import type { Api } from "grammy";
import type { AgentStreamEvent, ChannelSendResult } from "../channel/types.js";

type StreamDraftToChatInput = {
  api: Api;
  chatId: number;
  textStream: AsyncIterable<string>;
  supportsDraft: boolean;
  messageThreadId?: number;
  throttleMs?: number;
};

type StreamTurnToChatInput = {
  api: Api;
  chatId: number;
  agentStream: AsyncIterable<AgentStreamEvent>;
  supportsDraft: boolean;
  messageThreadId?: number;
  throttleMs?: number;
  sendMessage: (input: { text: string }) => Promise<ChannelSendResult>;
};

type StreamTurnToChatResult = {
  fullText: string;
  lastPlatformMessageId?: string;
};

type SendDraftInput = {
  api: Api;
  chatId: number;
  draftId: number;
  text: string;
  messageThreadId?: number;
};

const DEFAULT_THROTTLE_MS = 300;
const MAX_DRAFT_TEXT_LENGTH = 4096;

export async function streamDraftToChat({
  api,
  chatId,
  textStream,
  supportsDraft,
  messageThreadId,
  throttleMs = DEFAULT_THROTTLE_MS,
}: StreamDraftToChatInput): Promise<string> {
  let accumulatedText = "";
  let draftSendingEnabled = supportsDraft;
  let lastDraftSentAt = 0;
  let lastSentLength = 0;
  const draftId = createDraftId();

  for await (const textPart of textStream) {
    if (textPart.length === 0) {
      continue;
    }

    accumulatedText += textPart;
    if (!draftSendingEnabled) {
      continue;
    }

    if (accumulatedText.length > MAX_DRAFT_TEXT_LENGTH) {
      draftSendingEnabled = false;
      continue;
    }

    const now = Date.now();
    if (now - lastDraftSentAt < throttleMs) {
      continue;
    }

    const didSendDraft = await sendDraft({
      api,
      chatId,
      draftId,
      text: accumulatedText,
      messageThreadId,
    });
    if (!didSendDraft) {
      draftSendingEnabled = false;
      continue;
    }

    lastDraftSentAt = now;
    lastSentLength = accumulatedText.length;
  }

  if (
    draftSendingEnabled &&
    accumulatedText.length > 0 &&
    accumulatedText.length <= MAX_DRAFT_TEXT_LENGTH &&
    accumulatedText.length > lastSentLength
  ) {
    await sendDraft({
      api,
      chatId,
      draftId,
      text: accumulatedText,
      messageThreadId,
    });
  }

  return accumulatedText.trim();
}

export async function streamTurnToChat({
  api,
  chatId,
  agentStream,
  supportsDraft,
  messageThreadId,
  throttleMs = DEFAULT_THROTTLE_MS,
  sendMessage,
}: StreamTurnToChatInput): Promise<StreamTurnToChatResult> {
  const stepTexts: string[] = [];
  let lastPlatformMessageId: string | undefined;

  let reasoningText = "";
  let stepText = "";
  let draftSendingEnabled = supportsDraft;
  let lastDraftSentAt = 0;
  let draftId = createDraftId();

  for await (const event of agentStream) {
    switch (event.type) {
      case "reasoning-delta": {
        if (!draftSendingEnabled || event.text.length === 0) break;

        reasoningText += event.text;
        if (reasoningText.length > MAX_DRAFT_TEXT_LENGTH) {
          draftSendingEnabled = false;
          break;
        }

        const now = Date.now();
        if (now - lastDraftSentAt < throttleMs) break;

        const ok = await sendDraft({ api, chatId, draftId, text: reasoningText, messageThreadId });
        if (!ok) {
          draftSendingEnabled = false;
          break;
        }
        lastDraftSentAt = now;
        break;
      }

      case "text-delta": {
        stepText += event.text;
        break;
      }

      case "step-finish": {
        const trimmed = stepText.trim();
        if (trimmed.length > 0) {
          const result = await sendMessage({ text: trimmed });
          lastPlatformMessageId = result.platformMessageId;
          stepTexts.push(trimmed);
        }
        stepText = "";
        reasoningText = "";
        draftSendingEnabled = supportsDraft;
        draftId = createDraftId();
        break;
      }

      case "finish":
        break;
    }
  }

  return {
    fullText: stepTexts.join("\n\n"),
    lastPlatformMessageId,
  };
}

function createDraftId(): number {
  const candidate = Date.now() % 2_000_000_000;
  return candidate === 0 ? 1 : candidate;
}

async function sendDraft({
  api,
  chatId,
  draftId,
  text,
  messageThreadId,
}: SendDraftInput): Promise<boolean> {
  try {
    await api.sendMessageDraft(chatId, draftId, text, {
      message_thread_id: messageThreadId,
    });
    return true;
  } catch {
    return false;
  }
}
