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
    title: '整理思路',
    label: '把零散信息归纳成清晰结构',
    prompt: '请帮我把现有信息整理成要点、问题和下一步行动',
  },
  {
    title: '提炼重点',
    label: '从文本、附件或对话里抓关键内容',
    prompt: '请帮我提炼这段内容的重点，并列出需要继续确认的事项',
  },
  {
    title: '生成草稿',
    label: '起草邮件、说明、报告或清单',
    prompt: '请帮我起草一份结构清晰、语气专业的初稿',
  },
  {
    title: '检查方案',
    label: '发现风险、遗漏和可改进点',
    prompt: '请帮我检查这个方案可能存在的风险、遗漏和改进建议',
  },
  {
    title: '解释概念',
    label: '用易懂方式拆解复杂问题',
    prompt: '请用简明的方式解释这个问题，并给出一个例子',
  },
  {
    title: '处理附件',
    label: '上传文件后总结、转写或建立索引',
    prompt: '我准备上传附件，请先告诉我你可以如何帮我阅读、总结和整理它',
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
