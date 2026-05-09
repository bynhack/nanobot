import type {
  ActiveTurnState,
  AppState,
  BootstrapConfig,
  ConnectionState,
  HistoryMessage,
  MediaItem,
  PendingToolBlock,
  ServerEvent,
  SessionSummary,
} from './types';

export const STORAGE_KEYS = {
  authToken: 'nanobot_channel_webui_auth_token',
  chatId: 'nanobot_channel_webui_chat_id',
  appearanceMode: 'nanobot_channel_webui_appearance_mode',
  uiTheme: 'nanobot_channel_webui_ui_theme',
} as const;

let localMessageCounter = 0;

function nextMessageId(chatId: string, kind: string): string {
  localMessageCounter += 1;
  return `${chatId}-${kind}-${Date.now().toString(36)}-${localMessageCounter.toString(36)}`;
}

function createIdleTurn(): ActiveTurnState {
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

export function createInitialState(
  bootstrap: BootstrapConfig,
  authToken = '',
  currentChatId: string | null = null,
): AppState {
  return {
    bootstrap,
    authToken,
    connectionState: bootstrap.authRequired && !authToken ? 'auth_required' : 'connecting',
    currentChatId,
    sessions: [],
    messagesByChat: {},
    activeTurns: {},
  };
}

function withActiveTurn(state: AppState, chatId: string): ActiveTurnState {
  return state.activeTurns[chatId] ?? createIdleTurn();
}

function replaceActiveTurn(state: AppState, chatId: string, turn: ActiveTurnState): AppState {
  return {
    ...state,
    activeTurns: {
      ...state.activeTurns,
      [chatId]: turn,
    },
  };
}

function ensureMessageId(chatId: string, message: HistoryMessage): HistoryMessage {
  if (message.id) {
    return message;
  }
  const kind = message.type === 'user' ? 'user' : message.type === 'tools' ? 'tools' : 'assistant';
  return {
    ...message,
    id: nextMessageId(chatId, kind),
  };
}

function appendMessage(state: AppState, chatId: string, message: HistoryMessage): AppState {
  return {
    ...state,
    messagesByChat: {
      ...state.messagesByChat,
      [chatId]: [...(state.messagesByChat[chatId] ?? []), ensureMessageId(chatId, message)],
    },
  };
}

function commitStreamBuffer(state: AppState, chatId: string): AppState {
  const turn = withActiveTurn(state, chatId);
  if (!turn.streamBuffer.trim()) {
    return replaceActiveTurn(state, chatId, { ...turn, streamBuffer: '', streamId: null });
  }
  const nextState = appendMessage(state, chatId, {
    id: turn.messageId ?? nextMessageId(chatId, 'assistant'),
    type: 'assistant',
    content: turn.streamBuffer,
  });
  return replaceActiveTurn(nextState, chatId, {
    ...withActiveTurn(nextState, chatId),
    messageId: null,
    streamBuffer: '',
    streamId: null,
  });
}

function commitPendingTools(state: AppState, chatId: string): AppState {
  const turn = withActiveTurn(state, chatId);
  const pending = turn.pendingTools;
  if (!pending?.results) {
    return state;
  }
  const tools = pending.tools.map((tool, index) => ({
    name: tool.name,
    args: tool.args,
    result: pending.results?.[index]?.detail ?? '',
    status: pending.results?.[index]?.status ?? 'ok',
  }));
  const nextState = appendMessage(state, chatId, { type: 'tools', tools });
  return replaceActiveTurn(nextState, chatId, {
    ...withActiveTurn(nextState, chatId),
    pendingTools: null,
  });
}

function replaceLastMessage(
  state: AppState,
  chatId: string,
  transform: (message: HistoryMessage) => HistoryMessage,
): AppState {
  const messages = state.messagesByChat[chatId] ?? [];
  if (!messages.length) {
    return state;
  }
  const nextMessages = [...messages];
  nextMessages[nextMessages.length - 1] = ensureMessageId(chatId, transform(nextMessages[nextMessages.length - 1]!));
  return {
    ...state,
    messagesByChat: {
      ...state.messagesByChat,
      [chatId]: nextMessages,
    },
  };
}

function mergeMediaIntoLatestAssistant(
  state: AppState,
  chatId: string,
  content: string,
  media: { url: string; name: string; mime?: string }[],
): AppState {
  const lastMessage = (state.messagesByChat[chatId] ?? []).at(-1);
  if (lastMessage?.type === 'assistant' && lastMessage.content.trim() === content.trim()) {
    return replaceLastMessage(state, chatId, (message) => {
      if (message.type !== 'assistant') {
        return message;
      }
      return {
        id: message.id,
        type: 'outbound',
        content: message.content,
        media,
      };
    });
  }
  return appendMessage(state, chatId, {
    type: 'outbound',
    content,
    media,
  });
}

function normalizeHistoryMessages(chatId: string, messages: HistoryMessage[]): HistoryMessage[] {
  return messages.map((message) => ensureMessageId(chatId, message));
}

function ensureSessionSummary(
  state: AppState,
  chatId: string,
  overrides: Partial<SessionSummary> = {},
): SessionSummary[] {
  const existing = state.sessions.find((session) => session.chat_id === chatId);
  const base: SessionSummary = existing ?? {
    chat_id: chatId,
    created_at: new Date().toISOString(),
    last_ts: null,
    preview: '新对话',
    message_count: 0,
  };

  const nextSession: SessionSummary = {
    ...base,
    ...overrides,
    chat_id: chatId,
  };

  return [
    nextSession,
    ...state.sessions.filter((session) => session.chat_id !== chatId),
  ];
}

export type Action =
  | { type: 'auth.set'; token: string }
  | { type: 'connection.set'; connectionState: ConnectionState }
  | { type: 'sessions.loaded'; sessions: SessionSummary[] }
  | { type: 'local.user_message'; chatId: string; content: string; media?: MediaItem[] }
  | { type: 'local.turn_started'; chatId: string }
  | { type: 'server.event'; event: ServerEvent };

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'auth.set':
      return {
        ...state,
        authToken: action.token,
        connectionState: action.token ? 'connecting' : state.bootstrap.authRequired ? 'auth_required' : 'connecting',
      };
    case 'connection.set':
      return { ...state, connectionState: action.connectionState };
    case 'sessions.loaded':
      return { ...state, sessions: action.sessions };
    case 'local.user_message': {
      const nextState = appendMessage(state, action.chatId, {
        type: 'user',
        content: action.content,
        ...(action.media?.length ? { media: action.media } : {}),
      });
      const messageCount = nextState.messagesByChat[action.chatId]?.length ?? 1;
      return {
        ...nextState,
        sessions: ensureSessionSummary(nextState, action.chatId, {
          preview: action.content || (action.media?.length ? action.media[0]?.name ?? '附件' : '新对话'),
          message_count: messageCount,
          last_ts: new Date().toISOString(),
        }),
      };
    }
    case 'local.turn_started': {
      const turn = withActiveTurn(state, action.chatId);
      return replaceActiveTurn(state, action.chatId, {
        ...turn,
        phase: 'idle',
        waiting: true,
        messageId: nextMessageId(action.chatId, 'assistant'),
        streamBuffer: '',
        streamId: null,
        pendingTools: null,
        startedAtMs: Date.now(),
        lastDurationMs: null,
      });
    }
    case 'server.event':
      return reduceServerEvent(state, action.event);
    default:
      return state;
  }
}

function reduceServerEvent(state: AppState, event: ServerEvent): AppState {
  if (event.type === 'session.init') {
    return {
      ...state,
      currentChatId: event.chatId,
      sessions: ensureSessionSummary(state, event.chatId),
      messagesByChat: {
        ...state.messagesByChat,
        [event.chatId]: state.messagesByChat[event.chatId] ?? [],
      },
    };
  }

  if (event.type === 'session.history') {
    const preview = event.messages.find((message) => message.type === 'user')?.content ?? '新对话';
    return {
      ...state,
      currentChatId: event.chatId,
      sessions: ensureSessionSummary(state, event.chatId, {
        preview,
        message_count: event.messages.length,
      }),
      messagesByChat: {
        ...state.messagesByChat,
        [event.chatId]: normalizeHistoryMessages(event.chatId, event.messages),
      },
      activeTurns: {
        ...state.activeTurns,
        [event.chatId]: createIdleTurn(),
      },
    };
  }

  if (event.type === 'session.deleted') {
    const next = { ...state.messagesByChat };
    delete next[event.chatId];
    return {
      ...state,
      messagesByChat: next,
      activeTurns: {
        ...state.activeTurns,
        [event.chatId]: createIdleTurn(),
      },
      currentChatId: state.currentChatId === event.chatId ? null : state.currentChatId,
      sessions: state.sessions.filter((session) => session.chat_id !== event.chatId),
    };
  }

  if (event.type === 'turn.delta') {
    const turn = withActiveTurn(state, event.chatId);
    return replaceActiveTurn(state, event.chatId, {
      ...turn,
      waiting: true,
      phase: 'streaming',
      messageId: turn.messageId ?? event.streamId ?? nextMessageId(event.chatId, 'assistant'),
      streamId: event.streamId ?? turn.streamId,
      streamBuffer: `${turn.streamBuffer}${event.delta}`,
    });
  }

  if (event.type === 'turn.phase') {
    let nextState = state;
    if (event.phase === 'running_tools' || event.phase === 'finalizing') {
      nextState = commitStreamBuffer(nextState, event.chatId);
    }
    const turn = withActiveTurn(nextState, event.chatId);
    
    // 如果已经完成，忽略后续的 phase 事件
    if (turn.phase === 'completed' && turn.waiting === false) {
      return nextState;
    }
    
    return replaceActiveTurn(nextState, event.chatId, {
      ...turn,
      waiting: event.phase !== 'completed',
      phase: event.phase,
      streamId: event.streamId ?? turn.streamId,
    });
  }

  if (event.type === 'tools.started') {
    const turn = withActiveTurn(state, event.chatId);
    const pendingTools: PendingToolBlock = { tools: event.tools };
    return replaceActiveTurn(state, event.chatId, {
      ...turn,
      waiting: true,
      phase: 'running_tools',
      pendingTools,
    });
  }

  if (event.type === 'tools.finished') {
    const turn = withActiveTurn(state, event.chatId);
    const nextState = replaceActiveTurn(state, event.chatId, {
      ...turn,
      waiting: true,
      phase: 'running_tools',
      pendingTools: turn.pendingTools
        ? {
            ...turn.pendingTools,
            durationMs: event.durationMs,
            results: event.results,
          }
        : null,
    });
    return commitPendingTools(nextState, event.chatId);
  }

  if (event.type === 'turn.completed') {
    const turn = withActiveTurn(state, event.chatId);
    const streamedContent = turn.streamBuffer;

    // Commit any in-flight stream buffer and pending tools before finalising.
    let nextState = commitStreamBuffer(state, event.chatId);
    nextState = commitPendingTools(nextState, event.chatId);

    const hasStreamedContent = Boolean(streamedContent.trim());
    const completedContent = event.content?.trim() ? event.content : '';

    if (event.media?.length) {
      if (completedContent.trim()) {
        nextState = mergeMediaIntoLatestAssistant(nextState, event.chatId, completedContent, event.media);
      } else if (hasStreamedContent) {
        nextState = mergeMediaIntoLatestAssistant(nextState, event.chatId, streamedContent, event.media);
      } else {
        nextState = appendMessage(nextState, event.chatId, {
          type: 'outbound',
          content: '',
          media: event.media,
        });
      }
    } else if (completedContent.trim()) {
      const lastMessage = (nextState.messagesByChat[event.chatId] ?? []).at(-1);
      const alreadyCommitted =
        lastMessage?.type === 'assistant' && lastMessage.content.trim() === completedContent.trim();
      if (alreadyCommitted) {
        if (event.buttons?.length) {
          nextState = replaceLastMessage(nextState, event.chatId, (message) => {
            if (message.type !== 'assistant') {
              return message;
            }
            return {
              ...message,
              buttons: event.buttons,
            };
          });
        }
      } else {
        nextState = appendMessage(nextState, event.chatId, {
          type: 'assistant',
          content: completedContent,
          ...(event.buttons?.length ? { buttons: event.buttons } : {}),
        });
      }
    }
    return replaceActiveTurn(nextState, event.chatId, {
      phase: 'completed',
      waiting: false,
      messageId: null,
      streamBuffer: '',
      streamId: null,
      pendingTools: null,
      startedAtMs: turn.startedAtMs,
      lastDurationMs: turn.startedAtMs ? Math.max(0, Date.now() - turn.startedAtMs) : null,
    });
  }

  return state;
}

export function createStore(initialState: AppState) {
  let state = initialState;
  const listeners = new Set<(state: AppState) => void>();

  return {
    getState(): AppState {
      return state;
    },
    dispatch(action: Action): void {
      state = reducer(state, action);
      listeners.forEach((listener) => listener(state));
    },
    subscribe(listener: (state: AppState) => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
