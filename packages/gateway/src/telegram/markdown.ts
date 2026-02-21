import type { Api, Context } from "grammy";

/**
 * Characters that must be escaped in Telegram MarkdownV2 outside of
 * code blocks and inline code spans.
 */
const MARKDOWN_V2_SPECIAL = /[_*[\]()~`>#+\-=|{}.!\\]/g;

/**
 * Escape a plain-text string for Telegram MarkdownV2.
 * Use this when the input contains NO markdown formatting and should
 * appear as literal text.
 */
export function escapeMarkdownV2({ text }: { text: string }): string {
  return text.replace(MARKDOWN_V2_SPECIAL, "\\$&");
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

type Segment =
  | { kind: "codeblock"; lang: string; body: string }
  | { kind: "inline_code"; body: string }
  | { kind: "text"; body: string };

/**
 * Split the input into code blocks, inline code, and everything else.
 * Code regions are returned verbatim (no escaping needed in MarkdownV2).
 */
function tokenize({ text }: { text: string }): Segment[] {
  const segments: Segment[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    // --- fenced code block: ```lang\n…``` ---
    const codeBlockMatch = remaining.match(/^```(\w*)\n?([\s\S]*?)```/);
    if (codeBlockMatch) {
      segments.push({
        kind: "codeblock",
        lang: codeBlockMatch[1],
        body: codeBlockMatch[2],
      });
      remaining = remaining.slice(codeBlockMatch[0].length);
      continue;
    }

    // --- inline code: `…` ---
    const inlineCodeMatch = remaining.match(/^`([^`]+)`/);
    if (inlineCodeMatch) {
      segments.push({ kind: "inline_code", body: inlineCodeMatch[1] });
      remaining = remaining.slice(inlineCodeMatch[0].length);
      continue;
    }

    // --- plain text: consume up to the next ``` or ` ---
    const nextCode = remaining.search(/```|`[^`]/);
    if (nextCode === -1) {
      segments.push({ kind: "text", body: remaining });
      remaining = "";
    } else if (nextCode === 0) {
      // Unmatched ``` or ` – consume one character as text to avoid infinite loop
      segments.push({ kind: "text", body: remaining[0] });
      remaining = remaining.slice(1);
    } else {
      segments.push({ kind: "text", body: remaining.slice(0, nextCode) });
      remaining = remaining.slice(nextCode);
    }
  }

  return segments;
}

// Placeholder byte used to mark formatting boundaries during conversion.
const P = "\x01";

/**
 * Convert inline markdown formatting inside a plain-text segment
 * to Telegram MarkdownV2, escaping everything else.
 */
function convertTextSegment({ body }: { body: string }): string {
  let text = body;

  // 1. Replace formatting with placeholders so escaping won't touch them.
  //    Order matters: bold (** / __) before italic (* / _).

  // Bold: **…**
  text = text.replace(/\*\*(.+?)\*\*/g, `${P}BOLD_S${P}$1${P}BOLD_E${P}`);

  // Italic: *…* (must come after bold replacement)
  text = text.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, `${P}ITALIC_S${P}$1${P}ITALIC_E${P}`);

  // Strikethrough: ~~…~~
  text = text.replace(/~~(.+?)~~/g, `${P}STRIKE_S${P}$1${P}STRIKE_E${P}`);

  // Links: [text](url)
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, `${P}LINK_S${P}$1${P}LINK_M${P}$2${P}LINK_E${P}`);

  // 2. Split on placeholders, escape non-placeholder pieces,
  //    then reassemble.
  const placeholderRe = new RegExp(`${P}[A-Z_]+${P}`, "g");
  const tokens = text.split(placeholderRe);
  const placeholders = text.match(placeholderRe) ?? [];

  let result = "";
  for (let i = 0; i < tokens.length; i++) {
    result += escapeMarkdownV2({ text: tokens[i] });
    if (i < placeholders.length) {
      result += placeholders[i];
    }
  }

  // 3. Restore placeholders with MarkdownV2 syntax.
  result = result
    .replaceAll(`${P}BOLD_S${P}`, "*")
    .replaceAll(`${P}BOLD_E${P}`, "*")
    .replaceAll(`${P}ITALIC_S${P}`, "_")
    .replaceAll(`${P}ITALIC_E${P}`, "_")
    .replaceAll(`${P}STRIKE_S${P}`, "~")
    .replaceAll(`${P}STRIKE_E${P}`, "~");

  // Links need special handling: link text is already escaped,
  // but the URL only needs `)` and `\` escaped.
  const linkRe = new RegExp(`${P}LINK_S${P}(.*?)${P}LINK_M${P}(.*?)${P}LINK_E${P}`, "g");
  result = result.replace(linkRe, (_match, linkText: string, url: string) => {
    const escapedUrl = url.replace(/[)\\]/g, "\\$&");
    return `[${linkText}](${escapedUrl})`;
  });

  return result;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Convert a standard-markdown string (as produced by the AI) into
 * Telegram MarkdownV2 format.
 *
 * Handles: bold, italic, strikethrough, inline code, fenced code blocks,
 * and links.  Everything else is escaped so Telegram won't reject it.
 */
export function toTelegramMarkdownV2({ text }: { text: string }): string {
  const segments = tokenize({ text });

  return segments
    .map((seg) => {
      switch (seg.kind) {
        case "codeblock": {
          const lang = seg.lang ? seg.lang + "\n" : "";
          return "```" + lang + seg.body + "```";
        }
        case "inline_code":
          return "`" + seg.body + "`";
        case "text":
          return convertTextSegment({ body: seg.body });
      }
    })
    .join("");
}

// ---------------------------------------------------------------------------
// Safe-send helpers (MarkdownV2 with plain-text fallback)
// ---------------------------------------------------------------------------

type ReplyMarkdownV2Input = {
  ctx: Context;
  text: string;
};

/**
 * Reply with MarkdownV2 formatting.  If Telegram rejects the formatted
 * message (e.g. due to a conversion edge-case), automatically retries
 * as plain text so the message is never lost.
 */
export async function replyMarkdownV2({ ctx, text }: ReplyMarkdownV2Input) {
  try {
    return await ctx.reply(toTelegramMarkdownV2({ text }), {
      parse_mode: "MarkdownV2",
    });
  } catch {
    return await ctx.reply(text);
  }
}

type SendMessageMarkdownV2Input = {
  api: Api;
  chatId: string;
  text: string;
  options?: Record<string, unknown>;
};

/**
 * Send a message with MarkdownV2 formatting via the raw API,
 * falling back to plain text on failure.
 */
export async function sendMessageMarkdownV2({
  api,
  chatId,
  text,
  options = {},
}: SendMessageMarkdownV2Input) {
  try {
    return await api.sendMessage(chatId, toTelegramMarkdownV2({ text }), {
      ...options,
      parse_mode: "MarkdownV2",
    });
  } catch {
    return await api.sendMessage(chatId, text, options);
  }
}
