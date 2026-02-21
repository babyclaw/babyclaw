import { getLogger } from "../logging/index.js";
import type { Logger } from "../logging/index.js";
import type { SessionManager } from "../session/manager.js";
import type { MemoryExtractor } from "./extractor.js";

const DEBOUNCE_MS = 5 * 60 * 1000;

type MemoryExtractionQueueInput = {
  extractor: MemoryExtractor;
  sessionManager: SessionManager;
};

export class MemoryExtractionQueue {
  private readonly extractor: MemoryExtractor;
  private readonly sessionManager: SessionManager;
  private readonly log: Logger;
  private readonly debounceTimers = new Map<string, NodeJS.Timeout>();
  private readonly pending: string[] = [];
  private readonly pendingSet = new Set<string>();
  private processing = false;
  private stopped = false;

  constructor({ extractor, sessionManager }: MemoryExtractionQueueInput) {
    this.extractor = extractor;
    this.sessionManager = sessionManager;
    this.log = getLogger().child({ component: "memory-extraction-queue" });
  }

  enqueue({ sessionKey }: { sessionKey: string }): void {
    if (this.stopped) return;

    const existing = this.debounceTimers.get(sessionKey);
    if (existing) {
      clearTimeout(existing);
    }

    const timer = setTimeout(() => {
      this.debounceTimers.delete(sessionKey);
      this.pushToPending({ sessionKey });
    }, DEBOUNCE_MS);

    this.debounceTimers.set(sessionKey, timer);

    this.log.debug(
      { sessionKey, debounceMs: DEBOUNCE_MS },
      "Memory extraction enqueued (debounced)",
    );
  }

  enqueueImmediate({ sessionKey }: { sessionKey: string }): void {
    if (this.stopped) {
      this.log.debug({ sessionKey }, "Ignoring enqueueImmediate, queue is stopped");
      return;
    }
    this.log.info({ sessionKey }, "Memory extraction enqueued (immediate)");
    this.pushToPending({ sessionKey });
  }

  stop(): void {
    this.stopped = true;
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
  }

  private pushToPending({ sessionKey }: { sessionKey: string }): void {
    if (this.pendingSet.has(sessionKey)) {
      this.log.debug({ sessionKey }, "Session already pending, skipping duplicate");
      return;
    }
    this.pendingSet.add(sessionKey);
    this.pending.push(sessionKey);
    this.log.debug(
      { sessionKey, queueSize: this.pending.length },
      "Session added to pending queue",
    );
    this.drain();
  }

  private drain(): void {
    if (this.processing || this.pending.length === 0 || this.stopped) return;

    this.processing = true;
    const sessionKey = this.pending.shift()!;
    this.pendingSet.delete(sessionKey);

    this.processSession({ sessionKey })
      .catch((err) => {
        this.log.error({ err, sessionKey }, "Memory extraction failed");
      })
      .finally(() => {
        this.processing = false;
        this.drain();
      });
  }

  private async processSession({ sessionKey }: { sessionKey: string }): Promise<void> {
    if (this.stopped) return;

    const result = await this.sessionManager.getRawMessages({ sessionKey });
    if (!result || result.messages.length === 0) {
      this.log.debug({ sessionKey }, "No messages to extract, skipping");
      return;
    }

    this.log.info(
      { sessionKey, messageCount: result.messages.length },
      "Processing memory extraction",
    );

    await this.extractor.extract({
      messages: result.messages,
      sessionDate: result.sessionCreatedAt,
    });
    await this.sessionManager.updateMemoriesExtractedAt({ sessionKey });

    this.log.info({ sessionKey }, "Memory extraction completed");
  }
}
