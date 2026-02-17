import { tool, type ToolSet } from "ai";
import { z } from "zod";
import type { ChatRegistry } from "../chat/registry.js";
import type { CrossChatDeliveryService } from "../chat/delivery.js";
import type { MessageSender } from "../chat/message-sender.js";
import type { ToolExecutionContext } from "../utils/tool-context.js";
import { ToolExecutionError, withToolLogging } from "./errors.js";

type CreateMessagingToolsInput = {
  chatRegistry: ChatRegistry;
  deliveryService: CrossChatDeliveryService;
  messageSender: MessageSender;
  executionContext: ToolExecutionContext;
};

export function createMessagingTools({
  chatRegistry,
  deliveryService,
  messageSender,
  executionContext,
}: CreateMessagingToolsInput): ToolSet {
  return {
    send_message: tool({
      description: [
        "Send a message to a linked chat by alias or chat ID.",
        "Only available in the main session.",
        "Provide either alias or chat_id to identify the target.",
      ].join(" "),
      inputSchema: z.object({
        alias: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe("Target chat alias (e.g. 'family')"),
        chat_id: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe("Target platform chat ID"),
        text: z.string().trim().min(1).describe("Message text to send"),
        thread_id: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe("Optional topic/thread ID in the target chat"),
        context: z
          .string()
          .trim()
          .optional()
          .describe(
            "Brief context about why this message is being sent, for continuity if someone replies",
          ),
      }),
      execute: async ({ alias, chat_id, text, thread_id, context }) =>
        withToolLogging({
          context: executionContext,
          toolName: "send_message",
          defaultCode: "SEND_MESSAGE_FAILED",
          action: async () => {
            if (!alias && !chat_id) {
              throw new ToolExecutionError({
                code: "MISSING_TARGET",
                message:
                  "Provide either alias or chat_id to identify the target chat.",
              });
            }

            let targetPlatformChatId: string;
            let chatTitle: string | null = null;
            let resolvedAlias: string | null = null;

            if (alias) {
              const chat = await chatRegistry.resolveAlias({
                platform: messageSender.platform,
                alias,
              });
              if (!chat) {
                throw new ToolExecutionError({
                  code: "ALIAS_NOT_FOUND",
                  message: `No chat found with alias "${alias}".`,
                  hint: "Use list_known_chats to see available aliases.",
                });
              }
              if (!chat.linkedAt) {
                throw new ToolExecutionError({
                  code: "CHAT_NOT_LINKED",
                  message: `Chat "${alias}" is not linked.`,
                });
              }
              targetPlatformChatId = chat.platformChatId;
              chatTitle = chat.title;
              resolvedAlias = chat.alias;
            } else {
              targetPlatformChatId = chat_id!;
              const linked = await chatRegistry.isLinked({
                platform: messageSender.platform,
                platformChatId: targetPlatformChatId,
              });
              if (!linked) {
                throw new ToolExecutionError({
                  code: "CHAT_NOT_LINKED",
                  message: `Chat ${targetPlatformChatId} is not linked.`,
                  hint: "The owner needs to /link this chat first.",
                });
              }
            }

            const seedContext =
              context ?? `Cross-chat message sent to ${resolvedAlias ?? targetPlatformChatId}`;

            const result = await deliveryService.deliver({
              messageSender,
              targetPlatformChatId,
              targetThreadId: thread_id,
              text,
              seedContext,
            });

            return {
              status: "sent",
              chat_title: chatTitle,
              alias: resolvedAlias,
              platform_message_id: result.platformMessageId,
              bridge_session_key: result.bridgeSessionKey,
            } as const;
          },
        }),
    }),

    list_known_chats: tool({
      description:
        "List all linked chats the bot can interact with. Returns alias, title, type, and platform chat ID.",
      inputSchema: z.object({}),
      execute: async () =>
        withToolLogging({
          context: executionContext,
          toolName: "list_known_chats",
          defaultCode: "LIST_CHATS_FAILED",
          action: async () => {
            const chats = await chatRegistry.listLinkedChats({
              platform: messageSender.platform,
            });

            return {
              status: "ok",
              count: chats.length,
              chats: chats.map((chat) => ({
                alias: chat.alias,
                title: chat.title,
                type: chat.type,
                platform: chat.platform,
                platform_chat_id: chat.platformChatId,
                is_main: chat.isMain,
              })),
            } as const;
          },
        }),
    }),
  };
}
