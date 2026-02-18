export type ApprovalSender = {
  sendApprovalPrompt(input: {
    requestId: string;
    chatId: string;
    threadId?: string;
    command: string;
    disallowedNames: string[];
  }): Promise<{ messageId: string }>;

  updateApprovalPrompt(input: {
    chatId: string;
    messageId: string;
    command: string;
    approved: boolean;
    approvedForSession?: boolean;
  }): Promise<void>;
};

export type CommandApprovalRequest = {
  command: string;
  disallowedNames: string[];
  chatId: string;
  threadId?: string;
};

export type ApprovalResponse = {
  approved: boolean;
  approvedForSession?: boolean;
};
