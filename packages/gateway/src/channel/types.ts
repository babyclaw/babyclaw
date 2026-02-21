export type ChannelCapabilities = {
  supportsDraft: boolean;
  supportsMarkdown: boolean;
  supportsTypingIndicator: boolean;
  supportsEditing: boolean;
};

export type ImageAttachment = {
  localPath: string;
  mimeType: string;
};

export type NormalizedInboundEvent = {
  platform: string;
  chatId: string;
  threadId?: string;
  senderId: string;
  senderName?: string;
  messageId: string;
  messageText: string;
  images?: ImageAttachment[];
  replyToMessageId?: string;
  replyToText?: string;
  isEdited: boolean;
  chatType?: string;
  chatTitle?: string;
  directMessagesTopicId?: string;
  draftSupported: boolean;
};

export type ChannelOutboundMessage = {
  chatId: string;
  threadId?: string;
  text: string;
};

export type ChannelOutboundImage = {
  chatId: string;
  threadId?: string;
  filePath: string;
  caption?: string;
};

export type FileType = "image" | "document" | "audio" | "video" | "animation";

export type ChannelOutboundFile = {
  chatId: string;
  threadId?: string;
  filePath: string;
  fileType: FileType;
  caption?: string;
};

export type ChannelSendResult = {
  platformMessageId: string;
};

export type StreamDraftInput = {
  chatId: string;
  threadId?: string;
  textStream: AsyncIterable<string>;
};

export type AgentStreamEvent =
  | { type: "reasoning-delta"; text: string }
  | { type: "text-delta"; text: string }
  | { type: "step-finish" }
  | { type: "finish" };

export type StreamTurnInput = {
  chatId: string;
  threadId?: string;
  agentStream: AsyncIterable<AgentStreamEvent>;
};

export type StreamTurnResult = {
  fullText: string;
  lastPlatformMessageId?: string;
};

export type InboundEventHandler = (input: { event: NormalizedInboundEvent }) => Promise<void>;

/**
 * Unified channel adapter interface. Every present and future channel
 * implements this single contract covering both inbound and outbound.
 */
export interface ChannelAdapter {
  readonly platform: string;
  readonly capabilities: ChannelCapabilities;

  start(input: { onInboundEvent: InboundEventHandler }): Promise<void>;
  stop(): Promise<void>;

  sendMessage(input: ChannelOutboundMessage): Promise<ChannelSendResult>;
  sendImage(input: ChannelOutboundImage): Promise<ChannelSendResult>;
  sendFile(input: ChannelOutboundFile): Promise<ChannelSendResult>;
  streamDraft?(input: StreamDraftInput): Promise<string>;
  streamTurn?(input: StreamTurnInput): Promise<StreamTurnResult>;
  setSessionTitle?(input: { chatId: string; threadId?: string; title: string }): Promise<void>;
}

/**
 * Convenience type for consumers that only need the outbound send capability
 * (e.g. delivery service, heartbeat executor, messaging tools).
 */
export type ChannelSender = Pick<
  ChannelAdapter,
  "platform" | "sendMessage" | "sendImage" | "sendFile"
>;
