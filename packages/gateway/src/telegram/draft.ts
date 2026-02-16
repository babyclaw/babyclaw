import type { Api } from "grammy";

type StreamDraftToChatInput = {
  api: Api;
  chatId: number;
  textStream: AsyncIterable<string>;
  supportsDraft: boolean;
  messageThreadId?: number;
  throttleMs?: number;
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
