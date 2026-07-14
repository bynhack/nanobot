export class ChatBusyError extends Error {
  constructor(readonly chatId: string) {
    super("当前会话正在处理上一条消息");
  }
}

export class TurnCoordinator {
  private readonly turns = new Map<string, { startedAt: number }>();

  async run<T>(chatId: string, operation: () => Promise<T>): Promise<T> {
    if (this.turns.has(chatId)) throw new ChatBusyError(chatId);
    this.turns.set(chatId, { startedAt: Date.now() });
    try {
      return await operation();
    } finally {
      this.turns.delete(chatId);
    }
  }

  isActive(chatId: string): boolean {
    return this.turns.has(chatId);
  }

  snapshot() {
    return {
      active_turn_count: this.turns.size,
      turns: Object.fromEntries(
        [...this.turns].map(([chatId, turn]) => [
          chatId,
          { started_at: new Date(turn.startedAt).toISOString() },
        ]),
      ),
    };
  }
}
