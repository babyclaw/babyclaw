import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { AiAgent } from "./ai/agent.js";
import {
  buildProviderRegistry,
  parseModelRef,
  resolveModelRef,
} from "./ai/provider-registry.js";
import { AdminServer } from "./admin/server.js";
import { getAdminSocketPath } from "./admin/paths.js";
import { createBot } from "./bot.js";
import { BrowserMcpClient } from "./browser/mcp-client.js";
import { loadConfig } from "./config/loader.js";
import { getConfigPath } from "./config/paths.js";
import type { SimpleclawConfig } from "./config/types.js";
import { SchedulerExecutor } from "./scheduler/executor.js";
import { SchedulerRuntime } from "./scheduler/runtime.js";
import { SchedulerService } from "./scheduler/service.js";
import { SessionManager } from "./session/manager.js";
import { MessageLinkRepository } from "./telegram/message-link.js";
import { bootstrapWorkspace } from "./workspace/bootstrap.js";

export type GatewayStatus = {
  state: "stopped" | "starting" | "running" | "stopping";
  uptimeMs: number | null;
  configPath: string | null;
  pid: number;
  version: string;
};

export class GatewayRuntime {
  private state: GatewayStatus["state"] = "stopped";
  private startedAt: number | null = null;
  private config: SimpleclawConfig | null = null;

  private bot: ReturnType<typeof createBot> | null = null;
  private prisma: PrismaClient | null = null;
  private schedulerRuntime: SchedulerRuntime | null = null;
  private browserMcpClient: BrowserMcpClient | undefined = undefined;
  private adminServer: AdminServer | null = null;

  async start(): Promise<void> {
    if (this.state !== "stopped") {
      throw new Error(`Cannot start gateway: current state is "${this.state}"`);
    }

    this.state = "starting";

    try {
      const config = await loadConfig();
      this.config = config;

      const workspacePath = resolve(process.cwd(), config.workspace.root);

      const registry = buildProviderRegistry({
        providers: config.ai.providers,
      });

      const chatModelRef = resolveModelRef({
        ref: config.ai.models.chat,
        aliases: config.ai.aliases,
      });
      const chatModel = registry.languageModel(
        chatModelRef as `${string}:${string}`,
      );

      let browserMcpClient: BrowserMcpClient | undefined;
      if (config.tools.enableBrowserTools) {
        const browserModelRef = resolveModelRef({
          ref: config.ai.models.browser,
          aliases: config.ai.aliases,
        });
        const { providerKey, modelId: browserModelId } = parseModelRef({
          ref: browserModelRef,
        });
        const browserProviderConfig = config.ai.providers[providerKey];
        if (!browserProviderConfig) {
          throw new Error(
            `Browser model references provider "${providerKey}" which is not configured in ai.providers`,
          );
        }
        browserMcpClient = new BrowserMcpClient({
          llmApiKey: browserProviderConfig.apiKey,
          llmBaseUrl: browserProviderConfig.baseUrl,
          llmModel: browserModelId,
          headless: config.tools.browser.headless,
        });
      }
      this.browserMcpClient = browserMcpClient;

      const prisma = new PrismaClient({
        datasources: {
          db: {
            url: config.database.url,
          },
        },
      });
      this.prisma = prisma;

      const sessionManager = new SessionManager({
        prisma,
        maxMessagesPerSession: config.session.maxMessagesPerSession,
      });
      const aiAgent = new AiAgent({ model: chatModel });
      const schedulerService = new SchedulerService({
        prisma,
        timezone: config.scheduler.timezone,
      });
      const messageLinkRepository = new MessageLinkRepository({ prisma });

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
      this.bot = bot;

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
      this.schedulerRuntime = schedulerRuntime;

      await schedulerRuntime.start();

      this.adminServer = new AdminServer({
        socketPath: getAdminSocketPath(),
        routes: {
          "/status": () => this.getStatus(),
          "/health": () => ({ ok: true }),
          "/shutdown": () => {
            setImmediate(() => {
              void this.stop().then(() => process.exit(0));
            });
            return { ok: true };
          },
        },
      });
      await this.adminServer.start();

      await bot.start();

      this.startedAt = Date.now();
      this.state = "running";
      console.log("Telegram gateway bot is running.");
    } catch (error) {
      this.state = "stopped";
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (this.state !== "running" && this.state !== "starting") {
      return;
    }

    this.state = "stopping";

    if (this.schedulerRuntime) {
      this.schedulerRuntime.stop();
    }
    if (this.bot) {
      this.bot.stop();
    }
    if (this.browserMcpClient) {
      await this.browserMcpClient.shutdown();
    }
    if (this.prisma) {
      await this.prisma.$disconnect();
    }
    if (this.adminServer) {
      await this.adminServer.stop();
    }

    this.bot = null;
    this.prisma = null;
    this.schedulerRuntime = null;
    this.browserMcpClient = undefined;
    this.adminServer = null;
    this.startedAt = null;
    this.config = null;
    this.state = "stopped";
  }

  getStatus(): GatewayStatus {
    return {
      state: this.state,
      uptimeMs: this.startedAt ? Date.now() - this.startedAt : null,
      configPath: getConfigPath(),
      pid: process.pid,
      version: "1.0.0",
    };
  }

  getConfig(): SimpleclawConfig | null {
    return this.config;
  }

  registerSignalHandlers(): void {
    const shutdown = async () => {
      console.log("Received shutdown signal, stopping gateway...");
      await this.stop();
      process.exit(0);
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  }
}
