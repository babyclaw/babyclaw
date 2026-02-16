import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "./loader.js";
import { CONFIG_PATH_ENV_VAR, getDefaultConfigPath } from "./paths.js";

function createValidConfig(): Record<string, unknown> {
  return {
    version: 1,
    telegram: {
      botToken: "telegram-token",
    },
    ai: {
      gatewayApiKey: "ai-key",
    },
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("loadConfig", () => {
  it("loads a valid config from SIMPLECLAW_CONFIG_PATH", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "simpleclaw-config-"));

    try {
      const configPath = join(tempDir, "runtime.json");
      await writeFile(configPath, JSON.stringify(createValidConfig()), "utf8");
      vi.stubEnv(CONFIG_PATH_ENV_VAR, configPath);

      const config = await loadConfig();

      expect(config.telegram.botToken).toBe("telegram-token");
      expect(config.ai.gatewayApiKey).toBe("ai-key");
      expect(config.ai.baseUrl).toBe("https://ai-gateway.vercel.sh/v1");
      expect(config.session.historyLimit).toBe(40);
      expect(config.tools.webSearch.braveApiKey).toBeNull();
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("loads from the default home config path when override is unset", async () => {
    const tempHome = await mkdtemp(join(tmpdir(), "simpleclaw-home-"));

    try {
      vi.stubEnv(CONFIG_PATH_ENV_VAR, "");
      vi.stubEnv("HOME", tempHome);
      const defaultPath = getDefaultConfigPath();
      await mkdir(join(tempHome, ".simpleclaw"), { recursive: true });

      await writeFile(defaultPath, JSON.stringify(createValidConfig()), "utf8");

      const config = await loadConfig();

      expect(config.telegram.botToken).toBe("telegram-token");
      expect(config.ai.gatewayApiKey).toBe("ai-key");
    } finally {
      await rm(tempHome, { recursive: true, force: true });
    }
  });

  it("auto-creates a template file when config is missing", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "simpleclaw-missing-"));

    try {
      const configPath = join(tempDir, "nested", "simpleclaw.json");
      vi.stubEnv(CONFIG_PATH_ENV_VAR, configPath);

      await expect(loadConfig()).rejects.toThrow(
        "required secret values are missing",
      );

      const created = await readFile(configPath, "utf8");
      expect(created).toContain('"version": 1');
      expect(created).toContain('"botToken": "REPLACE_ME"');
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("fails validation for placeholder secrets", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "simpleclaw-secret-"));

    try {
      const configPath = join(tempDir, "runtime.json");
      vi.stubEnv(CONFIG_PATH_ENV_VAR, configPath);

      const withPlaceholders = {
        version: 1,
        telegram: {
          botToken: "REPLACE_ME",
        },
        ai: {
          gatewayApiKey: "  ",
        },
      };
      await writeFile(configPath, JSON.stringify(withPlaceholders), "utf8");

      await expect(loadConfig()).rejects.toThrow(
        "required secret values are missing",
      );
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("rejects unknown keys due to strict schema", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "simpleclaw-strict-"));

    try {
      const configPath = join(tempDir, "runtime.json");
      vi.stubEnv(CONFIG_PATH_ENV_VAR, configPath);

      const withUnknownKey = {
        ...createValidConfig(),
        unknownKey: true,
      };
      await writeFile(configPath, JSON.stringify(withUnknownKey), "utf8");

      await expect(loadConfig()).rejects.toThrow("unrecognized keys");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
