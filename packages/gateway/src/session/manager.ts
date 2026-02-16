import { MessageRole, PrismaClient, type Message } from "@prisma/client";
import type { ModelMessage } from "ai";
import type { Context } from "grammy";
import type {
  DeriveSessionIdentityInput,
  PersistedMessageInput,
  SessionIdentity,
} from "./types.js";

type MessageLike = {
  message_thread_id?: number;
  reply_to_message?: {
    message_id?: number;
  };
};

type SessionManagerConstructorInput = {
  prisma: PrismaClient;
  maxMessagesPerSession?: number;
};

type GetMessagesInput = {
  identity: SessionIdentity;
  limit?: number;
};

type AppendMessageInput = {
  identity: SessionIdentity;
  message: PersistedMessageInput;
};

type AppendMessagesInput = {
  identity: SessionIdentity;
  messages: PersistedMessageInput[];
};

type ClearSessionInput = {
  identity: SessionIdentity;
};

export class SessionManager {
  private readonly prisma: PrismaClient;
  private readonly maxMessagesPerSession: number;

  constructor({
    prisma,
    maxMessagesPerSession = 120,
  }: SessionManagerConstructorInput) {
    this.prisma = prisma;
    this.maxMessagesPerSession = maxMessagesPerSession;
  }

  static deriveSessionIdentity({
    ctx,
    useReplyChainKey = false,
  }: DeriveSessionIdentityInput): SessionIdentity {
    if (!ctx.chat) {
      throw new Error("Cannot derive a session key without chat context.");
    }

    const chatId = BigInt(ctx.chat.id);
    const message = getMessageLike({ ctx });
    const threadId =
      typeof message?.message_thread_id === "number"
        ? BigInt(message.message_thread_id)
        : null;
    const replyToMessageId =
      typeof message?.reply_to_message?.message_id === "number"
        ? BigInt(message.reply_to_message.message_id)
        : null;

    if (useReplyChainKey && replyToMessageId !== null) {
      const key =
        threadId !== null
          ? `${chatId}:${threadId}:reply:${replyToMessageId}`
          : `${chatId}:reply:${replyToMessageId}`;

      return {
        key,
        chatId,
        threadId,
        replyToMessageId,
        scope: "reply-chain",
      };
    }

    if (threadId !== null) {
      return {
        key: `${chatId}:${threadId}`,
        chatId,
        threadId,
        replyToMessageId,
        scope: "topic",
      };
    }

    return {
      key: `${chatId}`,
      chatId,
      threadId: null,
      replyToMessageId,
      scope: "chat",
    };
  }

  static fromLinkedSessionKey({
    key,
    chatId,
    threadId,
    replyToMessageId,
  }: {
    key: string;
    chatId: bigint;
    threadId: bigint | null;
    replyToMessageId: bigint | null;
  }): SessionIdentity {
    return {
      key,
      chatId,
      threadId,
      replyToMessageId,
      scope: "reply-chain",
    };
  }

  async getMessages({ identity, limit }: GetMessagesInput): Promise<ModelMessage[]> {
    const session = await this.getOrCreateSession({ identity });
    const take = getEffectiveLimit({
      maxMessagesPerSession: this.maxMessagesPerSession,
      requestedLimit: limit,
    });

    const records = await this.prisma.message.findMany({
      where: { sessionId: session.id },
      orderBy: { createdAt: "desc" },
      take,
    });

    records.reverse();
    return records.map((record) => toCoreMessage({ record }));
  }

  async appendMessage({ identity, message }: AppendMessageInput): Promise<void> {
    const session = await this.getOrCreateSession({ identity });

    await this.prisma.message.create({
      data: {
        sessionId: session.id,
        role: message.role,
        content: message.content,
        metadata: message.metadata,
      },
    });

    await this.trimOverflow({ sessionId: session.id });
  }

  async appendMessages({ identity, messages }: AppendMessagesInput): Promise<void> {
    if (messages.length === 0) {
      return;
    }

    const session = await this.getOrCreateSession({ identity });
    await this.prisma.$transaction(
      messages.map((message) =>
        this.prisma.message.create({
          data: {
            sessionId: session.id,
            role: message.role,
            content: message.content,
            metadata: message.metadata,
          },
        }),
      ),
    );

    await this.trimOverflow({ sessionId: session.id });
  }

  async clearSession({ identity }: ClearSessionInput): Promise<void> {
    await this.prisma.session.deleteMany({
      where: { key: identity.key },
    });
  }

  private async getOrCreateSession({ identity }: { identity: SessionIdentity }) {
    return this.prisma.session.upsert({
      where: { key: identity.key },
      update: {
        chatId: identity.chatId,
        threadId: identity.threadId,
      },
      create: {
        key: identity.key,
        chatId: identity.chatId,
        threadId: identity.threadId,
      },
    });
  }

  private async trimOverflow({ sessionId }: { sessionId: string }): Promise<void> {
    const total = await this.prisma.message.count({
      where: { sessionId },
    });

    const overflowCount = total - this.maxMessagesPerSession;
    if (overflowCount <= 0) {
      return;
    }

    const oldestRecords = await this.prisma.message.findMany({
      where: { sessionId },
      orderBy: { createdAt: "asc" },
      select: { id: true },
      take: overflowCount,
    });

    if (oldestRecords.length === 0) {
      return;
    }

    await this.prisma.message.deleteMany({
      where: {
        id: {
          in: oldestRecords.map((record) => record.id),
        },
      },
    });
  }
}

function getMessageLike({ ctx }: { ctx: Context }): MessageLike | null {
  const message = (ctx.message ?? ctx.editedMessage) as MessageLike | undefined;
  if (!message) {
    return null;
  }

  return message;
}

function getEffectiveLimit({
  maxMessagesPerSession,
  requestedLimit,
}: {
  maxMessagesPerSession: number;
  requestedLimit: number | undefined;
}): number {
  if (typeof requestedLimit !== "number" || !Number.isFinite(requestedLimit)) {
    return maxMessagesPerSession;
  }

  const rounded = Math.floor(requestedLimit);
  if (rounded <= 0) {
    return 1;
  }

  return Math.min(rounded, maxMessagesPerSession);
}

function toCoreMessage({
  record,
}: {
  record: Pick<Message, "role" | "content">;
}): ModelMessage {
  if (record.role === MessageRole.system) {
    return {
      role: "system",
      content: record.content,
    };
  }

  if (record.role === MessageRole.user) {
    return {
      role: "user",
      content: record.content,
    };
  }

  return {
    role: "assistant",
    content: record.content,
  };
}
