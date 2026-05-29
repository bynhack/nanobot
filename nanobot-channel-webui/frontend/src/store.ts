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
  SessionWorkspace,
  WorkspacePanelState,
} from './types';
import { applyTurnEvent, createEmptyTurnState, startLocalTurn } from './turn-state';

export const STORAGE_KEYS = {
  authToken: 'nanobot_channel_webui_auth_token',
  chatId: 'nanobot_channel_webui_chat_id',
  appearanceMode: 'nanobot_channel_webui_appearance_mode',
  uiTheme: 'nanobot_channel_webui_ui_theme',
  showToolMessages: 'nanobot_channel_webui_show_tool_messages',
} as const;

let localMessageCounter = 0;

function nextMessageId(chatId: string, kind: string): string {
  localMessageCounter += 1;
  return `${chatId}-${kind}-${Date.now().toString(36)}-${localMessageCounter.toString(36)}`;
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
    workspaceByChat: {},
    workspacePanel: {
      open: false,
      loading: false,
      error: null,
      chatId: null,
      requestId: null,
    },
  };
}

function withActiveTurn(state: AppState, chatId: string): ActiveTurnState {
  return state.activeTurns[chatId] ?? createEmptyTurnState();
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

function upsertAssistantMessage(
  state: AppState,
  chatId: string,
  messageId: string,
  transform: (current: Extract<HistoryMessage, { type: 'assistant' }> | null) => HistoryMessage,
): AppState {
  const messages = state.messagesByChat[chatId] ?? [];
  const index = messages.findIndex((message) => message.id === messageId && message.type === 'assistant');
  const current = index >= 0 ? (messages[index] as Extract<HistoryMessage, { type: 'assistant' }>) : null;
  const nextMessage = ensureMessageId(chatId, transform(current));

  if (index >= 0) {
    const nextMessages = [...messages];
    nextMessages[index] = nextMessage;
    return {
      ...state,
      messagesByChat: {
        ...state.messagesByChat,
        [chatId]: nextMessages,
      },
    };
  }

  return {
    ...state,
    messagesByChat: {
      ...state.messagesByChat,
      [chatId]: [...messages, nextMessage],
    },
  };
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
  | { type: 'local.new_draft' }
  | { type: 'local.user_message'; chatId: string; content: string; media?: MediaItem[] }
  | { type: 'local.turn_started'; chatId: string }
  | { type: 'workspace.open'; chatId: string }
  | { type: 'workspace.loading'; chatId: string; requestId: number }
  | { type: 'workspace.loaded'; chatId: string; requestId: number; workspace: SessionWorkspace }
  | { type: 'workspace.failed'; chatId: string; requestId: number; error: string }
  | { type: 'workspace.close' }
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
    case 'local.new_draft':
      return {
        ...state,
        currentChatId: null,
        workspacePanel: closedWorkspacePanel(),
      };
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
      const messageId = nextMessageId(action.chatId, 'assistant');
      const nextState = upsertAssistantMessage(state, action.chatId, messageId, (current) => ({
        id: current?.id ?? messageId,
        type: 'assistant',
        content: current?.content ?? '',
        ...(current?.buttons?.length ? { buttons: current.buttons } : {}),
      }));
      return replaceActiveTurn(
        nextState,
        action.chatId,
        startLocalTurn(turn, {
          messageId,
          startedAtMs: Date.now(),
        }),
      );
    }
    case 'workspace.open':
      return {
        ...state,
        workspacePanel: {
          open: true,
          loading: false,
          error: null,
          chatId: action.chatId,
          requestId: null,
        },
      };
    case 'workspace.loading':
      return {
        ...state,
        workspacePanel: {
          open: true,
          loading: true,
          error: null,
          chatId: action.chatId,
          requestId: action.requestId,
        },
      };
    case 'workspace.loaded':
      if (
        !state.workspacePanel.open
        || state.workspacePanel.chatId !== action.chatId
        || state.workspacePanel.requestId !== action.requestId
      ) {
        return state;
      }
      return {
        ...state,
        workspaceByChat: {
          ...state.workspaceByChat,
          [action.chatId]: action.workspace,
        },
        workspacePanel: {
          ...state.workspacePanel,
          loading: false,
          error: null,
        },
      };
    case 'workspace.failed':
      if (
        !state.workspacePanel.open
        || state.workspacePanel.chatId !== action.chatId
        || state.workspacePanel.requestId !== action.requestId
      ) {
        return state;
      }
      return {
        ...state,
        workspacePanel: {
          ...state.workspacePanel,
          loading: false,
          error: action.error,
        },
      };
    case 'workspace.close':
      return {
        ...state,
        workspacePanel: closedWorkspacePanel(),
      };
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
      workspacePanel: state.currentChatId === event.chatId ? state.workspacePanel : closedWorkspacePanel(),
      messagesByChat: {
        ...state.messagesByChat,
        [event.chatId]: state.messagesByChat[event.chatId] ?? [],
      },
    };
  }

  if (event.type === 'session.history') {
    const preview = event.messages.find((message) => message.type === 'user')?.content ?? '';
    const existingSession = state.sessions.find((session) => session.chat_id === event.chatId);
    return {
      ...state,
      currentChatId: event.chatId,
      workspacePanel: state.currentChatId === event.chatId ? state.workspacePanel : closedWorkspacePanel(),
      sessions:
        event.messages.length > 0 || existingSession
          ? ensureSessionSummary(state, event.chatId, {
              ...(preview ? { preview } : {}),
              message_count: event.messages.length,
            })
          : state.sessions,
      messagesByChat: {
        ...state.messagesByChat,
        [event.chatId]: normalizeHistoryMessages(event.chatId, event.messages),
      },
      activeTurns: {
        ...state.activeTurns,
        [event.chatId]: createEmptyTurnState(),
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
        [event.chatId]: createEmptyTurnState(),
      },
      currentChatId: state.currentChatId === event.chatId ? null : state.currentChatId,
      sessions: state.sessions.filter((session) => session.chat_id !== event.chatId),
    };
  }

  if (event.type === 'turn.delta') {
    const currentTurn = withActiveTurn(state, event.chatId);
    const nextTurn = applyTurnEvent(currentTurn, event, {
      allocateMessageId: () => nextMessageId(event.chatId, 'assistant'),
      nowMs: () => Date.now(),
    });
    const messageId = nextTurn.messageId ?? currentTurn.messageId ?? nextMessageId(event.chatId, 'assistant');
    const nextState = upsertAssistantMessage(state, event.chatId, messageId, (current) => ({
      id: current?.id ?? messageId,
      type: 'assistant',
      content: `${current?.content ?? ''}${normalizeDeltaForStore(current?.content ?? '', event.delta)}`,
      ...(current?.buttons?.length ? { buttons: current.buttons } : {}),
    }));
    return replaceActiveTurn(
      nextState,
      event.chatId,
      {
        ...nextTurn,
        messageId,
      },
    );
  }

  if (event.type === 'turn.phase') {
    return replaceActiveTurn(
      state,
      event.chatId,
      applyTurnEvent(withActiveTurn(state, event.chatId), event, {
        allocateMessageId: () => nextMessageId(event.chatId, 'assistant'),
        nowMs: () => Date.now(),
      }),
    );
  }

  if (event.type === 'tools.started') {
    return replaceActiveTurn(
      state,
      event.chatId,
      applyTurnEvent(withActiveTurn(state, event.chatId), event, {
        allocateMessageId: () => nextMessageId(event.chatId, 'assistant'),
        nowMs: () => Date.now(),
      }),
    );
  }

  if (event.type === 'tools.finished') {
    const nextState = replaceActiveTurn(
      state,
      event.chatId,
      applyTurnEvent(withActiveTurn(state, event.chatId), event, {
        allocateMessageId: () => nextMessageId(event.chatId, 'assistant'),
        nowMs: () => Date.now(),
      }),
    );
    return commitPendingTools(nextState, event.chatId);
  }

  if (event.type === 'turn.completed') {
    const turn = withActiveTurn(state, event.chatId);
    let nextState = commitPendingTools(state, event.chatId);

    const currentAssistantId = turn.messageId;
    const currentAssistant = currentAssistantId
      ? (nextState.messagesByChat[event.chatId] ?? []).find(
          (message) => message.id === currentAssistantId && message.type === 'assistant',
        ) as Extract<HistoryMessage, { type: 'assistant' }> | undefined
      : undefined;
    const currentContent = currentAssistant?.content ?? '';
    const completedContent = event.content?.trim() ? event.content : '';
    const resolvedAssistantContent = completedContent || currentContent || turn.streamBuffer || '';

    if (event.media?.length) {
      if (completedContent.trim()) {
        nextState = mergeMediaIntoLatestAssistant(nextState, event.chatId, completedContent, event.media);
      } else if (currentContent.trim()) {
        nextState = mergeMediaIntoLatestAssistant(nextState, event.chatId, currentContent, event.media);
      } else {
        nextState = appendMessage(nextState, event.chatId, {
          type: 'outbound',
          content: '',
          media: event.media,
        });
      }
    } else if (currentAssistantId) {
      nextState = upsertAssistantMessage(nextState, event.chatId, currentAssistantId, (current) => ({
        id: current?.id ?? currentAssistantId,
        type: 'assistant',
        content: resolvedAssistantContent,
        ...(event.buttons?.length
          ? { buttons: event.buttons }
          : current?.buttons?.length
            ? { buttons: current.buttons }
            : {}),
      }));
    } else if (completedContent.trim()) {
      const lastMessage = (nextState.messagesByChat[event.chatId] ?? []).at(-1);
      if (lastMessage?.type === 'assistant' && lastMessage.content.trim() === completedContent.trim()) {
        nextState = replaceLastMessage(nextState, event.chatId, (message) => {
          if (message.type !== 'assistant') {
            return message;
          }
          return {
            ...message,
            ...(event.buttons?.length ? { buttons: event.buttons } : {}),
          };
        });
      } else {
        nextState = appendMessage(nextState, event.chatId, {
          type: 'assistant',
          content: completedContent,
          ...(event.buttons?.length ? { buttons: event.buttons } : {}),
        });
      }
    }
    return replaceActiveTurn(
      nextState,
      event.chatId,
      applyTurnEvent(turn, event, {
        allocateMessageId: () => nextMessageId(event.chatId, 'assistant'),
        nowMs: () => Date.now(),
      }),
    );
  }

  return state;
}

function closedWorkspacePanel(): WorkspacePanelState {
  return {
    open: false,
    loading: false,
    error: null,
    chatId: null,
    requestId: null,
  };
}

function normalizeDeltaForStore(current: string, incoming: string): string {
  void current;
  return incoming;
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
