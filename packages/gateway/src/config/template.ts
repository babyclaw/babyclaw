import { DEFAULT_SHELL_ALLOWED_COMMANDS, DEFAULT_SHELL_MODE } from "./shell-defaults.js";

const DEFAULT_CONFIG_TEMPLATE = {
  version: 1,
  telegram: {
    botToken: "REPLACE_ME",
  },
  ai: {
    gatewayApiKey: "REPLACE_ME",
    baseUrl: "https://ai-gateway.vercel.sh/v1",
    models: {
      chat: "anthropic/claude-sonnet-4-20250514",
      browser: "anthropic/claude-opus-4.6",
    },
  },
  database: {
    url: "file:../data/simpleclaw.db",
  },
  scheduler: {
    timezone: "UTC",
  },
  workspace: {
    root: ".",
  },
  session: {
    maxMessagesPerSession: 120,
    historyLimit: 40,
    replyChainMode: "default",
  },
  tools: {
    enableGenericTools: true,
    enableBrowserTools: false,
    browser: {
      headless: true,
    },
    shell: {
      mode: DEFAULT_SHELL_MODE,
      allowedCommands: [...DEFAULT_SHELL_ALLOWED_COMMANDS],
    },
    webSearch: {
      braveApiKey: null,
    },
  },
};

export function getDefaultConfigTemplate(): string {
  return `${JSON.stringify(DEFAULT_CONFIG_TEMPLATE, null, 2)}\n`;
}
