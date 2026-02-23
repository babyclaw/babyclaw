import { describe, expect, it, beforeEach } from "vitest";
import type { ToolExecutionContext } from "../utils/tool-context.js";
import { createTestDatabase } from "../database/test-utils.js";
import { VaultRepository } from "../vault/repository.js";
import { createVaultTools, normalizeVaultKey } from "./vault.js";

let tools: ReturnType<typeof createVaultTools>;
let vaultRepository: VaultRepository;

const toolOpts = { messages: [], toolCallId: "t1", abortSignal: new AbortController().signal };

function exec(input: Record<string, unknown>) {
  const t = tools.vault;
  return t.execute!(input as any, toolOpts as any);
}

beforeEach(() => {
  const db = createTestDatabase();
  vaultRepository = new VaultRepository({ db });

  const context: ToolExecutionContext = {
    workspaceRoot: "/tmp/test",
    botTimezone: "UTC",
    runSource: "chat",
    isMainSession: false,
  };

  tools = createVaultTools({ context, vaultRepository });
});

describe("vault tool", () => {
  describe('action: "set"', () => {
    it("stores a new secret", async () => {
      const result: any = await exec({
        action: "set",
        key: "github/token",
        value: "ghp_test123",
        label: "GitHub PAT",
      });

      expect(result.ok).toBe(true);
      expect(result.key).toBe("github/token");
      expect(result.created).toBe(true);
    });

    it("upserts an existing secret", async () => {
      await exec({ action: "set", key: "github/token", value: "ghp_old" });
      const result: any = await exec({ action: "set", key: "github/token", value: "ghp_new" });

      expect(result.ok).toBe(true);
      expect(result.created).toBe(false);

      const get: any = await exec({ action: "get", key: "github/token" });
      expect(get.value).toBe("ghp_new");
    });
  });

  describe('action: "get"', () => {
    it("retrieves a stored secret", async () => {
      await exec({ action: "set", key: "openai/api-key", value: "sk-test", label: "OpenAI" });

      const result: any = await exec({ action: "get", key: "openai/api-key" });

      expect(result.ok).toBe(true);
      expect(result.found).toBe(true);
      expect(result.key).toBe("openai/api-key");
      expect(result.value).toBe("sk-test");
      expect(result.label).toBe("OpenAI");
    });

    it("returns found: false for a missing key", async () => {
      const result: any = await exec({ action: "get", key: "nonexistent" });

      expect(result.ok).toBe(true);
      expect(result.found).toBe(false);
      expect(result.key).toBe("nonexistent");
    });
  });

  describe('action: "delete"', () => {
    it("removes an existing secret", async () => {
      await exec({ action: "set", key: "temp/key", value: "val" });

      const result: any = await exec({ action: "delete", key: "temp/key" });

      expect(result.ok).toBe(true);
      expect(result.deleted).toBe(true);

      const get: any = await exec({ action: "get", key: "temp/key" });
      expect(get.found).toBe(false);
    });

    it("handles missing key gracefully", async () => {
      const result: any = await exec({ action: "delete", key: "nonexistent" });

      expect(result.ok).toBe(true);
      expect(result.deleted).toBe(false);
    });
  });

  describe('action: "list"', () => {
    it("returns empty items when vault is empty", async () => {
      const result: any = await exec({ action: "list" });

      expect(result.ok).toBe(true);
      expect(result.items).toEqual([]);
    });

    it("lists keys without values", async () => {
      await exec({ action: "set", key: "github/token", value: "ghp_secret", label: "GitHub" });
      await exec({ action: "set", key: "openai/key", value: "sk-secret" });

      const result: any = await exec({ action: "list" });

      expect(result.ok).toBe(true);
      expect(result.items).toHaveLength(2);

      const keys = result.items.map((i: any) => i.key);
      expect(keys).toContain("github/token");
      expect(keys).toContain("openai/key");

      for (const item of result.items) {
        expect(item).not.toHaveProperty("value");
      }

      const github = result.items.find((i: any) => i.key === "github/token");
      expect(github.label).toBe("GitHub");
    });
  });
});

describe("normalizeVaultKey", () => {
  it("returns a valid key unchanged", () => {
    expect(normalizeVaultKey({ key: "github/token" })).toBe("github/token");
  });

  it("accepts keys with dots, dashes, and underscores", () => {
    expect(normalizeVaultKey({ key: "my-service/api_key.v2" })).toBe("my-service/api_key.v2");
  });

  it("normalizes backslashes to forward slashes", () => {
    expect(normalizeVaultKey({ key: "service\\key" })).toBe("service/key");
  });

  it("trims whitespace", () => {
    expect(normalizeVaultKey({ key: "  my-key  " })).toBe("my-key");
  });

  it("throws on keys with invalid characters", () => {
    expect(() => normalizeVaultKey({ key: "my key!" })).toThrow("Invalid vault key");
  });

  it("throws on keys starting with non-alphanumeric", () => {
    expect(() => normalizeVaultKey({ key: ".hidden" })).toThrow("Invalid vault key");
  });

  it("throws on path traversal (..)", () => {
    expect(() => normalizeVaultKey({ key: "foo/../bar" })).toThrow(
      "Invalid vault key path segments",
    );
  });

  it("throws on leading slash", () => {
    expect(() => normalizeVaultKey({ key: "/absolute" })).toThrow("Invalid vault key");
  });

  it("throws on trailing slash", () => {
    expect(() => normalizeVaultKey({ key: "dir/" })).toThrow("Invalid vault key path segments");
  });

  it("throws on empty key", () => {
    expect(() => normalizeVaultKey({ key: "" })).toThrow("Invalid vault key");
  });

  it("throws on keys exceeding 256 characters", () => {
    const longKey = "a".repeat(258);
    expect(() => normalizeVaultKey({ key: longKey })).toThrow("Invalid vault key");
  });

  it("rejects key validation errors through the tool", async () => {
    const result: any = await exec({ action: "get", key: "../escape" });
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("INVALID_VAULT_KEY");
  });
});
