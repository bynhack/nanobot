import type { ExternalStoreThreadListAdapter, ThreadSuggestion } from '@assistant-ui/react';

import type { ConversationStarter, SessionSummary } from './types';

export const DRAFT_THREAD_ID = '__nanobot_draft_thread__';

type SuggestionCard = {
  title: string;
  label: string;
  prompt: string;
};

type ThreadListCallbacks = {
  onSwitchToThread: (threadId: string) => Promise<void> | void;
  onSwitchToNewThread: () => Promise<void> | void;
  onDeleteThread: (threadId: string) => Promise<void> | void;
};

export const DEFAULT_THREAD_SUGGESTIONS: SuggestionCard[] = [
  {
    title: '查看负责公司',
    label: '确认当前账号可见的公司和部门',
    prompt: '请帮我查询我当前账号能查看哪些公司，以及这些公司下面有哪些部门。',
  },
  {
    title: '员工花名册',
    label: '查看授权范围内员工人数和状态',
    prompt: '请帮我查询我负责公司范围内的员工花名册，并按公司、部门和在职状态做一个简要汇总。',
  },
  {
    title: '合同覆盖检查',
    label: '检查在职员工合同缺口',
    prompt: '请帮我分析我负责公司范围内的劳动合同覆盖情况，重点列出在职但缺少合同记录的员工。',
  },
  {
    title: '绩效社保概况',
    label: '按月份查看绩效和社保记录',
    prompt: '请帮我查询 2026 年 3 月我负责公司范围内的绩效记录和社保异动情况，并给出简要汇总。',
  },
  {
    title: '人事异动奖惩',
    label: '查看异动、纪律处分和用章记录',
    prompt: '请帮我查询 2026 年我负责公司范围内的人事异动、纪律处分和用章记录，并按类别汇总。',
  },
  {
    title: '查询员工档案',
    label: '按姓名查看员工基础信息和合同',
    prompt: '请帮我查询某位员工的基础信息和合同情况。如果员工不在我的权限范围内，请直接说明权限边界。',
  },
];

export function buildThreadSuggestions(
  starters: readonly ConversationStarter[] | undefined = DEFAULT_THREAD_SUGGESTIONS,
): readonly ThreadSuggestion[] {
  const normalized = (starters ?? [])
    .map((starter) => ({
      title: String(starter.title ?? '').trim(),
      label: String(starter.label ?? '').trim(),
      prompt: String(starter.prompt ?? '').trim(),
    }))
    .filter((starter) => starter.title && starter.prompt);
  return normalized as unknown as readonly ThreadSuggestion[];
}

export function threadRenderKey(threadId: string | null): string {
  return threadId ?? DRAFT_THREAD_ID;
}

export function buildExternalThreadListAdapter(
  sessions: SessionSummary[],
  currentChatId: string | null,
  callbacks: ThreadListCallbacks,
): ExternalStoreThreadListAdapter {
  const threads = sessions.map((session) => ({
    id: session.chat_id,
    remoteId: session.chat_id,
    title: session.preview,
    status: 'regular' as const,
  }));
  const hasCurrentThread = currentChatId ? threads.some((thread) => thread.id === currentChatId) : false;
  const runtimeThreads = [
    ...(currentChatId && !hasCurrentThread
      ? [{
          id: currentChatId,
          remoteId: currentChatId,
          title: '新对话',
          status: 'regular' as const,
        }]
      : []),
    ...(!currentChatId
      ? [{
          id: DRAFT_THREAD_ID,
          remoteId: DRAFT_THREAD_ID,
          title: '新对话',
          status: 'regular' as const,
        }]
      : []),
    ...threads,
  ];

  return {
    threadId: currentChatId ?? DRAFT_THREAD_ID,
    threads: runtimeThreads,
    onSwitchToThread: callbacks.onSwitchToThread,
    onSwitchToNewThread: callbacks.onSwitchToNewThread,
    onDelete: callbacks.onDeleteThread,
  };
}
