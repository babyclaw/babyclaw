type ActiveTurn = {
  abortController: AbortController;
  completion: Promise<void>;
  userMessage: string;
};

type RegisterInput = {
  sessionKey: string;
  abortController: AbortController;
  completion: Promise<void>;
  userMessage: string;
};

type RemoveInput = {
  sessionKey: string;
  abortController: AbortController;
};

export class ActiveTurnManager {
  private readonly turns = new Map<string, ActiveTurn>();

  get({ sessionKey }: { sessionKey: string }): ActiveTurn | undefined {
    return this.turns.get(sessionKey);
  }

  async cancel({
    sessionKey,
  }: {
    sessionKey: string;
  }): Promise<string | undefined> {
    const turn = this.turns.get(sessionKey);
    if (!turn) {
      return undefined;
    }

    turn.abortController.abort();
    await turn.completion;
    this.turns.delete(sessionKey);
    return turn.userMessage;
  }

  register({ sessionKey, abortController, completion, userMessage }: RegisterInput): void {
    this.turns.set(sessionKey, { abortController, completion, userMessage });
  }

  remove({ sessionKey, abortController }: RemoveInput): void {
    const current = this.turns.get(sessionKey);
    if (current?.abortController === abortController) {
      this.turns.delete(sessionKey);
    }
  }

  count(): number {
    return this.turns.size;
  }
}
