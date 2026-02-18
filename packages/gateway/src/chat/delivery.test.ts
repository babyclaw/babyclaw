import { describe, expect, it, vi } from "vitest";
import { CrossChatDeliveryService } from "./delivery.js";
import type { ChannelSender } from "../channel/types.js";

function createMockChannelSender(): ChannelSender {
  return {
    platform: "test-platform",
    sendMessage: vi.fn(async () => ({
      platformMessageId: "100",
    })),
    sendImage: vi.fn(async () => ({
      platformMessageId: "101",
    })),
    sendFile: vi.fn(async () => ({
      platformMessageId: "102",
    })),
  };
}

function createMockSessionManager(): any {
  return {
    appendMessages: vi.fn(async () => {}),
  };
}

function createMockMessageLinkRepository(): any {
  return {
    upsertMessageLink: vi.fn(async () => {}),
  };
}

describe("CrossChatDeliveryService", () => {
  it("calls channelSender.sendMessage with correct params", async () => {
    const channelSender = createMockChannelSender();
    const sessionManager = createMockSessionManager();
    const messageLinkRepository = createMockMessageLinkRepository();
    const service = new CrossChatDeliveryService({ sessionManager, messageLinkRepository });

    await service.deliver({
      channelSender,
      targetPlatformChatId: "-1001234",
      text: "Hello family",
      seedContext: "Owner requested a greeting",
    });

    expect(channelSender.sendMessage).toHaveBeenCalledWith({
      chatId: "-1001234",
      text: "Hello family",
      threadId: undefined,
    });
  });

  it("creates a bridge session with seed context and assistant text", async () => {
    const channelSender = createMockChannelSender();
    const sessionManager = createMockSessionManager();
    const messageLinkRepository = createMockMessageLinkRepository();
    const service = new CrossChatDeliveryService({ sessionManager, messageLinkRepository });

    await service.deliver({
      channelSender,
      targetPlatformChatId: "-1001234",
      text: "Hello family",
      seedContext: "Owner requested a greeting",
    });

    expect(sessionManager.appendMessages).toHaveBeenCalledOnce();
    const call = sessionManager.appendMessages.mock.calls[0][0];
    expect(call.identity.key).toMatch(/^bridge:test-platform:-1001234:/);
    expect(call.messages).toHaveLength(2);
    expect(call.messages[0].role).toBe("system");
    expect(call.messages[0].content).toBe("Owner requested a greeting");
    expect(call.messages[1].role).toBe("assistant");
    expect(call.messages[1].content).toBe("Hello family");
  });

  it("creates a message link pointing to the bridge session", async () => {
    const channelSender = createMockChannelSender();
    const sessionManager = createMockSessionManager();
    const messageLinkRepository = createMockMessageLinkRepository();
    const service = new CrossChatDeliveryService({ sessionManager, messageLinkRepository });

    const result = await service.deliver({
      channelSender,
      targetPlatformChatId: "-1001234",
      text: "Hello",
      seedContext: "test",
    });

    expect(messageLinkRepository.upsertMessageLink).toHaveBeenCalledWith({
      platform: "test-platform",
      platformChatId: "-1001234",
      platformMessageId: "100",
      sessionKey: result.bridgeSessionKey,
    });
  });

  it("generates unique bridge session keys per delivery", async () => {
    const channelSender = createMockChannelSender();
    const sessionManager = createMockSessionManager();
    const messageLinkRepository = createMockMessageLinkRepository();
    const service = new CrossChatDeliveryService({ sessionManager, messageLinkRepository });

    const result1 = await service.deliver({
      channelSender,
      targetPlatformChatId: "-1001234",
      text: "First",
      seedContext: "ctx",
    });

    const result2 = await service.deliver({
      channelSender,
      targetPlatformChatId: "-1001234",
      text: "Second",
      seedContext: "ctx",
    });

    expect(result1.bridgeSessionKey).not.toBe(result2.bridgeSessionKey);
  });

  it("forwards threadId when provided", async () => {
    const channelSender = createMockChannelSender();
    const sessionManager = createMockSessionManager();
    const messageLinkRepository = createMockMessageLinkRepository();
    const service = new CrossChatDeliveryService({ sessionManager, messageLinkRepository });

    await service.deliver({
      channelSender,
      targetPlatformChatId: "-1001234",
      targetThreadId: "789",
      text: "In thread",
      seedContext: "ctx",
    });

    expect(channelSender.sendMessage).toHaveBeenCalledWith({
      chatId: "-1001234",
      text: "In thread",
      threadId: "789",
    });

    const sessionCall = sessionManager.appendMessages.mock.calls[0][0];
    expect(sessionCall.identity.threadId).toBe("789");
  });

  it("returns platformMessageId and bridgeSessionKey", async () => {
    const channelSender = createMockChannelSender();
    const sessionManager = createMockSessionManager();
    const messageLinkRepository = createMockMessageLinkRepository();
    const service = new CrossChatDeliveryService({ sessionManager, messageLinkRepository });

    const result = await service.deliver({
      channelSender,
      targetPlatformChatId: "-1001234",
      text: "test",
      seedContext: "ctx",
    });

    expect(result.platformMessageId).toBe("100");
    expect(result.bridgeSessionKey).toMatch(/^bridge:test-platform:-1001234:/);
  });
});
