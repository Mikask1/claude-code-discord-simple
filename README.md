# claude-code-discord

A Discord bot powered by the [Claude Agent SDK](https://platform.claude.com/docs/en/agent-sdk/overview) that brings Claude Code into your Discord channels. Each channel gets its own persistent, resumable Claude Code session with full tool access — read/write files, run shell commands, browse the web, and more.

## Prerequisites

- **Bun** — install from [bun.sh](https://bun.sh) or `npm install -g bun`
- **Claude Code** — must be installed on the machine running the bot:
  ```bash
  npm install -g @anthropic-ai/claude-code
  ```
- **Anthropic API key** — get one at [console.anthropic.com](https://console.anthropic.com/settings/keys), or authenticate via `claude login` instead

## 1. Create a Discord Application

1. Go to [discord.com/developers/applications](https://discord.com/developers/applications)
2. Click **New Application** and give it a name
3. Go to **Bot** in the left sidebar
4. Click **Reset Token** and copy the token — you will need it shortly
5. Under **Privileged Gateway Intents**, enable **Message Content Intent**
6. Go to **General Information** and copy the **Application ID** (your Client ID)

## 2. Invite the Bot to Your Server

Build an invite URL by replacing `YOUR_CLIENT_ID` below:

```
https://discord.com/api/oauth2/authorize?client_id=YOUR_CLIENT_ID&permissions=277025467392&scope=bot%20applications.commands
```

Open the URL in your browser, select your server, and authorize.

The permission integer `277025467392` grants: Send Messages, Read Message History, Use Slash Commands, Embed Links, Attach Files, and Add Reactions.

## 3. Configure the Bot

```bash
cp .env.example .env
```

Open `.env` and fill in:

```env
DISCORD_TOKEN=your_bot_token_here
DISCORD_CLIENT_ID=your_application_id_here
ANTHROPIC_API_KEY=your_api_key_here
DISCORD_GUILD_ID=your_server_id_here    # recommended during development
DEFAULT_CWD=/path/to/your/project       # where Claude Code will read/write files
```

**Finding your server ID:** In Discord, go to Settings → Advanced → enable Developer Mode. Then right-click your server icon → Copy Server ID.

**`DISCORD_GUILD_ID`** restricts slash command registration to one server, making it instant. Leave it blank for global deployment (commands take up to 1 hour to propagate everywhere).

## 4. Install Dependencies

```bash
bun install
```

## 5. Start the Bot

```bash
bun start
```

You should see:

```
Logged in as YourBot#1234
Slash commands registered to guild 123456789012345678 (instant)
Bot is ready.
```

For development with auto-restart on file changes:

```bash
bun dev
```

---

## Using the Bot

### Slash Commands

| Command | Description |
|---------|-------------|
| `/ask <prompt>` | Send a prompt to Claude Code. Your session is maintained across messages. |
| `/reset` | Start a fresh session (also cancels any in-progress query). |
| `/session` | Show your session ID, working directory, status, and recent sessions. |
| `/cwd [path]` | Show or change the working directory for your Claude Code session. |

### @Mentions and Direct Messages

You can also interact with the bot without slash commands:

- **Mention in a channel:** `@YourBot fix the bug in auth.ts`
- **Direct message:** just send a message directly to the bot

The bot replies in-place and streams the response as Claude works through it.

### How Sessions Work

Each **channel** has its own Claude Code session shared by everyone in it. Conversation history is preserved across `/ask` calls — Claude remembers what was discussed earlier in the channel. Use `/reset` to wipe the channel's session and start completely fresh.

Different channels are fully isolated — work in `#project-a` won't affect `#project-b`. Discord threads each get their own session too.

When the bot restarts, in-memory sessions are cleared. Your next `/ask` will automatically start a new session.

### Live Streaming

As Claude responds, the bot edits its reply message in real time. You will see:

- `> Using tool: Bash...` while Claude is executing commands
- Accumulated response text as it is generated
- A footer like `*4s · $0.0012*` when complete

---

## Troubleshooting

**Slash commands do not appear**
- Check the bot logs for "Slash commands registered" — if it failed, check your token and client ID
- If using global registration (no `DISCORD_GUILD_ID`), wait up to 1 hour
- Try kicking and re-inviting the bot using the invite URL in Step 2

**Bot does not respond to @mentions**
- Confirm you enabled the **Message Content Intent** in the Discord Developer Portal
- Re-invite the bot if you changed intents after the initial invite

**Claude authentication errors**
- Run `claude` in a terminal on the same machine to re-authenticate
- The bot inherits Claude Code's credentials from the user running the bot process

**File operation errors or permission denied**
- Check that `DEFAULT_CWD` points to an existing directory: `ls $DEFAULT_CWD`
- The OS user running the bot must have read/write access to that directory

**Bot shows "I am already working on something"**
- A previous query is still running. Use `/reset` to cancel it and start fresh.

---

## Security Notes

This bot runs Claude Code with `permissionMode: "bypassPermissions"`, which means Claude can read and write files, execute shell commands, and perform any action Claude Code supports — all without asking for approval.

- Only add this bot to servers and channels you fully trust
- Set `DEFAULT_CWD` to a project directory, not your entire home folder
- The bot is intended for personal or small-team use

---

## Configuration Reference

All settings live in `.env`:

| Variable | Required | Description |
|----------|----------|-------------|
| `DISCORD_TOKEN` | Yes | Bot token from the Discord Developer Portal |
| `DISCORD_CLIENT_ID` | Yes | Application ID from the Discord Developer Portal |
| `ANTHROPIC_API_KEY` | Yes* | API key from console.anthropic.com (*or use `claude login`) |
| `DISCORD_GUILD_ID` | No | Server ID for instant slash command registration (development) |
| `DEFAULT_CWD` | No | Working directory for Claude Code (defaults to `process.cwd()`) |
| `CLAUDE_MODEL` | No | Override the Claude model (e.g. `claude-opus-4-6`) |
| `MAX_TURNS` | No | Maximum agentic turns per query (no limit by default) |
| `STREAM_UPDATE_INTERVAL_MS` | No | Discord message edit interval in ms (default: `3000`) |
