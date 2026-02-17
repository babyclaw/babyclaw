import type { Api } from "grammy";
import { sendMessageMarkdownV2 } from "../telegram/markdown.js";
import type {
  MessageSender,
  SendMessageInput,
  SendMessageResult,
} from "./message-sender.js";

type TelegramMessageSenderInput = {
  api: Api;
};

export class TelegramMessageSender implements MessageSender {
  readonly platform = "telegram";
  private readonly api: Api;

  constructor({ api }: TelegramMessageSenderInput) {
    this.api = api;
  }

  async sendMessage({
    platformChatId,
    text,
    threadId,
  }: SendMessageInput): Promise<SendMessageResult> {
    const options: Record<string, unknown> = {};
    if (threadId !== undefined) {
      options.message_thread_id = Number(threadId);
    }

    const sent = await sendMessageMarkdownV2({
      api: this.api,
      chatId: platformChatId,
      text,
      options,
    });

    return { platformMessageId: String(sent.message_id) };
  }
}
