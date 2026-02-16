import { PrismaClient } from "@prisma/client";

type MessageLinkRepositoryInput = {
  prisma: PrismaClient;
};

type UpsertMessageLinkInput = {
  chatId: bigint;
  messageId: bigint;
  sessionKey: string;
  scheduleId?: string | null;
  scheduleRunId?: string | null;
};

export type MessageLink = {
  chatId: bigint;
  messageId: bigint;
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
    chatId,
    messageId,
    sessionKey,
    scheduleId,
    scheduleRunId,
  }: UpsertMessageLinkInput): Promise<void> {
    await this.prisma.telegramMessageLink.upsert({
      where: {
        chatId_messageId: {
          chatId,
          messageId,
        },
      },
      create: {
        chatId,
        messageId,
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
    chatId,
    messageId,
  }: {
    chatId: bigint;
    messageId: bigint;
  }): Promise<MessageLink | null> {
    const link = await this.prisma.telegramMessageLink.findUnique({
      where: {
        chatId_messageId: {
          chatId,
          messageId,
        },
      },
      select: {
        chatId: true,
        messageId: true,
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
