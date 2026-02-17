import { PrismaClient } from "@prisma/client";

type MessageLinkRepositoryInput = {
  prisma: PrismaClient;
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
  private readonly prisma: PrismaClient;

  constructor({ prisma }: MessageLinkRepositoryInput) {
    this.prisma = prisma;
  }

  async upsertMessageLink({
    platform,
    platformChatId,
    platformMessageId,
    sessionKey,
    scheduleId,
    scheduleRunId,
  }: UpsertMessageLinkInput): Promise<void> {
    await this.prisma.channelMessageLink.upsert({
      where: {
        platform_platformChatId_platformMessageId: {
          platform,
          platformChatId,
          platformMessageId,
        },
      },
      create: {
        platform,
        platformChatId,
        platformMessageId,
        sessionKey,
        scheduleId: scheduleId ?? null,
        scheduleRunId: scheduleRunId ?? null,
      },
      update: {
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
    const link = await this.prisma.channelMessageLink.findUnique({
      where: {
        platform_platformChatId_platformMessageId: {
          platform,
          platformChatId,
          platformMessageId,
        },
      },
      select: {
        platform: true,
        platformChatId: true,
        platformMessageId: true,
        sessionKey: true,
        scheduleId: true,
        scheduleRunId: true,
      },
    });

    if (!link) {
      return null;
    }

    return link;
  }
}
