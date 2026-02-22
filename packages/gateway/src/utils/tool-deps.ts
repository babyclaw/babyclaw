import type { AiAgent } from "../ai/agent.js";
import type { MessageLinkRepository } from "../channel/message-link.js";
import type { CrossChatDeliveryService } from "../chat/delivery.js";
import type { ChatRegistry } from "../chat/registry.js";
import type { ShellConfig } from "../config/shell-defaults.js";
import type { GatewayStatus } from "../runtime.js";
import type { SchedulerService } from "../scheduler/service.js";
import type { SessionManager } from "../session/manager.js";
import type { SkillsConfig } from "../workspace/skills/types.js";

export type SelfToolDeps = {
  getStatus: () => GatewayStatus;
  adminSocketPath: string;
  logOutput: string;
  logLevel: string;
  schedulerActive: boolean;
  heartbeatActive: boolean;
  restartGateway: () => Promise<void>;
};

export type ToolDependencies = {
  workspacePath: string;
  bundledSkillsDir: string;
  aiAgent: AiAgent;
  sessionManager: SessionManager;
  schedulerService: SchedulerService;
  messageLinkRepository: MessageLinkRepository;
  chatRegistry: ChatRegistry;
  deliveryService: CrossChatDeliveryService;
  syncSchedule: (args: { scheduleId: string }) => Promise<void>;
  enableGenericTools: boolean;
  braveSearchApiKey: string | null;
  shellConfig: ShellConfig;
  skillsConfig: SkillsConfig;
  fullConfig: Record<string, unknown>;
  selfToolDeps: SelfToolDeps;
};
