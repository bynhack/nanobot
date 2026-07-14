import { useCallback, useEffect, useRef, useState } from 'react';

import { loadCurrentUser, login, logout } from './api';
import { bootstrap, appStore } from './app-state';
import { STORAGE_KEYS } from './store';
import type { AuthUser } from './types';

export function useAuthSession(authToken: string) {
  const [authModalOpen, setAuthModalOpen] = useState<boolean>(
    bootstrap.authMode === 'token' && bootstrap.authRequired && !authToken,
  );
  const [draftToken, setDraftToken] = useState(authToken);
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authResolved, setAuthResolved] = useState(
    bootstrap.authMode !== 'pocketbase' || !authToken,
  );
  const resolvedAuthTokenRef = useRef<string | null>(null);

  useEffect(() => {
    setDraftToken(authToken);
  }, [authToken]);

  useEffect(() => {
    if (bootstrap.authMode === 'token' && bootstrap.authRequired && !authToken) {
      setAuthModalOpen(true);
    }
    if (!authToken) {
      setCurrentUser(null);
      resolvedAuthTokenRef.current = null;
      setAuthResolved(true);
    }
  }, [authToken]);

  useEffect(() => {
    if (bootstrap.authMode !== 'pocketbase') {
      setAuthResolved(true);
      return;
    }
    if (!authToken) {
      setCurrentUser(null);
      setAuthError(null);
      setAuthResolved(true);
      resolvedAuthTokenRef.current = null;
      return;
    }
    if (resolvedAuthTokenRef.current === authToken) {
      setAuthResolved(true);
      return;
    }

    let active = true;
    setAuthBusy(true);
    setAuthResolved(false);
    void (async () => {
      try {
        const result = await loadCurrentUser(authToken);
        if (!active) return;
        const nextToken = result.token || authToken;
        resolvedAuthTokenRef.current = nextToken;
        window.localStorage.setItem(STORAGE_KEYS.authToken, nextToken);
        setCurrentUser(result.user);
        setAuthError(null);
        setAuthResolved(true);
        if (nextToken !== authToken) {
          appStore.dispatch({ type: 'auth.set', token: nextToken });
        }
      } catch (error) {
        if (!active) return;
        window.localStorage.removeItem(STORAGE_KEYS.authToken);
        appStore.dispatch({ type: 'auth.set', token: '' });
        setCurrentUser(null);
        setAuthError(error instanceof Error ? error.message : '登录状态已失效');
        resolvedAuthTokenRef.current = null;
        setAuthResolved(true);
      } finally {
        if (active) {
          setAuthBusy(false);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [authToken]);

  const handlePocketBaseLogin = useCallback(async (identity: string, password: string) => {
    if (!identity || !password) {
      setAuthError('邮箱和密码不能为空');
      return;
    }
    setAuthBusy(true);
    setAuthError(null);
    try {
      const result = await login(identity, password);
      window.localStorage.setItem(STORAGE_KEYS.authToken, result.token);
      appStore.dispatch({ type: 'auth.set', token: result.token });
      setCurrentUser(result.user);
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : '登录失败');
    } finally {
      setAuthBusy(false);
    }
  }, []);

  const handleLogout = useCallback(async () => {
    const token = authToken;
    window.localStorage.removeItem(STORAGE_KEYS.authToken);
    window.localStorage.removeItem(STORAGE_KEYS.chatId);
    appStore.dispatch({ type: 'auth.set', token: '' });
    appStore.dispatch({ type: 'sessions.loaded', sessions: [] });
    setCurrentUser(null);
    setAuthError(null);
    if (bootstrap.authMode === 'pocketbase' && token) {
      try {
        await logout(token);
      } catch {
        // ignore logout transport failure
      }
    } else if (bootstrap.authMode === 'token') {
      setAuthModalOpen(true);
    }
  }, [authToken]);

  return {
    authModalOpen,
    setAuthModalOpen,
    draftToken,
    setDraftToken,
    currentUser,
    authBusy,
    authError,
    authResolved,
    handlePocketBaseLogin,
    handleLogout,
  };
}
