import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ZodIssue } from "zod";
import { getConfigPath } from "./paths.js";
import { simpleclawConfigSchema } from "./schema.js";
import { getDefaultConfigTemplate } from "./template.js";
import type { SimpleclawConfig } from "./types.js";

const MISSING_SECRET_PLACEHOLDER = "REPLACE_ME";

export async function loadConfig(): Promise<SimpleclawConfig> {
  const configPath = getConfigPath();

  await ensureConfigFileExists({ configPath });

  const raw = await readFile(configPath, "utf8");
  const json = parseJsonConfig({ raw, configPath });

  detectLegacyConfig({ json, configPath });

  const parsed = simpleclawConfigSchema.safeParse(json);
  if (!parsed.success) {
    const issues = parsed.error.issues.map(formatIssue).join("\n");
    throw new Error(
      `Invalid configuration at ${configPath}:\n${issues}`,
    );
  }

  ensureRequiredSecrets({ config: parsed.data, configPath });

  return parsed.data;
}

export async function loadConfigRaw(): Promise<SimpleclawConfig | null> {
  const configPath = getConfigPath();

  try {
    await access(configPath);
  } catch {
    return null;
  }

  const raw = await readFile(configPath, "utf8");
  const json = parseJsonConfig({ raw, configPath });

  const parsed = simpleclawConfigSchema.safeParse(json);
  if (!parsed.success) {
    return null;
  }

  return parsed.data;
}

export async function writeConfig({
  config,
}: {
  config: SimpleclawConfig;
}): Promise<void> {
  const configPath = getConfigPath();
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, JSON.stringify(config, null, 2) + "\n", "utf8");
}

async function ensureConfigFileExists({
  configPath,
}: {
  configPath: string;
}): Promise<void> {
  try {
    await access(configPath);
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }

    await mkdir(dirname(configPath), { recursive: true });
    await writeFile(configPath, getDefaultConfigTemplate(), "utf8");
    console.warn(
      `[config] Created config file at ${configPath}. Fill required secrets and restart.`,
    );
  }
}

function parseJsonConfig({
  raw,
  configPath,
}: {
  raw: string;
  configPath: string;
}): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid JSON in config file at ${configPath}: ${message}`);
  }
}

function ensureRequiredSecrets({
  config,
  configPath,
}: {
  config: SimpleclawConfig;
  configPath: string;
}): void {
  const missing: string[] = [];

  if (isMissingSecret(config.telegram.botToken)) {
    missing.push("telegram.botToken");
  }

  for (const [key, provider] of Object.entries(config.ai.providers)) {
    if (isMissingSecret(provider.apiKey)) {
      missing.push(`ai.providers.${key}.apiKey`);
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `Invalid configuration at ${configPath}: required secret values are missing for ${missing.join(
        ", ",
      )}`,
    );
  }
}

function detectLegacyConfig({
  json,
  configPath,
}: {
  json: unknown;
  configPath: string;
}): void {
  if (
    typeof json === "object" &&
    json !== null &&
    "ai" in json &&
    typeof (json as Record<string, unknown>).ai === "object" &&
    (json as Record<string, unknown>).ai !== null &&
    "gatewayApiKey" in ((json as Record<string, unknown>).ai as Record<string, unknown>)
  ) {
    throw new Error(
      `Legacy configuration detected at ${configPath}.\n` +
        "The 'ai.gatewayApiKey' field has been replaced by the multi-provider 'ai.providers' structure.\n" +
        "Run 'simpleclaw model configure' to set up providers interactively, or migrate manually.\n" +
        "See the configuration docs for the new schema.",
    );
  }
}

function isMissingSecret(value: string): boolean {
  const normalized = value.trim();
  return normalized.length === 0 || normalized === MISSING_SECRET_PLACEHOLDER;
}

function formatIssue(issue: ZodIssue): string {
  const path = issue.path.length > 0 ? issue.path.map(String).join(".") : "$";

  if (issue.code === "unrecognized_keys") {
    return `- ${path}: unrecognized keys: ${issue.keys.join(", ")}`;
  }

  return `- ${path}: ${issue.message}`;
}
