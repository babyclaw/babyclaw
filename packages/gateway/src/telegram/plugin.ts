import { Context, Bot, type BotError } from "grammy";
import type {
  ChannelAdapter,
  ChannelCapabilities,
  ChannelOutboundMessage,
  ChannelSendResult,
  InboundEventHandler,
  NormalizedInboundEvent,
  StreamDraftInput,
} from "../channel/types.js";
import { isOwner } from "../channel/authorization.js";
import type { MessageLinkRepository } from "../channel/message-link.js";
import type { ChatRegistry } from "../chat/registry.js";
import type { SchedulerService } from "../scheduler/service.js";
import { formatSchedulesForCommand } from "../scheduler/formatter.js";
import type { SessionState } from "../session/types.js";
import { sendMessageMarkdownV2, replyMarkdownV2 } from "./markdown.js";
import { streamDraftToChat } from "./draft.js";

const ALIAS_PATTERN = /^[a-z0-9][a-z0-9-]{0,30}[a-z0-9]$/;

export type HeartbeatStatusGetter = () => {
  enabled: boolean;
  nextRunAt: Date | null;
};

class TelegramBotContext extends Context {
  state: SessionState = {};
}

type TelegramAdapterInput = {
  token: string;
  chatRegistry: ChatRegistry;
  schedulerService: SchedulerService;
  messageLinkRepository: MessageLinkRepository;
  getHeartbeatStatus?: HeartbeatStatusGetter;
};

/**
 * Telegram channel adapter. Implements the unified ChannelAdapter interface,
 * fully encapsulating all grammy/Telegram-specific logic for both inbound
 * event handling and outbound messaging.
 */
export class TelegramAdapter implements ChannelAdapter {
  readonly platform = "telegram";
  readonly capabilities: ChannelCapabilities = {
    supportsDraft: true,
    supportsMarkdown: true,
    supportsTypingIndicator: true,
    supportsEditing: false,
  };

  private readonly token: string;
  private readonly chatRegistry: ChatRegistry;
  private readonly schedulerService: SchedulerService;
  private readonly messageLinkRepository: MessageLinkRepository;
  private readonly getHeartbeatStatus?: HeartbeatStatusGetter;
  private bot: Bot<TelegramBotContext> | null = null;

  constructor({
    token,
    chatRegistry,
    schedulerService,
    messageLinkRepository,
    getHeartbeatStatus,
  }: TelegramAdapterInput) {
    this.token = token;
    this.chatRegistry = chatRegistry;
    this.schedulerService = schedulerService;
    this.messageLinkRepository = messageLinkRepository;
    this.getHeartbeatStatus = getHeartbeatStatus;
  }

  async sendMessage(input: ChannelOutboundMessage): Promise<ChannelSendResult> {
    const api = this.getApi();
    const options: Record<string, unknown> = {};
    if (input.threadId !== undefined) {
      options.message_thread_id = Number(input.threadId);
    }

    const sent = await sendMessageMarkdownV2({
      api,
      chatId: input.chatId,
      text: input.text,
      options,
    });

    return { platformMessageId: String(sent.message_id) };
  }

  async streamDraft(input: StreamDraftInput): Promise<string> {
    const api = this.getApi();
    return streamDraftToChat({
      api,
      chatId: Number(input.chatId),
      textStream: input.textStream,
      supportsDraft: this.capabilities.supportsDraft,
      messageThreadId: input.threadId !== undefined ? Number(input.threadId) : undefined,
    });
  }

  async start({
    onInboundEvent,
  }: {
    onInboundEvent: InboundEventHandler;
  }): Promise<void> {
    const bot = new Bot<TelegramBotContext>(this.token, {
      ContextConstructor: TelegramBotContext,
    });
    this.bot = bot;

    this.setupMiddleware({ bot });
    this.setupCommands({ bot });
    this.setupMessageHandlers({ bot, onInboundEvent });
    this.setupErrorHandler({ bot });

    await bot.start();
  }

  async stop(): Promise<void> {
    if (this.bot) {
      this.bot.stop();
      this.bot = null;
    }
  }

  private getApi() {
    if (!this.bot) {
      throw new Error("TelegramAdapter: bot not started, cannot access api");
    }
    return this.bot.api;
  }

  private setupMiddleware({
    bot,
  }: {
    bot: Bot<TelegramBotContext>;
  }): void {
    bot.use(async (ctx, next) => {
      if (!ctx.chat) {
        await next();
        return;
      }

      const platformChatId = String(ctx.chat.id);

      await this.chatRegistry.upsert({
        platform: "telegram",
        platformChatId,
        type: ctx.chat.type,
        title: getChatTitle({ ctx }),
      });

      const mainChat = await this.chatRegistry.getMainChat();

      if (!mainChat && ctx.chat.type === "private") {
        await this.chatRegistry.markAsMain({
          platform: "telegram",
          platformChatId,
        });
      }

      const isLinkCommand = isLinkOrUnlinkCommand({ ctx });
      const linked = await this.chatRegistry.isLinked({
        platform: "telegram",
        platformChatId,
      });

      if (!linked && !isLinkCommand) {
        return;
      }

      const currentChat = await this.chatRegistry.getMainChat();
      ctx.state.isMainSession = currentChat?.platformChatId === platformChatId;

      await next();
    });
  }

  private setupCommands({
    bot,
  }: {
    bot: Bot<TelegramBotContext>;
  }): void {
    bot.command("link", async (ctx) => {
      if (!ctx.chat || !ctx.from) return;

      const mainChat = await this.chatRegistry.getMainChat();
      if (!mainChat) {
        await ctx.reply("No main chat has been set up yet.");
        return;
      }

      const ownerCheck = await isOwner({
        actor: { platform: "telegram", platformUserId: String(ctx.from.id) },
        chatRegistry: this.chatRegistry,
      });
      if (!ownerCheck) {
        await ctx.reply("Only the owner can link chats.");
        return;
      }

      const alias = ctx.match?.toString().trim().toLowerCase();
      if (!alias || !ALIAS_PATTERN.test(alias)) {
        await ctx.reply(
          "Usage: /link <alias>\nAlias must be 2-32 characters, lowercase alphanumeric and hyphens.",
        );
        return;
      }

      try {
        await this.chatRegistry.link({
          platform: "telegram",
          platformChatId: String(ctx.chat.id),
          alias,
        });
        await ctx.reply(`Linked as "${alias}". I'll respond here now.`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes("Unique constraint")) {
          await ctx.reply(`The alias "${alias}" is already in use.`);
        } else {
          await ctx.reply("Failed to link this chat.");
        }
      }
    });

    bot.command("unlink", async (ctx) => {
      if (!ctx.chat || !ctx.from) return;

      const mainChat = await this.chatRegistry.getMainChat();
      if (!mainChat) return;

      const ownerCheck = await isOwner({
        actor: { platform: "telegram", platformUserId: String(ctx.from.id) },
        chatRegistry: this.chatRegistry,
      });
      if (!ownerCheck) {
        await ctx.reply("Only the owner can unlink chats.");
        return;
      }

      const platformChatId = String(ctx.chat.id);
      if (mainChat.platformChatId === platformChatId) {
        await ctx.reply("Cannot unlink the main chat.");
        return;
      }

      await this.chatRegistry.unlink({
        platform: "telegram",
        platformChatId,
      });
      await ctx.reply("Unlinked. I'll stop responding here.");
    });

    bot.command("schedules", async (ctx) => {
      if (!ctx.chat) return;

      const schedules = await this.schedulerService.listSchedules({
        chatId: String(ctx.chat.id),
        includeInactive: false,
      });

      await replyMarkdownV2({
        ctx,
        text: formatSchedulesForCommand({ schedules }),
      });
    });

    bot.command("heartbeat", async (ctx) => {
      if (!ctx.chat) return;

      if (!this.getHeartbeatStatus) {
        await ctx.reply("Heartbeat system is not available.");
        return;
      }

      const status = this.getHeartbeatStatus();
      if (!status.enabled) {
        await ctx.reply("Heartbeat is disabled in configuration.");
        return;
      }

      const nextRunLabel = status.nextRunAt
        ? status.nextRunAt.toISOString()
        : "not scheduled";

      await ctx.reply(`Heartbeat is enabled.\nNext run: ${nextRunLabel}`);
    });
  }

  private setupMessageHandlers({
    bot,
    onInboundEvent,
  }: {
    bot: Bot<TelegramBotContext>;
    onInboundEvent: InboundEventHandler;
  }): void {
    bot.on("message:text", async (ctx) => {
      const event = this.normalizeMessage({ ctx, isEdited: false });
      if (!event) return;
      await onInboundEvent({ event });
    });

    bot.on("edited_message:text", async (ctx) => {
      const event = this.normalizeMessage({ ctx, isEdited: true });
      if (!event) return;
      await onInboundEvent({ event });
    });
  }

  private setupErrorHandler({
    bot,
  }: {
    bot: Bot<TelegramBotContext>;
  }): void {
    bot.catch(async (error: BotError<TelegramBotContext>) => {
      const ctx = error.ctx;
      console.error("Unhandled Telegram bot error:", error.error);
      if (!ctx.chat) return;

      try {
        await ctx.reply("I hit an internal error while processing that message.");
      } catch (replyError) {
        console.error("Failed to send Telegram error reply:", replyError);
      }
    });
  }

  private normalizeMessage({
    ctx,
    isEdited,
  }: {
    ctx: TelegramBotContext;
    isEdited: boolean;
  }): NormalizedInboundEvent | null {
    if (!ctx.chat) return null;

    const message = isEdited ? ctx.editedMessage : ctx.message;
    if (!message || !("text" in message)) return null;

    const text = (message as { text?: string }).text?.trim();
    if (!text || text.length === 0) return null;

    const rawMessage = message as unknown as Record<string, unknown>;
    const messageThreadId = typeof rawMessage.message_thread_id === "number"
      ? rawMessage.message_thread_id
      : undefined;

    const replyToMessage = rawMessage.reply_to_message as Record<string, unknown> | undefined;
    const replyToMessageId = typeof replyToMessage?.message_id === "number"
      ? String(replyToMessage.message_id)
      : undefined;
    const replyToText = typeof replyToMessage?.text === "string"
      ? replyToMessage.text
      : typeof replyToMessage?.caption === "string"
        ? (replyToMessage.caption as string)
        : undefined;

    const directMessagesTopic = rawMessage.direct_messages_topic as Record<string, unknown> | undefined;
    const dmTopicId = typeof directMessagesTopic?.topic_id === "number"
      ? String(directMessagesTopic.topic_id)
      : undefined;

    const from = rawMessage.from as Record<string, unknown> | undefined;
    const senderName = buildSenderName({ from });

    return {
      platform: "telegram",
      chatId: String(ctx.chat.id),
      threadId: messageThreadId !== undefined ? String(messageThreadId) : undefined,
      senderId: from ? String(from.id) : String(ctx.chat.id),
      senderName,
      messageId: String(rawMessage.message_id),
      messageText: text,
      replyToMessageId,
      replyToText,
      isEdited,
      chatType: ctx.chat.type,
      chatTitle: getChatTitle({ ctx }) ?? undefined,
      directMessagesTopicId: dmTopicId,
      draftSupported: ctx.chat.type === "private",
    };
  }
}

function getChatTitle({ ctx }: { ctx: TelegramBotContext }): string | null {
  if (!ctx.chat) return null;
  const chat = ctx.chat as unknown as Record<string, unknown>;
  if (typeof chat.title === "string") return chat.title;
  if (typeof chat.first_name === "string") {
    const last = typeof chat.last_name === "string" ? ` ${chat.last_name}` : "";
    return `${chat.first_name}${last}`;
  }
  return null;
}

function isLinkOrUnlinkCommand({ ctx }: { ctx: TelegramBotContext }): boolean {
  const message = ctx.message as { text?: string } | undefined;
  if (!message?.text) return false;
  const text = message.text.trim();
  return text.startsWith("/link") || text.startsWith("/unlink");
}

function buildSenderName({ from }: { from: Record<string, unknown> | undefined }): string | undefined {
  if (!from) return undefined;
  const firstName = typeof from.first_name === "string" ? from.first_name : undefined;
  const lastName = typeof from.last_name === "string" ? from.last_name : undefined;
  if (firstName && lastName) return `${firstName} ${lastName}`;
  if (firstName) return firstName;
  return undefined;
}
