type PendingContinuation = {
  timer: ReturnType<typeof setTimeout>;
  onResume: () => void;
};

type ScheduleInput = {
  sessionKey: string;
  delayMs: number;
  onResume: () => void;
};

export class ContinuationManager {
  private readonly pending = new Map<string, PendingContinuation>();

  schedule({ sessionKey, delayMs, onResume }: ScheduleInput): void {
    this.cancel({ sessionKey });

    const timer = setTimeout(() => {
      this.pending.delete(sessionKey);
      onResume();
    }, delayMs);

    this.pending.set(sessionKey, { timer, onResume });
  }

  cancel({ sessionKey }: { sessionKey: string }): boolean {
    const entry = this.pending.get(sessionKey);
    if (!entry) return false;

    clearTimeout(entry.timer);
    this.pending.delete(sessionKey);
    return true;
  }

  hasPending({ sessionKey }: { sessionKey: string }): boolean {
    return this.pending.has(sessionKey);
  }
}
