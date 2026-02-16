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

  if (isMissingSecret(config.ai.gatewayApiKey)) {
    missing.push("ai.gatewayApiKey");
  }

  if (missing.length > 0) {
    throw new Error(
      `Invalid configuration at ${configPath}: required secret values are missing for ${missing.join(
        ", ",
      )}`,
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
