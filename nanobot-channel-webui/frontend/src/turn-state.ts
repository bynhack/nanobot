import type { ActiveTurnState, PendingToolBlock, ServerEvent } from './types';

export function normalizeIncomingDelta(current: string, incoming: string): string {
  void current;
  return incoming;
}

export function createEmptyTurnState(): ActiveTurnState {
  return {
    phase: 'idle',
    waiting: false,
    messageId: null,
    streamBuffer: '',
    streamId: null,
    pendingTools: null,
    startedAtMs: null,
    lastDurationMs: null,
  };
}

type TurnEvent = Extract<
  ServerEvent,
  | { type: 'turn.phase' }
  | { type: 'turn.delta' }
  | { type: 'tools.started' }
  | { type: 'tools.finished' }
  | { type: 'turn.completed' }
>;

export function startLocalTurn(
  state: ActiveTurnState,
  options: {
    messageId: string;
    startedAtMs: number;
  },
): ActiveTurnState {
  return {
    ...state,
    phase: 'idle',
    waiting: true,
    messageId: options.messageId,
    streamBuffer: '',
    streamId: null,
    pendingTools: null,
    startedAtMs: options.startedAtMs,
    lastDurationMs: null,
  };
}

export function applyTurnEvent(
  state: ActiveTurnState,
  event: TurnEvent,
  options: {
    allocateMessageId: () => string;
    nowMs: () => number;
  },
): ActiveTurnState {
  if (event.type === 'turn.delta') {
    const normalizedDelta = normalizeIncomingDelta(state.streamBuffer, event.delta);
    return {
      ...state,
      waiting: true,
      phase: 'streaming',
      messageId: state.messageId ?? event.streamId ?? options.allocateMessageId(),
      streamId: event.streamId ?? state.streamId,
      streamBuffer: `${state.streamBuffer}${normalizedDelta}`,
    };
  }

  if (event.type === 'turn.phase') {
    if (state.phase === 'completed' && state.waiting === false) {
      return state;
    }
    return {
      ...state,
      waiting: event.phase !== 'completed',
      phase: event.phase,
      streamId: event.streamId ?? state.streamId,
    };
  }

  if (event.type === 'tools.started') {
    const pendingTools: PendingToolBlock = { tools: event.tools };
    return {
      ...state,
      waiting: true,
      phase: 'running_tools',
      pendingTools,
    };
  }

  if (event.type === 'tools.finished') {
    return {
      ...state,
      waiting: true,
      phase: 'running_tools',
      pendingTools: state.pendingTools
        ? {
            ...state.pendingTools,
            durationMs: event.durationMs,
            results: event.results,
          }
        : null,
    };
  }

  return {
    phase: 'completed',
    waiting: false,
    messageId: null,
    streamBuffer: '',
    streamId: event.streamId ?? state.streamId,
    pendingTools: null,
    startedAtMs: state.startedAtMs,
    lastDurationMs: state.startedAtMs ? Math.max(0, options.nowMs() - state.startedAtMs) : null,
  };
}
