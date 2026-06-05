import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';

import { deleteSession, loadSessions, loadUpstreamThread } from './api';
import { appStore, bootstrap } from './app-state';
import { STORAGE_KEYS } from './store';
import { createThreadSwitchGuard } from './thread-switch';
import { WebSocketClient } from './ws-client';

type MessageAttachmentPayload = {
  path: string;
  name: string;
  mime?: string;
};

export function useWebsocketSession({
  authResolved,
  showFlash,
}: {
  authResolved: boolean;
  showFlash: (message: string) => void;
}) {
  const wsClientRef = useRef<WebSocketClient | null>(null);
  const pendingThreadResolversRef = useRef<Array<(chatId: string | null) => void>>([]);
  const pendingThreadPromiseRef = useRef<Promise<string | null> | null>(null);
  const threadSwitchGuardRef = useRef(createThreadSwitchGuard());
  const authToken = useSyncExternalStore(
    appStore.subscribe,
    () => appStore.getState().authToken,
    () => appStore.getState().authToken,
  );

  const refreshSessions = useCallback(async () => {
    const authToken = appStore.getState().authToken;
    if (bootstrap.authRequired && !authToken) {
      appStore.dispatch({ type: 'sessions.loaded', sessions: [] });
      return;
    }
    try {
      const sessions = await loadSessions(authToken);
      const currentChatId = appStore.getState().currentChatId;
      if (
        currentChatId
        && !sessions.some((session) => session.chat_id === currentChatId)
        && !(appStore.getState().messagesByChat[currentChatId]?.length)
      ) {
        window.localStorage.removeItem(STORAGE_KEYS.chatId);
      }
      appStore.dispatch({ type: 'sessions.loaded', sessions });
    } catch (error) {
      showFlash(error instanceof Error ? error.message : '加载会话失败');
    }
  }, [showFlash]);

  const resolvePendingThreads = useCallback((chatId: string | null) => {
    const resolvers = pendingThreadResolversRef.current.splice(0);
    for (const resolve of resolvers) {
      resolve(chatId);
    }
  }, []);

  const requestServerThread = useCallback(() => {
    const existing = appStore.getState().currentChatId;
    if (existing) {
      return Promise.resolve(existing);
    }
    if (pendingThreadPromiseRef.current) {
      return pendingThreadPromiseRef.current;
    }

    let settleThread: (chatId: string | null) => void = () => undefined;
    const promise = new Promise<string | null>((resolve) => {
      let settled = false;
      settleThread = (chatId: string | null) => {
        if (settled) {
          return;
        }
        settled = true;
        window.clearTimeout(timeout);
        pendingThreadResolversRef.current = pendingThreadResolversRef.current.filter((item) => item !== settleThread);
        pendingThreadPromiseRef.current = null;
        resolve(chatId);
      };
      const timeout = window.setTimeout(() => settleThread(null), 5000);

      pendingThreadResolversRef.current.push(settleThread);
    });
    pendingThreadPromiseRef.current = promise;
    const sent = wsClientRef.current?.send({ type: 'new_chat', webui: true }) ?? false;
    if (!sent) {
      settleThread(null);
    }
    return promise;
  }, []);

  useEffect(() => {
    const client = new WebSocketClient({
      getAuthToken: () => appStore.getState().authToken,
      upstreamBootstrapUrl: bootstrap.upstreamGateway?.bootstrapUrl || '/api/upstream/bootstrap',
      onConnectionState: (connectionState) => {
        appStore.dispatch({ type: 'connection.set', connectionState });
        if (connectionState === 'disconnected') {
          resolvePendingThreads(null);
        }
        if (connectionState === 'connected') {
          void refreshSessions();
        }
      },
      onEvent: (event) => {
        const normalized = normalizeServerEvent(event);
        if (normalized?.type === 'session.init') {
          window.localStorage.setItem(STORAGE_KEYS.chatId, normalized.chatId);
          resolvePendingThreads(normalized.chatId);
        }
        if (normalized?.type === 'session.deleted' && appStore.getState().currentChatId === normalized.chatId) {
          window.localStorage.removeItem(STORAGE_KEYS.chatId);
          resolvePendingThreads(null);
        }
        if (normalized?.type === 'error') {
          showFlash(normalized.message);
        }
        if (!('type' in event) && event.event === 'session_updated') {
          void refreshSessions();
        }
        if (normalized) {
          appStore.dispatch({ type: 'server.event', event: normalized });
        }
      },
    });

    wsClientRef.current = client;
    return () => {
      client.close();
      resolvePendingThreads(null);
      wsClientRef.current = null;
    };
  }, [refreshSessions, resolvePendingThreads, showFlash]);

  useEffect(() => {
    const client = wsClientRef.current;
    if (!client) return;

    if (bootstrap.authMode === 'supabase' && !authResolved) {
      client.close();
      appStore.dispatch({ type: 'connection.set', connectionState: 'connecting' });
      return;
    }
    if (bootstrap.authRequired && !authToken) {
      client.close();
      appStore.dispatch({ type: 'connection.set', connectionState: 'auth_required' });
      appStore.dispatch({ type: 'sessions.loaded', sessions: [] });
      return;
    }

    client.connect();
    return () => client.close();
  }, [authResolved, authToken]);

  const sendMessage = useCallback((payload: {
    content: string;
    attachments: MessageAttachmentPayload[];
  }) => {
    const chatId = appStore.getState().currentChatId;
    wsClientRef.current?.send({
      type: 'message',
      chat_id: chatId,
      content: payload.content,
      webui: true,
    });
  }, []);

  const switchThread = useCallback((threadId: string) => {
    if (threadId && threadId !== appStore.getState().currentChatId) {
      const switchRequestId = threadSwitchGuardRef.current.begin();
      void loadUpstreamThread(threadId, appStore.getState().authToken).then((messages) => {
        if (!threadSwitchGuardRef.current.isCurrent(switchRequestId)) {
          return;
        }
        appStore.dispatch({ type: 'server.event', event: { type: 'session.history', chatId: threadId, messages } });
        window.localStorage.setItem(STORAGE_KEYS.chatId, threadId);
        wsClientRef.current?.send({ type: 'attach', chat_id: threadId });
      }).catch((error) => showFlash(error instanceof Error ? error.message : '加载会话历史失败'));
    }
  }, [showFlash]);

  const createThread = useCallback(() => {
    threadSwitchGuardRef.current.begin();
    window.localStorage.removeItem(STORAGE_KEYS.chatId);
    appStore.dispatch({ type: 'local.new_draft' });
  }, []);

  const deleteThreadById = useCallback(async (threadId: string) => {
    try {
      const deletingCurrentThread = appStore.getState().currentChatId === threadId;
      await deleteSession(threadId, appStore.getState().authToken);
      if (deletingCurrentThread) {
        createThread();
      }
      await refreshSessions();
    } catch (error) {
      showFlash(error instanceof Error ? error.message : '删除会话失败');
      throw error;
    }
  }, [createThread, refreshSessions, showFlash]);

  const cancelTurn = useCallback(() => {
    const chatId = appStore.getState().currentChatId;
    wsClientRef.current?.send({ type: 'message', chat_id: chatId, content: '/stop', webui: true });
  }, []);

  return useMemo(
    () => ({
      refreshSessions,
      sendMessage,
      switchThread,
      createThread,
      deleteThread: deleteThreadById,
      ensureThread: requestServerThread,
      cancelTurn,
    }),
    [cancelTurn, createThread, deleteThreadById, refreshSessions, requestServerThread, sendMessage, switchThread],
  );
}

function normalizeServerEvent(event: import('./types').ServerEvent): import('./types').ServerEvent | null {
  if ('type' in event) {
    return event;
  }

  const chatId = typeof event.chat_id === 'string' ? event.chat_id : '';
  if (event.event === 'ready' || event.event === 'attached') {
    return { type: 'session.init', chatId, sessionId: chatId };
  }
  if (event.event === 'delta') {
    return { type: 'turn.delta', chatId, delta: event.text, streamId: event.stream_id };
  }
  if (event.event === 'reasoning_delta') {
    return { type: 'turn.reasoning_delta', chatId, delta: event.text, streamId: event.stream_id };
  }
  if (event.event === 'reasoning_end') {
    return { type: 'turn.reasoning_end', chatId, streamId: event.stream_id };
  }
  if (event.event === 'message') {
    if (event.kind === 'progress' && event.tool_events?.length) {
      const results = event.tool_events
        .filter((item) => item.phase === 'end')
        .map((item) => ({
          callId: typeof item.call_id === 'string' ? item.call_id : undefined,
          name: String(item.name ?? ''),
          args: item.arguments ?? {},
          status: item.error ? 'error' as const : 'ok' as const,
          detail: item.error ? String(item.error) : String(item.result ?? ''),
        }));
      if (results.length) {
        return { type: 'tools.finished', chatId, durationMs: 0, results };
      }
      return null;
    }
    if (!event.text && !event.media_urls?.length) {
      return null;
    }
    return { type: 'turn.completed', chatId, content: event.text ?? '', media: event.media_urls };
  }
  if (event.event === 'turn_end') {
    return { type: 'turn.phase', chatId, phase: 'completed', resuming: false };
  }
  if (event.event === 'goal_status' && event.status === 'running') {
    return { type: 'turn.phase', chatId, phase: 'streaming' };
  }
  if (event.event === 'goal_status') {
    return null;
  }
  if (event.event === 'error') {
    return { type: 'error', code: String(event.detail ?? 'error'), message: String(event.message ?? event.detail ?? event.reason ?? '请求失败'), chatId };
  }
  return null;
}
