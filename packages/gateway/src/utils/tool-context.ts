export type ToolRunSource = "chat" | "scheduled" | "heartbeat";

export type ToolExecutionContext = {
  workspaceRoot: string;
  botTimezone: string;
  platform?: string;
  chatId?: string;
  threadId?: string;
  directMessagesTopicId?: string;
  runSource: ToolRunSource;
  isMainSession: boolean;
};
