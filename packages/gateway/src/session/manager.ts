import { asc, count, desc, eq, inArray, not } from "drizzle-orm";
import type { ModelMessage } from "ai";
import { buildUserContentFromMetadata } from "../agent/helpers.js";
import type { Database } from "../database/client.js";
import {
  MessageRole,
  messages,
  sessions,
  type Message,
} from "../database/schema.js";
import { getLogger } from "../logging/index.js";
import type {
  DeriveSessionIdentityInput,
  PersistedMessageInput,
  SessionIdentity,
} from "./types.js";

type SessionManagerConstructorInput = {
  db: Database;
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
  private readonly db: Database;
  private readonly maxMessagesPerSession: number;

  constructor({
    db,
    maxMessagesPerSession = 120,
  }: SessionManagerConstructorInput) {
    this.db = db;
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

    const records = await this.db
      .select({
        role: messages.role,
        content: messages.content,
        metadata: messages.metadata,
      })
      .from(messages)
      .where(eq(messages.sessionId, session.id))
      .orderBy(desc(messages.createdAt))
      .limit(take);

    records.reverse();
    return records.map((record) => toCoreMessage({ record }));
  }

  async appendMessage({ identity, message }: AppendMessageInput): Promise<void> {
    const session = await this.getOrCreateSession({ identity });

    await this.db.insert(messages).values({
      sessionId: session.id,
      role: message.role,
      content: message.content,
      metadata: message.metadata,
    });

    await this.trimOverflow({ sessionId: session.id });
  }

  async appendMessages({ identity, messages: msgs }: AppendMessagesInput): Promise<void> {
    if (msgs.length === 0) {
      return;
    }

    const session = await this.getOrCreateSession({ identity });
    await this.db.insert(messages).values(
      msgs.map((msg) => ({
        sessionId: session.id,
        role: msg.role,
        content: msg.content,
        metadata: msg.metadata,
      })),
    );

    await this.trimOverflow({ sessionId: session.id });
  }

  async touchLastActivity({ sessionKey }: { sessionKey: string }): Promise<void> {
    await this.db
      .update(sessions)
      .set({ lastActivityAt: new Date() })
      .where(eq(sessions.key, sessionKey));
  }

  async updateMemoriesExtractedAt({ sessionKey }: { sessionKey: string }): Promise<void> {
    await this.db
      .update(sessions)
      .set({ memoriesLastExtractedAt: new Date() })
      .where(eq(sessions.key, sessionKey));
  }

  async getWorkingMemory({ sessionKey }: { sessionKey: string }): Promise<string | null> {
    const session = await this.db.query.sessions.findFirst({
      where: eq(sessions.key, sessionKey),
      columns: { workingMemory: true },
    });
    return session?.workingMemory ?? null;
  }

  async updateWorkingMemory({ sessionKey, content }: { sessionKey: string; content: string }): Promise<void> {
    await this.db
      .update(sessions)
      .set({ workingMemory: content })
      .where(eq(sessions.key, sessionKey));
  }

  async getTitle({ sessionKey }: { sessionKey: string }): Promise<string | null> {
    const session = await this.db.query.sessions.findFirst({
      where: eq(sessions.key, sessionKey),
      columns: { title: true },
    });
    return session?.title ?? null;
  }

  async setTitle({ sessionKey, title }: { sessionKey: string; title: string }): Promise<void> {
    await this.db
      .update(sessions)
      .set({ title })
      .where(eq(sessions.key, sessionKey));
  }

  async findSessionsNeedingExtraction(): Promise<Array<{ key: string }>> {
    const log = getLogger().child({ component: "session-manager" });

    const allSessions = await this.db
      .select({
        key: sessions.key,
        lastActivityAt: sessions.lastActivityAt,
        memoriesLastExtractedAt: sessions.memoriesLastExtractedAt,
      })
      .from(sessions)
      .where(not(eq(sessions.key, "")));

    const candidates = allSessions.filter(
      (s) => !s.key.startsWith("schedule:"),
    );

    log.info(
      { candidateCount: candidates.length },
      "Found candidate sessions for memory extraction",
    );

    const result = candidates.filter((s) => {
      if (!s.memoriesLastExtractedAt) return true;
      if (!s.lastActivityAt) return false;
      return s.memoriesLastExtractedAt < s.lastActivityAt;
    });

    log.info(
      { candidateCount: candidates.length, qualifiedCount: result.length },
      "Filtered sessions needing memory extraction",
    );

    return result;
  }

  async getRawMessages({ sessionKey }: { sessionKey: string }): Promise<{
    sessionCreatedAt: Date;
    messages: Array<{ role: string; content: string }>;
  } | null> {
    const session = await this.db.query.sessions.findFirst({
      where: eq(sessions.key, sessionKey),
    });
    if (!session) return null;

    const records = await this.db
      .select({ role: messages.role, content: messages.content })
      .from(messages)
      .where(eq(messages.sessionId, session.id))
      .orderBy(asc(messages.createdAt));

    return {
      sessionCreatedAt: session.createdAt,
      messages: records.map((r) => ({ role: r.role, content: r.content })),
    };
  }

  async clearSession({ identity }: ClearSessionInput): Promise<void> {
    await this.db.delete(sessions).where(eq(sessions.key, identity.key));
  }

  private async getOrCreateSession({ identity }: { identity: SessionIdentity }) {
    const chatId = Number(identity.chatId);
    const threadId = identity.threadId ? Number(identity.threadId) : null;

    const rows = await this.db
      .insert(sessions)
      .values({
        key: identity.key,
        chatId,
        threadId,
      })
      .onConflictDoUpdate({
        target: sessions.key,
        set: { chatId, threadId },
      })
      .returning();

    return rows[0];
  }

  private async trimOverflow({ sessionId }: { sessionId: string }): Promise<void> {
    const [result] = await this.db
      .select({ total: count() })
      .from(messages)
      .where(eq(messages.sessionId, sessionId));

    const overflowCount = result.total - this.maxMessagesPerSession;
    if (overflowCount <= 0) {
      return;
    }

    const oldestRecords = await this.db
      .select({ id: messages.id })
      .from(messages)
      .where(eq(messages.sessionId, sessionId))
      .orderBy(asc(messages.createdAt))
      .limit(overflowCount);

    if (oldestRecords.length === 0) {
      return;
    }

    await this.db.delete(messages).where(
      inArray(
        messages.id,
        oldestRecords.map((r) => r.id),
      ),
    );
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
