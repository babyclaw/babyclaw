import { describe, expect, it, vi, afterEach } from "vitest";
import { Bot } from "grammy";
import type { Update, UserFromGetMe } from "grammy/types";
import {
  TelegramAdapter,
  getChatTitle,
  isLinkOrUnlinkCommand,
  buildSenderName,
  extFromFilePath,
  mimeFromExt,
} from "./plugin.js";

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

function fakeCtx(overrides: Record<string, unknown> = {}): any {
  return { chat: null, message: undefined, ...overrides };
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
    await expect(adapter.sendMessage({ chatId: "123", text: "hello" })).rejects.toThrow(
      "bot not started",
    );
  });

  it("sendImage throws if bot not started", async () => {
    const adapter = createAdapter();
    await expect(adapter.sendImage({ chatId: "123", filePath: "/tmp/photo.jpg" })).rejects.toThrow(
      "bot not started",
    );
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

describe("getChatTitle", () => {
  it("returns null when ctx.chat is null", () => {
    expect(getChatTitle({ ctx: fakeCtx() })).toBeNull();
  });

  it("returns title from group/supergroup chat", () => {
    const ctx = fakeCtx({ chat: { id: 1, type: "supergroup", title: "My Group" } });
    expect(getChatTitle({ ctx })).toBe("My Group");
  });

  it("returns first + last name for private chat", () => {
    const ctx = fakeCtx({
      chat: { id: 1, type: "private", first_name: "Alice", last_name: "Smith" },
    });
    expect(getChatTitle({ ctx })).toBe("Alice Smith");
  });

  it("returns first name only when last name is absent", () => {
    const ctx = fakeCtx({ chat: { id: 1, type: "private", first_name: "Bob" } });
    expect(getChatTitle({ ctx })).toBe("Bob");
  });

  it("returns null when chat has no title or name fields", () => {
    const ctx = fakeCtx({ chat: { id: 1, type: "channel" } });
    expect(getChatTitle({ ctx })).toBeNull();
  });
});

describe("isLinkOrUnlinkCommand", () => {
  it("returns true for /link command", () => {
    const ctx = fakeCtx({ message: { text: "/link my-alias" } });
    expect(isLinkOrUnlinkCommand({ ctx })).toBe(true);
  });

  it("returns true for /unlink command", () => {
    const ctx = fakeCtx({ message: { text: "/unlink" } });
    expect(isLinkOrUnlinkCommand({ ctx })).toBe(true);
  });

  it("returns false for other commands", () => {
    const ctx = fakeCtx({ message: { text: "/schedules" } });
    expect(isLinkOrUnlinkCommand({ ctx })).toBe(false);
  });

  it("returns false for regular text", () => {
    const ctx = fakeCtx({ message: { text: "hello there" } });
    expect(isLinkOrUnlinkCommand({ ctx })).toBe(false);
  });

  it("returns false when message has no text", () => {
    const ctx = fakeCtx({ message: {} });
    expect(isLinkOrUnlinkCommand({ ctx })).toBe(false);
  });

  it("returns false when message is undefined", () => {
    const ctx = fakeCtx();
    expect(isLinkOrUnlinkCommand({ ctx })).toBe(false);
  });

  it("handles leading whitespace by trimming first", () => {
    const ctx = fakeCtx({ message: { text: "  /link foo" } });
    expect(isLinkOrUnlinkCommand({ ctx })).toBe(true);
  });
});

describe("buildSenderName", () => {
  it("returns undefined when from is undefined", () => {
    expect(buildSenderName({ from: undefined })).toBeUndefined();
  });

  it("returns first + last name", () => {
    expect(buildSenderName({ from: { first_name: "Alice", last_name: "Smith" } })).toBe(
      "Alice Smith",
    );
  });

  it("returns first name only when last name is missing", () => {
    expect(buildSenderName({ from: { first_name: "Bob" } })).toBe("Bob");
  });

  it("returns undefined when neither name field is a string", () => {
    expect(buildSenderName({ from: { id: 123 } })).toBeUndefined();
  });

  it("ignores non-string first_name", () => {
    expect(buildSenderName({ from: { first_name: 42, last_name: "Jones" } })).toBeUndefined();
  });
});

describe("extFromFilePath", () => {
  it("extracts .jpg extension", () => {
    expect(extFromFilePath("photos/image.jpg")).toBe(".jpg");
  });

  it("extracts .png and lowercases it", () => {
    expect(extFromFilePath("photos/image.PNG")).toBe(".png");
  });

  it("handles paths with multiple dots", () => {
    expect(extFromFilePath("photos/my.photo.webp")).toBe(".webp");
  });

  it("defaults to .jpg when no extension present", () => {
    expect(extFromFilePath("photos/noext")).toBe(".jpg");
  });

  it("defaults to .jpg for empty string", () => {
    expect(extFromFilePath("")).toBe(".jpg");
  });
});

describe("mimeFromExt", () => {
  it.each([
    [".jpg", "image/jpeg"],
    [".jpeg", "image/jpeg"],
    [".png", "image/png"],
    [".gif", "image/gif"],
    [".webp", "image/webp"],
    [".bmp", "image/bmp"],
  ])("maps %s to %s", (ext, expected) => {
    expect(mimeFromExt(ext)).toBe(expected);
  });

  it("falls back to image/jpeg for unknown extensions", () => {
    expect(mimeFromExt(".tiff")).toBe("image/jpeg");
    expect(mimeFromExt(".svg")).toBe("image/jpeg");
  });
});

// ---------------------------------------------------------------------------
// Integration tests — full middleware + handler pipeline via handleUpdate
// ---------------------------------------------------------------------------

const FAKE_BOT_INFO: UserFromGetMe = {
  id: 99999,
  is_bot: true,
  first_name: "TestBot",
  username: "test_bot",
  can_join_groups: true,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
  can_connect_to_business: false,
  has_main_web_app: false,
  has_topics_enabled: false,
  allows_users_to_create_topics: false,
};

const OWNER_ID = 42;

type ApiCall = { method: string; payload: Record<string, unknown> };

function createIntegrationChatRegistry(
  overrides: {
    mainChat?: { platformChatId: string } | null;
    linked?: boolean;
  } = {},
): any {
  const { mainChat = { platformChatId: String(OWNER_ID) }, linked = true } = overrides;
  return {
    upsert: vi.fn(async () => {}),
    getMainChat: vi.fn(async () => mainChat),
    markAsMain: vi.fn(async () => {}),
    isLinked: vi.fn(async () => linked),
    link: vi.fn(async () => {}),
    unlink: vi.fn(async () => {}),
    listLinkedChats: vi.fn(async () => []),
  };
}

function makeTextUpdate(opts: {
  text: string;
  chatId?: number;
  chatType?: string;
  fromId?: number;
  firstName?: string;
  entities?: Array<{ type: string; offset: number; length: number }>;
}) {
  const chatId = opts.chatId ?? 100;
  const chatType = opts.chatType ?? "private";
  const fromId = opts.fromId ?? OWNER_ID;
  const firstName = opts.firstName ?? "Alice";
  return {
    update_id: Math.floor(Math.random() * 100000),
    message: {
      message_id: Math.floor(Math.random() * 100000),
      date: Math.floor(Date.now() / 1000),
      chat: { id: chatId, type: chatType, first_name: firstName },
      from: { id: fromId, is_bot: false, first_name: firstName },
      text: opts.text,
      ...(opts.entities ? { entities: opts.entities } : {}),
    },
  } as Update;
}

function makeCommandUpdate(opts: {
  command: string;
  args?: string;
  chatId?: number;
  chatType?: string;
  fromId?: number;
}) {
  const text = opts.args ? `/${opts.command} ${opts.args}` : `/${opts.command}`;
  return makeTextUpdate({
    text,
    chatId: opts.chatId,
    chatType: opts.chatType,
    fromId: opts.fromId,
    entities: [{ type: "bot_command", offset: 0, length: `/${opts.command}`.length }],
  });
}

function makeCallbackQueryUpdate(opts: { data: string; chatId?: number; fromId?: number }) {
  const chatId = opts.chatId ?? 100;
  const fromId = opts.fromId ?? OWNER_ID;
  return {
    update_id: Math.floor(Math.random() * 100000),
    callback_query: {
      id: String(Math.floor(Math.random() * 100000)),
      chat_instance: "ci1",
      from: { id: fromId, is_bot: false, first_name: "Alice" },
      message: {
        message_id: 5,
        date: Math.floor(Date.now() / 1000),
        chat: { id: chatId, type: "private", first_name: "Alice" },
        from: FAKE_BOT_INFO,
        text: "original message",
      },
      data: opts.data,
    },
  } as Update;
}

async function bootAdapter(
  opts: {
    chatRegistryOverrides?: Parameters<typeof createIntegrationChatRegistry>[0];
    getHeartbeatStatus?: () => { enabled: boolean; nextRunAt: Date | null };
  } = {},
) {
  const startSpy = vi.spyOn(Bot.prototype, "start").mockResolvedValue(undefined as never);

  const chatRegistry = createIntegrationChatRegistry(opts.chatRegistryOverrides);
  const schedulerService = createMockSchedulerService();
  const messageLinkRepository = createMockMessageLinkRepository();
  const onInboundEvent = vi.fn();
  const apiCalls: ApiCall[] = [];

  const adapter = new TelegramAdapter({
    token: "test-token",
    workspacePath: "/tmp/test",
    chatRegistry,
    schedulerService,
    messageLinkRepository,
    getHeartbeatStatus: opts.getHeartbeatStatus,
  });

  await adapter.start({ onInboundEvent });

  const bot = (adapter as any).bot as Bot;
  bot.botInfo = FAKE_BOT_INFO;
  bot.api.config.use(async (_prev, method, payload) => {
    apiCalls.push({ method, payload: payload as Record<string, unknown> });
    return { ok: true, result: { message_id: 1 } } as any;
  });

  return { adapter, bot, chatRegistry, schedulerService, onInboundEvent, apiCalls, startSpy };
}

describe("TelegramAdapter integration", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -- middleware ---------------------------------------------------------

  describe("middleware", () => {
    it("upserts chat info on every message", async () => {
      const { bot, chatRegistry } = await bootAdapter();
      await bot.handleUpdate(makeTextUpdate({ text: "hi" }));

      expect(chatRegistry.upsert).toHaveBeenCalledWith({
        platform: "telegram",
        platformChatId: "100",
        type: "private",
        title: "Alice",
      });
    });

    it("auto-promotes first private chat to main when none exists", async () => {
      const { bot, chatRegistry } = await bootAdapter({
        chatRegistryOverrides: { mainChat: null },
      });
      await bot.handleUpdate(makeTextUpdate({ text: "hi" }));

      expect(chatRegistry.markAsMain).toHaveBeenCalledWith({
        platform: "telegram",
        platformChatId: "100",
      });
    });

    it("does NOT auto-promote group chats to main", async () => {
      const { bot, chatRegistry } = await bootAdapter({
        chatRegistryOverrides: { mainChat: null },
      });
      await bot.handleUpdate(makeTextUpdate({ text: "hi", chatType: "supergroup" }));

      expect(chatRegistry.markAsMain).not.toHaveBeenCalled();
    });

    it("blocks messages from unlinked chats", async () => {
      const { bot, onInboundEvent } = await bootAdapter({
        chatRegistryOverrides: { linked: false },
      });
      await bot.handleUpdate(makeTextUpdate({ text: "hello" }));

      expect(onInboundEvent).not.toHaveBeenCalled();
    });

    it("allows /link command through even from unlinked chat", async () => {
      const { bot, apiCalls } = await bootAdapter({
        chatRegistryOverrides: { linked: false },
      });
      await bot.handleUpdate(makeCommandUpdate({ command: "link", args: "my-chat" }));

      const reply = apiCalls.find((c) => c.method === "sendMessage");
      expect(reply).toBeDefined();
    });
  });

  // -- commands ----------------------------------------------------------

  describe("commands", () => {
    it("/link links a chat with a valid alias", async () => {
      const { bot, chatRegistry, apiCalls } = await bootAdapter();
      await bot.handleUpdate(makeCommandUpdate({ command: "link", args: "my-chat" }));

      expect(chatRegistry.link).toHaveBeenCalledWith({
        platform: "telegram",
        platformChatId: "100",
        alias: "my-chat",
      });
      const reply = apiCalls.find((c) => c.method === "sendMessage");
      expect((reply?.payload as any)?.text).toContain("Linked");
    });

    it("/link rejects invalid alias format", async () => {
      const { bot, chatRegistry, apiCalls } = await bootAdapter();
      await bot.handleUpdate(makeCommandUpdate({ command: "link", args: "X" }));

      expect(chatRegistry.link).not.toHaveBeenCalled();
      const reply = apiCalls.find((c) => c.method === "sendMessage");
      expect((reply?.payload as any)?.text).toContain("Usage");
    });

    it("/link rejects non-owner", async () => {
      const { bot, chatRegistry, apiCalls } = await bootAdapter();
      await bot.handleUpdate(
        makeCommandUpdate({ command: "link", args: "test-alias", fromId: 9999 }),
      );

      expect(chatRegistry.link).not.toHaveBeenCalled();
      const reply = apiCalls.find((c) => c.method === "sendMessage");
      expect((reply?.payload as any)?.text).toContain("Only the owner");
    });

    it("/link replies when no main chat exists", async () => {
      const { bot, apiCalls } = await bootAdapter({
        chatRegistryOverrides: { mainChat: null },
      });
      await bot.handleUpdate(makeCommandUpdate({ command: "link", args: "test-alias" }));

      const reply = apiCalls.find((c) => c.method === "sendMessage");
      expect((reply?.payload as any)?.text).toContain("No main chat");
    });

    it("/unlink prevents unlinking the main chat", async () => {
      const { bot, chatRegistry, apiCalls } = await bootAdapter({
        chatRegistryOverrides: { mainChat: { platformChatId: "100" } },
      });
      await bot.handleUpdate(makeCommandUpdate({ command: "unlink", chatId: 100, fromId: 100 }));

      expect(chatRegistry.unlink).not.toHaveBeenCalled();
      const reply = apiCalls.find((c) => c.method === "sendMessage");
      expect((reply?.payload as any)?.text).toContain("Cannot unlink the main chat");
    });

    it("/unlink unlinks a non-main chat", async () => {
      const { bot, chatRegistry, apiCalls } = await bootAdapter({
        chatRegistryOverrides: { mainChat: { platformChatId: String(OWNER_ID) } },
      });
      await bot.handleUpdate(makeCommandUpdate({ command: "unlink", chatId: 200 }));

      expect(chatRegistry.unlink).toHaveBeenCalledWith({
        platform: "telegram",
        platformChatId: "200",
      });
      const reply = apiCalls.find((c) => c.method === "sendMessage");
      expect((reply?.payload as any)?.text).toContain("Unlinked");
    });

    it("/heartbeat shows enabled status with next run time", async () => {
      const nextRun = new Date("2026-03-01T12:00:00Z");
      const { bot, apiCalls } = await bootAdapter({
        getHeartbeatStatus: () => ({ enabled: true, nextRunAt: nextRun }),
      });
      await bot.handleUpdate(makeCommandUpdate({ command: "heartbeat" }));

      const reply = apiCalls.find((c) => c.method === "sendMessage");
      const text = (reply?.payload as any)?.text as string;
      expect(text).toContain("Heartbeat is enabled");
      expect(text).toContain("2026-03-01");
    });

    it("/heartbeat shows disabled status", async () => {
      const { bot, apiCalls } = await bootAdapter({
        getHeartbeatStatus: () => ({ enabled: false, nextRunAt: null }),
      });
      await bot.handleUpdate(makeCommandUpdate({ command: "heartbeat" }));

      const reply = apiCalls.find((c) => c.method === "sendMessage");
      expect((reply?.payload as any)?.text).toContain("disabled");
    });

    it("/heartbeat reports unavailable when getter is not set", async () => {
      const { bot, apiCalls } = await bootAdapter();
      await bot.handleUpdate(makeCommandUpdate({ command: "heartbeat" }));

      const reply = apiCalls.find((c) => c.method === "sendMessage");
      expect((reply?.payload as any)?.text).toContain("not available");
    });

    it("/schedules replies with no-schedules message", async () => {
      const { bot, apiCalls } = await bootAdapter();
      await bot.handleUpdate(makeCommandUpdate({ command: "schedules" }));

      const reply = apiCalls.find((c) => c.method === "sendMessage");
      expect((reply?.payload as any)?.text).toBeDefined();
    });
  });

  // -- message handlers --------------------------------------------------

  describe("message handlers", () => {
    it("normalizes a text message and calls onInboundEvent", async () => {
      const { bot, onInboundEvent } = await bootAdapter();
      await bot.handleUpdate(makeTextUpdate({ text: "hello world" }));

      expect(onInboundEvent).toHaveBeenCalledTimes(1);
      const { event } = onInboundEvent.mock.calls[0][0];
      expect(event).toMatchObject({
        platform: "telegram",
        chatId: "100",
        senderId: String(OWNER_ID),
        senderName: "Alice",
        messageText: "hello world",
        isEdited: false,
      });
    });

    it("sets chatType and chatTitle on normalized event", async () => {
      const { bot, onInboundEvent } = await bootAdapter();
      await bot.handleUpdate(makeTextUpdate({ text: "hi", chatType: "private", firstName: "Bob" }));

      const { event } = onInboundEvent.mock.calls[0][0];
      expect(event.chatType).toBe("private");
      expect(event.chatTitle).toBe("Bob");
    });

    it("ignores empty text after trimming", async () => {
      const { bot, onInboundEvent } = await bootAdapter();
      await bot.handleUpdate(makeTextUpdate({ text: "   " }));

      expect(onInboundEvent).not.toHaveBeenCalled();
    });
  });

  // -- callback queries (approvals) --------------------------------------

  describe("callback queries", () => {
    it("dispatches approval to the approval service", async () => {
      const { adapter, bot, apiCalls } = await bootAdapter();
      const approvalService = {
        handleResponse: vi.fn(async () => {}),
      };
      adapter.setCommandApprovalService({ service: approvalService as any });

      await bot.handleUpdate(makeCallbackQueryUpdate({ data: "cmd_approve:req-123" }));

      expect(approvalService.handleResponse).toHaveBeenCalledWith({
        requestId: "req-123",
        approved: true,
        approveSession: false,
      });
      const answer = apiCalls.find((c) => c.method === "answerCallbackQuery");
      expect((answer?.payload as any)?.text).toContain("approved");
    });

    it("dispatches session-wide approval", async () => {
      const { adapter, bot } = await bootAdapter();
      const approvalService = { handleResponse: vi.fn(async () => {}) };
      adapter.setCommandApprovalService({ service: approvalService as any });

      await bot.handleUpdate(makeCallbackQueryUpdate({ data: "cmd_approve_session:req-456" }));

      expect(approvalService.handleResponse).toHaveBeenCalledWith({
        requestId: "req-456",
        approved: true,
        approveSession: true,
      });
    });

    it("dispatches denial to the approval service", async () => {
      const { adapter, bot } = await bootAdapter();
      const approvalService = { handleResponse: vi.fn(async () => {}) };
      adapter.setCommandApprovalService({ service: approvalService as any });

      await bot.handleUpdate(makeCallbackQueryUpdate({ data: "cmd_deny:req-789" }));

      expect(approvalService.handleResponse).toHaveBeenCalledWith({
        requestId: "req-789",
        approved: false,
        approveSession: false,
      });
    });

    it("rejects approval from non-owner", async () => {
      const { adapter, bot, apiCalls } = await bootAdapter();
      const approvalService = { handleResponse: vi.fn(async () => {}) };
      adapter.setCommandApprovalService({ service: approvalService as any });

      await bot.handleUpdate(
        makeCallbackQueryUpdate({ data: "cmd_approve:req-000", fromId: 9999 }),
      );

      expect(approvalService.handleResponse).not.toHaveBeenCalled();
      const answer = apiCalls.find((c) => c.method === "answerCallbackQuery");
      expect((answer?.payload as any)?.text).toContain("Only the owner");
    });

    it("reports unavailable when approval service is not set", async () => {
      const { bot, apiCalls } = await bootAdapter();

      await bot.handleUpdate(makeCallbackQueryUpdate({ data: "cmd_approve:req-000" }));

      const answer = apiCalls.find((c) => c.method === "answerCallbackQuery");
      expect((answer?.payload as any)?.text).toContain("not available");
    });

    it("ignores non-approval callback data", async () => {
      const { adapter, bot, apiCalls } = await bootAdapter();
      const approvalService = { handleResponse: vi.fn(async () => {}) };
      adapter.setCommandApprovalService({ service: approvalService as any });

      await bot.handleUpdate(makeCallbackQueryUpdate({ data: "some_other:data" }));

      expect(approvalService.handleResponse).not.toHaveBeenCalled();
      expect(apiCalls.find((c) => c.method === "answerCallbackQuery")).toBeUndefined();
    });
  });
});
