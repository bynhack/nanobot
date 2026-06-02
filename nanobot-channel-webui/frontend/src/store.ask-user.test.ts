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
        preview: 'ask_user',
        message_count: messages.length,
      },
    ],
  };
}

describe('ask_user store reducer', () => {
  it('stores ask_user buttons from completed assistant events', () => {
    const next = reducer(baseState(), {
      type: 'server.event',
      event: {
        type: 'turn.completed',
        chatId: 'chat-1',
        content: '请确认本次操作：更新员工信息',
        buttons: [['确认', '取消']],
      },
    });

    expect(next.messagesByChat['chat-1'][0]).toMatchObject({
      type: 'assistant',
      content: '请确认本次操作：更新员工信息',
      buttons: [['确认', '取消']],
    });
  });

  it('adds ask_user buttons to an already streamed assistant message', () => {
    const next = reducer(
      baseState([
        {
          id: 'assistant-streamed',
          type: 'assistant',
          content: '请确认本次操作：更新员工信息',
        },
      ]),
      {
        type: 'server.event',
        event: {
          type: 'turn.completed',
          chatId: 'chat-1',
          content: '请确认本次操作：更新员工信息',
          buttons: [['确认', '取消']],
        },
      },
    );

    expect(next.messagesByChat['chat-1']).toHaveLength(1);
    expect(next.messagesByChat['chat-1'][0]).toMatchObject({
      id: 'assistant-streamed',
      type: 'assistant',
      content: '请确认本次操作：更新员工信息',
      buttons: [['确认', '取消']],
    });
  });

  it('keeps the streamed assistant message id on completion', () => {
    let state = baseState();
    state.activeTurns['chat-1'] = {
      phase: 'streaming',
      requestStatus: 'processing',
      waiting: true,
      messageId: 'temp-stream-id',
      streamBuffer: '| a | b |\n|---|---|\n| 1 | 2 |',
      streamId: 's1',
      pendingTools: null,
      startedAtMs: 100,
      lastDurationMs: null,
    };

    const next = reducer(state, {
      type: 'server.event',
      event: {
        type: 'turn.completed',
        chatId: 'chat-1',
        content: '',
      },
    });

    expect(next.messagesByChat['chat-1']).toHaveLength(1);
    expect(next.messagesByChat['chat-1'][0]?.id).toBe('temp-stream-id');
    expect(next.messagesByChat['chat-1'][0]).toMatchObject({
      type: 'assistant',
      content: '| a | b |\n|---|---|\n| 1 | 2 |',
    });
  });
});
