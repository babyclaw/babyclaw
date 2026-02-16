export type ToolRunSource = "chat" | "scheduled";

export type ToolExecutionContext = {
  workspaceRoot: string;
  botTimezone: string;
  chatId?: bigint;
  threadId?: bigint;
  directMessagesTopicId?: bigint;
  runSource: ToolRunSource;
};
