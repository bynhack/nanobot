import { describe, expect, it } from 'vitest';

import {
  buildRuntimeMessages,
  historyMessageToThreadMessage,
  mediaToParts,
  requestStatusText,
} from './app-helpers';

describe('mediaToParts', () => {
  it('keeps assistant image parts only for data URLs', () => {
    expect(
      mediaToParts([
        {
          url: 'data:image/png;base64,ZmFrZQ==',
          name: 'inline.png',
          mime: 'image/png',
        },
      ]),
    ).toEqual([
      {
        type: 'image',
        image: 'data:image/png;base64,ZmFrZQ==',
        filename: 'inline.png',
      },
    ]);
  });

  it('maps remote image URLs to file parts so assistant-ui does not discard them', () => {
    expect(
      mediaToParts([
        {
          url: 'https://example.com/cat.png',
          name: 'cat.png',
          mime: 'image/png',
        },
      ]),
    ).toEqual([
      {
        type: 'file',
        data: 'https://example.com/cat.png',
        filename: 'cat.png',
        mimeType: 'image/png',
      },
    ]);
  });
});

describe('tool message visibility helpers', () => {
  it('hides persisted tool messages by default', () => {
    const state = {
      currentChatId: 'chat-1',
      messagesByChat: {
        'chat-1': [
          { id: 'user-1', type: 'user', content: '查一下' },
          {
            id: 'tools-1',
            type: 'tools',
            tools: [{ name: 'search', args: {}, result: 'ok', status: 'ok' }],
          },
        ],
      },
    };

    expect(buildRuntimeMessages(state as any)).toEqual([
      { id: 'user-1', type: 'user', content: '查一下' },
    ]);
  });

  it('keeps persisted tool messages when enabled', () => {
    const state = {
      currentChatId: 'chat-1',
      messagesByChat: {
        'chat-1': [
          { id: 'user-1', type: 'user', content: '查一下' },
          {
            id: 'tools-1',
            type: 'tools',
            tools: [{ name: 'search', args: {}, result: 'ok', status: 'ok' }],
          },
        ],
      },
    };

    expect(buildRuntimeMessages(state as any, { showToolMessages: true })).toHaveLength(2);
  });

  it('hides pending tool parts from running assistant messages by default', () => {
    const message = {
      id: 'assistant-1',
      type: 'assistant',
      content: '处理中',
    };
    const activeTurn = {
      waiting: true,
      messageId: 'assistant-1',
      pendingTools: {
        tools: [{ name: 'search', args: { keyword: '线索' } }],
        results: [],
      },
    };

    expect(
      historyMessageToThreadMessage(message as any, 'chat-1', 0, activeTurn as any).content,
    ).toEqual([{ type: 'text', text: '处理中' }]);
  });

});


describe('request status text', () => {
  it('shows only the simple overall request states', () => {
    expect(requestStatusText('processing')).toBe('处理中');
    expect(requestStatusText('running_tools')).toBe('调用工具中');
    expect(requestStatusText('completed')).toBe('整体已完成');
    expect(requestStatusText('idle')).toBe('处理中');
  });
});
