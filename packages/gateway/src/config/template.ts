import { DEFAULT_SHELL_ALLOWED_COMMANDS, DEFAULT_SHELL_MODE } from "./shell-defaults.js";

const DEFAULT_CONFIG_TEMPLATE = {
  version: 1,
  channels: {
    telegram: {
      botToken: "REPLACE_ME",
    },
  },
  ai: {
    providers: {
      anthropic: {
        apiKey: "REPLACE_ME",
      },
    },
    models: {
      chat: "anthropic:claude-sonnet-4-20250514",
    },
    aliases: {},
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
    shell: {
      mode: DEFAULT_SHELL_MODE,
      allowedCommands: [...DEFAULT_SHELL_ALLOWED_COMMANDS],
    },
    webSearch: {
      braveApiKey: null,
    },
  },
  heartbeat: {
    enabled: false,
    intervalMinutes: 30,
    activeHours: {
      start: null,
      end: null,
    },
    prompt:
      "Read HEARTBEAT.md if it exists. Follow its instructions. " +
      "Do not infer or repeat old tasks from prior chats. " +
      "If nothing needs attention, say so.",
  },
};

export function getDefaultConfigTemplate(): string {
  return `${JSON.stringify(DEFAULT_CONFIG_TEMPLATE, null, 2)}\n`;
}
