import type { AuthStatus, AuthUser } from './types';

export interface AuthState {
  status: AuthStatus;
  token: string;
  user: AuthUser | null;
}

export function createAuthState(initial?: Partial<AuthState>): AuthState {
  return {
    status: initial?.status ?? 'anonymous',
    token: initial?.token ?? '',
    user: initial?.user ?? null,
  };
}
