export type ToolRunSource = "chat" | "scheduled" | "heartbeat";

export type ToolExecutionContext = {
  workspaceRoot: string;
  botTimezone: string;
  chatId?: bigint;
  threadId?: bigint;
  directMessagesTopicId?: bigint;
  runSource: ToolRunSource;
  isMainSession: boolean;
};
