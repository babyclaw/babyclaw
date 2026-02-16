import type { Context } from "grammy";
import type { MessageRole } from "@prisma/client";

export type SessionScope = "chat" | "topic" | "reply-chain";

export type SessionIdentity = {
  key: string;
  chatId: bigint;
  threadId: bigint | null;
  replyToMessageId: bigint | null;
  scope: SessionScope;
};

export type DeriveSessionIdentityInput = {
  ctx: Context;
  useReplyChainKey?: boolean;
};

export type SessionState = {
  sessionIdentity?: SessionIdentity;
};

export type PersistedMessageInput = {
  role: MessageRole;
  content: string;
  metadata?: string;
};
