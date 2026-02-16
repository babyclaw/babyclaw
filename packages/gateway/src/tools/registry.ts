import type { ToolSet } from "ai";
import type { BrowserMcpClient } from "../browser/mcp-client.js";
import { SchedulerService } from "../scheduler/service.js";
import type { ToolExecutionContext } from "../utils/tool-context.js";
import { createBrowserTools } from "./browser.js";
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
  createdByUserId: bigint;
  enableGenericTools: boolean;
  browserMcpClient?: BrowserMcpClient;
};

export function createUnifiedTools({
  executionContext,
  schedulerService,
  syncSchedule,
  sourceText,
  createdByUserId,
  enableGenericTools,
  browserMcpClient,
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
    }),
    ...createWebSearchTools({
      context: executionContext,
    }),
    ...browserTools,
  };
}
