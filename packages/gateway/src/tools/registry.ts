import type { LanguageModel, ToolSet } from "ai";
import type { CommandApprovalService } from "../approval/service.js";
import type { ChannelSender } from "../channel/types.js";
import type { ToolExecutionContext } from "../utils/tool-context.js";
import type { ToolDependencies } from "../utils/tool-deps.js";
import { createClawhubTools } from "./clawhub.js";
import { createMediaTools } from "./media.js";
import { createMessagingTools } from "./messaging.js";
import { createSchedulerTools } from "./scheduler.js";
import { createSelfTools } from "./self.js";
import { createShellTools } from "./shell.js";
import { createStateTools } from "./state.js";
import { createVaultTools } from "./vault.js";
import { createWebSearchTools } from "./web-search.js";
import { createWorkingMemoryTools } from "./working-memory.js";
import { createWorkspaceTools } from "./workspace.js";

type CreateUnifiedToolsInput = {
  toolDeps: ToolDependencies;
  executionContext: ToolExecutionContext;
  sourceText: string;
  createdByUserId: string;
  getActiveTurnCount: () => number;
  chatModel?: LanguageModel;
  channelSender?: ChannelSender;
  commandApprovalService?: CommandApprovalService;
  sessionKey?: string;
};

export function createUnifiedTools({
  toolDeps,
  executionContext,
  sourceText,
  createdByUserId,
  getActiveTurnCount,
  chatModel,
  channelSender,
  commandApprovalService,
  sessionKey,
}: CreateUnifiedToolsInput): ToolSet {
  const {
    schedulerService,
    syncSchedule,
    enableGenericTools,
    braveSearchApiKey,
    shellConfig,
    chatRegistry,
    deliveryService,
    sessionManager,
    selfToolDeps,
    vaultRepository,
  } = toolDeps;

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
    ...selfToolDeps,
    getActiveTurnCount,
  });

  if (!enableGenericTools) {
    return { ...schedulerTools, ...selfTools };
  }

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

  return {
    ...schedulerTools,
    ...selfTools,
    ...createStateTools({
      context: executionContext,
    }),
    ...createVaultTools({
      context: executionContext,
      vaultRepository,
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
      model: chatModel,
    }),
    ...messagingTools,
    ...mediaTools,
    ...(sessionKey
      ? createWorkingMemoryTools({
          sessionManager,
          sessionKey,
          context: executionContext,
        })
      : {}),
  };
}
