import type { BetaContentBlock, BetaThinkingBlock, BetaToolUseBlock } from '@anthropic-ai/sdk/resources/beta/messages/messages';

// Maximum safe Discord message length (Discord limit is 2000, leave margin)
const DISCORD_MAX_LENGTH = 1900;

/**
 * Splits text into chunks that fit within Discord's message limit.
 * Prefers splitting at double-newline, then single newline, then space.
 * Tracks code fences so splits never leave an unclosed fence.
 */
export function splitMessage(text: string, limit = DISCORD_MAX_LENGTH): string[] {
  if (text.length <= limit) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= limit) {
      chunks.push(remaining);
      break;
    }

    const window = remaining.slice(0, limit);

    // Detect if we're inside a code block at the split point
    const fenceCount = (window.match(/```/g) ?? []).length;
    const insideCodeBlock = fenceCount % 2 !== 0;

    // Find best split point
    let splitAt = window.lastIndexOf('\n\n');
    if (splitAt === -1 || splitAt < limit * 0.5) {
      splitAt = window.lastIndexOf('\n');
    }
    if (splitAt === -1 || splitAt < limit * 0.5) {
      splitAt = window.lastIndexOf(' ');
    }
    if (splitAt === -1) {
      splitAt = limit;
    }

    let chunk = remaining.slice(0, splitAt).trimEnd();

    // Close any open code fence before splitting
    if (insideCodeBlock) {
      chunk += '\n```';
    }

    chunks.push(chunk);
    remaining = remaining.slice(splitAt).trimStart();

    // Re-open code fence at start of next chunk
    if (insideCodeBlock && remaining.length > 0) {
      remaining = '```\n' + remaining;
    }
  }

  return chunks;
}

/**
 * Extracts concatenated text from SDK assistant message content blocks.
 */
export function extractTextFromContent(
  content: BetaContentBlock[]
): string {
  return content
    .filter((block) => block.type === 'text')
    .map((block) => block.text as string)
    .join('\n');
}

/**
 * Formats thinking blocks as Discord small text (-# prefix per line).
 * Redacted thinking blocks are skipped (encrypted gibberish).
 */
export function extractThinking(content: BetaContentBlock[]): string {
  const parts: string[] = [];
  for (const block of content) {
    if (block.type === 'thinking') {
      const lines = (block as BetaThinkingBlock).thinking
        .split('\n')
        .filter((l) => l.trim());
      parts.push(lines.map((l) => `-# > ${escapeMd(l)}`).join('\n'));
    }
    // redacted_thinking is encrypted gibberish — skip
  }
  return parts.join('\n');
}

export interface ToolUse {
  name: string;
  input: Record<string, unknown>;
}

/**
 * Returns tool name + input for all tool_use blocks in a content array.
 */
export function extractToolUses(content: BetaContentBlock[]): ToolUse[] {
  return content
    .filter((block): block is BetaToolUseBlock => block.type === 'tool_use')
    .map((block) => ({ name: block.name, input: block.input as Record<string, unknown> }));
}

/**
 * Formats tool uses as -# small text lines.
 * Example: -# > Bash: `command=ls /foo`
 */
export function formatToolActivity(tools: ToolUse[]): string {
  if (tools.length === 0) return '';
  return tools
    .map((t) => {
      const pairs = Object.entries(t.input)
        .map(([k, v]) => {
          const val = JSON.stringify(v)
          const inner = `${k}=${val}`;
          // Use double backticks if content contains backticks (standard Markdown, Discord-supported)
          if (inner.includes('`')) {
            const padded = (inner.startsWith('`') || inner.endsWith('`')) ? ` ${inner} ` : inner;
            return `\`\`${padded}\`\``;
          }
          return `\`${inner}\``;
        })
        .join(' ');
      return `-# ${escapeMd(t.name)}: ${pairs}`;
    })
    .join('\n');
}

/**
 * Escapes backticks in text that appears outside of code spans in Discord markdown.
 * Prevents unmatched backticks from breaking inline-code formatting in -# lines.
 */
export function escapeMd(text: string): string {
  return text.replace(/`/g, '\\`');
}

/**
 * Strips Discord mention syntax from text and trims whitespace.
 */
export function stripMentions(text: string): string {
  return text.replace(/<@!?\d+>/g, '').trim();
}

/**
 * Truncates a string to maxLength, appending "…" if truncated.
 */
export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 1) + '…';
}

/**
 * Formats milliseconds into a human-readable duration string.
 */
export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

/**
 * Formats a USD cost value to 4 decimal places.
 */
export function formatCost(usd: number): string {
  return `$${usd.toFixed(4)}`;
}
