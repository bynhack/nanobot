import { describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_THREAD_SUGGESTIONS,
  buildExternalThreadListAdapter,
  buildThreadSuggestions,
} from './assistant-ui-runtime';
import type { SessionSummary } from './types';

const sessions: SessionSummary[] = [
  {
    chat_id: 'chat-1',
    created_at: '2026-05-10T00:00:00.000Z',
    last_ts: '2026-05-10T01:00:00.000Z',
    preview: '第一个会话',
    message_count: 3,
  },
  {
    chat_id: 'chat-2',
    created_at: '2026-05-09T00:00:00.000Z',
    last_ts: '2026-05-09T01:00:00.000Z',
    preview: '第二个会话',
    message_count: 8,
    read_only: true,
  },
];

describe('assistant-ui runtime helpers', () => {
  it('builds thread suggestions with title, label, and prompt', () => {
    const suggestions = buildThreadSuggestions() as Array<{
      title?: string;
      label?: string;
      prompt: string;
    }>;

    expect(suggestions).toEqual(DEFAULT_THREAD_SUGGESTIONS);
    expect(suggestions).toHaveLength(6);
  });

  it('builds external thread list adapter from sessions', async () => {
    const onSwitchToThread = vi.fn();
    const onSwitchToNewThread = vi.fn();
    const onDeleteThread = vi.fn();
    const adapter = buildExternalThreadListAdapter(sessions, 'chat-1', {
      onSwitchToThread,
      onSwitchToNewThread,
      onDeleteThread,
    });

    expect(adapter.threadId).toBe('chat-1');
    expect(adapter.threads).toEqual([
      { id: 'chat-1', remoteId: 'chat-1', title: '第一个会话', status: 'regular' },
      { id: 'chat-2', remoteId: 'chat-2', title: '第二个会话', status: 'regular' },
    ]);

    await adapter.onSwitchToThread?.('chat-2');
    await adapter.onSwitchToNewThread?.();
    await adapter.onDelete?.('chat-1');

    expect(onSwitchToThread).toHaveBeenCalledWith('chat-2');
    expect(onSwitchToNewThread).toHaveBeenCalledTimes(1);
    expect(onDeleteThread).toHaveBeenCalledWith('chat-1');
  });

  it('keeps the active thread available to assistant-ui before sessions load', () => {
    const adapter = buildExternalThreadListAdapter([], 'restored-chat', {
      onSwitchToThread: vi.fn(),
      onSwitchToNewThread: vi.fn(),
      onDeleteThread: vi.fn(),
    });

    expect(adapter.threadId).toBe('restored-chat');
    expect(adapter.threads).toEqual([
      { id: 'restored-chat', remoteId: 'restored-chat', title: '新对话', status: 'regular' },
    ]);
  });

  it('uses a non-persisted draft thread for assistant-ui draft state', () => {
    const adapter = buildExternalThreadListAdapter(sessions, null, {
      onSwitchToThread: vi.fn(),
      onSwitchToNewThread: vi.fn(),
      onDeleteThread: vi.fn(),
    });

    expect(adapter.threadId).toBe('__nanobot_draft_thread__');
    const threads = adapter.threads ?? [];
    expect(threads.map((thread) => thread.id)).toEqual(['__nanobot_draft_thread__', 'chat-1', 'chat-2']);
  });
});
