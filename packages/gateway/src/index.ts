import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { AiAgent } from "./ai/agent.js";
import { createBot } from "./bot.js";
import { BrowserMcpClient } from "./browser/mcp-client.js";
import { SchedulerExecutor } from "./scheduler/executor.js";
import { bootstrapWorkspace } from "./workspace/bootstrap.js";
import { SchedulerRuntime } from "./scheduler/runtime.js";
import { SchedulerService } from "./scheduler/service.js";
import { SessionManager } from "./session/manager.js";
import { MessageLinkRepository } from "./telegram/message-link.js";

type EnvKey = "BOT_TOKEN" | "AI_GATEWAY_API_KEY" | "DATABASE_URL" | "BOT_TIMEZONE";

type ParsePositiveIntInput = {
  rawValue: string | undefined;
  fallback: number;
};

type ShutdownInput = {
  signal: NodeJS.Signals;
  bot: ReturnType<typeof createBot>;
  prisma: PrismaClient;
  schedulerRuntime: SchedulerRuntime;
  browserMcpClient?: BrowserMcpClient;
};

async function main(): Promise<void> {
  const botToken = requireEnv({ key: "BOT_TOKEN" });
  const aiGatewayApiKey = requireEnv({ key: "AI_GATEWAY_API_KEY" });
  requireEnv({ key: "DATABASE_URL" });
  const botTimezone = requireValidTimezone({
    rawTimezone: requireEnv({ key: "BOT_TIMEZONE" }),
  });

  const modelId = process.env.AI_MODEL || "anthropic/claude-sonnet-4-20250514";
  const workspacePath = process.env.WORKSPACE_ROOT || process.cwd();
  const maxMessagesPerSession = parsePositiveInt({
    rawValue: process.env.MAX_MESSAGES_PER_SESSION,
    fallback: 120,
  });
  const historyLimit = parsePositiveInt({
    rawValue: process.env.HISTORY_LIMIT,
    fallback: 40,
  });
  const useReplyChainKey = process.env.SESSION_REPLY_CHAIN_MODE === "reply-chain";
  const enableGenericTools = parseFeatureFlag({
    rawValue: process.env.ENABLE_GENERIC_TOOLS,
    defaultValue: process.env.NODE_ENV !== "production",
  });
  const enableBrowserTools = parseFeatureFlag({
    rawValue: process.env.ENABLE_BROWSER_TOOLS,
    defaultValue: false,
  });

  const AI_GATEWAY_BASE_URL = "https://ai-gateway.vercel.sh/v1";

  const browserMcpClient = enableBrowserTools
    ? new BrowserMcpClient({
        llmApiKey: aiGatewayApiKey,
        llmBaseUrl: AI_GATEWAY_BASE_URL,
        headless: process.env.BROWSER_USE_HEADLESS !== "false",
      })
    : undefined;

  const prisma = new PrismaClient();
  const sessionManager = new SessionManager({
    prisma,
    maxMessagesPerSession,
  });
  const aiAgent = new AiAgent({
    apiKey: aiGatewayApiKey,
    modelId,
  });
  const schedulerService = new SchedulerService({
    prisma,
    timezone: botTimezone,
  });
  const messageLinkRepository = new MessageLinkRepository({
    prisma,
  });

  let schedulerRuntime: SchedulerRuntime | null = null;
  const syncSchedule = async ({ scheduleId }: { scheduleId: string }) => {
    if (!schedulerRuntime) {
      return;
    }

    await schedulerRuntime.syncSchedule({ scheduleId });
  };

  await bootstrapWorkspace({ workspacePath });

  const bot = createBot({
    token: botToken,
    workspacePath,
    sessionManager,
    aiAgent,
    schedulerService,
    messageLinkRepository,
    syncSchedule,
    enableGenericTools,
    browserMcpClient,
    useReplyChainKey,
    historyLimit,
  });

  const schedulerExecutor = new SchedulerExecutor({
    api: bot.api,
    workspacePath,
    aiAgent,
    sessionManager,
    schedulerService,
    messageLinkRepository,
    syncSchedule,
    enableGenericTools,
    browserMcpClient,
  });
  schedulerRuntime = new SchedulerRuntime({
    schedulerService,
    schedulerExecutor,
  });

  await schedulerRuntime.start();

  const shutdown = ({ signal }: { signal: NodeJS.Signals }) =>
    handleShutdown({
      signal,
      bot,
      prisma,
      schedulerRuntime,
      browserMcpClient,
    });

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  await bot.start();
  console.log("Telegram gateway bot is running.");
}

function requireEnv({ key }: { key: EnvKey }): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }

  return value;
}

function requireValidTimezone({ rawTimezone }: { rawTimezone: string }): string {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: rawTimezone });
  } catch {
    throw new Error(`Invalid BOT_TIMEZONE value: ${rawTimezone}`);
  }

  return rawTimezone;
}

function parsePositiveInt({ rawValue, fallback }: ParsePositiveIntInput): number {
  if (!rawValue) {
    return fallback;
  }

  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

function parseFeatureFlag({
  rawValue,
  defaultValue,
}: {
  rawValue: string | undefined;
  defaultValue: boolean;
}): boolean {
  if (typeof rawValue !== "string") {
    return defaultValue;
  }

  const normalized = rawValue.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  return defaultValue;
}

async function handleShutdown({
  signal,
  bot,
  prisma,
  schedulerRuntime,
  browserMcpClient,
}: ShutdownInput): Promise<void> {
  console.log(`Received ${signal}, shutting down Telegram gateway bot...`);
  schedulerRuntime.stop();
  bot.stop();
  if (browserMcpClient) {
    await browserMcpClient.shutdown();
  }
  await prisma.$disconnect();
  process.exit(0);
}

main().catch((error) => {
  console.error("Failed to start Telegram gateway bot:", error);
  process.exit(1);
});
