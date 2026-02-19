import { MessageRole, PrismaClient, type Message } from "@prisma/client";
import type { ModelMessage } from "ai";
import { buildUserContentFromMetadata } from "../agent/helpers.js";
import { getLogger } from "../logging/index.js";
import type {
  DeriveSessionIdentityInput,
  PersistedMessageInput,
  SessionIdentity,
} from "./types.js";

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
    platform,
    chatId,
    threadId: rawThreadId,
    replyToMessageId: rawReplyToMessageId,
    useReplyChainKey = false,
  }: DeriveSessionIdentityInput): SessionIdentity {
    const threadId = rawThreadId ?? null;
    const replyToMessageId = rawReplyToMessageId ?? null;
    const prefix = `${platform}:${chatId}`;

    if (useReplyChainKey && replyToMessageId !== null) {
      const key =
        threadId !== null
          ? `${prefix}:${threadId}:reply:${replyToMessageId}`
          : `${prefix}:reply:${replyToMessageId}`;

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
        key: `${prefix}:${threadId}`,
        chatId,
        threadId,
        replyToMessageId,
        scope: "topic",
      };
    }

    return {
      key: prefix,
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
    chatId: string;
    threadId: string | null;
    replyToMessageId: string | null;
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
      select: { role: true, content: true, metadata: true },
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

  async touchLastActivity({ sessionKey }: { sessionKey: string }): Promise<void> {
    await this.prisma.session.updateMany({
      where: { key: sessionKey },
      data: { lastActivityAt: new Date() },
    });
  }

  async updateMemoriesExtractedAt({ sessionKey }: { sessionKey: string }): Promise<void> {
    await this.prisma.session.updateMany({
      where: { key: sessionKey },
      data: { memoriesLastExtractedAt: new Date() },
    });
  }

  async findSessionsNeedingExtraction(): Promise<Array<{ key: string }>> {
    const log = getLogger().child({ component: "session-manager" });

    const sessions = await this.prisma.session.findMany({
      where: {
        key: { not: { startsWith: "schedule:" } },
        OR: [
          { memoriesLastExtractedAt: null },
          {
            lastActivityAt: { not: null },
            memoriesLastExtractedAt: { not: null },
          },
        ],
      },
      select: { key: true, lastActivityAt: true, memoriesLastExtractedAt: true },
    });

    log.info(
      { candidateCount: sessions.length },
      "Found candidate sessions for memory extraction",
    );

    const result = sessions.filter((s) => {
      if (!s.memoriesLastExtractedAt) return true;
      if (!s.lastActivityAt) return false;
      return s.memoriesLastExtractedAt < s.lastActivityAt;
    });

    log.info(
      { candidateCount: sessions.length, qualifiedCount: result.length },
      "Filtered sessions needing memory extraction",
    );

    return result;
  }

  async getRawMessages({ sessionKey }: { sessionKey: string }): Promise<{
    sessionCreatedAt: Date;
    messages: Array<{ role: string; content: string }>;
  } | null> {
    const session = await this.prisma.session.findUnique({
      where: { key: sessionKey },
    });
    if (!session) return null;

    const records = await this.prisma.message.findMany({
      where: { sessionId: session.id },
      orderBy: { createdAt: "asc" },
      select: { role: true, content: true },
    });

    return {
      sessionCreatedAt: session.createdAt,
      messages: records.map((r) => ({ role: r.role, content: r.content })),
    };
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
        chatId: BigInt(identity.chatId),
        threadId: identity.threadId ? BigInt(identity.threadId) : null,
      },
      create: {
        key: identity.key,
        chatId: BigInt(identity.chatId),
        threadId: identity.threadId ? BigInt(identity.threadId) : null,
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
  record: Pick<Message, "role" | "content" | "metadata">;
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
      content: buildUserContentFromMetadata({
        content: record.content,
        metadata: record.metadata,
      }),
    };
  }

  return {
    role: "assistant",
    content: record.content,
  };
}
