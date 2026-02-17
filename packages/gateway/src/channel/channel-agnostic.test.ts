import { describe, expect, it, vi } from "vitest";
import { SessionManager } from "../session/manager.js";
import { ChannelRouter } from "./router.js";
import type { ChannelAdapter, NormalizedInboundEvent } from "./types.js";

describe("Session identity derivation - platform namespaced", () => {
  it("produces platform-namespaced keys for chat scope", () => {
    const identity = SessionManager.deriveSessionIdentity({
      platform: "telegram",
      chatId: "12345",
    });

    expect(identity.key).toBe("telegram:12345");
    expect(identity.chatId).toBe("12345");
    expect(identity.scope).toBe("chat");
  });

  it("produces platform-namespaced keys for topic scope", () => {
    const identity = SessionManager.deriveSessionIdentity({
      platform: "telegram",
      chatId: "12345",
      threadId: "42",
    });

    expect(identity.key).toBe("telegram:12345:42");
    expect(identity.scope).toBe("topic");
  });

  it("produces platform-namespaced keys for reply-chain scope", () => {
    const identity = SessionManager.deriveSessionIdentity({
      platform: "telegram",
      chatId: "12345",
      threadId: "42",
      replyToMessageId: "99",
      useReplyChainKey: true,
    });

    expect(identity.key).toBe("telegram:12345:42:reply:99");
    expect(identity.scope).toBe("reply-chain");
  });

  it("produces different keys for different platforms with same chat ID", () => {
    const telegram = SessionManager.deriveSessionIdentity({
      platform: "telegram",
      chatId: "12345",
    });

    const discord = SessionManager.deriveSessionIdentity({
      platform: "discord",
      chatId: "12345",
    });

    expect(telegram.key).not.toBe(discord.key);
    expect(telegram.key).toBe("telegram:12345");
    expect(discord.key).toBe("discord:12345");
  });
});

describe("Non-numeric ID support", () => {
  it("supports string-based non-numeric chat IDs", () => {
    const identity = SessionManager.deriveSessionIdentity({
      platform: "discord",
      chatId: "channel-abc-123",
    });

    expect(identity.key).toBe("discord:channel-abc-123");
    expect(identity.chatId).toBe("channel-abc-123");
  });

  it("supports UUID-style IDs", () => {
    const identity = SessionManager.deriveSessionIdentity({
      platform: "slack",
      chatId: "C04BQRF7Q1A",
      threadId: "1703275200.123456",
    });

    expect(identity.key).toBe("slack:C04BQRF7Q1A:1703275200.123456");
    expect(identity.chatId).toBe("C04BQRF7Q1A");
    expect(identity.threadId).toBe("1703275200.123456");
  });
});

describe("ChannelRouter multi-adapter", () => {
  function createMockAdapter(platform: string): ChannelAdapter {
    return {
      platform,
      capabilities: {
        supportsDraft: false,
        supportsMarkdown: true,
        supportsTypingIndicator: false,
        supportsEditing: false,
      },
      sendMessage: vi.fn(async () => ({ platformMessageId: "1" })),
      start: vi.fn(async () => {}),
      stop: vi.fn(async () => {}),
    };
  }

  it("routes messages to the correct platform adapter", async () => {
    const router = new ChannelRouter();
    const telegram = createMockAdapter("telegram");
    const discord = createMockAdapter("discord");

    router.register({ adapter: telegram });
    router.register({ adapter: discord });

    const telegramAdapter = router.getAdapter({ platform: "telegram" });
    const discordAdapter = router.getAdapter({ platform: "discord" });

    await telegramAdapter.sendMessage({ chatId: "123", text: "Hello telegram" });
    await discordAdapter.sendMessage({ chatId: "456", text: "Hello discord" });

    expect(telegram.sendMessage).toHaveBeenCalledWith({
      chatId: "123",
      text: "Hello telegram",
    });
    expect(discord.sendMessage).toHaveBeenCalledWith({
      chatId: "456",
      text: "Hello discord",
    });
  });
});

describe("NormalizedInboundEvent shape", () => {
  it("can represent a Telegram-style event", () => {
    const event: NormalizedInboundEvent = {
      platform: "telegram",
      chatId: "-1001234567890",
      threadId: "42",
      senderId: "12345",
      messageId: "500",
      messageText: "Hello from Telegram",
      replyToMessageId: "99",
      replyToText: "Previous message",
      isEdited: false,
      draftSupported: true,
    };

    expect(event.platform).toBe("telegram");
    expect(event.chatId).toBe("-1001234567890");
    expect(event.messageId).toBe("500");
    expect(event.draftSupported).toBe(true);
  });

  it("can represent a Discord-style event with non-numeric IDs", () => {
    const event: NormalizedInboundEvent = {
      platform: "discord",
      chatId: "channel-abc-123",
      senderId: "user-xyz-456",
      messageId: "msg-789",
      messageText: "Hello from Discord",
      isEdited: false,
      draftSupported: false,
    };

    expect(event.platform).toBe("discord");
    expect(event.threadId).toBeUndefined();
    expect(event.draftSupported).toBe(false);
  });
});
