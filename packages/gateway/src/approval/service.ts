import { randomUUID } from "node:crypto";
import type { ApprovalResponse, ApprovalSender, CommandApprovalRequest } from "./types.js";

const DEFAULT_TIMEOUT_MS = 120_000;

type PendingApproval = {
  resolve: (result: ApprovalResponse) => void;
  timeoutId: ReturnType<typeof setTimeout>;
  chatId: string;
  messageId: string;
  command: string;
};

type CommandApprovalServiceInput = {
  sender: ApprovalSender;
  timeoutMs?: number;
};

export class CommandApprovalService {
  private readonly sender: ApprovalSender;
  private readonly timeoutMs: number;
  private readonly pending = new Map<string, PendingApproval>();
  private readonly sessionApprovedChats = new Set<string>();

  constructor({ sender, timeoutMs }: CommandApprovalServiceInput) {
    this.sender = sender;
    this.timeoutMs = timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  isSessionApproved({ chatId }: { chatId: string }): boolean {
    return this.sessionApprovedChats.has(chatId);
  }

  async requestApproval(input: CommandApprovalRequest): Promise<ApprovalResponse> {
    if (this.sessionApprovedChats.has(input.chatId)) {
      return { approved: true, approvedForSession: true };
    }

    const requestId = randomUUID().slice(0, 8);

    const { messageId } = await this.sender.sendApprovalPrompt({
      requestId,
      chatId: input.chatId,
      threadId: input.threadId,
      command: input.command,
      disallowedNames: input.disallowedNames,
    });

    return new Promise<ApprovalResponse>((resolve) => {
      const timeoutId = setTimeout(() => {
        const entry = this.pending.get(requestId);
        if (!entry) return;

        this.pending.delete(requestId);
        resolve({ approved: false });

        this.sender
          .updateApprovalPrompt({
            chatId: input.chatId,
            messageId,
            command: input.command,
            approved: false,
          })
          .catch((err) => {
            console.error("[approval] Failed to update prompt after timeout:", err);
          });
      }, this.timeoutMs);

      this.pending.set(requestId, {
        resolve,
        timeoutId,
        chatId: input.chatId,
        messageId,
        command: input.command,
      });
    });
  }

  async handleResponse({
    requestId,
    approved,
    approveSession,
  }: {
    requestId: string;
    approved: boolean;
    approveSession?: boolean;
  }): Promise<void> {
    const entry = this.pending.get(requestId);
    if (!entry) return;

    clearTimeout(entry.timeoutId);
    this.pending.delete(requestId);

    if (approved && approveSession) {
      this.sessionApprovedChats.add(entry.chatId);
    }

    entry.resolve({ approved, approvedForSession: approveSession });

    await this.sender.updateApprovalPrompt({
      chatId: entry.chatId,
      messageId: entry.messageId,
      command: entry.command,
      approved,
      approvedForSession: approveSession,
    });
  }
}
