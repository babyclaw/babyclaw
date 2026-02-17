import { describe, expect, it, vi } from "vitest";
import { TelegramMessageSender } from "./telegram-sender.js";

function createMockApi(): any {
  return {
    sendMessage: vi.fn(async () => ({
      message_id: 42,
    })),
  };
}

describe("TelegramMessageSender", () => {
  it("sends a message and returns the stringified message id", async () => {
    const api = createMockApi();
    const sender = new TelegramMessageSender({ api });

    const result = await sender.sendMessage({
      platformChatId: "-1001234567890",
      text: "Hello world",
    });

    expect(result.platformMessageId).toBe("42");
    expect(api.sendMessage).toHaveBeenCalled();
  });

  it("has platform set to telegram", () => {
    const api = createMockApi();
    const sender = new TelegramMessageSender({ api });
    expect(sender.platform).toBe("telegram");
  });

  it("forwards threadId as message_thread_id", async () => {
    const api = createMockApi();
    const sender = new TelegramMessageSender({ api });

    await sender.sendMessage({
      platformChatId: "-1001234567890",
      text: "In a thread",
      threadId: "789",
    });

    const call = api.sendMessage.mock.calls[0];
    expect(call[2]).toMatchObject({ message_thread_id: 789 });
  });
});
