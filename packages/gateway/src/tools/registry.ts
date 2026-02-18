import type { ToolSet } from "ai";
import type { TurnSignals } from "../agent/types.js";
import type { CommandApprovalService } from "../approval/service.js";
import type { BrowserMcpClient } from "../browser/mcp-client.js";
import type { ChannelRouter } from "../channel/router.js";
import type { ChannelSender } from "../channel/types.js";
import type { CrossChatDeliveryService } from "../chat/delivery.js";
import type { ChatRegistry } from "../chat/registry.js";
import type { ShellConfig } from "../config/shell-defaults.js";
import type { GatewayStatus } from "../runtime.js";
import { SchedulerService } from "../scheduler/service.js";
import type { ToolExecutionContext } from "../utils/tool-context.js";
import { createBrowserTools } from "./browser.js";
import { createClawhubTools } from "./clawhub.js";
import { createContinuationTools } from "./continuation.js";
import { createMediaTools } from "./media.js";
import { createMessagingTools } from "./messaging.js";
import { createSchedulerTools } from "./scheduler.js";
import { createSelfTools } from "./self.js";
import { createShellTools } from "./shell.js";
import { createStateTools } from "./state.js";
import { createWebSearchTools } from "./web-search.js";
import { createWorkspaceTools } from "./workspace.js";

type CreateUnifiedToolsInput = {
  executionContext: ToolExecutionContext;
  schedulerService: SchedulerService;
  syncSchedule: (args: { scheduleId: string }) => Promise<void>;
  sourceText: string;
  createdByUserId: string;
  enableGenericTools: boolean;
  braveSearchApiKey: string | null;
  shellConfig: ShellConfig;
  browserMcpClient?: BrowserMcpClient;
  chatRegistry?: ChatRegistry;
  channelSender?: ChannelSender;
  channelRouter?: ChannelRouter;
  deliveryService?: CrossChatDeliveryService;
  commandApprovalService?: CommandApprovalService;
  turnSignals?: TurnSignals;
  getStatus: () => GatewayStatus;
  adminSocketPath: string;
  logOutput: string;
  logLevel: string;
  schedulerActive: boolean;
  heartbeatActive: boolean;
  getActiveTurnCount: () => number;
  restartGateway: () => Promise<void>;
};

export function createUnifiedTools({
  executionContext,
  schedulerService,
  syncSchedule,
  sourceText,
  createdByUserId,
  enableGenericTools,
  braveSearchApiKey,
  shellConfig,
  browserMcpClient,
  chatRegistry,
  channelSender,
  deliveryService,
  commandApprovalService,
  turnSignals,
  getStatus,
  adminSocketPath,
  logOutput,
  logLevel,
  schedulerActive,
  heartbeatActive,
  getActiveTurnCount,
  restartGateway,
}: CreateUnifiedToolsInput): ToolSet {
  if (!executionContext.chatId) {
    throw new Error("Tool execution context must include chatId");
  }

  const schedulerTools = createSchedulerTools({
    schedulerService,
    syncSchedule,
    chatId: executionContext.chatId,
    createdByUserId,
    threadId: executionContext.threadId ?? null,
    directMessagesTopicId: executionContext.directMessagesTopicId ?? null,
    sourceText,
    executionContext,
    chatRegistry,
  });

  const selfTools = createSelfTools({
    context: executionContext,
    getStatus,
    adminSocketPath,
    logOutput,
    logLevel,
    schedulerActive,
    heartbeatActive,
    getActiveTurnCount,
    restartGateway,
  });

  if (!enableGenericTools) {
    return { ...schedulerTools, ...selfTools };
  }

  const browserTools = browserMcpClient
    ? createBrowserTools({
        mcpClient: browserMcpClient,
        context: executionContext,
      })
    : {};

  const messagingTools =
    executionContext.isMainSession && chatRegistry && channelSender && deliveryService
      ? createMessagingTools({
          chatRegistry,
          deliveryService,
          channelSender,
          executionContext,
        })
      : {};

  const mediaTools = channelSender
    ? createMediaTools({
        channelSender,
        executionContext,
      })
    : {};

  const continuationTools = turnSignals
    ? createContinuationTools({ turnSignals, context: executionContext })
    : {};

  return {
    ...schedulerTools,
    ...selfTools,
    ...createStateTools({
      context: executionContext,
    }),
    ...createWorkspaceTools({
      context: executionContext,
    }),
    ...createShellTools({
      context: executionContext,
      shellConfig,
      commandApprovalService,
    }),
    ...createWebSearchTools({
      context: executionContext,
      braveApiKey: braveSearchApiKey,
    }),
    ...createClawhubTools({
      context: executionContext,
    }),
    ...browserTools,
    ...messagingTools,
    ...mediaTools,
    ...continuationTools,
  };
}
