import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('Supabase logout session restore guard', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('window', {
      __NANOBOT_WEBUI_BOOTSTRAP__: { title: 'Nanobot', authRequired: true, authMode: 'supabase' },
      localStorage: {
        getItem: vi.fn(() => ''),
        setItem: vi.fn(),
        removeItem: vi.fn(),
      },
    });
  });

  it('skips session restore after an explicit logout clears the local auth token', async () => {
    const { shouldSkipSupabaseSessionRestore } = await import('./use-auth-session');

    expect(shouldSkipSupabaseSessionRestore('', true)).toBe(true);
  });

  it('keeps normal page-load session restore enabled when logout was not requested', async () => {
    const { shouldSkipSupabaseSessionRestore } = await import('./use-auth-session');

    expect(shouldSkipSupabaseSessionRestore('', false)).toBe(false);
  });

  it('does not skip validation when a token is already present', async () => {
    const { shouldSkipSupabaseSessionRestore } = await import('./use-auth-session');

    expect(shouldSkipSupabaseSessionRestore('access-token', true)).toBe(false);
  });

  it('reads auth expiration messages from global events', async () => {
    const { authExpiredMessage } = await import('./use-auth-session');

    expect(authExpiredMessage(new CustomEvent('x', { detail: { message: '未登录或登录已失效' } }))).toBe('未登录或登录已失效');
    expect(authExpiredMessage(new Event('x'))).toBe('登录已失效，请重新登录');
  });
});
