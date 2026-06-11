import { describe, expect, it } from 'vitest';

import { createInitialState, reducer } from './store';

describe('thread list session lifecycle', () => {
  it('ignores empty session init events without leaving the current thread', () => {
    const state = createInitialState({ title: 'Nanobot', authRequired: false }, '', 'chat-current');

    const next = reducer(state, {
      type: 'server.event',
      event: {
        type: 'session.init',
        chatId: '',
        sessionId: '',
      },
    });

    expect(next.currentChatId).toBe('chat-current');
    expect(next.messagesByChat).toEqual({});
  });

  it('ignores empty session history events without leaving the current thread', () => {
    const state = createInitialState({ title: 'Nanobot', authRequired: false }, '', 'chat-current');

    const next = reducer(state, {
      type: 'server.event',
      event: {
        type: 'session.history',
        chatId: '   ',
        messages: [],
      },
    });

    expect(next.currentChatId).toBe('chat-current');
    expect(next.messagesByChat).toEqual({});
  });

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

  it('clears an empty restored current thread when it is missing from upstream sessions', () => {
    const session = {
      chat_id: 'chat-existing',
      created_at: '2026-05-10T00:00:00.000Z',
      last_ts: '2026-05-10T00:00:00.000Z',
      preview: '已有会话',
      message_count: 2,
    };
    const state = createInitialState({ title: 'Nanobot', authRequired: false }, '', 'stale-chat');

    const next = reducer(state, {
      type: 'sessions.loaded',
      sessions: [session],
    });

    expect(next.currentChatId).toBeNull();
    expect(next.sessions).toEqual([session]);
  });

  it('keeps a current thread with local messages while sessions are catching up', () => {
    const state = reducer(createInitialState({ title: 'Nanobot', authRequired: false }, '', 'chat-new'), {
      type: 'local.user_message',
      chatId: 'chat-new',
      content: '刚发送的消息',
    });

    const next = reducer(state, {
      type: 'sessions.loaded',
      sessions: [],
    });

    expect(next.currentChatId).toBe('chat-new');
    expect(next.sessions[0]?.chat_id).toBe('chat-new');
  });

  it('rebuilds the current session summary when upstream sessions temporarily miss the active chat', () => {
    const stateWithMessage = reducer(createInitialState({ title: 'Nanobot', authRequired: false }), {
      type: 'local.user_message',
      chatId: 'chat-active',
      content: '',
      media: [{ url: '/api/public-media/upload-token', name: 'discipline.png', mime: 'image/png' }],
    });
    const stateWithoutSessionCache = {
      ...stateWithMessage,
      sessions: [],
    };

    const next = reducer(stateWithoutSessionCache, {
      type: 'sessions.loaded',
      sessions: [],
    });

    expect(next.currentChatId).toBe('chat-active');
    expect(next.sessions).toHaveLength(1);
    expect(next.sessions[0]).toMatchObject({
      chat_id: 'chat-active',
      preview: 'discipline.png',
      message_count: 1,
    });
  });

  it('switches from a draft to the server thread when the local attachment message is committed', () => {
    const state = createInitialState({ title: 'Nanobot', authRequired: false });

    const next = reducer(state, {
      type: 'local.user_message',
      chatId: 'chat-with-upload',
      content: '',
      media: [{ url: '/api/public-media/upload-token', name: 'contract.pdf', mime: 'application/pdf' }],
    });

    expect(next.currentChatId).toBe('chat-with-upload');
    expect(next.messagesByChat['chat-with-upload']).toMatchObject([
      {
        type: 'user',
        content: '',
        media: [{ url: '/api/public-media/upload-token', name: 'contract.pdf', mime: 'application/pdf' }],
      },
    ]);
    expect(next.sessions[0]).toMatchObject({
      chat_id: 'chat-with-upload',
      preview: 'contract.pdf',
      message_count: 1,
    });
  });

  it('does not replace an existing attachment thread title with later user messages', () => {
    const firstTurn = reducer(createInitialState({ title: 'Nanobot', authRequired: false }), {
      type: 'local.user_message',
      chatId: 'chat-with-upload',
      content: '',
      media: [{ url: '/api/public-media/upload-token', name: 'discipline.png', mime: 'image/png' }],
    });

    const secondTurn = reducer(firstTurn, {
      type: 'local.user_message',
      chatId: 'chat-with-upload',
      content: '你又在瞎说了',
    });

    expect(secondTurn.currentChatId).toBe('chat-with-upload');
    expect(secondTurn.sessions[0]).toMatchObject({
      chat_id: 'chat-with-upload',
      preview: 'discipline.png',
      message_count: 2,
    });
  });

  it('uses uploaded attachment names instead of raw source text when rebuilding history titles', () => {
    const state = createInitialState({ title: 'Nanobot', authRequired: false });

    const next = reducer(state, {
      type: 'server.event',
      event: {
        type: 'session.history',
        chatId: 'chat-with-upload',
        messages: [
          {
            type: 'user',
            content: '[file: discipline.png] [File: source: /tmp/.nanobot_webui_uploads/chat/discipline.png]',
            media: [{ url: '/api/public-media/upload-token', name: 'discipline.png', mime: 'image/png' }],
          },
          {
            type: 'assistant',
            content: '已读取附件。',
          },
        ],
      },
    });

    expect(next.sessions[0]).toMatchObject({
      chat_id: 'chat-with-upload',
      preview: 'discipline.png',
      message_count: 2,
    });
  });

  it('sanitizes upstream session previews created from attachment bridge text', () => {
    const state = createInitialState({ title: 'Nanobot', authRequired: false });

    const next = reducer(state, {
      type: 'sessions.loaded',
      sessions: [
        {
          chat_id: 'chat-with-upload',
          created_at: '2026-06-10T00:00:00.000Z',
          last_ts: '2026-06-10T00:00:00.000Z',
          preview: '[file: discipline.png] [File: source: /tmp/.nanobot_webui_uploads/chat/discipline.png]',
          message_count: 2,
        },
      ],
    });

    expect(next.sessions[0]).toMatchObject({
      chat_id: 'chat-with-upload',
      preview: 'discipline.png',
      message_count: 2,
    });
  });

  it('keeps existing session order when switching to a session with history', () => {
    const first = {
      chat_id: 'chat-first',
      created_at: '2026-05-10T00:00:00.000Z',
      last_ts: '2026-05-10T00:00:00.000Z',
      preview: '第一个会话',
      message_count: 2,
    };
    const second = {
      chat_id: 'chat-second',
      created_at: '2026-05-11T00:00:00.000Z',
      last_ts: '2026-05-11T00:00:00.000Z',
      preview: '第二个会话',
      message_count: 2,
    };
    const state = reducer(createInitialState({ title: 'Nanobot', authRequired: false }, '', 'chat-first'), {
      type: 'sessions.loaded',
      sessions: [first, second],
    });

    const next = reducer(state, {
      type: 'server.event',
      event: {
        type: 'session.history',
        chatId: 'chat-second',
        messages: [
          { type: 'user', content: '切换到第二个' },
          { type: 'assistant', content: '历史回复' },
        ],
      },
    });

    expect(next.currentChatId).toBe('chat-second');
    expect(next.sessions.map((session) => session.chat_id)).toEqual(['chat-first', 'chat-second']);
    expect(next.sessions[1]).toMatchObject({
      chat_id: 'chat-second',
      preview: '切换到第二个',
      message_count: 2,
    });
  });
});
