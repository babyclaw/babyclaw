import { resolve } from "node:path";
import type { LanguageModel } from "ai";
import { AiAgent } from "./ai/agent.js";
import {
  buildProviderRegistry,
  parseModelRef,
  resolveModelRef,
} from "./ai/provider-registry.js";
import { AdminServer } from "./admin/server.js";
import { getAdminSocketPath } from "./admin/paths.js";
import { AgentTurnOrchestrator } from "./agent/orchestrator.js";
import { CommandApprovalService } from "./approval/service.js";
import { BrowserMcpClient } from "./browser/mcp-client.js";
import { ChannelRouter } from "./channel/router.js";
import { MessageLinkRepository } from "./channel/message-link.js";
import { TelegramAdapter } from "./telegram/plugin.js";
import { CrossChatDeliveryService } from "./chat/delivery.js";
import { ChatRegistry } from "./chat/registry.js";
import { loadConfig } from "./config/loader.js";
import { getConfigPath } from "./config/paths.js";
import type { SimpleclawConfig } from "./config/types.js";
import { HeartbeatExecutor } from "./heartbeat/executor.js";
import { HeartbeatRuntime } from "./heartbeat/runtime.js";
import { HeartbeatService } from "./heartbeat/service.js";
import { createLogger, getLogger } from "./logging/index.js";
import type { Logger } from "./logging/index.js";
import { SchedulerExecutor } from "./scheduler/executor.js";
import { SchedulerRuntime } from "./scheduler/runtime.js";
import { SchedulerService } from "./scheduler/service.js";
import { MemoryExtractor } from "./memory/extractor.js";
import { MemoryExtractionQueue } from "./memory/queue.js";
import { SessionManager } from "./session/manager.js";
import { SessionTitleGenerator } from "./session/title-generator.js";
import { bootstrapWorkspace } from "./workspace/bootstrap.js";
import { createDatabase, type Database } from "./database/client.js";
import { applyMigrations } from "./database/migrate.js";

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
  private log: Logger | null = null;

  private db: Database | null = null;
  private schedulerRuntime: SchedulerRuntime | null = null;
  private heartbeatRuntime: HeartbeatRuntime | null = null;
  private browserMcpClient: BrowserMcpClient | undefined = undefined;
  private adminServer: AdminServer | null = null;
  private channelRouter: ChannelRouter | null = null;
  private memoryExtractionQueue: MemoryExtractionQueue | null = null;

  async start(): Promise<void> {
    if (this.state !== "stopped") {
      throw new Error(`Cannot start gateway: current state is "${this.state}"`);
    }

    this.state = "starting";

    try {
      const config = await loadConfig();
      this.config = config;

      const log = createLogger({ config: config.logging });
      this.log = log;

      log.info({ configPath: getConfigPath() }, "Configuration loaded");
      log.debug({
        workspace: config.workspace.root,
        providers: Object.keys(config.ai.providers),
        chatModel: config.ai.models.chat,
        shellMode: config.tools.shell.mode,
        heartbeatEnabled: config.heartbeat.enabled,
        logLevel: config.logging.level,
      }, "Gateway configuration summary");

      const workspacePath = resolve(process.cwd(), config.workspace.root);

      log.info("Applying database migrations...");
      applyMigrations({ workspacePath });
      log.info("Database migrations applied");

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

      let visionModel: LanguageModel | undefined;
      if (config.ai.models.vision) {
        const visionModelRef = resolveModelRef({
          ref: config.ai.models.vision,
          aliases: config.ai.aliases,
        });
        visionModel = registry.languageModel(
          visionModelRef as `${string}:${string}`,
        );
        log.info({ visionModel: config.ai.models.vision }, "Vision model configured");
      }

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

      const db = createDatabase({ workspacePath });
      this.db = db;

      const sessionManager = new SessionManager({
        db,
        maxMessagesPerSession: config.session.maxMessagesPerSession,
      });
      const aiAgent = new AiAgent({ model: chatModel });
      const schedulerService = new SchedulerService({
        db,
        timezone: config.scheduler.timezone,
      });
      const messageLinkRepository = new MessageLinkRepository({ db });

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
        log.warn("Shell tool is running in full-access mode. Command allowlist validation is disabled.");
      }

      const chatRegistry = new ChatRegistry({ db });
      const deliveryService = new CrossChatDeliveryService({
        sessionManager,
        messageLinkRepository,
      });

      const heartbeatService = new HeartbeatService({ db });

      let heartbeatRuntime: HeartbeatRuntime | null = null;

      const telegramBotToken =
        config.channels?.telegram?.botToken ?? config.telegram?.botToken;
      if (!telegramBotToken) {
        throw new Error(
          "Telegram bot token is required. Set channels.telegram.botToken in configuration.",
        );
      }

      const telegramAdapter = new TelegramAdapter({
        token: telegramBotToken,
        workspacePath,
        chatRegistry,
        schedulerService,
        messageLinkRepository,
        getHeartbeatStatus: () => ({
          enabled: config.heartbeat.enabled,
          nextRunAt: heartbeatRuntime?.getNextRunAt() ?? null,
        }),
      });

      const commandApprovalService =
        shellConfig.mode === "allowlist"
          ? new CommandApprovalService({
              sender: telegramAdapter,
              timeoutMs: 120_000,
            })
          : undefined;

      if (commandApprovalService) {
        telegramAdapter.setCommandApprovalService({ service: commandApprovalService });
      }

      const channelRouter = new ChannelRouter();
      channelRouter.register({ adapter: telegramAdapter });
      this.channelRouter = channelRouter;

      const adminSocketPath = getAdminSocketPath();

      const selfToolDeps = {
        getStatus: () => this.getStatus(),
        adminSocketPath,
        logOutput: config.logging.output,
        logLevel: config.logging.level,
        schedulerActive: true,
        heartbeatActive: config.heartbeat.enabled,
        restartGateway: async () => {
          await this.stop();
          process.exit(0);
        },
      };

      const memoryExtractor = new MemoryExtractor({ aiAgent, workspacePath });
      const memoryExtractionQueue = new MemoryExtractionQueue({
        extractor: memoryExtractor,
        sessionManager,
      });
      this.memoryExtractionQueue = memoryExtractionQueue;

      log.info("Querying sessions for memory extraction catch-up...");
      sessionManager
        .findSessionsNeedingExtraction()
        .then((sessions) => {
          log.info(
            { count: sessions.length },
            "Memory extraction catch-up query complete",
          );
          for (const session of sessions) {
            log.debug({ sessionKey: session.key }, "Enqueuing session for memory extraction");
            memoryExtractionQueue.enqueueImmediate({ sessionKey: session.key });
          }
        })
        .catch((err) => {
          log.error({ err }, "Failed to query sessions for memory extraction catch-up");
        });

      let titleGenerator: SessionTitleGenerator | undefined;
      if (config.session.titleGeneration.model) {
        const titleModelRef = resolveModelRef({
          ref: config.session.titleGeneration.model,
          aliases: config.ai.aliases,
        });
        const titleModel = registry.languageModel(
          titleModelRef as `${string}:${string}`,
        );
        titleGenerator = new SessionTitleGenerator({
          model: titleModel,
          prompt: config.session.titleGeneration.prompt,
        });
        log.info({ titleModel: config.session.titleGeneration.model }, "Session title generation enabled");
      }

      const orchestrator = new AgentTurnOrchestrator({
        workspacePath,
        sessionManager,
        aiAgent,
        chatModel,
        visionModel,
        schedulerService,
        messageLinkRepository,
        chatRegistry,
        deliveryService,
        channelRouter,
        syncSchedule,
        enableGenericTools: config.tools.enableGenericTools,
        braveSearchApiKey: config.tools.webSearch.braveApiKey,
        shellConfig,
        browserMcpClient,
        commandApprovalService,
        useReplyChainKey: config.session.replyChainMode === "reply-chain",
        historyLimit: config.session.historyLimit,
        skillsConfig: config.skills,
        fullConfig: config as unknown as Record<string, unknown>,
        memoryExtractionQueue,
        titleGenerator,
        ...selfToolDeps,
      });

      const schedulerExecutor = new SchedulerExecutor({
        channelSender: telegramAdapter,
        workspacePath,
        aiAgent,
        sessionManager,
        schedulerService,
        messageLinkRepository,
        chatRegistry,
        deliveryService,
        syncSchedule,
        enableGenericTools: config.tools.enableGenericTools,
        braveSearchApiKey: config.tools.webSearch.braveApiKey,
        shellConfig,
        browserMcpClient,
        skillsConfig: config.skills,
        fullConfig: config as unknown as Record<string, unknown>,
        ...selfToolDeps,
      });

      schedulerRuntime = new SchedulerRuntime({
        schedulerService,
        schedulerExecutor,
      });
      this.schedulerRuntime = schedulerRuntime;

      await schedulerRuntime.start();
      log.info("Scheduler runtime started");

      const heartbeatExecutor = new HeartbeatExecutor({
        workspacePath,
        aiAgent,
        sessionManager,
        schedulerService,
        heartbeatService,
        chatRegistry,
        channelSender: telegramAdapter,
        deliveryService,
        messageLinkRepository,
        syncSchedule,
        enableGenericTools: config.tools.enableGenericTools,
        braveSearchApiKey: config.tools.webSearch.braveApiKey,
        shellConfig,
        browserMcpClient,
        heartbeatConfig: config.heartbeat,
        historyLimit: config.session.historyLimit,
        skillsConfig: config.skills,
        fullConfig: config as unknown as Record<string, unknown>,
        ...selfToolDeps,
      });

      heartbeatRuntime = new HeartbeatRuntime({
        heartbeatService,
        heartbeatExecutor,
        heartbeatConfig: config.heartbeat,
        timezone: config.scheduler.timezone,
      });
      this.heartbeatRuntime = heartbeatRuntime;

      await heartbeatRuntime.start();
      log.info({ enabled: config.heartbeat.enabled }, "Heartbeat runtime started");

      this.adminServer = new AdminServer({
        socketPath: adminSocketPath,
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

      await channelRouter.startAll({
        onInboundEvent: orchestrator.handleInboundEvent.bind(orchestrator),
      });
      log.info({ platforms: channelRouter.listPlatforms() }, "Channel adapters started");

      this.startedAt = Date.now();
      this.state = "running";
      log.info({ pid: process.pid }, "Gateway is running");
    } catch (error) {
      this.state = "stopped";
      if (this.log) {
        this.log.fatal({ err: error }, "Gateway failed to start");
      }
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (this.state !== "running" && this.state !== "starting") {
      return;
    }

    const log = this.log ?? getLogger();
    log.info("Gateway shutting down...");
    this.state = "stopping";

    if (this.memoryExtractionQueue) {
      this.memoryExtractionQueue.stop();
      log.debug("Memory extraction queue stopped");
    }
    if (this.heartbeatRuntime) {
      this.heartbeatRuntime.stop();
      log.debug("Heartbeat runtime stopped");
    }
    if (this.schedulerRuntime) {
      this.schedulerRuntime.stop();
      log.debug("Scheduler runtime stopped");
    }
    if (this.channelRouter) {
      await this.channelRouter.stopAll();
      log.debug("Channel adapters stopped");
    }
    if (this.browserMcpClient) {
      await this.browserMcpClient.shutdown();
      log.debug("Browser MCP client shut down");
    }
    if (this.db) {
      log.debug("Database connection closed");
    }
    if (this.adminServer) {
      await this.adminServer.stop();
      log.debug("Admin server stopped");
    }

    this.db = null;
    this.schedulerRuntime = null;
    this.heartbeatRuntime = null;
    this.browserMcpClient = undefined;
    this.adminServer = null;
    this.channelRouter = null;
    this.memoryExtractionQueue = null;
    this.startedAt = null;
    this.config = null;
    this.log = null;
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
    const shutdown = async (signal: string) => {
      const log = this.log ?? getLogger();
      log.info({ signal }, "Received shutdown signal");
      await this.stop();
      process.exit(0);
    };
    process.once("SIGINT", () => shutdown("SIGINT"));
    process.once("SIGTERM", () => shutdown("SIGTERM"));
  }
}
