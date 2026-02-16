import { Context } from "grammy";
import { SessionManager } from "../session/manager.js";
import type { SessionIdentity, SessionState } from "../session/types.js";
import type { MessageLinkRepository } from "./message-link.js";

export class BotContext extends Context {
  state: SessionState = {};
}

export type ReplyReference = {
  raw: any;
  messageId: number | null;
  text: string | null;
};

export function getSessionIdentity({
  ctx,
  useReplyChainKey,
}: {
  ctx: BotContext;
  useReplyChainKey: boolean;
}): SessionIdentity {
  if (ctx.state.sessionIdentity) {
    return ctx.state.sessionIdentity;
  }

  return SessionManager.deriveSessionIdentity({
    ctx,
    useReplyChainKey,
  });
}

export async function deriveLinkedSessionIdentity({
  ctx,
  messageLinkRepository,
}: {
  ctx: BotContext;
  messageLinkRepository: MessageLinkRepository;
}): Promise<SessionIdentity | null> {
  if (!ctx.chat) {
    return null;
  }

  const replyToMessageId = getReplyToMessageId({ ctx });
  if (replyToMessageId === null) {
    return null;
  }

  const link = await messageLinkRepository.findByChatAndMessage({
    chatId: BigInt(ctx.chat.id),
    messageId: BigInt(replyToMessageId),
  });

  if (!link) {
    return null;
  }

  const messageThreadId = getMessageThreadId({ ctx });

  return SessionManager.fromLinkedSessionKey({
    key: link.sessionKey,
    chatId: BigInt(ctx.chat.id),
    threadId: messageThreadId === undefined ? null : BigInt(messageThreadId),
    replyToMessageId: BigInt(replyToMessageId),
  });
}

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

  const replyIdLabel =
    replyReference.messageId === null
      ? "unknown"
      : replyReference.messageId.toString();
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

export function getMessageThreadId({ ctx }: { ctx: BotContext }): number | undefined {
  const message = (ctx.message ?? ctx.editedMessage) as
    | { message_thread_id?: number }
    | undefined;
  if (!message || typeof message.message_thread_id !== "number") {
    return undefined;
  }

  return message.message_thread_id;
}

export function getDirectMessagesTopicId({
  ctx,
}: {
  ctx: BotContext;
}): bigint | null {
  const message = (ctx.message ?? ctx.editedMessage) as
    | {
        direct_messages_topic?: {
          topic_id?: number;
        };
      }
    | undefined;

  const topicId = message?.direct_messages_topic?.topic_id;
  if (typeof topicId !== "number") {
    return null;
  }

  return BigInt(topicId);
}

export function getReplyToMessageId({ ctx }: { ctx: BotContext }): number | null {
  const message = ctx.message as
    | {
        reply_to_message?: {
          message_id?: number;
        };
      }
    | undefined;

  const messageId = message?.reply_to_message?.message_id;
  return typeof messageId === "number" ? messageId : null;
}

export function getReplyReference({ ctx }: { ctx: BotContext }): ReplyReference | null {
  const message = (ctx.message ?? ctx.editedMessage) as
    | {
        reply_to_message?: {
          message_id?: number;
          text?: string;
          caption?: string;
        };
      }
    | undefined;

  const reply = message?.reply_to_message;
  if (!reply) {
    return null;
  }

  return {
    raw: reply,
    messageId: typeof reply.message_id === "number" ? reply.message_id : null,
    text:
      typeof reply.text === "string"
        ? reply.text
        : typeof reply.caption === "string"
          ? reply.caption
          : null,
  };
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
