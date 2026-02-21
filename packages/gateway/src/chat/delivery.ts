import { randomUUID } from "node:crypto";
import { MessageRole } from "../database/schema.js";
import type { ChannelSender } from "../channel/types.js";
import type { SessionManager } from "../session/manager.js";
import type { MessageLinkRepository } from "../channel/message-link.js";

type DeliverInput = {
  channelSender: ChannelSender;
  targetPlatformChatId: string;
  targetThreadId?: string;
  text: string;
  seedContext: string;
};

type DeliverResult = {
  platformMessageId: string;
  bridgeSessionKey: string;
};

type CrossChatDeliveryServiceInput = {
  sessionManager: SessionManager;
  messageLinkRepository: MessageLinkRepository;
};

export class CrossChatDeliveryService {
  private readonly sessionManager: SessionManager;
  private readonly messageLinkRepository: MessageLinkRepository;

  constructor({
    sessionManager,
    messageLinkRepository,
  }: CrossChatDeliveryServiceInput) {
    this.sessionManager = sessionManager;
    this.messageLinkRepository = messageLinkRepository;
  }

  async deliver({
    channelSender,
    targetPlatformChatId,
    targetThreadId,
    text,
    seedContext,
  }: DeliverInput): Promise<DeliverResult> {
    const sendResult = await channelSender.sendMessage({
      chatId: targetPlatformChatId,
      text,
      threadId: targetThreadId,
    });

    const bridgeSessionKey = `bridge:${channelSender.platform}:${targetPlatformChatId}:${randomUUID()}`;

    const identity = {
      key: bridgeSessionKey,
      chatId: targetPlatformChatId,
      threadId: targetThreadId ?? null,
      replyToMessageId: null,
      scope: "chat" as const,
    };

    const seedMessages = [
      {
        role: MessageRole.system,
        content: seedContext,
      },
      {
        role: MessageRole.assistant,
        content: text,
      },
    ];

    await this.sessionManager.appendMessages({
      identity,
      messages: seedMessages,
    });

    await this.messageLinkRepository.upsertMessageLink({
      platform: channelSender.platform,
      platformChatId: targetPlatformChatId,
      platformMessageId: sendResult.platformMessageId,
      sessionKey: bridgeSessionKey,
    });

    return {
      platformMessageId: sendResult.platformMessageId,
      bridgeSessionKey,
    };
  }
}
