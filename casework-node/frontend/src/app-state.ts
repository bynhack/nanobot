import { useRef, useSyncExternalStore } from 'react';

import { createAuthState } from './auth-store';
import { STORAGE_KEYS, createInitialState, createStore } from './store';
import type { AppState } from './types';
import { bootstrapConfig } from './ui-utils';

export const bootstrap = bootstrapConfig();

const initialAuthState = createAuthState({
  token: window.localStorage.getItem(STORAGE_KEYS.authToken) ?? '',
});

export const appStore = createStore(
  createInitialState(
    bootstrap,
    initialAuthState.token,
    window.localStorage.getItem(STORAGE_KEYS.chatId),
  ),
);

export const DETAIL_PANEL_WIDTH_KEY = 'nanobot_channel_webui_detail_panel_width';

export function useAppState(): AppState {
  return useSyncExternalStore(
    (onChange) => appStore.subscribe(() => onChange()),
    () => appStore.getState(),
    () => appStore.getState(),
  );
}

export function useAppSelector<T>(
  selector: (state: AppState) => T,
  isEqual: (left: T, right: T) => boolean = Object.is,
): T {
  const cacheRef = useRef<{ hasValue: boolean; value: T } | null>(null);

  return useSyncExternalStore(
    (onChange) => appStore.subscribe(() => onChange()),
    () => {
      const nextValue = selector(appStore.getState());
      const cachedValue = cacheRef.current;
      if (cachedValue?.hasValue && isEqual(cachedValue.value, nextValue)) {
        return cachedValue.value;
      }
      cacheRef.current = { hasValue: true, value: nextValue };
      return nextValue;
    },
    () => selector(appStore.getState()),
  );
}
