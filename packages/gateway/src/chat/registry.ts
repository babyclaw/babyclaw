import type { Chat, PrismaClient } from "@prisma/client";

type ChatRegistryInput = {
  prisma: PrismaClient;
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
  private readonly prisma: PrismaClient;

  constructor({ prisma }: ChatRegistryInput) {
    this.prisma = prisma;
  }

  async upsert({ platform, platformChatId, type, title }: UpsertInput): Promise<Chat> {
    return this.prisma.chat.upsert({
      where: {
        platform_platformChatId: { platform, platformChatId },
      },
      create: {
        platform,
        platformChatId,
        type,
        title: title ?? null,
      },
      update: {
        type,
        title: title ?? undefined,
      },
    });
  }

  async markAsMain({ platform, platformChatId }: PlatformChatIdentifier): Promise<Chat> {
    await this.prisma.chat.updateMany({
      where: { isMain: true },
      data: { isMain: false },
    });

    return this.prisma.chat.update({
      where: {
        platform_platformChatId: { platform, platformChatId },
      },
      data: {
        isMain: true,
        linkedAt: new Date(),
      },
    });
  }

  async link({ platform, platformChatId, alias }: LinkInput): Promise<Chat> {
    return this.prisma.chat.update({
      where: {
        platform_platformChatId: { platform, platformChatId },
      },
      data: {
        alias,
        linkedAt: new Date(),
      },
    });
  }

  async unlink({ platform, platformChatId }: PlatformChatIdentifier): Promise<Chat> {
    return this.prisma.chat.update({
      where: {
        platform_platformChatId: { platform, platformChatId },
      },
      data: {
        alias: null,
        linkedAt: null,
      },
    });
  }

  async isLinked({ platform, platformChatId }: PlatformChatIdentifier): Promise<boolean> {
    const chat = await this.prisma.chat.findUnique({
      where: {
        platform_platformChatId: { platform, platformChatId },
      },
      select: { linkedAt: true },
    });

    return chat?.linkedAt !== null && chat?.linkedAt !== undefined;
  }

  async listLinkedChats({ platform }: ListLinkedChatsInput = {}): Promise<Chat[]> {
    return this.prisma.chat.findMany({
      where: {
        linkedAt: { not: null },
        ...(platform ? { platform } : {}),
      },
      orderBy: { createdAt: "asc" },
    });
  }

  async resolveAlias({ platform, alias }: ResolveAliasInput): Promise<Chat | null> {
    return this.prisma.chat.findUnique({
      where: {
        platform_alias: { platform, alias },
      },
    });
  }

  async findById({ id }: { id: string }): Promise<Chat | null> {
    return this.prisma.chat.findUnique({
      where: { id },
    });
  }

  async getMainChat(): Promise<Chat | null> {
    return this.prisma.chat.findFirst({
      where: { isMain: true },
    });
  }
}
