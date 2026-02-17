import { z } from "zod";
import {
  DEFAULT_SHELL_ALLOWED_COMMANDS,
  DEFAULT_SHELL_MODE,
  SHELL_MODES,
} from "./shell-defaults.js";

const DEFAULT_DATABASE_URL = "file:../data/simpleclaw.db";

function isValidTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

const providerConfigSchema = z.object({
  apiKey: z.string().min(1),
  baseUrl: z.string().url().optional(),
}).strict();

const aiProvidersSchema = z.record(
  z.string().min(1),
  providerConfigSchema,
).refine(
  (obj) => Object.keys(obj).length > 0,
  "At least one provider must be configured",
);

const modelAliasesSchema = z.record(
  z.string().min(1).regex(/^[a-z0-9_-]+$/),
  z.string().min(1),
).default({});

const aiModelsSchema = z.object({
  chat: z.string().min(1),
  browser: z.string().min(1),
}).strict();

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

const telegramChannelConfigSchema = z.object({
  botToken: z.string().min(1),
}).strict();

const channelsSchema = z.object({
  telegram: telegramChannelConfigSchema.optional(),
}).strict().default({});

export const simpleclawConfigSchema = z.object({
  version: z.literal(1),
  telegram: z.object({
    botToken: z.string().min(1),
  }).strict().optional(),
  channels: channelsSchema,
  ai: z.object({
    providers: aiProvidersSchema,
    models: aiModelsSchema,
    aliases: modelAliasesSchema,
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
  heartbeat: z.object({
    enabled: z.boolean().default(false),
    intervalMinutes: z.number().int().min(5).default(30),
    activeHours: z.object({
      start: z.string().regex(/^\d{2}:\d{2}$/).nullable().default(null),
      end: z.string().regex(/^\d{2}:\d{2}$/).nullable().default(null),
    }).strict().default({ start: null, end: null }),
    prompt: z.string().min(1).default(
      "Read HEARTBEAT.md if it exists. Follow its instructions. " +
      "Do not infer or repeat old tasks from prior chats. " +
      "If nothing needs attention, say so.",
    ),
  }).strict().default({
    enabled: false,
    intervalMinutes: 30,
    activeHours: { start: null, end: null },
    prompt:
      "Read HEARTBEAT.md if it exists. Follow its instructions. " +
      "Do not infer or repeat old tasks from prior chats. " +
      "If nothing needs attention, say so.",
  }),
}).strict();
