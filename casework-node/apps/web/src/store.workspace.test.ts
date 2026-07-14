import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadSessionWorkspace } from './api';
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

describe('loadSessionWorkspace', () => {
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
