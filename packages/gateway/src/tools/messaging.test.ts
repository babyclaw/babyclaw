import { describe, expect, it, vi } from "vitest";
import type { ToolExecutionContext } from "../utils/tool-context.js";
import { createMessagingTools } from "./messaging.js";

function makeChatRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: "chat-1",
    platform: "telegram",
    platformChatId: "-1001234",
    type: "group",
    title: "Family Group",
    alias: "family",
    isMain: false,
    linkedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function createMocks() {
  const chatRegistry = {
    resolveAlias: vi.fn(),
    isLinked: vi.fn(),
    listLinkedChats: vi.fn(),
  } as any;

  const deliveryService = {
    deliver: vi.fn(async () => ({
      platformMessageId: "42",
      bridgeSessionKey: "bridge:telegram:-1001234:uuid",
    })),
  } as any;

  const messageSender = {
    platform: "telegram",
    sendMessage: vi.fn(),
  } as any;

  const executionContext: ToolExecutionContext = {
    workspaceRoot: "/tmp",
    botTimezone: "UTC",
    runSource: "chat",
    isMainSession: true,
  };

  return { chatRegistry, deliveryService, messageSender, executionContext };
}

describe("createMessagingTools", () => {
  describe("send_message", () => {
    it("resolves alias via registry and delegates to delivery service", async () => {
      const { chatRegistry, deliveryService, messageSender, executionContext } = createMocks();
      const chat = makeChatRecord();
      chatRegistry.resolveAlias.mockResolvedValue(chat);

      const tools = createMessagingTools({
        chatRegistry,
        deliveryService,
        messageSender,
        executionContext,
      });

      const result = await tools.send_message.execute!(
        { alias: "family", text: "Hello!" },
        { messages: [], toolCallId: "1", abortSignal: new AbortController().signal },
      );

      expect(chatRegistry.resolveAlias).toHaveBeenCalledWith({
        platform: "telegram",
        alias: "family",
      });
      expect(deliveryService.deliver).toHaveBeenCalledWith({
        messageSender,
        targetPlatformChatId: "-1001234",
        targetThreadId: undefined,
        text: "Hello!",
        seedContext: "Cross-chat message sent to family",
      });
      expect(result).toMatchObject({ status: "sent", alias: "family" });
    });

    it("works with direct chat_id", async () => {
      const { chatRegistry, deliveryService, messageSender, executionContext } = createMocks();
      chatRegistry.isLinked.mockResolvedValue(true);

      const tools = createMessagingTools({
        chatRegistry,
        deliveryService,
        messageSender,
        executionContext,
      });

      const result = await tools.send_message.execute!(
        { chat_id: "-1001234", text: "Direct" },
        { messages: [], toolCallId: "1", abortSignal: new AbortController().signal },
      );

      expect(chatRegistry.isLinked).toHaveBeenCalledWith({
        platform: "telegram",
        platformChatId: "-1001234",
      });
      expect(deliveryService.deliver).toHaveBeenCalled();
      expect(result).toMatchObject({ status: "sent" });
    });

    it("rejects if target chat is not linked (by alias)", async () => {
      const { chatRegistry, deliveryService, messageSender, executionContext } = createMocks();
      chatRegistry.resolveAlias.mockResolvedValue(makeChatRecord({ linkedAt: null }));

      const tools = createMessagingTools({
        chatRegistry,
        deliveryService,
        messageSender,
        executionContext,
      });

      const result: any = await tools.send_message.execute!(
        { alias: "family", text: "Hello!" },
        { messages: [], toolCallId: "1", abortSignal: new AbortController().signal },
      );

      expect(result.ok).toBe(false);
      expect(result.error.code).toBe("CHAT_NOT_LINKED");
    });

    it("rejects if target chat is not linked (by chat_id)", async () => {
      const { chatRegistry, deliveryService, messageSender, executionContext } = createMocks();
      chatRegistry.isLinked.mockResolvedValue(false);

      const tools = createMessagingTools({
        chatRegistry,
        deliveryService,
        messageSender,
        executionContext,
      });

      const result: any = await tools.send_message.execute!(
        { chat_id: "-1001234", text: "Hello!" },
        { messages: [], toolCallId: "1", abortSignal: new AbortController().signal },
      );

      expect(result.ok).toBe(false);
      expect(result.error.code).toBe("CHAT_NOT_LINKED");
    });

    it("rejects when alias is not found", async () => {
      const { chatRegistry, deliveryService, messageSender, executionContext } = createMocks();
      chatRegistry.resolveAlias.mockResolvedValue(null);

      const tools = createMessagingTools({
        chatRegistry,
        deliveryService,
        messageSender,
        executionContext,
      });

      const result: any = await tools.send_message.execute!(
        { alias: "nonexistent", text: "Hello!" },
        { messages: [], toolCallId: "1", abortSignal: new AbortController().signal },
      );

      expect(result.ok).toBe(false);
      expect(result.error.code).toBe("ALIAS_NOT_FOUND");
    });

    it("includes context in seed when provided", async () => {
      const { chatRegistry, deliveryService, messageSender, executionContext } = createMocks();
      chatRegistry.resolveAlias.mockResolvedValue(makeChatRecord());

      const tools = createMessagingTools({
        chatRegistry,
        deliveryService,
        messageSender,
        executionContext,
      });

      await tools.send_message.execute!(
        {
          alias: "family",
          text: "Dinner at 7!",
          context: "Owner wants to announce dinner plans",
        },
        { messages: [], toolCallId: "1", abortSignal: new AbortController().signal },
      );

      expect(deliveryService.deliver).toHaveBeenCalledWith(
        expect.objectContaining({
          seedContext: "Owner wants to announce dinner plans",
        }),
      );
    });
  });

  describe("list_known_chats", () => {
    it("returns formatted list from registry", async () => {
      const { chatRegistry, deliveryService, messageSender, executionContext } = createMocks();
      const chats = [
        makeChatRecord({ alias: "family", title: "Family Group" }),
        makeChatRecord({ alias: "work", title: "Work Team", platformChatId: "-1009876" }),
      ];
      chatRegistry.listLinkedChats.mockResolvedValue(chats);

      const tools = createMessagingTools({
        chatRegistry,
        deliveryService,
        messageSender,
        executionContext,
      });

      const result: any = await tools.list_known_chats.execute!(
        {},
        { messages: [], toolCallId: "1", abortSignal: new AbortController().signal },
      );

      expect(result.status).toBe("ok");
      expect(result.count).toBe(2);
      expect(result.chats[0].alias).toBe("family");
      expect(result.chats[1].alias).toBe("work");
    });
  });
});
