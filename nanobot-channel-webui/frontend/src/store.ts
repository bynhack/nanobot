import type {
  ActiveTurnState,
  AppState,
  AssistantHistoryPart,
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
  showReasoningMessages: 'nanobot_channel_webui_show_reasoning_messages',
  debugState: 'nanobot_channel_webui_debug_state',
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

function isTurnFullyCompleted(turn: ActiveTurnState): boolean {
  return turn.requestStatus === 'completed' && turn.waiting === false;
}

function latestAssistantMessageId(state: AppState, chatId: string): string | null {
  const messages = state.messagesByChat[chatId] ?? [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.type === 'assistant' && message.id) {
      return message.id;
    }
  }
  return null;
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

function upsertToolsMessage(
  state: AppState,
  chatId: string,
  messageId: string,
  tools: Extract<HistoryMessage, { type: 'tools' }>['tools'],
): AppState {
  const messages = state.messagesByChat[chatId] ?? [];
  const index = messages.findIndex((message) => message.id === messageId && message.type === 'tools');
  const nextMessage: HistoryMessage = { id: messageId, type: 'tools', tools };
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
  return appendMessage(state, chatId, nextMessage);
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
  const messageId = turn.toolsMessageId ?? nextMessageId(chatId, 'tools');
  const nextState = upsertToolsMessage(state, chatId, messageId, tools);
  return replaceActiveTurn(nextState, chatId, {
    ...withActiveTurn(nextState, chatId),
    pendingTools: null,
    toolsMessageId: messageId,
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

function assistantPartsFromMessage(
  message: Extract<HistoryMessage, { type: 'assistant' }> | null,
): AssistantHistoryPart[] {
  if (message?.parts?.length) {
    return message.parts.map((part) => ({ ...part }));
  }
  if (message?.content) {
    return [{ type: 'text', text: message.content }];
  }
  return [];
}

function upsertAssistantParts(
  state: AppState,
  chatId: string,
  messageId: string,
  update: (parts: AssistantHistoryPart[]) => AssistantHistoryPart[],
  extras: Pick<Extract<HistoryMessage, { type: 'assistant' }>, 'buttons'> = {},
): AppState {
  return upsertAssistantMessage(state, chatId, messageId, (current) => {
    const parts = update(assistantPartsFromMessage(current));
    const content = parts
      .filter((part): part is Extract<AssistantHistoryPart, { type: 'text' }> => part.type === 'text')
      .map((part) => part.text)
      .join('');
    return {
      id: current?.id ?? messageId,
      type: 'assistant',
      content,
      parts,
      ...(extras.buttons?.length
        ? { buttons: extras.buttons }
        : current?.buttons?.length
          ? { buttons: current.buttons }
          : {}),
    };
  });
}

function appendTextPart(parts: AssistantHistoryPart[], text: string): AssistantHistoryPart[] {
  if (!text) return parts;
  const next = [...parts];
  const last = next.at(-1);
  if (last?.type === 'text') {
    next[next.length - 1] = { ...last, text: `${last.text}${text}` };
    return next;
  }
  next.push({ type: 'text', text });
  return next;
}

function replaceFinalTextPart(parts: AssistantHistoryPart[], text: string): AssistantHistoryPart[] {
  if (!text) return parts;
  const last = parts.at(-1);
  if (last?.type !== 'text') {
    return [...parts, { type: 'text', text }];
  }
  const next = [...parts];
  next[next.length - 1] = { type: 'text', text };
  return next;
}

function appendReasoningPart(parts: AssistantHistoryPart[], text: string): AssistantHistoryPart[] {
  if (!text) return parts;
  const next = [...parts];
  const last = next.at(-1);
  if (last?.type === 'reasoning' && last.streaming) {
    next[next.length - 1] = { ...last, text: `${last.text}${text}`, streaming: true };
    return next;
  }
  next.push({ type: 'reasoning', text, streaming: true });
  return next;
}

function closeReasoningParts(parts: AssistantHistoryPart[]): AssistantHistoryPart[] {
  return parts.map((part) => (
    part.type === 'reasoning' && part.streaming
      ? { ...part, streaming: false }
      : part
  ));
}

function replaceTrailingToolParts(
  parts: AssistantHistoryPart[],
  tools: Extract<AssistantHistoryPart, { type: 'tool-call' }>[],
): AssistantHistoryPart[] {
  let keepUntil = parts.length;
  while (keepUntil > 0 && parts[keepUntil - 1].type === 'tool-call') {
    keepUntil -= 1;
  }
  return [...parts.slice(0, keepUntil), ...tools];
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
  options: { preserveExistingOrder?: boolean } = {},
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

  if (existing && options.preserveExistingOrder) {
    return state.sessions.map((session) => (
      session.chat_id === chatId ? nextSession : session
    ));
  }

  return [
    nextSession,
    ...state.sessions.filter((session) => session.chat_id !== chatId),
  ];
}

function sanitizeSessionPreview(preview: string): string {
  const fileMatch = preview.match(/^\s*\[file:\s*([^\]]+)\]/i);
  return fileMatch?.[1]?.trim() || preview;
}

function sessionPreviewFromMessages(messages: HistoryMessage[] | undefined): string {
  if (!messages?.length) {
    return '新对话';
  }
  const userMessage = messages.find((message) => message.type === 'user');
  if (userMessage?.type === 'user') {
    return previewFromUserMessage(userMessage.content, userMessage.media);
  }
  const firstMessage = messages[0];
  if (firstMessage?.type === 'outbound') {
    return firstMessage.content || firstMessage.media[0]?.name || '新对话';
  }
  return firstMessage?.content || '新对话';
}

function previewFromUserMessage(content: string, media?: MediaItem[]): string {
  if (media?.length && /^\s*\[file:/i.test(content)) {
    return media[0]?.name ?? '附件';
  }
  return sanitizeSessionPreview(content) || (media?.length ? media[0]?.name ?? '附件' : '新对话');
}

function normalizeSessionSummary(session: SessionSummary): SessionSummary {
  return {
    ...session,
    preview: sanitizeSessionPreview(session.preview) || '新对话',
  };
}

function currentSessionFallback(state: AppState, chatId: string): SessionSummary {
  const messages = state.messagesByChat[chatId] ?? [];
  return {
    chat_id: chatId,
    created_at: new Date().toISOString(),
    last_ts: new Date().toISOString(),
    preview: sessionPreviewFromMessages(messages),
    message_count: messages.length,
  };
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
    case 'sessions.loaded': {
      const loadedSessions = action.sessions.map(normalizeSessionSummary);
      const currentChatId = state.currentChatId;
      const currentExists = currentChatId
        ? loadedSessions.some((session) => session.chat_id === currentChatId)
        : false;
      const currentHasLocalMessages = currentChatId
        ? Boolean(state.messagesByChat[currentChatId]?.length)
        : false;
      const currentLocalSession = currentChatId
        ? state.sessions.find((session) => session.chat_id === currentChatId)
        : undefined;
      const currentTurn = currentChatId ? state.activeTurns[currentChatId] : undefined;
      const currentTurnInFlight = Boolean(
        currentTurn
        && (currentTurn.waiting || currentTurn.requestStatus === 'processing' || currentTurn.requestStatus === 'running_tools'),
      );
      const shouldPreserveCurrent = Boolean(currentChatId && !currentExists && (currentHasLocalMessages || currentTurnInFlight));
      const sessions = shouldPreserveCurrent && currentChatId
        ? [currentLocalSession ?? currentSessionFallback(state, currentChatId), ...loadedSessions]
        : loadedSessions;
      return {
        ...state,
        currentChatId: currentChatId && !currentExists && !currentHasLocalMessages && !currentTurnInFlight
          ? null
          : currentChatId,
        sessions,
      };
    }
    case 'local.new_draft':
      return {
        ...state,
        currentChatId: null,
        workspacePanel: closedWorkspacePanel(),
      };
    case 'local.user_message': {
      const previousMessageCount = state.messagesByChat[action.chatId]?.length ?? 0;
      const existingSession = state.sessions.find((session) => session.chat_id === action.chatId);
      const nextState = appendMessage(state, action.chatId, {
        type: 'user',
        content: action.content,
        ...(action.media?.length ? { media: action.media } : {}),
      });
      const messageCount = nextState.messagesByChat[action.chatId]?.length ?? 1;
      const shouldSetPreview = !existingSession || previousMessageCount === 0;
      return {
        ...nextState,
        currentChatId: action.chatId,
        workspacePanel: state.currentChatId === action.chatId ? state.workspacePanel : closedWorkspacePanel(),
        sessions: ensureSessionSummary(nextState, action.chatId, {
          ...(shouldSetPreview ? { preview: previewFromUserMessage(action.content, action.media) } : {}),
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
    if (!event.chatId.trim()) {
      return state;
    }
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
    if (!event.chatId.trim()) {
      return state;
    }
    const preview = sessionPreviewFromMessages(event.messages);
    const existingSession = state.sessions.find((session) => session.chat_id === event.chatId);
    return {
      ...state,
      currentChatId: event.chatId,
      workspacePanel: state.currentChatId === event.chatId ? state.workspacePanel : closedWorkspacePanel(),
      sessions:
        event.messages.length > 0 || existingSession
          ? ensureSessionSummary(state, event.chatId, {
              ...(preview !== '新对话' ? { preview } : {}),
              message_count: event.messages.length,
            }, { preserveExistingOrder: Boolean(existingSession) })
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
    if (isTurnFullyCompleted(currentTurn)) {
      return state;
    }
    const nextTurn = applyTurnEvent(currentTurn, event, {
      allocateMessageId: () => nextMessageId(event.chatId, 'assistant'),
      nowMs: () => Date.now(),
    });
    const messageId = nextTurn.messageId ?? currentTurn.messageId ?? nextMessageId(event.chatId, 'assistant');
    const nextState = upsertAssistantParts(
      state,
      event.chatId,
      messageId,
      (parts) => appendTextPart(parts, normalizeDeltaForStore('', event.delta)),
    );
    return replaceActiveTurn(
      nextState,
      event.chatId,
      {
        ...nextTurn,
        messageId,
      },
    );
  }

  if (event.type === 'turn.reasoning_delta') {
    const currentTurn = withActiveTurn(state, event.chatId);
    if (isTurnFullyCompleted(currentTurn)) {
      return state;
    }
    const messageId = currentTurn.messageId ?? nextMessageId(event.chatId, 'assistant');
    const nextState = upsertAssistantParts(
      state,
      event.chatId,
      messageId,
      (parts) => appendReasoningPart(parts, event.delta),
    );
    return replaceActiveTurn(nextState, event.chatId, {
      ...currentTurn,
      waiting: true,
      phase: 'streaming',
      requestStatus: 'processing',
      messageId,
      streamId: event.streamId ?? currentTurn.streamId,
    });
  }

  if (event.type === 'turn.reasoning_end') {
    const turn = withActiveTurn(state, event.chatId);
    if (isTurnFullyCompleted(turn)) {
      return state;
    }
    if (!turn.messageId) {
      return state;
    }
    return upsertAssistantParts(
      state,
      event.chatId,
      turn.messageId,
      closeReasoningParts,
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
    const currentTurn = withActiveTurn(state, event.chatId);
    if (isTurnFullyCompleted(currentTurn)) {
      return state;
    }
    return replaceActiveTurn(
      state,
      event.chatId,
      applyTurnEvent(currentTurn, event, {
        allocateMessageId: () => nextMessageId(event.chatId, 'assistant'),
        nowMs: () => Date.now(),
      }),
    );
  }

  if (event.type === 'tools.finished') {
    const currentTurn = withActiveTurn(state, event.chatId);
    const nextTurn = applyTurnEvent(currentTurn, event, {
        allocateMessageId: () => nextMessageId(event.chatId, 'assistant'),
        nowMs: () => Date.now(),
    });
    const messageId = currentTurn.messageId
      ?? nextTurn.messageId
      ?? latestAssistantMessageId(state, event.chatId)
      ?? nextMessageId(event.chatId, 'assistant');
    const toolParts: Extract<AssistantHistoryPart, { type: 'tool-call' }>[] = event.results.map((result) => ({
      type: 'tool-call',
      durationMs: event.durationMs,
      tool: {
        callId: result.callId,
        name: result.name,
        args: result.args,
        result: result.detail,
        status: result.status,
      },
    }));
    const nextState = upsertAssistantParts(
      state,
      event.chatId,
      messageId,
      (parts) => replaceTrailingToolParts(parts, toolParts),
    );
    if (isTurnFullyCompleted(currentTurn)) {
      return nextState;
    }
    return replaceActiveTurn(nextState, event.chatId, {
      ...nextTurn,
      messageId,
      pendingTools: null,
    });
  }

  if (event.type === 'turn.completed') {
    const turn = withActiveTurn(state, event.chatId);
    let nextState = state;

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
      nextState = upsertAssistantParts(
        nextState,
        event.chatId,
        currentAssistantId,
        (parts) => replaceFinalTextPart(parts, resolvedAssistantContent),
        { buttons: event.buttons },
      );
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

function debugStateEnabled(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  return window.localStorage.getItem(STORAGE_KEYS.debugState) === 'true'
    || new URLSearchParams(window.location.search).get('debug_state') === '1';
}

function activeTurnSummary(state: AppState, chatId: string | null) {
  if (!chatId) {
    return null;
  }
  const turn = state.activeTurns[chatId];
  if (!turn) {
    return null;
  }
  return {
    phase: turn.phase,
    requestStatus: turn.requestStatus,
    waiting: turn.waiting,
    messageId: turn.messageId,
    streamId: turn.streamId,
  };
}

function debugStateSnapshot(state: AppState) {
  return {
    currentChatId: state.currentChatId,
    connectionState: state.connectionState,
    sessions: state.sessions.map((session) => ({
      chat_id: session.chat_id,
      preview: session.preview,
      message_count: session.message_count,
    })),
    currentMessageCount: state.currentChatId
      ? state.messagesByChat[state.currentChatId]?.length ?? 0
      : 0,
    currentTurn: activeTurnSummary(state, state.currentChatId),
  };
}

function debugAction(action: Action, before: AppState, after: AppState): void {
  if (!debugStateEnabled()) {
    return;
  }
  const changed = before.currentChatId !== after.currentChatId
    || before.sessions !== after.sessions
    || before.connectionState !== after.connectionState
    || (before.currentChatId && before.activeTurns[before.currentChatId] !== after.activeTurns[before.currentChatId]);
  if (!changed) {
    return;
  }
  console.debug('[nanobot-debug] appStore.dispatch', {
    action,
    before: debugStateSnapshot(before),
    after: debugStateSnapshot(after),
  });
}

export function createStore(initialState: AppState) {
  let state = initialState;
  const listeners = new Set<(state: AppState) => void>();

  return {
    getState(): AppState {
      return state;
    },
    dispatch(action: Action): void {
      const before = state;
      state = reducer(state, action);
      debugAction(action, before, state);
      listeners.forEach((listener) => listener(state));
    },
    subscribe(listener: (state: AppState) => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
