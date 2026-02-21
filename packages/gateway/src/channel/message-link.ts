import { and, eq } from "drizzle-orm";
import type { Database } from "../database/client.js";
import { channelMessageLinks } from "../database/schema.js";

type MessageLinkRepositoryInput = {
  db: Database;
};

type UpsertMessageLinkInput = {
  platform: string;
  platformChatId: string;
  platformMessageId: string;
  sessionKey: string;
  scheduleId?: string | null;
  scheduleRunId?: string | null;
};

export type MessageLink = {
  platform: string;
  platformChatId: string;
  platformMessageId: string;
  sessionKey: string;
  scheduleId: string | null;
  scheduleRunId: string | null;
};

export class MessageLinkRepository {
  private readonly db: Database;

  constructor({ db }: MessageLinkRepositoryInput) {
    this.db = db;
  }

  async upsertMessageLink({
    platform,
    platformChatId,
    platformMessageId,
    sessionKey,
    scheduleId,
    scheduleRunId,
  }: UpsertMessageLinkInput): Promise<void> {
    await this.db
      .insert(channelMessageLinks)
      .values({
        platform,
        platformChatId,
        platformMessageId,
        sessionKey,
        scheduleId: scheduleId ?? null,
        scheduleRunId: scheduleRunId ?? null,
      })
      .onConflictDoUpdate({
        target: [
          channelMessageLinks.platform,
          channelMessageLinks.platformChatId,
          channelMessageLinks.platformMessageId,
        ],
        set: {
          sessionKey,
          scheduleId: scheduleId ?? null,
          scheduleRunId: scheduleRunId ?? null,
        },
      });
  }

  async findByChatAndMessage({
    platform,
    platformChatId,
    platformMessageId,
  }: {
    platform: string;
    platformChatId: string;
    platformMessageId: string;
  }): Promise<MessageLink | null> {
    const link = await this.db.query.channelMessageLinks.findFirst({
      where: and(
        eq(channelMessageLinks.platform, platform),
        eq(channelMessageLinks.platformChatId, platformChatId),
        eq(channelMessageLinks.platformMessageId, platformMessageId),
      ),
      columns: {
        platform: true,
        platformChatId: true,
        platformMessageId: true,
        sessionKey: true,
        scheduleId: true,
        scheduleRunId: true,
      },
    });

    return link ?? null;
  }
}
