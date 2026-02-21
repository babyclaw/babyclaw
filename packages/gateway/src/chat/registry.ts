import { and, asc, eq, isNotNull } from "drizzle-orm";
import type { Database } from "../database/client.js";
import { chats, type Chat } from "../database/schema.js";

type ChatRegistryInput = {
  db: Database;
};

type UpsertInput = {
  platform: string;
  platformChatId: string;
  type: string;
  title?: string | null;
};

type PlatformChatIdentifier = {
  platform: string;
  platformChatId: string;
};

type LinkInput = {
  platform: string;
  platformChatId: string;
  alias: string;
};

type ResolveAliasInput = {
  platform: string;
  alias: string;
};

type ListLinkedChatsInput = {
  platform?: string;
};

export class ChatRegistry {
  private readonly db: Database;

  constructor({ db }: ChatRegistryInput) {
    this.db = db;
  }

  async upsert({ platform, platformChatId, type, title }: UpsertInput): Promise<Chat> {
    const rows = await this.db
      .insert(chats)
      .values({
        platform,
        platformChatId,
        type,
        title: title ?? null,
      })
      .onConflictDoUpdate({
        target: [chats.platform, chats.platformChatId],
        set: {
          type,
          ...(title !== undefined ? { title: title ?? null } : {}),
        },
      })
      .returning();

    return rows[0];
  }

  async markAsMain({ platform, platformChatId }: PlatformChatIdentifier): Promise<Chat> {
    await this.db.update(chats).set({ isMain: false }).where(eq(chats.isMain, true));

    const rows = await this.db
      .update(chats)
      .set({ isMain: true, linkedAt: new Date() })
      .where(and(eq(chats.platform, platform), eq(chats.platformChatId, platformChatId)))
      .returning();

    return rows[0];
  }

  async link({ platform, platformChatId, alias }: LinkInput): Promise<Chat> {
    const rows = await this.db
      .update(chats)
      .set({ alias, linkedAt: new Date() })
      .where(and(eq(chats.platform, platform), eq(chats.platformChatId, platformChatId)))
      .returning();

    return rows[0];
  }

  async unlink({ platform, platformChatId }: PlatformChatIdentifier): Promise<Chat> {
    const rows = await this.db
      .update(chats)
      .set({ alias: null, linkedAt: null })
      .where(and(eq(chats.platform, platform), eq(chats.platformChatId, platformChatId)))
      .returning();

    return rows[0];
  }

  async isLinked({ platform, platformChatId }: PlatformChatIdentifier): Promise<boolean> {
    const chat = await this.db.query.chats.findFirst({
      where: and(eq(chats.platform, platform), eq(chats.platformChatId, platformChatId)),
      columns: { linkedAt: true },
    });

    return chat?.linkedAt !== null && chat?.linkedAt !== undefined;
  }

  async listLinkedChats({ platform }: ListLinkedChatsInput = {}): Promise<Chat[]> {
    return this.db.query.chats.findMany({
      where: and(isNotNull(chats.linkedAt), ...(platform ? [eq(chats.platform, platform)] : [])),
      orderBy: [asc(chats.createdAt)],
    });
  }

  async resolveAlias({ platform, alias }: ResolveAliasInput): Promise<Chat | null> {
    const chat = await this.db.query.chats.findFirst({
      where: and(eq(chats.platform, platform), eq(chats.alias, alias)),
    });
    return chat ?? null;
  }

  async findById({ id }: { id: string }): Promise<Chat | null> {
    const chat = await this.db.query.chats.findFirst({
      where: eq(chats.id, id),
    });
    return chat ?? null;
  }

  async getMainChat(): Promise<Chat | null> {
    const chat = await this.db.query.chats.findFirst({
      where: eq(chats.isMain, true),
    });
    return chat ?? null;
  }
}
