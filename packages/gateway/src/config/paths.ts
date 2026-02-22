import { homedir } from "node:os";
import { dirname, join, resolve, isAbsolute } from "node:path";

export const CONFIG_PATH_ENV_VAR = "BABYCLAW_CONFIG_PATH";

export function getDefaultConfigPath(): string {
  return join(homedir(), ".babyclaw", "babyclaw.json");
}

export function getConfigPath(): string {
  const overridePath = process.env[CONFIG_PATH_ENV_VAR]?.trim();
  if (overridePath) {
    return overridePath;
  }

  return getDefaultConfigPath();
}

export function getConfigDir(): string {
  return dirname(getConfigPath());
}

export const DEFAULT_WORKSPACE_ROOT = "~/babyclaw";

/**
 * Resolves the workspace path from the config's workspace.root value.
 * Supports ~ expansion for home-relative paths.
 * Plain relative paths are resolved against the config file's directory
 * so the result is deterministic regardless of where the process starts.
 */
export function resolveWorkspaceRoot({ configRoot }: { configRoot: string }): string {
  if (configRoot === "~" || configRoot.startsWith("~/")) {
    return join(homedir(), configRoot.slice(2));
  }
  if (isAbsolute(configRoot)) {
    return configRoot;
  }
  return resolve(getConfigDir(), configRoot);
}
