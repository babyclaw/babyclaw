import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { AiAgent } from "./ai/agent.js";
import { createBot } from "./bot.js";
import { BrowserMcpClient } from "./browser/mcp-client.js";
import { loadConfig } from "./config/loader.js";
import { SchedulerExecutor } from "./scheduler/executor.js";
import { SchedulerRuntime } from "./scheduler/runtime.js";
import { SchedulerService } from "./scheduler/service.js";
import { SessionManager } from "./session/manager.js";
import { MessageLinkRepository } from "./telegram/message-link.js";
import { bootstrapWorkspace } from "./workspace/bootstrap.js";

type ShutdownInput = {
  signal: NodeJS.Signals;
  bot: ReturnType<typeof createBot>;
  prisma: PrismaClient;
  schedulerRuntime: SchedulerRuntime;
  browserMcpClient?: BrowserMcpClient;
};

async function main(): Promise<void> {
  const config = await loadConfig();

  const workspacePath = resolveWorkspaceRoot({
    workspaceRoot: config.workspace.root,
  });

  const browserMcpClient = config.tools.enableBrowserTools
    ? new BrowserMcpClient({
        llmApiKey: config.ai.gatewayApiKey,
        llmBaseUrl: config.ai.baseUrl,
        llmModel: config.ai.models.browser,
        headless: config.tools.browser.headless,
      })
    : undefined;

  const prisma = new PrismaClient({
    datasources: {
      db: {
        url: config.database.url,
      },
    },
  });

  const sessionManager = new SessionManager({
    prisma,
    maxMessagesPerSession: config.session.maxMessagesPerSession,
  });
  const aiAgent = new AiAgent({
    apiKey: config.ai.gatewayApiKey,
    modelId: config.ai.models.chat,
  });
  const schedulerService = new SchedulerService({
    prisma,
    timezone: config.scheduler.timezone,
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

  const shellConfig = config.tools.shell;

  if (shellConfig.mode === "full-access") {
    console.warn(
      "[config] WARNING: Shell tool is running in full-access mode. " +
        "Command allowlist validation is disabled. Any shell command can be executed.",
    );
  }

  const bot = createBot({
    token: config.telegram.botToken,
    workspacePath,
    sessionManager,
    aiAgent,
    schedulerService,
    messageLinkRepository,
    syncSchedule,
    enableGenericTools: config.tools.enableGenericTools,
    braveSearchApiKey: config.tools.webSearch.braveApiKey,
    shellConfig,
    browserMcpClient,
    useReplyChainKey: config.session.replyChainMode === "reply-chain",
    historyLimit: config.session.historyLimit,
  });

  const schedulerExecutor = new SchedulerExecutor({
    api: bot.api,
    workspacePath,
    aiAgent,
    sessionManager,
    schedulerService,
    messageLinkRepository,
    syncSchedule,
    enableGenericTools: config.tools.enableGenericTools,
    braveSearchApiKey: config.tools.webSearch.braveApiKey,
    shellConfig,
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

function resolveWorkspaceRoot({ workspaceRoot }: { workspaceRoot: string }): string {
  return resolve(process.cwd(), workspaceRoot);
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
