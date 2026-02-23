import { MessageRole } from "../database/schema.js";
import {
  buildHeartbeatVerdictMessages,
  getHeartbeatSystemMessage,
  getMainSessionSystemMessage,
  getSchedulerGuidanceSystemMessage,
  getSharedSystemMessage,
  getSkillsSystemMessage,
  getVaultSystemMessage,
  getWorkspaceGuideSystemMessage,
} from "../ai/prompts.js";
import { loadAgentContext } from "../agent/context.js";
import type { ChannelSender } from "../channel/types.js";
import { getLogger } from "../logging/index.js";
import type { Logger } from "../logging/index.js";
import { SessionManager } from "../session/manager.js";
import { createUnifiedTools } from "../tools/registry.js";
import { toErrorMessage } from "../utils/errors.js";
import type { ToolDependencies } from "../utils/tool-deps.js";
import { readHeartbeatInstructions } from "../workspace/bootstrap.js";
import type { HeartbeatService } from "./service.js";
import { heartbeatResultSchema, type HeartbeatConfig } from "./types.js";

type HeartbeatExecutorInput = {
  toolDeps: ToolDependencies;
  channelSender: ChannelSender;
  heartbeatService: HeartbeatService;
  heartbeatConfig: HeartbeatConfig;
  historyLimit: number;
};

export class HeartbeatExecutor {
  private readonly toolDeps: ToolDependencies;
  private readonly channelSender: ChannelSender;
  private readonly heartbeatService: HeartbeatService;
  private readonly heartbeatConfig: HeartbeatConfig;
  private readonly historyLimit: number;
  private readonly log: Logger;
  private running = false;

  constructor({
    toolDeps,
    channelSender,
    heartbeatService,
    heartbeatConfig,
    historyLimit,
  }: HeartbeatExecutorInput) {
    this.toolDeps = toolDeps;
    this.channelSender = channelSender;
    this.heartbeatService = heartbeatService;
    this.heartbeatConfig = heartbeatConfig;
    this.historyLimit = historyLimit;
    this.log = getLogger().child({ component: "heartbeat-executor" });
  }

  async execute(): Promise<void> {
    if (this.running) {
      await this.heartbeatService.recordRun({
        startedAt: new Date(),
        finishedAt: new Date(),
        outcome: "skipped_overlap",
        summary: "Skipped because previous heartbeat is still running",
      });
      return;
    }

    this.running = true;
    const startedAt = new Date();
    this.log.info("Heartbeat execution starting");

    try {
      const {
        workspacePath,
        aiAgent,
        sessionManager,
        schedulerService,
        messageLinkRepository,
        chatRegistry,
        skillsConfig,
        fullConfig,
      } = this.toolDeps;

      const mainChat = await chatRegistry.getMainChat();
      if (!mainChat) {
        this.log.warn("No main chat found, skipping heartbeat");
        return;
      }

      const instructions = await readHeartbeatInstructions({
        workspacePath,
      });
      if (!instructions) {
        await this.heartbeatService.recordRun({
          startedAt,
          finishedAt: new Date(),
          outcome: "skipped_empty",
          summary: "HEARTBEAT.md is empty or missing",
        });
        return;
      }

      const platformChatId = mainChat.platformChatId;

      const sessionIdentity = SessionManager.deriveSessionIdentity({
        platform: mainChat.platform,
        chatId: platformChatId,
      });

      const linkedChats = await chatRegistry.listLinkedChats({
        platform: mainChat.platform,
      });

      const { personalityFiles, toolNotesContent, agentsContent, skills } = await loadAgentContext({
        workspacePath,
        skillsConfig,
        fullConfig,
      });

      const history = await sessionManager.getMessages({
        identity: sessionIdentity,
        limit: this.historyLimit,
      });

      const messages = [
        getSharedSystemMessage({
          workspacePath,
          personalityFiles,
        }),
        getWorkspaceGuideSystemMessage({ agentsContent }),
        getSkillsSystemMessage({ skills, toolNotesContent }),
        getSchedulerGuidanceSystemMessage(),
        getVaultSystemMessage(),
        getMainSessionSystemMessage({ linkedChats }),
        getHeartbeatSystemMessage({ instructions }),
        ...history,
        { role: "user" as const, content: this.heartbeatConfig.prompt },
      ];

      const tools = createUnifiedTools({
        toolDeps: this.toolDeps,
        executionContext: {
          workspaceRoot: workspacePath,
          bundledSkillsDir: this.toolDeps.bundledSkillsDir,
          botTimezone: schedulerService.getTimezone(),
          platform: mainChat.platform,
          chatId: platformChatId,
          runSource: "heartbeat",
          isMainSession: true,
        },
        createdByUserId: platformChatId,
        sourceText: this.heartbeatConfig.prompt,
        getActiveTurnCount: () => 0,
        channelSender: this.channelSender,
      });

      const phase1Response = await aiAgent.chatWithTools({
        messages,
        tools,
        maxSteps: 50,
      });

      const verdictMessages = buildHeartbeatVerdictMessages({
        phase1Response,
      });

      const verdict = await aiAgent.forceToolCall({
        messages: verdictMessages,
        toolName: "heartbeat_result",
        description:
          "Report the heartbeat check result. Use ok if nothing needs attention, alert if something should be delivered.",
        inputSchema: heartbeatResultSchema,
      });

      this.log.info(
        { action: verdict.action, durationMs: new Date().getTime() - startedAt.getTime() },
        "Heartbeat verdict reached",
      );

      if (verdict.action === "alert" && verdict.message) {
        const sendResult = await this.channelSender.sendMessage({
          chatId: platformChatId,
          text: verdict.message,
        });

        await messageLinkRepository.upsertMessageLink({
          platform: mainChat.platform,
          platformChatId,
          platformMessageId: sendResult.platformMessageId,
          sessionKey: sessionIdentity.key,
        });

        await sessionManager.appendMessages({
          identity: sessionIdentity,
          messages: [
            {
              role: MessageRole.user,
              content: "[heartbeat tick]",
            },
            {
              role: MessageRole.assistant,
              content: verdict.message,
            },
          ],
        });
      } else {
        await sessionManager.appendMessages({
          identity: sessionIdentity,
          messages: [
            {
              role: MessageRole.user,
              content: "[heartbeat tick]",
            },
            {
              role: MessageRole.assistant,
              content: "[heartbeat: all clear]",
            },
          ],
        });
      }

      await this.heartbeatService.recordRun({
        startedAt,
        finishedAt: new Date(),
        outcome: verdict.action === "alert" ? "alerted" : "ok",
        summary: verdict.summary,
      });
    } catch (error) {
      this.log.error(
        { err: error, durationMs: new Date().getTime() - startedAt.getTime() },
        "Heartbeat execution failed",
      );
      await this.heartbeatService.recordRun({
        startedAt,
        finishedAt: new Date(),
        outcome: "error",
        error: toErrorMessage({ error }),
      });
    } finally {
      this.running = false;
    }
  }
}
