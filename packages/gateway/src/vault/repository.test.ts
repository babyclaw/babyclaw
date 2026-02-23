import { describe, expect, it } from "vitest";
import { createTestDatabase } from "../database/test-utils.js";
import { VaultRepository } from "./repository.js";

function createRepository() {
  const db = createTestDatabase();
  return new VaultRepository({ db });
}

describe("VaultRepository", () => {
  describe("get", () => {
    it("returns null for a missing key", async () => {
      const repo = createRepository();
      const result = await repo.get({ key: "nonexistent" });
      expect(result).toBeNull();
    });

    it("returns the stored secret", async () => {
      const repo = createRepository();
      await repo.set({ key: "github/token", value: "ghp_abc123", label: "GitHub PAT" });

      const result = await repo.get({ key: "github/token" });
      expect(result).not.toBeNull();
      expect(result!.key).toBe("github/token");
      expect(result!.value).toBe("ghp_abc123");
      expect(result!.label).toBe("GitHub PAT");
      expect(result!.createdAt).toBeInstanceOf(Date);
      expect(result!.updatedAt).toBeInstanceOf(Date);
    });
  });

  describe("set", () => {
    it("creates a new secret and returns created: true", async () => {
      const repo = createRepository();
      const result = await repo.set({ key: "openai/api-key", value: "sk-test123" });

      expect(result.created).toBe(true);

      const stored = await repo.get({ key: "openai/api-key" });
      expect(stored!.value).toBe("sk-test123");
      expect(stored!.label).toBeNull();
    });

    it("updates an existing secret and returns created: false", async () => {
      const repo = createRepository();
      await repo.set({ key: "openai/api-key", value: "sk-old", label: "Old key" });
      const result = await repo.set({ key: "openai/api-key", value: "sk-new", label: "New key" });

      expect(result.created).toBe(false);

      const stored = await repo.get({ key: "openai/api-key" });
      expect(stored!.value).toBe("sk-new");
      expect(stored!.label).toBe("New key");
    });

    it("stores label when provided", async () => {
      const repo = createRepository();
      await repo.set({ key: "aws/secret", value: "abc", label: "AWS secret key" });

      const stored = await repo.get({ key: "aws/secret" });
      expect(stored!.label).toBe("AWS secret key");
    });

    it("sets label to null when not provided", async () => {
      const repo = createRepository();
      await repo.set({ key: "aws/secret", value: "abc" });

      const stored = await repo.get({ key: "aws/secret" });
      expect(stored!.label).toBeNull();
    });

    it("clears label on update when not provided", async () => {
      const repo = createRepository();
      await repo.set({ key: "test/key", value: "v1", label: "Has label" });
      await repo.set({ key: "test/key", value: "v2" });

      const stored = await repo.get({ key: "test/key" });
      expect(stored!.label).toBeNull();
    });
  });

  describe("delete", () => {
    it("removes an existing secret and returns deleted: true", async () => {
      const repo = createRepository();
      await repo.set({ key: "temp/secret", value: "temporary" });

      const result = await repo.delete({ key: "temp/secret" });
      expect(result.deleted).toBe(true);

      const stored = await repo.get({ key: "temp/secret" });
      expect(stored).toBeNull();
    });

    it("returns deleted: false for a missing key", async () => {
      const repo = createRepository();
      const result = await repo.delete({ key: "nonexistent" });
      expect(result.deleted).toBe(false);
    });
  });

  describe("list", () => {
    it("returns empty array when vault is empty", async () => {
      const repo = createRepository();
      const result = await repo.list();
      expect(result).toEqual([]);
    });

    it("returns all keys with labels but no values", async () => {
      const repo = createRepository();
      await repo.set({ key: "github/token", value: "ghp_secret", label: "GitHub" });
      await repo.set({ key: "openai/api-key", value: "sk-secret", label: "OpenAI" });
      await repo.set({ key: "no-label", value: "plain" });

      const result = await repo.list();
      expect(result).toHaveLength(3);

      const keys = result.map((r) => r.key);
      expect(keys).toContain("github/token");
      expect(keys).toContain("openai/api-key");
      expect(keys).toContain("no-label");

      const github = result.find((r) => r.key === "github/token")!;
      expect(github.label).toBe("GitHub");
      expect(github.updatedAt).toBeInstanceOf(Date);
      expect("value" in github).toBe(false);
    });

    it("reflects deletions", async () => {
      const repo = createRepository();
      await repo.set({ key: "a", value: "1" });
      await repo.set({ key: "b", value: "2" });
      await repo.delete({ key: "a" });

      const result = await repo.list();
      expect(result).toHaveLength(1);
      expect(result[0].key).toBe("b");
    });
  });
});
