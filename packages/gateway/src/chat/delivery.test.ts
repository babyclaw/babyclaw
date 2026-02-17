import { describe, expect, it, vi } from "vitest";
import { CrossChatDeliveryService } from "./delivery.js";
import type { MessageSender } from "./message-sender.js";

function createMockMessageSender(): MessageSender {
  return {
    platform: "test-platform",
    sendMessage: vi.fn(async () => ({
      platformMessageId: "100",
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
  it("calls messageSender.sendMessage with correct params", async () => {
    const messageSender = createMockMessageSender();
    const sessionManager = createMockSessionManager();
    const messageLinkRepository = createMockMessageLinkRepository();
    const service = new CrossChatDeliveryService({ sessionManager, messageLinkRepository });

    await service.deliver({
      messageSender,
      targetPlatformChatId: "-1001234",
      text: "Hello family",
      seedContext: "Owner requested a greeting",
    });

    expect(messageSender.sendMessage).toHaveBeenCalledWith({
      platformChatId: "-1001234",
      text: "Hello family",
      threadId: undefined,
    });
  });

  it("creates a bridge session with seed context and assistant text", async () => {
    const messageSender = createMockMessageSender();
    const sessionManager = createMockSessionManager();
    const messageLinkRepository = createMockMessageLinkRepository();
    const service = new CrossChatDeliveryService({ sessionManager, messageLinkRepository });

    await service.deliver({
      messageSender,
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
    const messageSender = createMockMessageSender();
    const sessionManager = createMockSessionManager();
    const messageLinkRepository = createMockMessageLinkRepository();
    const service = new CrossChatDeliveryService({ sessionManager, messageLinkRepository });

    const result = await service.deliver({
      messageSender,
      targetPlatformChatId: "-1001234",
      text: "Hello",
      seedContext: "test",
    });

    expect(messageLinkRepository.upsertMessageLink).toHaveBeenCalledWith({
      chatId: BigInt("-1001234"),
      messageId: BigInt("100"),
      sessionKey: result.bridgeSessionKey,
    });
  });

  it("generates unique bridge session keys per delivery", async () => {
    const messageSender = createMockMessageSender();
    const sessionManager = createMockSessionManager();
    const messageLinkRepository = createMockMessageLinkRepository();
    const service = new CrossChatDeliveryService({ sessionManager, messageLinkRepository });

    const result1 = await service.deliver({
      messageSender,
      targetPlatformChatId: "-1001234",
      text: "First",
      seedContext: "ctx",
    });

    const result2 = await service.deliver({
      messageSender,
      targetPlatformChatId: "-1001234",
      text: "Second",
      seedContext: "ctx",
    });

    expect(result1.bridgeSessionKey).not.toBe(result2.bridgeSessionKey);
  });

  it("forwards threadId when provided", async () => {
    const messageSender = createMockMessageSender();
    const sessionManager = createMockSessionManager();
    const messageLinkRepository = createMockMessageLinkRepository();
    const service = new CrossChatDeliveryService({ sessionManager, messageLinkRepository });

    await service.deliver({
      messageSender,
      targetPlatformChatId: "-1001234",
      targetThreadId: "789",
      text: "In thread",
      seedContext: "ctx",
    });

    expect(messageSender.sendMessage).toHaveBeenCalledWith({
      platformChatId: "-1001234",
      text: "In thread",
      threadId: "789",
    });

    const sessionCall = sessionManager.appendMessages.mock.calls[0][0];
    expect(sessionCall.identity.threadId).toBe(BigInt(789));
  });

  it("returns platformMessageId and bridgeSessionKey", async () => {
    const messageSender = createMockMessageSender();
    const sessionManager = createMockSessionManager();
    const messageLinkRepository = createMockMessageLinkRepository();
    const service = new CrossChatDeliveryService({ sessionManager, messageLinkRepository });

    const result = await service.deliver({
      messageSender,
      targetPlatformChatId: "-1001234",
      text: "test",
      seedContext: "ctx",
    });

    expect(result.platformMessageId).toBe("100");
    expect(result.bridgeSessionKey).toMatch(/^bridge:test-platform:-1001234:/);
  });
});
