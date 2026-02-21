/**
 * Channel-agnostic helpers used by the AgentTurnOrchestrator.
 * Extracted from telegram/helpers.ts.
 */

import { readFileSync, existsSync } from "node:fs";
import type { ImagePart, TextPart, UserContent } from "ai";
import type { ImageAttachment } from "../channel/types.js";

export type ReplyReference = {
  messageId: string | null;
  text: string | null;
};

function buildTextContent({
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

export function buildUserContent({
  messageText,
  replyReference,
  images,
}: {
  messageText: string;
  replyReference: ReplyReference | null;
  images?: ImageAttachment[];
}): UserContent {
  const text = buildTextContent({ messageText, replyReference });

  if (!images || images.length === 0) {
    return text;
  }

  const parts: Array<TextPart | ImagePart> = [];

  if (text.length > 0) {
    parts.push({ type: "text", text });
  }

  for (const img of images) {
    parts.push({
      type: "image",
      image: readFileSync(img.localPath),
      mediaType: img.mimeType,
    });
  }

  return parts;
}

export function buildUserContentFromMetadata({
  content,
  metadata,
}: {
  content: string;
  metadata: string | null;
}): UserContent {
  if (!metadata) return content;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(metadata);
  } catch {
    return content;
  }

  const imagePaths = parsed.images as Array<{ localPath: string; mimeType: string }> | undefined;
  if (!imagePaths || imagePaths.length === 0) return content;

  const parts: Array<TextPart | ImagePart> = [];

  if (content.length > 0) {
    parts.push({ type: "text", text: content });
  }

  for (const img of imagePaths) {
    if (existsSync(img.localPath)) {
      parts.push({
        type: "image",
        image: readFileSync(img.localPath),
        mediaType: img.mimeType,
      });
    } else {
      parts.push({
        type: "text",
        text: `[The user had attached an image here, but the file is no longer available]`,
      });
    }
  }

  return parts.length === 1 && parts[0].type === "text" ? parts[0].text : parts;
}

export function getUserMetadata({
  replyReference,
  images,
}: {
  replyReference: ReplyReference | null;
  images?: ImageAttachment[];
}): string | undefined {
  const hasReply = !!replyReference;
  const hasImages = images && images.length > 0;

  if (!hasReply && !hasImages) {
    return undefined;
  }

  return JSON.stringify({
    ...(replyReference && {
      replyToMessageId: replyReference.messageId,
      replyToText: replyReference.text,
    }),
    ...(hasImages && {
      images: images.map((img) => ({
        localPath: img.localPath,
        mimeType: img.mimeType,
      })),
    }),
  });
}

export function extractTextFromUserContent({ content }: { content: UserContent }): string {
  if (typeof content === "string") return content;
  return content
    .filter((part): part is TextPart => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}

export function isCommandText({ text }: { text: string }): boolean {
  return text.startsWith("/");
}

const STOP_PHRASES = new Set(["stop", "cancel", "abort", "nevermind", "never mind", "nvm"]);

export function isStopMessage({ text }: { text: string }): boolean {
  return STOP_PHRASES.has(text.toLowerCase());
}
