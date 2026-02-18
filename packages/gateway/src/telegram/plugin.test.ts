import { describe, expect, it, vi } from "vitest";
import { TelegramAdapter } from "./plugin.js";

function createMockChatRegistry(): any {
  return {
    upsert: vi.fn(async () => {}),
    getMainChat: vi.fn(async () => null),
    markAsMain: vi.fn(async () => {}),
    isLinked: vi.fn(async () => true),
    link: vi.fn(async () => {}),
    unlink: vi.fn(async () => {}),
    listLinkedChats: vi.fn(async () => []),
  };
}

function createMockSchedulerService(): any {
  return {
    listSchedules: vi.fn(async () => []),
    getTimezone: vi.fn(() => "UTC"),
  };
}

function createMockMessageLinkRepository(): any {
  return {
    upsertMessageLink: vi.fn(async () => {}),
    findByChatAndMessage: vi.fn(async () => null),
  };
}

function createAdapter() {
  return new TelegramAdapter({
    token: "test-token",
    workspacePath: "/tmp/test-workspace",
    chatRegistry: createMockChatRegistry(),
    schedulerService: createMockSchedulerService(),
    messageLinkRepository: createMockMessageLinkRepository(),
  });
}

describe("TelegramAdapter", () => {
  it("has platform set to telegram", () => {
    const adapter = createAdapter();
    expect(adapter.platform).toBe("telegram");
  });

  it("reports correct capabilities", () => {
    const adapter = createAdapter();
    expect(adapter.capabilities).toEqual({
      supportsDraft: true,
      supportsMarkdown: true,
      supportsTypingIndicator: true,
      supportsEditing: false,
    });
  });

  it("implements ChannelAdapter interface (has sendMessage + sendImage + sendFile + start + stop)", () => {
    const adapter = createAdapter();
    expect(typeof adapter.sendMessage).toBe("function");
    expect(typeof adapter.sendImage).toBe("function");
    expect(typeof adapter.sendFile).toBe("function");
    expect(typeof adapter.streamDraft).toBe("function");
    expect(typeof adapter.start).toBe("function");
    expect(typeof adapter.stop).toBe("function");
    expect(adapter.platform).toBe("telegram");
    expect(adapter.capabilities).toBeDefined();
  });

  it("sendMessage throws if bot not started", async () => {
    const adapter = createAdapter();
    await expect(
      adapter.sendMessage({ chatId: "123", text: "hello" }),
    ).rejects.toThrow("bot not started");
  });

  it("sendImage throws if bot not started", async () => {
    const adapter = createAdapter();
    await expect(
      adapter.sendImage({ chatId: "123", filePath: "/tmp/photo.jpg" }),
    ).rejects.toThrow("bot not started");
  });

  it("sendFile throws if bot not started", async () => {
    const adapter = createAdapter();
    await expect(
      adapter.sendFile({ chatId: "123", filePath: "/tmp/photo.jpg", fileType: "image" }),
    ).rejects.toThrow("bot not started");
  });

  it("stop is safe to call without start", async () => {
    const adapter = createAdapter();
    await expect(adapter.stop()).resolves.toBeUndefined();
  });
});
