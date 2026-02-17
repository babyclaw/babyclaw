export type SendMessageInput = {
  platformChatId: string;
  text: string;
  threadId?: string;
};

export type SendMessageResult = {
  platformMessageId: string;
};

export interface MessageSender {
  readonly platform: string;
  sendMessage(input: SendMessageInput): Promise<SendMessageResult>;
}
