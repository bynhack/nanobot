import { describe, expect, it } from 'vitest';

import { createInitialState, reducer } from './store';
import type { AppState, HistoryMessage } from './types';

function baseState(messages: HistoryMessage[] = []): AppState {
  return {
    ...createInitialState({ title: 'Nanobot', authRequired: false }),
    currentChatId: 'chat-1',
    messagesByChat: {
      'chat-1': messages,
    },
    sessions: [
      {
        chat_id: 'chat-1',
        created_at: null,
        last_ts: null,
        preview: 'interactive',
        message_count: messages.length,
      },
    ],
  };
}

describe('interactive store reducer', () => {
  it('adds pending interactive messages from websocket events', () => {
    const next = reducer(
      baseState(),
      {
        type: 'server.event',
        event: {
          type: 'interactive.request',
          chatId: 'chat-1',
          sessionKey: 'webui:chat-1',
          id: 'int_1',
          kind: 'confirm',
          payload: { title: '确认部署', message: '继续吗？' },
          createdAt: Date.now(),
        },
      },
    );

    expect(next.messagesByChat['chat-1']).toEqual([
      {
        id: 'int_1',
        type: 'interactive',
        kind: 'confirm',
        payload: { title: '确认部署', message: '继续吗？' },
        status: 'pending',
      },
    ]);
  });

  it('marks an interactive message completed from the server acknowledgement', () => {
    const state = baseState([
      {
        id: 'int_2',
        type: 'interactive',
        kind: 'confirm',
        payload: { title: '确认部署' },
        status: 'pending',
      },
    ]);

    const next = reducer(state, {
      type: 'server.event',
      event: {
        type: 'interactive.response',
        chatId: 'chat-1',
        id: 'int_2',
        result: { confirmed: true },
      },
    });

    expect(next.messagesByChat['chat-1'][0]).toMatchObject({
      id: 'int_2',
      status: 'ok',
      result: { confirmed: true },
    });
  });

  it('marks an interactive message cancelled from the server acknowledgement', () => {
    const state = baseState([
      {
        id: 'int_3',
        type: 'interactive',
        kind: 'input',
        payload: { title: '输入环境名' },
        status: 'pending',
      },
    ]);

    const next = reducer(state, {
      type: 'server.event',
      event: {
        type: 'interactive.cancel',
        chatId: 'chat-1',
        id: 'int_3',
      },
    });

    expect(next.messagesByChat['chat-1'][0]).toMatchObject({
      id: 'int_3',
      status: 'cancelled',
    });
  });

  it('does not let a pending restore overwrite completed history', () => {
    const state = baseState([
      {
        id: 'int_4',
        type: 'interactive',
        kind: 'select',
        payload: {
          title: '选择环境',
          options: [{ label: '生产', value: 'prod' }],
        },
        status: 'ok',
        result: { selected: 'prod' },
      },
    ]);

    const next = reducer(state, {
      type: 'server.event',
      event: {
        type: 'interactive.request',
        chatId: 'chat-1',
        sessionKey: 'webui:chat-1',
        id: 'int_4',
        kind: 'select',
        payload: {
          title: '选择环境',
          options: [{ label: '生产', value: 'prod' }],
        },
        createdAt: Date.now(),
      },
    });

    expect(next.messagesByChat['chat-1'][0]).toMatchObject({
      id: 'int_4',
      status: 'ok',
      result: { selected: 'prod' },
    });
  });
});
