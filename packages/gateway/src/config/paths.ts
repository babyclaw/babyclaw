import { homedir } from "node:os";
import { join } from "node:path";

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
