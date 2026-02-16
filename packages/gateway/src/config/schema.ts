import { z } from "zod";
import {
  DEFAULT_SHELL_ALLOWED_COMMANDS,
  DEFAULT_SHELL_MODE,
  SHELL_MODES,
} from "./shell-defaults.js";

const DEFAULT_CHAT_MODEL = "anthropic/claude-sonnet-4-20250514";
const DEFAULT_BROWSER_MODEL = "anthropic/claude-opus-4.6";
const DEFAULT_AI_BASE_URL = "https://ai-gateway.vercel.sh/v1";
const DEFAULT_DATABASE_URL = "file:../data/simpleclaw.db";

function isValidTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

const aiModelsSchema = z.object({
  chat: z.string().min(1).default(DEFAULT_CHAT_MODEL),
  browser: z.string().min(1).default(DEFAULT_BROWSER_MODEL),
}).strict().default({
  chat: DEFAULT_CHAT_MODEL,
  browser: DEFAULT_BROWSER_MODEL,
});

const toolsSchema = z.object({
  enableGenericTools: z.boolean().default(true),
  enableBrowserTools: z.boolean().default(false),
  browser: z.object({
    headless: z.boolean().default(true),
  }).strict().default({
    headless: true,
  }),
  shell: z.object({
    mode: z.enum(SHELL_MODES).default(DEFAULT_SHELL_MODE),
    allowedCommands: z.array(z.string().trim().min(1)).default([...DEFAULT_SHELL_ALLOWED_COMMANDS]),
  }).strict().default({
    mode: DEFAULT_SHELL_MODE,
    allowedCommands: [...DEFAULT_SHELL_ALLOWED_COMMANDS],
  }),
  webSearch: z.object({
    braveApiKey: z.string().min(1).nullable().default(null),
  }).strict().default({
    braveApiKey: null,
  }),
}).strict().default({
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
});

export const simpleclawConfigSchema = z.object({
  version: z.literal(1),
  telegram: z.object({
    botToken: z.string().min(1),
  }).strict(),
  ai: z.object({
    gatewayApiKey: z.string().min(1),
    baseUrl: z.string().url().default(DEFAULT_AI_BASE_URL),
    models: aiModelsSchema,
  }).strict(),
  database: z.object({
    url: z.string().min(1).default(DEFAULT_DATABASE_URL),
  }).strict().default({
    url: DEFAULT_DATABASE_URL,
  }),
  scheduler: z.object({
    timezone: z
      .string()
      .min(1)
      .refine(isValidTimezone, "Must be a valid IANA timezone")
      .default("UTC"),
  }).strict().default({
    timezone: "UTC",
  }),
  workspace: z.object({
    root: z.string().min(1).default("."),
  }).strict().default({
    root: ".",
  }),
  session: z.object({
    maxMessagesPerSession: z.number().int().positive().default(120),
    historyLimit: z.number().int().positive().default(40),
    replyChainMode: z.enum(["default", "reply-chain"]).default("default"),
  }).strict().default({
    maxMessagesPerSession: 120,
    historyLimit: 40,
    replyChainMode: "default",
  }),
  tools: toolsSchema,
}).strict();
