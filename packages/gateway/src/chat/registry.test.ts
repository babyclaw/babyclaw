import { describe, expect, it } from "vitest";
import { createTestDatabase } from "../database/test-utils.js";
import { ChatRegistry } from "./registry.js";

function createRegistry() {
  const db = createTestDatabase();
  return new ChatRegistry({ db });
}

describe("ChatRegistry", () => {
  describe("upsert", () => {
    it("creates a new chat with platform and platformChatId", async () => {
      const registry = createRegistry();

      const result = await registry.upsert({
        platform: "telegram",
        platformChatId: "12345",
        type: "private",
        title: "John",
      });

      expect(result.platform).toBe("telegram");
      expect(result.platformChatId).toBe("12345");
      expect(result.type).toBe("private");
      expect(result.title).toBe("John");
      expect(result.id).toBeDefined();
    });

    it("updates title and type for existing chat without touching linkedAt", async () => {
      const registry = createRegistry();

      await registry.upsert({
        platform: "telegram",
        platformChatId: "12345",
        type: "private",
        title: "John",
      });

      const updated = await registry.upsert({
        platform: "telegram",
        platformChatId: "12345",
        type: "supergroup",
        title: "Updated",
      });

      expect(updated.type).toBe("supergroup");
      expect(updated.title).toBe("Updated");
      expect(updated.linkedAt).toBeNull();
    });
  });

  describe("markAsMain", () => {
    it("clears previous main and sets isMain + linkedAt", async () => {
      const registry = createRegistry();

      await registry.upsert({
        platform: "telegram",
        platformChatId: "11111",
        type: "private",
      });
      await registry.markAsMain({
        platform: "telegram",
        platformChatId: "11111",
      });

      await registry.upsert({
        platform: "telegram",
        platformChatId: "22222",
        type: "private",
      });
      const result = await registry.markAsMain({
        platform: "telegram",
        platformChatId: "22222",
      });

      expect(result.isMain).toBe(true);
      expect(result.linkedAt).toBeInstanceOf(Date);

      const oldMain = await registry.getMainChat();
      expect(oldMain).not.toBeNull();
      expect(oldMain!.platformChatId).toBe("22222");
    });
  });

  describe("link", () => {
    it("sets alias and linkedAt on a chat", async () => {
      const registry = createRegistry();

      await registry.upsert({
        platform: "telegram",
        platformChatId: "-100999",
        type: "group",
      });

      const result = await registry.link({
        platform: "telegram",
        platformChatId: "-100999",
        alias: "family",
      });

      expect(result.alias).toBe("family");
      expect(result.linkedAt).toBeInstanceOf(Date);
    });
  });

  describe("unlink", () => {
    it("clears alias and linkedAt", async () => {
      const registry = createRegistry();

      await registry.upsert({
        platform: "telegram",
        platformChatId: "-100999",
        type: "group",
      });
      await registry.link({
        platform: "telegram",
        platformChatId: "-100999",
        alias: "family",
      });

      const result = await registry.unlink({
        platform: "telegram",
        platformChatId: "-100999",
      });

      expect(result.alias).toBeNull();
      expect(result.linkedAt).toBeNull();
    });
  });

  describe("isLinked", () => {
    it("returns true when chat has linkedAt set", async () => {
      const registry = createRegistry();

      await registry.upsert({
        platform: "telegram",
        platformChatId: "12345",
        type: "private",
      });
      await registry.link({
        platform: "telegram",
        platformChatId: "12345",
        alias: "test",
      });

      expect(await registry.isLinked({ platform: "telegram", platformChatId: "12345" })).toBe(true);
    });

    it("returns false when chat has no linkedAt", async () => {
      const registry = createRegistry();

      await registry.upsert({
        platform: "telegram",
        platformChatId: "12345",
        type: "private",
      });

      expect(await registry.isLinked({ platform: "telegram", platformChatId: "12345" })).toBe(
        false,
      );
    });

    it("returns false when chat does not exist", async () => {
      const registry = createRegistry();

      expect(await registry.isLinked({ platform: "telegram", platformChatId: "99999" })).toBe(
        false,
      );
    });
  });

  describe("listLinkedChats", () => {
    it("returns only linked chats", async () => {
      const registry = createRegistry();

      await registry.upsert({
        platform: "telegram",
        platformChatId: "111",
        type: "private",
      });
      await registry.link({
        platform: "telegram",
        platformChatId: "111",
        alias: "linked",
      });

      await registry.upsert({
        platform: "telegram",
        platformChatId: "222",
        type: "private",
      });

      const result = await registry.listLinkedChats();
      expect(result).toHaveLength(1);
      expect(result[0].platformChatId).toBe("111");
    });

    it("filters by platform when specified", async () => {
      const registry = createRegistry();

      await registry.upsert({
        platform: "telegram",
        platformChatId: "111",
        type: "private",
      });
      await registry.link({
        platform: "telegram",
        platformChatId: "111",
        alias: "tg",
      });

      const result = await registry.listLinkedChats({ platform: "discord" });
      expect(result).toHaveLength(0);
    });
  });

  describe("resolveAlias", () => {
    it("finds a chat by platform and alias", async () => {
      const registry = createRegistry();

      await registry.upsert({
        platform: "telegram",
        platformChatId: "-100999",
        type: "group",
      });
      await registry.link({
        platform: "telegram",
        platformChatId: "-100999",
        alias: "family",
      });

      const result = await registry.resolveAlias({
        platform: "telegram",
        alias: "family",
      });

      expect(result).not.toBeNull();
      expect(result!.alias).toBe("family");
    });

    it("returns null when alias does not exist", async () => {
      const registry = createRegistry();

      const result = await registry.resolveAlias({
        platform: "telegram",
        alias: "nonexistent",
      });

      expect(result).toBeNull();
    });
  });

  describe("findById", () => {
    it("returns chat by id", async () => {
      const registry = createRegistry();

      const created = await registry.upsert({
        platform: "telegram",
        platformChatId: "12345",
        type: "private",
      });

      const result = await registry.findById({ id: created.id });
      expect(result).not.toBeNull();
      expect(result!.id).toBe(created.id);
    });
  });

  describe("getMainChat", () => {
    it("returns the main chat", async () => {
      const registry = createRegistry();

      await registry.upsert({
        platform: "telegram",
        platformChatId: "12345",
        type: "private",
      });
      await registry.markAsMain({
        platform: "telegram",
        platformChatId: "12345",
      });

      const result = await registry.getMainChat();
      expect(result).not.toBeNull();
      expect(result!.isMain).toBe(true);
    });

    it("returns null when no main chat exists", async () => {
      const registry = createRegistry();

      const result = await registry.getMainChat();
      expect(result).toBeNull();
    });
  });
});
