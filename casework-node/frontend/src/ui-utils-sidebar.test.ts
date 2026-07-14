import { describe, expect, it } from 'vitest';

import { groupSessionsForSidebar } from './ui-utils';
import type { SessionSummary } from './types';

describe('groupSessionsForSidebar', () => {
  it('splits sessions into recent and earlier buckets', () => {
    const now = new Date('2026-05-08T12:00:00Z').valueOf();
    const sessions: SessionSummary[] = [
      {
        chat_id: 'recent-1',
        created_at: '2026-05-08T10:00:00Z',
        last_ts: '2026-05-08T11:30:00Z',
        preview: '最近会话',
        message_count: 4,
      },
      {
        chat_id: 'old-1',
        created_at: '2026-05-01T10:00:00Z',
        last_ts: '2026-05-01T11:30:00Z',
        preview: '更早会话',
        message_count: 12,
      },
    ];

    expect(groupSessionsForSidebar(sessions, now)).toEqual([
      {
        key: 'recent',
        label: '最近',
        sessions: [sessions[0]],
      },
      {
        key: 'earlier',
        label: '更早',
        sessions: [sessions[1]],
      },
    ]);
  });
});
