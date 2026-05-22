import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';

import { deleteSession, loadSessions } from './api';
import { appStore, bootstrap } from './app-state';
import { STORAGE_KEYS } from './store';
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
    const sent = wsClientRef.current?.send({ type: 'session.new' }) ?? false;
    if (!sent) {
      settleThread(null);
    }
    return promise;
  }, []);

  const createServerThread = useCallback(() => {
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
        resolve(chatId);
      };
      const timeout = window.setTimeout(() => settleThread(null), 5000);
      pendingThreadResolversRef.current.push(settleThread);
    });
    const sent = wsClientRef.current?.send({ type: 'session.new' }) ?? false;
    if (!sent) {
      settleThread(null);
    }
    return promise;
  }, []);

  useEffect(() => {
    const client = new WebSocketClient({
      getAuthToken: () => appStore.getState().authToken,
      getChatId: () => appStore.getState().currentChatId,
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
        if (event.type === 'session.init') {
          window.localStorage.setItem(STORAGE_KEYS.chatId, event.chatId);
          resolvePendingThreads(event.chatId);
        }
        if (event.type === 'session.deleted' && appStore.getState().currentChatId === event.chatId) {
          window.localStorage.removeItem(STORAGE_KEYS.chatId);
          resolvePendingThreads(null);
        }
        if (event.type === 'error') {
          showFlash(event.message);
        }
        appStore.dispatch({ type: 'server.event', event });
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

    if (bootstrap.authMode === 'pocketbase' && !authResolved) {
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
    wsClientRef.current?.send({
      type: 'message.send',
      content: payload.content,
      attachments: payload.attachments,
    });
  }, []);

  const switchThread = useCallback((threadId: string) => {
    if (threadId && threadId !== appStore.getState().currentChatId) {
      wsClientRef.current?.send({ type: 'session.switch', chatId: threadId });
    }
  }, []);

  const createThread = useCallback(() => {
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
    wsClientRef.current?.send({ type: 'message.cancel' });
  }, []);

  return useMemo(
    () => ({
      refreshSessions,
      sendMessage,
      switchThread,
      createThread,
      deleteThread: deleteThreadById,
      ensureThread: requestServerThread,
      createServerThread,
      cancelTurn,
    }),
    [cancelTurn, createServerThread, createThread, deleteThreadById, refreshSessions, requestServerThread, sendMessage, switchThread],
  );
}
