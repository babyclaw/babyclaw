import { describe, expect, it, vi } from "vitest";
import { ChatRegistry } from "./registry.js";

function createMockPrisma(): any {
  return {
    chat: {
      upsert: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
  };
}

function makeChatRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: "chat-1",
    platform: "telegram",
    platformChatId: "12345",
    type: "private",
    title: null,
    alias: null,
    isMain: false,
    linkedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("ChatRegistry", () => {
  describe("upsert", () => {
    it("creates a new chat with platform and platformChatId", async () => {
      const prisma = createMockPrisma();
      const registry = new ChatRegistry({ prisma });
      const record = makeChatRecord();
      prisma.chat.upsert.mockResolvedValue(record);

      const result = await registry.upsert({
        platform: "telegram",
        platformChatId: "12345",
        type: "private",
        title: "John",
      });

      expect(prisma.chat.upsert).toHaveBeenCalledOnce();
      const call = prisma.chat.upsert.mock.calls[0][0];
      expect(call.where.platform_platformChatId).toEqual({
        platform: "telegram",
        platformChatId: "12345",
      });
      expect(call.create.platform).toBe("telegram");
      expect(call.create.platformChatId).toBe("12345");
      expect(call.create.type).toBe("private");
      expect(call.create.title).toBe("John");
      expect(result).toBe(record);
    });

    it("updates title and type for existing chat without touching linkedAt", async () => {
      const prisma = createMockPrisma();
      const registry = new ChatRegistry({ prisma });
      const record = makeChatRecord({ title: "Updated" });
      prisma.chat.upsert.mockResolvedValue(record);

      await registry.upsert({
        platform: "telegram",
        platformChatId: "12345",
        type: "supergroup",
        title: "Updated",
      });

      const call = prisma.chat.upsert.mock.calls[0][0];
      expect(call.update.type).toBe("supergroup");
      expect(call.update.title).toBe("Updated");
      expect(call.update).not.toHaveProperty("linkedAt");
    });
  });

  describe("markAsMain", () => {
    it("clears previous main and sets isMain + linkedAt", async () => {
      const prisma = createMockPrisma();
      const registry = new ChatRegistry({ prisma });
      const record = makeChatRecord({ isMain: true, linkedAt: new Date() });
      prisma.chat.updateMany.mockResolvedValue({ count: 1 });
      prisma.chat.update.mockResolvedValue(record);

      const result = await registry.markAsMain({
        platform: "telegram",
        platformChatId: "12345",
      });

      expect(prisma.chat.updateMany).toHaveBeenCalledWith({
        where: { isMain: true },
        data: { isMain: false },
      });

      const updateCall = prisma.chat.update.mock.calls[0][0];
      expect(updateCall.data.isMain).toBe(true);
      expect(updateCall.data.linkedAt).toBeInstanceOf(Date);
      expect(result).toBe(record);
    });
  });

  describe("link", () => {
    it("sets alias and linkedAt on a chat", async () => {
      const prisma = createMockPrisma();
      const registry = new ChatRegistry({ prisma });
      const record = makeChatRecord({ alias: "family", linkedAt: new Date() });
      prisma.chat.update.mockResolvedValue(record);

      const result = await registry.link({
        platform: "telegram",
        platformChatId: "-100999",
        alias: "family",
      });

      const call = prisma.chat.update.mock.calls[0][0];
      expect(call.data.alias).toBe("family");
      expect(call.data.linkedAt).toBeInstanceOf(Date);
      expect(result).toBe(record);
    });
  });

  describe("unlink", () => {
    it("clears alias and linkedAt", async () => {
      const prisma = createMockPrisma();
      const registry = new ChatRegistry({ prisma });
      const record = makeChatRecord();
      prisma.chat.update.mockResolvedValue(record);

      await registry.unlink({
        platform: "telegram",
        platformChatId: "-100999",
      });

      const call = prisma.chat.update.mock.calls[0][0];
      expect(call.data.alias).toBeNull();
      expect(call.data.linkedAt).toBeNull();
    });
  });

  describe("isLinked", () => {
    it("returns true when chat has linkedAt set", async () => {
      const prisma = createMockPrisma();
      const registry = new ChatRegistry({ prisma });
      prisma.chat.findUnique.mockResolvedValue({ linkedAt: new Date() });

      expect(
        await registry.isLinked({ platform: "telegram", platformChatId: "12345" }),
      ).toBe(true);
    });

    it("returns false when chat has no linkedAt", async () => {
      const prisma = createMockPrisma();
      const registry = new ChatRegistry({ prisma });
      prisma.chat.findUnique.mockResolvedValue({ linkedAt: null });

      expect(
        await registry.isLinked({ platform: "telegram", platformChatId: "12345" }),
      ).toBe(false);
    });

    it("returns false when chat does not exist", async () => {
      const prisma = createMockPrisma();
      const registry = new ChatRegistry({ prisma });
      prisma.chat.findUnique.mockResolvedValue(null);

      expect(
        await registry.isLinked({ platform: "telegram", platformChatId: "99999" }),
      ).toBe(false);
    });
  });

  describe("listLinkedChats", () => {
    it("returns only linked chats", async () => {
      const prisma = createMockPrisma();
      const registry = new ChatRegistry({ prisma });
      const chats = [makeChatRecord({ linkedAt: new Date() })];
      prisma.chat.findMany.mockResolvedValue(chats);

      const result = await registry.listLinkedChats();

      expect(prisma.chat.findMany).toHaveBeenCalledWith({
        where: { linkedAt: { not: null } },
        orderBy: { createdAt: "asc" },
      });
      expect(result).toBe(chats);
    });

    it("filters by platform when specified", async () => {
      const prisma = createMockPrisma();
      const registry = new ChatRegistry({ prisma });
      prisma.chat.findMany.mockResolvedValue([]);

      await registry.listLinkedChats({ platform: "telegram" });

      expect(prisma.chat.findMany).toHaveBeenCalledWith({
        where: { linkedAt: { not: null }, platform: "telegram" },
        orderBy: { createdAt: "asc" },
      });
    });
  });

  describe("resolveAlias", () => {
    it("finds a chat by platform and alias", async () => {
      const prisma = createMockPrisma();
      const registry = new ChatRegistry({ prisma });
      const chat = makeChatRecord({ alias: "family" });
      prisma.chat.findUnique.mockResolvedValue(chat);

      const result = await registry.resolveAlias({
        platform: "telegram",
        alias: "family",
      });

      expect(prisma.chat.findUnique).toHaveBeenCalledWith({
        where: { platform_alias: { platform: "telegram", alias: "family" } },
      });
      expect(result).toBe(chat);
    });

    it("returns null when alias does not exist", async () => {
      const prisma = createMockPrisma();
      const registry = new ChatRegistry({ prisma });
      prisma.chat.findUnique.mockResolvedValue(null);

      const result = await registry.resolveAlias({
        platform: "telegram",
        alias: "nonexistent",
      });

      expect(result).toBeNull();
    });
  });

  describe("findById", () => {
    it("returns chat by cuid", async () => {
      const prisma = createMockPrisma();
      const registry = new ChatRegistry({ prisma });
      const chat = makeChatRecord();
      prisma.chat.findUnique.mockResolvedValue(chat);

      const result = await registry.findById({ id: "chat-1" });
      expect(result).toBe(chat);
    });
  });

  describe("getMainChat", () => {
    it("returns the main chat", async () => {
      const prisma = createMockPrisma();
      const registry = new ChatRegistry({ prisma });
      const chat = makeChatRecord({ isMain: true });
      prisma.chat.findFirst.mockResolvedValue(chat);

      const result = await registry.getMainChat();
      expect(prisma.chat.findFirst).toHaveBeenCalledWith({
        where: { isMain: true },
      });
      expect(result).toBe(chat);
    });

    it("returns null when no main chat exists", async () => {
      const prisma = createMockPrisma();
      const registry = new ChatRegistry({ prisma });
      prisma.chat.findFirst.mockResolvedValue(null);

      const result = await registry.getMainChat();
      expect(result).toBeNull();
    });
  });
});
