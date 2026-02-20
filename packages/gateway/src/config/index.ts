export { loadConfig } from "./loader.js";
export { getConfigPath, getDefaultConfigPath, CONFIG_PATH_ENV_VAR } from "./paths.js";
export { simpleclawConfigSchema } from "./schema.js";
export {
  DEFAULT_SHELL_ALLOWED_COMMANDS,
  DEFAULT_SHELL_MODE,
  SHELL_MODES,
} from "./shell-defaults.js";
export type { ShellConfig, ShellMode } from "./shell-defaults.js";
export { getDefaultConfigTemplate } from "./template.js";
export type { SimpleclawConfig } from "./types.js";
