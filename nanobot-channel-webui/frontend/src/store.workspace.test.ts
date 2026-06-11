import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  AUTH_EXPIRED_EVENT,
  AuthExpiredError,
  loadSessionWorkspace,
  loadUpstreamThread,
  withAuthQuery,
} from './api';
import { createInitialState, reducer } from './store';
import type { SessionWorkspace } from './types';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('workspace store reducer', () => {
  it('caches the loaded workspace by chat id', () => {
    const state = createInitialState({ title: 'Nanobot', authRequired: false });
    const workspace: SessionWorkspace = {
      chatId: 'chat-1',
      updatedAt: '2026-05-13T08:00:00.000Z',
      files: [
        {
          id: 'file-1',
          name: 'report.md',
          url: '/api/workspaces/chat-1/files/file-1',
          mime: 'text/markdown',
          deliveredAt: '2026-05-13T08:01:00.000Z',
        },
      ],
    };

    const next = reducer(state, {
      type: 'workspace.loaded',
      chatId: 'chat-1',
      requestId: 1,
      workspace,
    });

    expect(next.workspaceByChat['chat-1']).toBeUndefined();
    expect(next.workspacePanel).toEqual({
      open: false,
      loading: false,
      error: null,
      chatId: null,
      requestId: null,
    });
  });

  it('transitions through open, loading, failed, and close panel states', () => {
    let state = createInitialState({ title: 'Nanobot', authRequired: false });

    state = reducer(state, { type: 'workspace.open', chatId: 'chat-1' });
    expect(state.workspacePanel).toEqual({
      open: true,
      loading: false,
      error: null,
      chatId: 'chat-1',
      requestId: null,
    });

    state = reducer(state, { type: 'workspace.loading', chatId: 'chat-1', requestId: 1 });
    expect(state.workspacePanel).toEqual({
      open: true,
      loading: true,
      error: null,
      chatId: 'chat-1',
      requestId: 1,
    });

    state = reducer(state, {
      type: 'workspace.failed',
      chatId: 'chat-1',
      requestId: 1,
      error: '加载工作空间失败（500）',
    });
    expect(state.workspacePanel).toEqual({
      open: true,
      loading: false,
      error: '加载工作空间失败（500）',
      chatId: 'chat-1',
      requestId: 1,
    });

    state = reducer(state, { type: 'workspace.close' });
    expect(state.workspacePanel).toEqual({
      open: false,
      loading: false,
      error: null,
      chatId: null,
      requestId: null,
    });
  });

  it('keeps the current panel loading when an old chat load arrives after switching chats', () => {
    let state = createInitialState({ title: 'Nanobot', authRequired: false });
    state = reducer(state, { type: 'workspace.loading', chatId: 'chat-1', requestId: 1 });
    state = reducer(state, { type: 'workspace.loading', chatId: 'chat-2', requestId: 2 });

    const workspace: SessionWorkspace = {
      chatId: 'chat-1',
      updatedAt: null,
      files: [],
    };
    const next = reducer(state, {
      type: 'workspace.loaded',
      chatId: 'chat-1',
      requestId: 1,
      workspace,
    });

    expect(next.workspaceByChat['chat-1']).toBeUndefined();
    expect(next.workspacePanel).toEqual({
      open: true,
      loading: true,
      error: null,
      chatId: 'chat-2',
      requestId: 2,
    });
  });

  it('ignores an older load for the same chat when a newer request is active', () => {
    let state = createInitialState({ title: 'Nanobot', authRequired: false });
    state = reducer(state, { type: 'workspace.loading', chatId: 'chat-1', requestId: 1 });
    state = reducer(state, { type: 'workspace.loading', chatId: 'chat-1', requestId: 2 });

    const workspace: SessionWorkspace = {
      chatId: 'chat-1',
      updatedAt: null,
      files: [],
    };
    const next = reducer(state, {
      type: 'workspace.loaded',
      chatId: 'chat-1',
      requestId: 1,
      workspace,
    });

    expect(next.workspaceByChat['chat-1']).toBeUndefined();
    expect(next.workspacePanel).toEqual({
      open: true,
      loading: true,
      error: null,
      chatId: 'chat-1',
      requestId: 2,
    });
  });

  it('closes the workspace panel when switching sessions', () => {
    let state = createInitialState({ title: 'Nanobot', authRequired: false }, '', 'chat-1');
    state = reducer(state, { type: 'workspace.loading', chatId: 'chat-1', requestId: 1 });

    const next = reducer(state, {
      type: 'server.event',
      event: {
        type: 'session.history',
        chatId: 'chat-2',
        messages: [],
      },
    });

    expect(next.currentChatId).toBe('chat-2');
    expect(next.workspacePanel).toEqual({
      open: false,
      loading: false,
      error: null,
      chatId: null,
      requestId: null,
    });
  });

  it('ignores old failures after the workspace panel has closed', () => {
    let state = createInitialState({ title: 'Nanobot', authRequired: false });
    state = reducer(state, { type: 'workspace.loading', chatId: 'chat-1', requestId: 1 });
    state = reducer(state, { type: 'workspace.close' });

    const next = reducer(state, {
      type: 'workspace.failed',
      chatId: 'chat-1',
      requestId: 1,
      error: '加载工作空间失败（500）',
    });

    expect(next.workspacePanel).toEqual({
      open: false,
      loading: false,
      error: null,
      chatId: null,
      requestId: null,
    });
  });
});

describe('withAuthQuery', () => {
  it('does not add auth query to public media links', () => {
    vi.stubGlobal('window', { location: { origin: 'http://127.0.0.1:8081' } });

    expect(withAuthQuery('/api/public-media/payload456', 'token-1')).toBe('/api/public-media/payload456');
  });
});

describe('loadSessionWorkspace', () => {
  it('notifies global auth expiration on 401 responses', async () => {
    const listeners = new Map<string, EventListener>();
    const dispatchEvent = vi.fn((event: Event) => {
      listeners.get(event.type)?.(event);
      return true;
    });
    vi.stubGlobal('window', {
      dispatchEvent,
      addEventListener: vi.fn((type: string, listener: EventListener) => listeners.set(type, listener)),
      removeEventListener: vi.fn(),
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: '未登录或登录已失效' }),
    }));

    const events: string[] = [];
    window.addEventListener(AUTH_EXPIRED_EVENT, (event) => {
      events.push((event as CustomEvent<{ message: string }>).detail.message);
    });

    await expect(loadSessionWorkspace('chat-1', 'expired-token')).rejects.toBeInstanceOf(AuthExpiredError);
    expect(dispatchEvent).toHaveBeenCalledTimes(1);
    expect(events).toEqual(['未登录或登录已失效']);
  });

  it('maps a workspace with a null updatedAt and filters malformed files', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        chat_id: 'chat-1',
        updated_at: null,
        files: [
          {
            id: 'file-1',
            name: 'report.md',
            url: '/api/workspaces/chat-1/files/file-1',
            mime: 'text/markdown',
            delivered_at: '2026-05-13T08:01:00.000Z',
          },
          null,
          { id: 'missing-url', name: 'broken.md', mime: 'text/markdown', delivered_at: '2026-05-13T08:02:00.000Z' },
          'not-a-file',
        ],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(loadSessionWorkspace('chat 1', 'token-1')).resolves.toEqual({
      chatId: 'chat-1',
      updatedAt: null,
      files: [
        {
          id: 'file-1',
          name: 'report.md',
          url: '/api/workspaces/chat-1/files/file-1',
          mime: 'text/markdown',
          deliveredAt: '2026-05-13T08:01:00.000Z',
        },
      ],
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/workspaces/chat%201', {
      headers: { Authorization: 'Bearer token-1' },
    });
  });

  it('returns an empty files array when the API returns malformed files', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        chat_id: 'chat-1',
        updated_at: null,
        files: { id: 'not-an-array' },
      }),
    }));

    await expect(loadSessionWorkspace('chat-1', '')).resolves.toEqual({
      chatId: 'chat-1',
      updatedAt: null,
      files: [],
    });
  });
});

describe('loadUpstreamThread', () => {
  it('keeps snake_case tool events from upstream history', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        messages: [
          {
            role: 'tool',
            kind: 'trace',
            content: '',
            tool_events: [
              {
                phase: 'end',
                call_id: 'call_write',
                name: 'write_file',
                arguments: { path: 'hello.html' },
                result: 'ok',
              },
            ],
          },
        ],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(loadUpstreamThread('chat-1', 'token-1')).resolves.toEqual([
      {
        type: 'assistant',
        content: '',
        parts: [
          {
            type: 'tool-call',
            tool: {
              callId: 'call_write',
              name: 'write_file',
              args: { path: 'hello.html' },
              result: 'ok',
              status: 'ok',
            },
          },
        ],
      },
    ]);
  });

  it('keeps outbound media messages from upstream history', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        messages: [
          {
            type: 'outbound',
            content: '已发送',
            media: [
              { url: '/api/upstream/media/sig/payload', name: 'hello.html', mime: 'application/octet-stream' },
            ],
          },
        ],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(loadUpstreamThread('chat-1', 'token-1')).resolves.toEqual([
      {
        type: 'outbound',
        content: '已发送',
        media: [
          { url: '/api/upstream/media/sig/payload', name: 'hello.html', mime: 'application/octet-stream' },
        ],
      },
    ]);
  });

  it('rebuilds assistant tool_calls and following tool result rows around outbound media', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        messages: [
          {
            role: 'assistant',
            content: '',
            tool_calls: [
              {
                id: 'call_write',
                type: 'function',
                function: {
                  name: 'write_file',
                  arguments: JSON.stringify({ path: 'navicat-reset-intro.html', content: '<html></html>' }),
                },
              },
            ],
          },
          {
            role: 'assistant',
            content: '给你写好了，一个干干净净的 HTML 介绍页',
            _channel_delivery: true,
            media: ['/workspace/navicat-reset-intro.html'],
          },
          {
            role: 'tool',
            tool_call_id: 'call_write',
            name: 'write_file',
            content: 'Successfully wrote 7190 characters to /workspace/navicat-reset-intro.html',
          },
          {
            role: 'assistant',
            content: '',
            tool_calls: [
              {
                id: 'call_message',
                type: 'function',
                function: {
                  name: 'message',
                  arguments: JSON.stringify({
                    content: '给你写好了，一个干干净净的 HTML 介绍页',
                    media: ['/workspace/navicat-reset-intro.html'],
                  }),
                },
              },
            ],
          },
          {
            role: 'tool',
            tool_call_id: 'call_message',
            name: 'message',
            content: 'Message sent to websocket:c9842da7 with 1 attachments',
          },
        ],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(loadUpstreamThread('chat-1', 'token-1')).resolves.toEqual([
      {
        type: 'outbound',
        content: '给你写好了，一个干干净净的 HTML 介绍页',
        media: [
          { url: '/workspace/navicat-reset-intro.html', name: 'navicat-reset-intro.html', mime: '' },
        ],
      },
      {
        type: 'assistant',
        content: '',
        parts: [
          {
            type: 'tool-call',
            tool: {
              callId: 'call_write',
              name: 'write_file',
              args: { path: 'navicat-reset-intro.html', content: '<html></html>' },
              result: 'Successfully wrote 7190 characters to /workspace/navicat-reset-intro.html',
              status: 'ok',
            },
          },
          {
            type: 'tool-call',
            tool: {
              callId: 'call_message',
              name: 'message',
              args: {
                content: '给你写好了，一个干干净净的 HTML 介绍页',
                media: ['/workspace/navicat-reset-intro.html'],
              },
              result: 'Message sent to websocket:c9842da7 with 1 attachments',
              status: 'ok',
            },
          },
        ],
      },
    ]);
  });

  it('rebuilds schema v3 tool events, file edits, and media delivery messages', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        schemaVersion: 3,
        messages: [
          {
            role: 'tool',
            kind: 'trace',
            content: 'read_file({"path":"reset_for_mac.sh"})',
            traces: ['read_file({"path":"reset_for_mac.sh"})'],
            toolEvents: [
              {
                phase: 'end',
                call_id: 'call_read',
                name: 'read_file',
                arguments: { path: 'reset_for_mac.sh' },
                result: 'script content',
              },
            ],
          },
          {
            role: 'tool',
            kind: 'trace',
            content: '',
            traces: [],
            fileEdits: [
              {
                call_id: 'call_write',
                tool: 'write_file',
                path: 'navicat-reset-intro.html',
                phase: 'end',
                added: 263,
                deleted: 0,
                status: 'done',
                absolute_path: '/workspace/navicat-reset-intro.html',
              },
            ],
          },
          {
            role: 'assistant',
            content: '给你写好了，一个干干净净的 HTML 介绍页',
            media: [
              {
                kind: 'file',
                url: '/api/public-media/payload',
                name: 'navicat-reset-intro.html',
              },
            ],
          },
        ],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(loadUpstreamThread('chat-1', 'token-1')).resolves.toEqual([
      {
        type: 'assistant',
        content: '',
        parts: [
          {
            type: 'tool-call',
            tool: {
              callId: 'call_read',
              name: 'read_file',
              args: { path: 'reset_for_mac.sh' },
              result: 'script content',
              status: 'ok',
            },
          },
          {
            type: 'tool-call',
            tool: {
              callId: 'call_write',
              name: 'write_file',
              args: {
                path: 'navicat-reset-intro.html',
                absolute_path: '/workspace/navicat-reset-intro.html',
                added: 263,
                deleted: 0,
              },
              result: 'done',
              status: 'ok',
            },
          },
          {
            type: 'tool-call',
            tool: {
              name: 'message',
              args: {
                content: '给你写好了，一个干干净净的 HTML 介绍页',
                media: ['/api/public-media/payload'],
              },
              result: 'Message delivered with 1 attachment',
              status: 'ok',
            },
          },
        ],
      },
      {
        type: 'outbound',
        content: '给你写好了，一个干干净净的 HTML 介绍页',
        media: [
          { url: '/api/public-media/payload', name: 'navicat-reset-intro.html', mime: '' },
        ],
      },
    ]);
  });
});
