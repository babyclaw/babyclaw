import type { MessageRole } from "@prisma/client";

type SessionScope = "chat" | "topic" | "reply-chain";

export type SessionIdentity = {
  key: string;
  chatId: string;
  threadId: string | null;
  replyToMessageId: string | null;
  scope: SessionScope;
};

export type DeriveSessionIdentityInput = {
  platform: string;
  chatId: string;
  threadId?: string | null;
  replyToMessageId?: string | null;
  useReplyChainKey?: boolean;
};

export type SessionState = {
  sessionIdentity?: SessionIdentity;
  isMainSession?: boolean;
};

export type PersistedMessageInput = {
  role: MessageRole;
  content: string;
  metadata?: string;
};
