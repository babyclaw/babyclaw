/**
 * Channel-agnostic helpers used by the AgentTurnOrchestrator.
 * Extracted from telegram/helpers.ts.
 */

export type ReplyReference = {
  messageId: string | null;
  text: string | null;
};

export function buildUserContent({
  messageText,
  replyReference,
}: {
  messageText: string;
  replyReference: ReplyReference | null;
}): string {
  if (!replyReference) {
    return messageText;
  }

  const replyIdLabel = replyReference.messageId ?? "unknown";
  const replyBody = replyReference.text?.trim() || "(non-text message)";

  return [
    `Reply context (message_id=${replyIdLabel}):`,
    replyBody,
    "",
    "User message:",
    messageText,
  ].join("\n");
}

export function getUserMetadata({
  replyReference,
}: {
  replyReference: ReplyReference | null;
}): string | undefined {
  if (!replyReference) {
    return undefined;
  }

  return JSON.stringify({
    replyToMessageId: replyReference.messageId,
    replyToText: replyReference.text,
  });
}

export function isCommandText({ text }: { text: string }): boolean {
  return text.startsWith("/");
}

const STOP_PHRASES = new Set([
  "stop",
  "cancel",
  "abort",
  "nevermind",
  "never mind",
  "nvm",
]);

export function isStopMessage({ text }: { text: string }): boolean {
  return STOP_PHRASES.has(text.toLowerCase());
}
