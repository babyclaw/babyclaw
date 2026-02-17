import type { ToolSet } from "ai";
import type { BrowserMcpClient } from "../browser/mcp-client.js";
import type { ChannelRouter } from "../channel/router.js";
import type { ChannelSender } from "../channel/types.js";
import type { CrossChatDeliveryService } from "../chat/delivery.js";
import type { ChatRegistry } from "../chat/registry.js";
import type { ShellConfig } from "../config/shell-defaults.js";
import { SchedulerService } from "../scheduler/service.js";
import type { ToolExecutionContext } from "../utils/tool-context.js";
import { createBrowserTools } from "./browser.js";
import { createMessagingTools } from "./messaging.js";
import { createSchedulerTools } from "./scheduler.js";
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

  if (!enableGenericTools) {
    return schedulerTools;
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

  return {
    ...schedulerTools,
    ...createStateTools({
      context: executionContext,
    }),
    ...createWorkspaceTools({
      context: executionContext,
    }),
    ...createShellTools({
      context: executionContext,
      shellConfig,
    }),
    ...createWebSearchTools({
      context: executionContext,
      braveApiKey: braveSearchApiKey,
    }),
    ...browserTools,
    ...messagingTools,
  };
}
