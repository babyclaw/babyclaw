export type ToolRunSource = "chat" | "scheduled" | "heartbeat";

export type ToolExecutionContext = {
  workspaceRoot: string;
  bundledSkillsDir?: string;
  botTimezone: string;
  platform?: string;
  chatId?: string;
  threadId?: string;
  directMessagesTopicId?: string;
  runSource: ToolRunSource;
  isMainSession: boolean;
};
