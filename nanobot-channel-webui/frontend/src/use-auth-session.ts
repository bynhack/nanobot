import { useCallback, useEffect, useRef, useState } from 'react';

import { AUTH_EXPIRED_EVENT, loadCurrentUser } from './api';
import { bootstrap, appStore } from './app-state';
import { STORAGE_KEYS } from './store';
import { getSupabaseAccessToken, signInWithSupabase, signOutSupabase } from './supabase-client';
import type { AuthUser } from './types';

export function shouldSkipSupabaseSessionRestore(authToken: string, logoutRequested: boolean): boolean {
  return !authToken && logoutRequested;
}

export function authExpiredMessage(event: Event): string {
  const detail = (event as Event & { detail?: { message?: unknown } }).detail;
  return typeof detail?.message === 'string' && detail.message.trim()
    ? detail.message
    : '登录已失效，请重新登录';
}

export function useAuthSession(authToken: string) {
  const [authModalOpen, setAuthModalOpen] = useState<boolean>(
    bootstrap.authMode === 'token' && bootstrap.authRequired && !authToken,
  );
  const [draftToken, setDraftToken] = useState(authToken);
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authResolved, setAuthResolved] = useState(
    bootstrap.authMode !== 'supabase' || !authToken,
  );
  const resolvedAuthTokenRef = useRef<string | null>(null);
  const suppressSupabaseRestoreRef = useRef(false);

  useEffect(() => {
    setDraftToken(authToken);
  }, [authToken]);

  useEffect(() => {
    const handleAuthExpired = (event: Event) => {
      suppressSupabaseRestoreRef.current = true;
      window.localStorage.removeItem(STORAGE_KEYS.authToken);
      appStore.dispatch({ type: 'auth.set', token: '' });
      appStore.dispatch({ type: 'sessions.loaded', sessions: [] });
      setCurrentUser(null);
      setAuthError(authExpiredMessage(event));
      resolvedAuthTokenRef.current = null;
      setAuthResolved(true);
      setAuthBusy(false);
      if (bootstrap.authMode === 'token') {
        setAuthModalOpen(true);
      }
    };

    window.addEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired);
  }, []);

  useEffect(() => {
    if (bootstrap.authMode === 'token' && bootstrap.authRequired && !authToken) {
      setAuthModalOpen(true);
    }
    if (!authToken && bootstrap.authMode !== 'supabase') {
      setCurrentUser(null);
      resolvedAuthTokenRef.current = null;
      setAuthResolved(true);
    }
  }, [authToken]);

  useEffect(() => {
    if (bootstrap.authMode !== 'supabase') {
      setAuthResolved(true);
      return;
    }
    if (shouldSkipSupabaseSessionRestore(authToken, suppressSupabaseRestoreRef.current)) {
      window.localStorage.removeItem(STORAGE_KEYS.authToken);
      setCurrentUser(null);
      setAuthError(null);
      resolvedAuthTokenRef.current = null;
      setAuthResolved(true);
      setAuthBusy(false);
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
        let sessionToken = authToken;
        if (!sessionToken) {
          sessionToken = await getSupabaseAccessToken();
        }
        if (!sessionToken) {
          if (!active) return;
          window.localStorage.removeItem(STORAGE_KEYS.authToken);
          appStore.dispatch({ type: 'auth.set', token: '' });
          setCurrentUser(null);
          setAuthError(null);
          resolvedAuthTokenRef.current = null;
          setAuthResolved(true);
          return;
        }
        const result = await loadCurrentUser(sessionToken);
        if (!active) return;
        const nextToken = result.token || sessionToken;
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

  const handleSupabaseLogin = useCallback(async (identity: string, password: string) => {
    if (!identity || !password) {
      setAuthError('邮箱和密码不能为空');
      return;
    }
    setAuthBusy(true);
    setAuthError(null);
    suppressSupabaseRestoreRef.current = false;
    try {
      const token = await signInWithSupabase(identity, password);
      const result = await loadCurrentUser(token);
      const nextToken = result.token || token;
      window.localStorage.setItem(STORAGE_KEYS.authToken, nextToken);
      resolvedAuthTokenRef.current = nextToken;
      appStore.dispatch({ type: 'auth.set', token: nextToken });
      setCurrentUser(result.user);
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : '登录失败');
    } finally {
      setAuthBusy(false);
    }
  }, []);

  const handleLogout = useCallback(async () => {
    suppressSupabaseRestoreRef.current = bootstrap.authMode === 'supabase';
    window.localStorage.removeItem(STORAGE_KEYS.authToken);
    window.localStorage.removeItem(STORAGE_KEYS.chatId);
    appStore.dispatch({ type: 'auth.set', token: '' });
    appStore.dispatch({ type: 'sessions.loaded', sessions: [] });
    setCurrentUser(null);
    setAuthError(null);
    resolvedAuthTokenRef.current = null;
    if (bootstrap.authMode === 'supabase') {
      try {
        await signOutSupabase();
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
    handleSupabaseLogin,
    handleLogout,
  };
}
