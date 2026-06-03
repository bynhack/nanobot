import type { ActiveTurnState, PendingToolBlock, ServerEvent } from './types';

export function normalizeIncomingDelta(current: string, incoming: string): string {
  void current;
  return incoming;
}

export function createEmptyTurnState(): ActiveTurnState {
  return {
    phase: 'idle',
    requestStatus: 'idle',
    waiting: false,
    messageId: null,
    streamBuffer: '',
    streamId: null,
    pendingTools: null,
    toolsMessageId: null,
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
    requestStatus: 'processing',
    waiting: true,
    messageId: options.messageId,
    streamBuffer: '',
    streamId: null,
    pendingTools: null,
    toolsMessageId: null,
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
      requestStatus: 'processing',
        messageId: state.messageId ?? event.streamId ?? options.allocateMessageId(),
      streamId: event.streamId ?? state.streamId,
      streamBuffer: `${state.streamBuffer}${normalizedDelta}`,
      toolsMessageId: state.messageId ? state.toolsMessageId : null,
    };
  }

  if (event.type === 'turn.phase') {
    if (state.requestStatus === 'completed' && state.waiting === false) {
      return state;
    }
    const streamFinished = event.resuming === false;
    const nextRequestStatus = streamFinished
      ? 'completed'
      : event.phase === 'running_tools' || event.resuming === true
        ? 'running_tools'
        : 'processing';
    return {
      ...state,
      waiting: !streamFinished,
      phase: event.phase,
      requestStatus: nextRequestStatus,
      messageId: streamFinished ? null : state.messageId,
      streamBuffer: streamFinished ? '' : state.streamBuffer,
      pendingTools: streamFinished ? null : state.pendingTools,
      streamId: event.streamId ?? state.streamId,
      lastDurationMs: streamFinished && state.startedAtMs !== null
        ? Math.max(0, options.nowMs() - state.startedAtMs)
        : state.lastDurationMs,
    };
  }

  if (event.type === 'tools.started') {
    const pendingTools: PendingToolBlock = { tools: event.tools };
    return {
      ...state,
      waiting: true,
      phase: 'running_tools',
      requestStatus: 'running_tools',
      pendingTools,
      messageId: null,
      streamBuffer: '',
    };
  }

  if (event.type === 'tools.finished') {
    const tools = event.results.map((result, index) => (
      state.pendingTools?.tools[index] ?? {
        name: result.name,
        args: result.args,
        hint: result.name,
      }
    ));
    return {
      ...state,
      waiting: true,
      phase: 'running_tools',
      requestStatus: 'running_tools',
      messageId: null,
      streamBuffer: '',
      pendingTools: state.pendingTools
        ? {
            ...state.pendingTools,
            tools,
            durationMs: event.durationMs,
            results: event.results,
          }
        : {
            tools,
            durationMs: event.durationMs,
            results: event.results,
          },
    };
  }

  const streamAlreadyFinished = state.requestStatus === 'completed' && state.waiting === false;
  return {
    ...state,
    phase: streamAlreadyFinished ? 'completed' : state.phase,
    requestStatus: streamAlreadyFinished ? 'completed' : state.requestStatus,
    waiting: streamAlreadyFinished ? false : state.waiting,
    messageId: null,
    streamBuffer: '',
    streamId: event.streamId ?? state.streamId,
    pendingTools: streamAlreadyFinished ? null : state.pendingTools,
    toolsMessageId: streamAlreadyFinished || (event.type === 'turn.completed' && Boolean(event.content?.trim()))
      ? null
      : state.toolsMessageId,
    lastDurationMs: streamAlreadyFinished
      ? state.lastDurationMs ?? (state.startedAtMs !== null ? Math.max(0, options.nowMs() - state.startedAtMs) : null)
      : state.lastDurationMs,
  };
}
