import 'dotenv/config';
import {
  Client,
  GatewayIntentBits,
  Events,
  REST,
  Routes,
  SlashCommandBuilder,
  MessageFlags,
  TextChannel,
  NewsChannel,
  ThreadChannel,
  VoiceChannel,
  type ChatInputCommandInteraction,
  type Message,
  type Interaction,
} from 'discord.js';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { runClaudeQuery } from './claude-handler.js';
import {
  getSession,
  getOrCreateSession,
  resetSession,
  interruptQuery,
  setCwd,
} from './session-manager.js';
import { stripMentions } from './utils.js';

// ── Env validation ────────────────────────────────────────────────────────────

const DISCORD_TOKEN = process.env['DISCORD_TOKEN'];
const DISCORD_CLIENT_ID = process.env['DISCORD_CLIENT_ID'];
const DEFAULT_CWD = process.env['DEFAULT_CWD'] ?? process.cwd();
const CLAUDIUS_CHANNELS = (process.env['CLAUDIUS_CHANNELS'] ?? 'claudius')
  .split(',')
  .map((s) => s.trim().toLowerCase());

if (!DISCORD_TOKEN || !DISCORD_CLIENT_ID) {
  console.error('ERROR: DISCORD_TOKEN and DISCORD_CLIENT_ID must be set in .env');
  process.exit(1);
}

// ── Slash command definitions ─────────────────────────────────────────────────

const commands = [
  new SlashCommandBuilder()
    .setName('ask')
    .setDescription('Send a prompt to Claude Code')
    .addStringOption((opt) =>
      opt.setName('prompt').setDescription('Your prompt or task').setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('reset')
    .setDescription('Reset your Claude Code session and start fresh'),

  new SlashCommandBuilder()
    .setName('cwd')
    .setDescription('Get or set the working directory for your Claude Code session')
    .addStringOption((opt) =>
      opt
        .setName('path')
        .setDescription('New working directory path (omit to show current)')
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('new')
    .setDescription('Create a new Claude Code thread in this channel'),
];

// ── Command registration ──────────────────────────────────────────────────────

async function registerCommands(): Promise<void> {
  const rest = new REST().setToken(DISCORD_TOKEN!);
  const guildId = process.env['DISCORD_GUILD_ID'];
  const body = commands.map((c) => c.toJSON());

  try {
    if (guildId) {
      await rest.put(Routes.applicationGuildCommands(DISCORD_CLIENT_ID!, guildId), { body });
      console.log(`Slash commands registered to guild ${guildId} (instant)`);
    } else {
      await rest.put(Routes.applicationCommands(DISCORD_CLIENT_ID!), { body });
      console.log('Slash commands registered globally (may take up to 1 hour to propagate)');
    }
  } catch (error) {
    console.error('Failed to register slash commands:', error);
  }
}

// ── Discord client ────────────────────────────────────────────────────────────

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

function isSendableChannel(ch: unknown): ch is TextChannel | NewsChannel | ThreadChannel | VoiceChannel {
  return (
    ch instanceof TextChannel ||
    ch instanceof NewsChannel ||
    ch instanceof ThreadChannel ||
    ch instanceof VoiceChannel
  );
}

function isInAllowedThread(channel: unknown): channel is ThreadChannel {
  if (!(channel instanceof ThreadChannel)) return false;
  const parent = channel.parent;
  if (!parent) return false;
  return CLAUDIUS_CHANNELS.some((c) => c === parent.id || c === parent.name.toLowerCase());
}

async function requireThread(interaction: ChatInputCommandInteraction): Promise<boolean> {
  if (interaction.channel instanceof ThreadChannel) return true;
  await interaction.reply({ content: 'Please use Claudius in a thread.', flags: MessageFlags.Ephemeral });
  return false;
}

// ── Slash command handlers ────────────────────────────────────────────────────

async function handleAsk(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!await requireThread(interaction)) return;

  const { channelId } = interaction;
  const session = getOrCreateSession(channelId, DEFAULT_CWD);

  if (session.busy) {
    await interaction.reply({
      content: 'I am already working on something in this channel. Use `/reset` to cancel it first.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const prompt = interaction.options.getString('prompt', true);

  // Defer — Claude can take many seconds; this extends the response window to 15 min
  await interaction.deferReply();
  const replyMessage = (await interaction.fetchReply()) as Message;

  if (!isSendableChannel(interaction.channel)) {
    await interaction.editReply('Cannot send messages in this channel type.');
    return;
  }

  await runClaudeQuery(prompt, {
    channelId,
    channel: interaction.channel,
    replyMessage,
  });
}

async function handleReset(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!await requireThread(interaction)) return;

  const { channelId } = interaction;
  const session = getSession(channelId);
  const wasBusy = session?.busy ?? false;

  resetSession(channelId);

  await interaction.reply({
    content: wasBusy
      ? 'Resetting session and clearing thread…'
      : 'Resetting session and clearing thread…',
    flags: MessageFlags.Ephemeral,
  });

  // Delete all messages in the thread
  const thread = interaction.channel as ThreadChannel;
  try {
    let fetched: Awaited<ReturnType<typeof thread.messages.fetch>>;
    do {
      fetched = await thread.messages.fetch({ limit: 100 });
      if (fetched.size === 0) break;
      await thread.bulkDelete(fetched, true).catch(async () => {
        // bulkDelete fails for messages >14 days old; fall back to individual deletes
        for (const msg of fetched.values()) {
          await msg.delete().catch(() => {});
        }
      });
    } while (fetched.size === 100);
  } catch {
    // Thread may be inaccessible
  }
}

async function handleCwd(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!await requireThread(interaction)) return;

  const { channelId } = interaction;
  const session = getOrCreateSession(channelId, DEFAULT_CWD);
  const newPath = interaction.options.getString('path');

  if (!newPath) {
    await interaction.reply({
      content: `Current working directory: \`${session.cwd}\``,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const resolved = path.resolve(newPath);

  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    await interaction.reply({
      content: `Path does not exist or is not a directory: \`${resolved}\``,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  setCwd(channelId, resolved);
  await interaction.reply({
    content: `Working directory updated to: \`${resolved}\`\n_Takes effect on your next query._`,
    flags: MessageFlags.Ephemeral,
  });
}

async function handleNew(interaction: ChatInputCommandInteraction): Promise<void> {
  // Resolve the target channel: use the thread's parent if we're in a thread
  const targetChannel = interaction.channel instanceof ThreadChannel
    ? interaction.channel.parent
    : interaction.channel;

  if (!(targetChannel instanceof TextChannel) && !(targetChannel instanceof NewsChannel)) {
    await interaction.reply({
      content: 'Cannot create a thread in this channel type.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const isClaudiusChannel = CLAUDIUS_CHANNELS.some(
    (c) => c === targetChannel.id || c === targetChannel.name.toLowerCase()
  );
  if (!isClaudiusChannel) {
    await interaction.reply({
      content: 'You can only create Claudius threads in a designated Claudius channel.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const shortId = Math.random().toString(36).slice(2, 8);
  
  await targetChannel.threads.create({
    name: `Chat-${shortId}`,
    autoArchiveDuration: 1440,
  });
}

// ── Interaction handler ───────────────────────────────────────────────────────

client.on(Events.InteractionCreate, async (interaction: Interaction) => {
  if (!interaction.isChatInputCommand()) return;

  try {
    switch (interaction.commandName) {
      case 'ask':   await handleAsk(interaction);   break;
      case 'reset': await handleReset(interaction); break;
      case 'cwd':   await handleCwd(interaction);   break;
      case 'new':   await handleNew(interaction);   break;
      default:
        await interaction.reply({ content: 'Unknown command.', flags: MessageFlags.Ephemeral });
    }
  } catch (error) {
    console.error(`Error in command "${interaction.commandName}":`, error);
    const msg = 'An unexpected error occurred.';
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(msg);
      } else {
        await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
      }
    } catch {
      // Interaction may have expired
    }
  }
});

// ── Message handler (auto-reply in allowed threads) ──────────────────────────

client.on(Events.MessageCreate, async (message: Message) => {
  if (message.author.bot) return;
  if (!isInAllowedThread(message.channel)) return;

  // If the message mentions anyone, only respond if the bot itself is tagged
  const hasMentions = message.mentions.users.size > 0 || message.mentions.roles.size > 0;
  const mentionsBot = client.user != null && message.mentions.has(client.user);
  if (hasMentions && !mentionsBot) return;

  const { channelId } = message;
  const session = getOrCreateSession(channelId, DEFAULT_CWD);

  // Any new message interrupts the current query but preserves session history
  if (session.busy) {
    interruptQuery(channelId);
  }

  const prompt = stripMentions(message.content).trim();
  if (!prompt) return;

  if (!isSendableChannel(message.channel)) return;

  const replyMessage = await message.reply('_Thinking..._');

  await runClaudeQuery(prompt, {
    channelId,
    channel: message.channel,
    replyMessage,
  }); 
});

// ── Thread handler (auto-join every new thread) ───────────────────────────────

client.on(Events.ThreadCreate, async (thread) => {
  try {
    await thread.join();
  } catch {
    // Thread may be inaccessible or already joined
  }
});

// ── Ready ─────────────────────────────────────────────────────────────────────

client.once(Events.ClientReady, async (c) => {
  console.log(`Logged in as ${c.user.tag}`);
  await registerCommands();
  console.log('Bot is ready.');
});

// ── Health check server ──────────────────────

const port = process.env['PORT'] ? parseInt(process.env['PORT']) : 3000;
Bun.serve({ port, fetch: () => new Response('OK') });

// Keep Render free tier alive by self-pinging every 10 minutes
const RENDER_URL = process.env['RENDER_EXTERNAL_URL'];
if (RENDER_URL) {
  setInterval(() => fetch(RENDER_URL).catch(() => {}), 10 * 60 * 1000);
}

// ── Start ─────────────────────────────────────────────────────────────────────

client.login(DISCORD_TOKEN);
