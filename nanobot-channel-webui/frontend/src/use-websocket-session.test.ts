import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('normalizeServerEvent', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('window', {
      __NANOBOT_WEBUI_BOOTSTRAP__: { title: 'Nanobot', authRequired: false },
      localStorage: {
        getItem: vi.fn(() => ''),
        setItem: vi.fn(),
        removeItem: vi.fn(),
      },
    });
  });

  it('ignores ready and attached events without a valid chat id', async () => {
    const { normalizeServerEvent } = await import('./use-websocket-session');

    expect(normalizeServerEvent({ event: 'ready', chat_id: '' })).toBeNull();
    expect(normalizeServerEvent({ event: 'attached', chat_id: '   ' })).toBeNull();
  });

  it('normalizes ready and attached events with trimmed chat ids', async () => {
    const { normalizeServerEvent } = await import('./use-websocket-session');

    expect(normalizeServerEvent({ event: 'ready', chat_id: ' chat-123 ' })).toEqual({
      type: 'session.init',
      chatId: 'chat-123',
      sessionId: 'chat-123',
    });
    expect(normalizeServerEvent({ event: 'attached', chat_id: 'chat-456' })).toEqual({
      type: 'session.init',
      chatId: 'chat-456',
      sessionId: 'chat-456',
    });
  });
});
