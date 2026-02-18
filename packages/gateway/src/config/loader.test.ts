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
      providers: {
        anthropic: {
          apiKey: "ai-key",
        },
      },
      models: {
        chat: "anthropic:claude-sonnet-4-20250514",
        browser: "anthropic:claude-sonnet-4-20250514",
      },
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

      expect(config.channels.telegram?.botToken).toBe("telegram-token");
      expect(config.ai.providers.anthropic?.apiKey).toBe("ai-key");
      expect(config.ai.models.chat).toBe("anthropic:claude-sonnet-4-20250514");
      expect(config.session.historyLimit).toBe(40);
      expect(config.tools.webSearch.braveApiKey).toBeNull();
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("defaults shell config to allowlist mode with default commands", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "simpleclaw-shell-default-"));

    try {
      const configPath = join(tempDir, "runtime.json");
      await writeFile(configPath, JSON.stringify(createValidConfig()), "utf8");
      vi.stubEnv(CONFIG_PATH_ENV_VAR, configPath);

      const config = await loadConfig();

      expect(config.tools.shell.mode).toBe("allowlist");
      expect(config.tools.shell.allowedCommands).toBeInstanceOf(Array);
      expect(config.tools.shell.allowedCommands.length).toBeGreaterThan(0);
      expect(config.tools.shell.allowedCommands).toContain("ls");
      expect(config.tools.shell.allowedCommands).toContain("git");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("accepts full-access shell mode from config", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "simpleclaw-shell-full-"));

    try {
      const configPath = join(tempDir, "runtime.json");
      const withFullAccess = {
        ...createValidConfig(),
        tools: {
          shell: {
            mode: "full-access",
          },
        },
      };
      await writeFile(configPath, JSON.stringify(withFullAccess), "utf8");
      vi.stubEnv(CONFIG_PATH_ENV_VAR, configPath);

      const config = await loadConfig();

      expect(config.tools.shell.mode).toBe("full-access");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("accepts a custom shell allowedCommands list", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "simpleclaw-shell-custom-"));

    try {
      const configPath = join(tempDir, "runtime.json");
      const withCustomCommands = {
        ...createValidConfig(),
        tools: {
          shell: {
            mode: "allowlist",
            allowedCommands: ["docker", "kubectl"],
          },
        },
      };
      await writeFile(configPath, JSON.stringify(withCustomCommands), "utf8");
      vi.stubEnv(CONFIG_PATH_ENV_VAR, configPath);

      const config = await loadConfig();

      expect(config.tools.shell.mode).toBe("allowlist");
      expect(config.tools.shell.allowedCommands).toEqual(["docker", "kubectl"]);
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

      expect(config.channels.telegram?.botToken).toBe("telegram-token");
      expect(config.ai.providers.anthropic?.apiKey).toBe("ai-key");
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
      expect(created).toContain('"channels"');
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
        channels: {
          telegram: {
            botToken: "REPLACE_ME",
          },
        },
        ai: {
          providers: {
            anthropic: {
              apiKey: "  ",
            },
          },
          models: {
            chat: "anthropic:claude-sonnet-4-20250514",
            browser: "anthropic:claude-sonnet-4-20250514",
          },
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

  it("loads new channels.telegram config format", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "simpleclaw-channels-"));

    try {
      const configPath = join(tempDir, "runtime.json");
      const newFormatConfig = {
        version: 1,
        channels: {
          telegram: {
            botToken: "new-format-token",
          },
        },
        ai: {
          providers: {
            anthropic: {
              apiKey: "ai-key",
            },
          },
          models: {
            chat: "anthropic:claude-sonnet-4-20250514",
            browser: "anthropic:claude-sonnet-4-20250514",
          },
        },
      };
      await writeFile(configPath, JSON.stringify(newFormatConfig), "utf8");
      vi.stubEnv(CONFIG_PATH_ENV_VAR, configPath);

      const config = await loadConfig();

      expect(config.channels.telegram?.botToken).toBe("new-format-token");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("normalizes legacy telegram config into channels", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "simpleclaw-legacy-"));

    try {
      const configPath = join(tempDir, "runtime.json");
      await writeFile(configPath, JSON.stringify(createValidConfig()), "utf8");
      vi.stubEnv(CONFIG_PATH_ENV_VAR, configPath);

      const config = await loadConfig();

      expect(config.channels.telegram?.botToken).toBe("telegram-token");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("accepts optional vision model in ai.models", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "simpleclaw-vision-"));

    try {
      const configPath = join(tempDir, "runtime.json");
      const configWithVision = {
        ...createValidConfig(),
        ai: {
          ...createValidConfig().ai as Record<string, unknown>,
          models: {
            chat: "anthropic:claude-sonnet-4-20250514",
            browser: "anthropic:claude-sonnet-4-20250514",
            vision: "anthropic:claude-sonnet-4-20250514",
          },
        },
      };
      await writeFile(configPath, JSON.stringify(configWithVision), "utf8");
      vi.stubEnv(CONFIG_PATH_ENV_VAR, configPath);

      const config = await loadConfig();

      expect(config.ai.models.vision).toBe("anthropic:claude-sonnet-4-20250514");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("defaults vision model to undefined when not provided", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "simpleclaw-no-vision-"));

    try {
      const configPath = join(tempDir, "runtime.json");
      await writeFile(configPath, JSON.stringify(createValidConfig()), "utf8");
      vi.stubEnv(CONFIG_PATH_ENV_VAR, configPath);

      const config = await loadConfig();

      expect(config.ai.models.vision).toBeUndefined();
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("defaults api config to disabled mode", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "simpleclaw-api-default-"));

    try {
      const configPath = join(tempDir, "runtime.json");
      await writeFile(configPath, JSON.stringify(createValidConfig()), "utf8");
      vi.stubEnv(CONFIG_PATH_ENV_VAR, configPath);

      const config = await loadConfig();

      expect(config.api.enabled).toBe(false);
      expect(config.api.port).toBe(4800);
      expect(config.api.apiKey).toBeNull();
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("accepts enabled api config with api key", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "simpleclaw-api-enabled-"));

    try {
      const configPath = join(tempDir, "runtime.json");
      const configWithApi = {
        ...createValidConfig(),
        api: {
          enabled: true,
          port: 4801,
          apiKey: "gateway-api-key",
        },
      };
      await writeFile(configPath, JSON.stringify(configWithApi), "utf8");
      vi.stubEnv(CONFIG_PATH_ENV_VAR, configPath);

      const config = await loadConfig();

      expect(config.api.enabled).toBe(true);
      expect(config.api.port).toBe(4801);
      expect(config.api.apiKey).toBe("gateway-api-key");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("requires api.apiKey when api is enabled", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "simpleclaw-api-secret-"));

    try {
      const configPath = join(tempDir, "runtime.json");
      const configWithMissingApiKey = {
        ...createValidConfig(),
        api: {
          enabled: true,
          port: 4800,
          apiKey: null,
        },
      };
      await writeFile(configPath, JSON.stringify(configWithMissingApiKey), "utf8");
      vi.stubEnv(CONFIG_PATH_ENV_VAR, configPath);

      await expect(loadConfig()).rejects.toThrow("api.apiKey");
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
