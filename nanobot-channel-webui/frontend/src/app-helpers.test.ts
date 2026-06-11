import { describe, expect, it } from 'vitest';

import {
  appendAttachmentReferences,
  buildRuntimeMessages,
  historyMessageToThreadMessage,
  mediaToParts,
  requestStatusText,
  rewriteUpstreamMediaItems,
  rewriteUpstreamMediaUrl,
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

describe('rewriteUpstreamMediaUrl', () => {
  it('routes upstream sidecar media URLs through the control-plane proxy', () => {
    expect(rewriteUpstreamMediaUrl('/api/media/sig123/payload456')).toBe(
      '/api/public-media/payload456',
    );
    expect(rewriteUpstreamMediaUrl('https://example.com/file.png')).toBe('https://example.com/file.png');
  });

  it('rewrites media item arrays without changing remote URLs', () => {
    expect(
      rewriteUpstreamMediaItems([
        { url: '/api/media/sig123/payload456', name: 'preview.html', mime: 'text/html' },
        { url: 'https://example.com/remote.png', name: 'remote.png', mime: 'image/png' },
      ]),
    ).toEqual([
      { url: '/api/public-media/payload456', name: 'preview.html', mime: 'text/html' },
      { url: 'https://example.com/remote.png', name: 'remote.png', mime: 'image/png' },
    ]);
  });
});

describe('appendAttachmentReferences', () => {
  it('adds uploaded file source paths to upstream websocket content', () => {
    expect(
      appendAttachmentReferences('请分析这份合同', [
        {
          path: '/instances/user-1/workspace/.nanobot_webui_uploads/chat-1/contract.pdf',
          name: 'contract.pdf',
          mime: 'application/pdf',
        },
      ]),
    ).toBe(
      '请分析这份合同\n\n[file: contract.pdf]\n[File: source: /instances/user-1/workspace/.nanobot_webui_uploads/chat-1/contract.pdf]',
    );
  });

  it('keeps attachment-only messages actionable for the model', () => {
    expect(
      appendAttachmentReferences('', [
        {
          path: '/instances/user-1/workspace/.nanobot_webui_uploads/chat-1/report.xlsx',
          name: 'report.xlsx',
          mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        },
      ]),
    ).toBe(
      '[file: report.xlsx]\n[File: source: /instances/user-1/workspace/.nanobot_webui_uploads/chat-1/report.xlsx]',
    );
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

  it('hides assistant reasoning parts by default', () => {
    const message = {
      id: 'assistant-1',
      type: 'assistant',
      content: '最终答案',
      parts: [
        { type: 'reasoning', text: '内部思考' },
        { type: 'text', text: '最终答案' },
      ],
    };

    const converted = historyMessageToThreadMessage(message as any, 'chat-1', 0, null);

    expect(converted.content).toEqual([
      { type: 'text', text: '最终答案', status: { type: 'complete' } },
    ]);
  });

  it('keeps assistant reasoning parts when enabled', () => {
    const message = {
      id: 'assistant-1',
      type: 'assistant',
      content: '最终答案',
      parts: [
        { type: 'reasoning', text: '内部思考' },
        { type: 'text', text: '最终答案' },
      ],
    };

    const converted = historyMessageToThreadMessage(
      message as any,
      'chat-1',
      0,
      null,
      { showReasoningMessages: true },
    );

    expect(converted.content).toEqual([
      { type: 'reasoning', text: '内部思考', status: { type: 'complete' } },
      { type: 'text', text: '最终答案', status: { type: 'complete' } },
    ]);
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
    ).toEqual([{ type: 'text', text: '处理中', status: { type: 'running' } }]);
  });

  it('deduplicates assistant-ui toolCallId values within one assistant message', () => {
    const message = {
      id: 'assistant-1',
      type: 'assistant',
      content: '',
      parts: [
        {
          type: 'tool-call',
          tool: { callId: 'call_same', name: 'exec', args: { command: 'pwd' }, result: '/workspace', status: 'ok' },
        },
      ],
    };
    const activeTurn = {
      waiting: true,
      requestStatus: 'processing',
      messageId: 'assistant-1',
      pendingTools: {
        tools: [{ callId: 'call_same', name: 'exec', args: { command: 'date' } }],
        results: [{ callId: 'call_same', name: 'exec', args: { command: 'date' }, status: 'ok', detail: 'today' }],
      },
    };

    const content = historyMessageToThreadMessage(
      message as any,
      'chat-1',
      0,
      activeTurn as any,
      { showToolMessages: true },
    ).content;

    expect(content).toMatchObject([
      { type: 'tool-call', toolCallId: 'call_same' },
      { type: 'tool-call', toolCallId: 'call_same-2' },
    ]);
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
