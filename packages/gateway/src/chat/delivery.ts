import { randomUUID } from "node:crypto";
import { MessageRole } from "@prisma/client";
import type { MessageSender } from "./message-sender.js";
import type { SessionManager } from "../session/manager.js";
import type { MessageLinkRepository } from "../telegram/message-link.js";

type DeliverInput = {
  messageSender: MessageSender;
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
    messageSender,
    targetPlatformChatId,
    targetThreadId,
    text,
    seedContext,
  }: DeliverInput): Promise<DeliverResult> {
    const sendResult = await messageSender.sendMessage({
      platformChatId: targetPlatformChatId,
      text,
      threadId: targetThreadId,
    });

    const bridgeSessionKey = `bridge:${messageSender.platform}:${targetPlatformChatId}:${randomUUID()}`;

    const identity = {
      key: bridgeSessionKey,
      chatId: BigInt(targetPlatformChatId),
      threadId: targetThreadId ? BigInt(targetThreadId) : null,
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
      chatId: BigInt(targetPlatformChatId),
      messageId: BigInt(sendResult.platformMessageId),
      sessionKey: bridgeSessionKey,
    });

    return {
      platformMessageId: sendResult.platformMessageId,
      bridgeSessionKey,
    };
  }
}
