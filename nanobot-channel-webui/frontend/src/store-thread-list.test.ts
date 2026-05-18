import { describe, expect, it } from 'vitest';

import { createInitialState, reducer } from './store';

describe('thread list session lifecycle', () => {
  it('does not create a fake session row on session.init alone', () => {
    const state = createInitialState({ title: 'Nanobot', authRequired: false });

    const next = reducer(state, {
      type: 'server.event',
      event: {
        type: 'session.init',
        chatId: 'chat-new',
        sessionId: 'chat-new',
      },
    });

    expect(next.currentChatId).toBe('chat-new');
    expect(next.sessions).toEqual([]);
    expect(next.messagesByChat['chat-new']).toEqual([]);
  });

  it('does not create a fake session row for an empty history payload', () => {
    const state = reducer(createInitialState({ title: 'Nanobot', authRequired: false }), {
      type: 'server.event',
      event: {
        type: 'session.init',
        chatId: 'chat-new',
        sessionId: 'chat-new',
      },
    });

    const next = reducer(state, {
      type: 'server.event',
      event: {
        type: 'session.history',
        chatId: 'chat-new',
        messages: [],
      },
    });

    expect(next.sessions).toEqual([]);
    expect(next.messagesByChat['chat-new']).toEqual([]);
  });

  it('switches to a local draft without adding a persisted session row', () => {
    const session = {
      chat_id: 'chat-existing',
      created_at: '2026-05-10T00:00:00.000Z',
      last_ts: '2026-05-10T00:00:00.000Z',
      preview: '已有会话',
      message_count: 2,
    };
    const state = reducer(createInitialState({ title: 'Nanobot', authRequired: false }, '', 'chat-existing'), {
      type: 'sessions.loaded',
      sessions: [session],
    });

    const next = reducer(state, { type: 'local.new_draft' });

    expect(next.currentChatId).toBeNull();
    expect(next.sessions).toEqual([session]);
    expect(next.messagesByChat).toEqual(state.messagesByChat);
  });
});
