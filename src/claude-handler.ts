import { query } from "@anthropic-ai/claude-agent-sdk";
import type {
  Message,
  TextChannel,
  DMChannel,
  NewsChannel,
  ThreadChannel,
  VoiceChannel,
} from "discord.js";
import {
  getOrCreateSession,
  getSession,
  setSessionId,
  setBusy,
  setAbortController,
  setCwd,
} from "./session-manager.js";
import {
  splitMessage,
  extractTextFromContent,
  extractThinking,
  extractToolUses,
  formatToolActivity,
  escapeMd,
} from "./utils.js";

type SendableChannel =
  | TextChannel
  | DMChannel
  | NewsChannel
  | ThreadChannel
  | VoiceChannel;

const STREAM_UPDATE_INTERVAL = parseInt(
  process.env["STREAM_UPDATE_INTERVAL_MS"] ?? "1500",
  10,
);

export interface QueryContext {
  channelId: string;
  channel: SendableChannel;
  /** The initial Discord message to stream updates into. */
  replyMessage: Message;
}

/**
 * Runs a Claude Code query for a channel, streaming live updates into Discord.
 * Each channel gets its own independent session.
 */
export async function runClaudeQuery(
  prompt: string,
  ctx: QueryContext,
): Promise<void> {
  const key = ctx.channelId;
  const defaultCwd = process.env["DEFAULT_CWD"] ?? process.cwd();
  const session = getOrCreateSession(key, defaultCwd);

  if (session.busy) {
    await ctx.replyMessage
      .edit(
        "I am already processing a request. Use `/reset` to cancel it first.",
      )
      .catch(() => {});
    return;
  }

  const ac = new AbortController();
  // Set busy BEFORE any await to prevent race conditions
  setBusy(key, true);
  setAbortController(key, ac);

  // Keep typing indicator alive — Discord expires it after ~10s
  ctx.channel.sendTyping().catch(() => {});
  const typingInterval = setInterval(() => {
    ctx.channel.sendTyping().catch(() => {});
  }, 8000);

  // Build query options
  const resumeOption = session.sessionId ? { resume: session.sessionId } : {};
  const modelOption = process.env["CLAUDE_MODEL"]
    ? { model: process.env["CLAUDE_MODEL"] }
    : {};
  const maxTurnsOption = process.env["MAX_TURNS"]
    ? { maxTurns: parseInt(process.env["MAX_TURNS"], 10) }
    : {};

  const apiKeyEnv = process.env["ANTHROPIC_API_KEY"]
    ? { ANTHROPIC_API_KEY: process.env["ANTHROPIC_API_KEY"] }
    : {};

  const options = {
    cwd: session.cwd,
    permissionMode: "bypassPermissions" as const,
    allowDangerouslySkipPermissions: true,
    abortController: ac,
    systemPrompt: {
      type: "preset" as const,
      preset: "claude_code" as const,
      append: "Your nickname is Claudius. Do not use markdown tables.",
    },
    env: { ...process.env, ...apiKeyEnv } as Record<string, string>,
    ...resumeOption,
    ...modelOption,
    ...maxTurnsOption,
  };

  // State for streaming updates
  let accumulatedText = "";
  // Each entry corresponds to one Discord message slot in order.
  // slots[0] is always the initial reply; additional slots are overflow messages.
  const slots: Message[] = [ctx.replyMessage];
  let lastEditAt = 0;

  /**
   * Edits Discord message slots to reflect current accumulated content.
   * Throttled unless `final` is true. Allocates new messages for overflow chunks.
   */
  async function flushToDiscord(final = false): Promise<void> {
    const now = Date.now();
    if (!final && now - lastEditAt < STREAM_UPDATE_INTERVAL) return;
    lastEditAt = now;

    const displayText = accumulatedText || "_Thinking..._";
    const chunks = splitMessage(displayText);

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]!;
      if (i < slots.length) {
        // Update existing slot
        try {
          await slots[i]!.edit(chunk);
        } catch {
          // Message may have been deleted; continue
        }
      } else {
        // Allocate a new overflow message
        try {
          slots.push(await ctx.channel.send(chunk));
        } catch {
          break;
        }
      }
    }
  }

  try {
    const claudeQuery = query({ prompt, options });

    for await (const message of claudeQuery) {
      switch (message.type) {
        case "system": {
          switch (message.subtype) {
            case "init":
              if (message.session_id) {
                setSessionId(key, message.session_id);
                if (message.cwd) setCwd(key, message.cwd);
              }
              break;
            case "status":
              if ((message as { status?: string }).status === "compacting") {
                accumulatedText +=
                  (accumulatedText ? "\n\n" : "") + "-# *Compacting context…*";
                await flushToDiscord();
              }
              break;
            case "compact_boundary":
              accumulatedText +=
                (accumulatedText ? "\n\n" : "") + "-# *[Context compacted]*";
              await flushToDiscord();
              break;
            case "local_command_output":
              if ((message as { content?: string }).content?.trim()) {
                accumulatedText +=
                  (accumulatedText ? "\n\n" : "") +
                  (message as { content: string }).content;
                await flushToDiscord();
              }
              break;
            case "task_started":
              accumulatedText +=
                (accumulatedText ? "\n\n" : "") +
                `-# *Task started: ${escapeMd((message as { description: string }).description)}*`;
              await flushToDiscord();
              break;
            case "task_progress":
              accumulatedText +=
                (accumulatedText ? "\n\n" : "") +
                `-# *Task: ${escapeMd((message as { description: string }).description)}*`;
              await flushToDiscord();
              break;
            case "task_notification":
              accumulatedText +=
                (accumulatedText ? "\n\n" : "") +
                `-# *Task ${escapeMd((message as { status: string }).status)}: ${escapeMd((message as { summary: string }).summary)}*`;
              await flushToDiscord();
              break;
          }
          break;
        }

        case "tool_use_summary": {
          const summary = (message as { summary?: string }).summary;
          if (summary?.trim()) {
            accumulatedText +=
              (accumulatedText ? "\n\n" : "") + `-# *${escapeMd(summary)}*`;
            await flushToDiscord();
          }
          break;
        }

        case "assistant": {
          const content = message.message.content;

          const thinking = extractThinking(content);
          if (thinking) {
            accumulatedText += (accumulatedText ? "\n\n" : "") + thinking;
          }

          const toolNames = extractToolUses(content);
          if (toolNames.length > 0) {
            accumulatedText +=
              (accumulatedText ? "\n\n" : "") + formatToolActivity(toolNames);
          }

          const text = extractTextFromContent(content);
          if (text) {
            accumulatedText += (accumulatedText ? "\n\n" : "") + text;
          }

          await flushToDiscord();
          break;
        }

        case "result": {
          if (message.subtype === "success") {
            // result.result duplicates streamed assistant text; only use it as fallback
            if (!accumulatedText && message.result?.trim()) {
              accumulatedText = message.result;
            }
          } else {
            const errors =
              "errors" in message
                ? (message.errors as string[]).join(", ")
                : "";
            accumulatedText = `**Error** (${message.subtype})${errors ? ": " + errors : ""}`;
          }
          break;
        }

        default:
          break;
      }
    }

    // Final flush with complete content
    await flushToDiscord(true);
  } catch (error: unknown) {
    if (!ac.signal.aborted) {
      const msg = error instanceof Error ? error.message : String(error);
      await slots[slots.length - 1]!.edit(`**Error:** ${msg}`).catch(() => {});
    }
  } finally {
    clearInterval(typingInterval);
    // Only clear session state if we're still the active query.
    // If resetSession() ran while we were running, a new query may have already
    // taken over — don't overwrite its busy/abortController state.
    if (getSession(key)?.abortController === ac) {
      setBusy(key, false);
      setAbortController(key, null);
    }
  }
}
