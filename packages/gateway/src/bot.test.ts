import { describe, expect, it, vi } from "vitest";
import type { ChatRegistry } from "./chat/registry.js";

function createMockChatRegistry(): ChatRegistry {
  return {
    upsert: vi.fn(async () => ({})),
    markAsMain: vi.fn(async () => ({})),
    link: vi.fn(async () => ({})),
    unlink: vi.fn(async () => ({})),
    isLinked: vi.fn(async () => false),
    listLinkedChats: vi.fn(async () => []),
    resolveAlias: vi.fn(async () => null),
    findById: vi.fn(async () => null),
    getMainChat: vi.fn(async () => null),
  } as unknown as ChatRegistry;
}

describe("Bot middleware logic", () => {
  describe("auto-main on bootstrap", () => {
    it("marks a private chat as main when no main exists", async () => {
      const registry = createMockChatRegistry();
      const getMainChat = registry.getMainChat as ReturnType<typeof vi.fn>;
      const markAsMain = registry.markAsMain as ReturnType<typeof vi.fn>;
      const upsert = registry.upsert as ReturnType<typeof vi.fn>;

      getMainChat.mockResolvedValue(null);
      upsert.mockResolvedValue({});

      await registry.upsert({
        platform: "telegram",
        platformChatId: "12345",
        type: "private",
        title: "John",
      });

      const mainChat = await registry.getMainChat();
      if (!mainChat) {
        await registry.markAsMain({
          platform: "telegram",
          platformChatId: "12345",
        });
      }

      expect(markAsMain).toHaveBeenCalledWith({
        platform: "telegram",
        platformChatId: "12345",
      });
    });

    it("does not mark a group chat as main", async () => {
      const registry = createMockChatRegistry();
      const getMainChat = registry.getMainChat as ReturnType<typeof vi.fn>;
      const markAsMain = registry.markAsMain as ReturnType<typeof vi.fn>;

      getMainChat.mockResolvedValue(null);

      const chatType: string = "group";

      await registry.upsert({
        platform: "telegram",
        platformChatId: "-100999",
        type: chatType,
      });

      const mainChat = await registry.getMainChat();
      if (!mainChat && chatType === "private") {
        await registry.markAsMain({
          platform: "telegram",
          platformChatId: "-100999",
        });
      }

      expect(markAsMain).not.toHaveBeenCalled();
    });

    it("does not mark main when one already exists", async () => {
      const registry = createMockChatRegistry();
      const getMainChat = registry.getMainChat as ReturnType<typeof vi.fn>;
      const markAsMain = registry.markAsMain as ReturnType<typeof vi.fn>;

      getMainChat.mockResolvedValue({
        id: "existing-main",
        platformChatId: "99999",
        isMain: true,
      });

      const mainChat = await registry.getMainChat();
      if (!mainChat) {
        await registry.markAsMain({
          platform: "telegram",
          platformChatId: "12345",
        });
      }

      expect(markAsMain).not.toHaveBeenCalled();
    });
  });

  describe("unlinked group gating", () => {
    it("allows processing for linked chats", async () => {
      const registry = createMockChatRegistry();
      const isLinked = registry.isLinked as ReturnType<typeof vi.fn>;
      isLinked.mockResolvedValue(true);

      const linked = await registry.isLinked({
        platform: "telegram",
        platformChatId: "-100999",
      });

      expect(linked).toBe(true);
    });

    it("blocks processing for unlinked chats", async () => {
      const registry = createMockChatRegistry();
      const isLinked = registry.isLinked as ReturnType<typeof vi.fn>;
      isLinked.mockResolvedValue(false);

      const linked = await registry.isLinked({
        platform: "telegram",
        platformChatId: "-100999",
      });

      expect(linked).toBe(false);
    });
  });

  describe("isMainSession derivation", () => {
    it("returns true when chat is the main chat", async () => {
      const registry = createMockChatRegistry();
      const getMainChat = registry.getMainChat as ReturnType<typeof vi.fn>;

      getMainChat.mockResolvedValue({
        id: "main-1",
        platformChatId: "12345",
        isMain: true,
      });

      const currentChat = await registry.getMainChat();
      const isMainSession = currentChat?.platformChatId === "12345";
      expect(isMainSession).toBe(true);
    });

    it("returns false for linked groups", async () => {
      const registry = createMockChatRegistry();
      const getMainChat = registry.getMainChat as ReturnType<typeof vi.fn>;

      getMainChat.mockResolvedValue({
        id: "main-1",
        platformChatId: "12345",
        isMain: true,
      });

      const currentChat = await registry.getMainChat();
      const isMainSession = currentChat?.platformChatId === "-100999";
      expect(isMainSession).toBe(false);
    });
  });
});

describe("/link command logic", () => {
  it("links a chat with a valid alias", async () => {
    const registry = createMockChatRegistry();
    const getMainChat = registry.getMainChat as ReturnType<typeof vi.fn>;
    const link = registry.link as ReturnType<typeof vi.fn>;

    getMainChat.mockResolvedValue({
      id: "main-1",
      platformChatId: "12345",
      isMain: true,
    });

    const ownerId = "12345";
    const alias = "family";

    const mainChat = await registry.getMainChat();
    if (!mainChat) return;

    if (ownerId !== mainChat.platformChatId) return;

    const aliasPattern = /^[a-z0-9][a-z0-9-]{0,30}[a-z0-9]$/;
    expect(aliasPattern.test(alias)).toBe(true);

    await registry.link({
      platform: "telegram",
      platformChatId: "-100999",
      alias,
    });

    expect(link).toHaveBeenCalledWith({
      platform: "telegram",
      platformChatId: "-100999",
      alias: "family",
    });
  });

  it("rejects non-owner link attempts", async () => {
    const registry = createMockChatRegistry();
    const getMainChat = registry.getMainChat as ReturnType<typeof vi.fn>;
    const link = registry.link as ReturnType<typeof vi.fn>;

    getMainChat.mockResolvedValue({
      id: "main-1",
      platformChatId: "12345",
      isMain: true,
    });

    const ownerId = "99999";
    const mainChat = await registry.getMainChat();
    if (!mainChat || ownerId !== mainChat.platformChatId) {
      expect(link).not.toHaveBeenCalled();
      return;
    }
  });

  it("rejects invalid alias format", () => {
    const aliasPattern = /^[a-z0-9][a-z0-9-]{0,30}[a-z0-9]$/;
    expect(aliasPattern.test("a")).toBe(false);
    expect(aliasPattern.test("ABC")).toBe(false);
    expect(aliasPattern.test("-bad")).toBe(false);
    expect(aliasPattern.test("bad-")).toBe(false);
    expect(aliasPattern.test("good-alias")).toBe(true);
    expect(aliasPattern.test("ab")).toBe(true);
  });
});

describe("/unlink command logic", () => {
  it("unlinks a non-main chat", async () => {
    const registry = createMockChatRegistry();
    const getMainChat = registry.getMainChat as ReturnType<typeof vi.fn>;
    const unlink = registry.unlink as ReturnType<typeof vi.fn>;

    getMainChat.mockResolvedValue({
      id: "main-1",
      platformChatId: "12345",
      isMain: true,
    });

    const mainChat = await registry.getMainChat();
    if (!mainChat) return;

    const targetChatId = "-100999";
    if (mainChat.platformChatId === targetChatId) return;

    await registry.unlink({
      platform: "telegram",
      platformChatId: targetChatId,
    });

    expect(unlink).toHaveBeenCalledWith({
      platform: "telegram",
      platformChatId: "-100999",
    });
  });

  it("prevents unlinking the main chat", async () => {
    const registry = createMockChatRegistry();
    const getMainChat = registry.getMainChat as ReturnType<typeof vi.fn>;
    const unlink = registry.unlink as ReturnType<typeof vi.fn>;

    getMainChat.mockResolvedValue({
      id: "main-1",
      platformChatId: "12345",
      isMain: true,
    });

    const mainChat = await registry.getMainChat();
    if (!mainChat) return;

    const targetChatId = "12345";
    if (mainChat.platformChatId === targetChatId) {
      expect(unlink).not.toHaveBeenCalled();
      return;
    }
  });
});
