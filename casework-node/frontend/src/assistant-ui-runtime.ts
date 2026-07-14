import type { ExternalStoreThreadListAdapter, ThreadSuggestion } from '@assistant-ui/react';

import type { SessionSummary } from './types';

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
    title: '梳理资金路径',
    label: '按时间和层级追踪转入、转出、回流',
    prompt: '帮我梳理这批交易的资金流向路径，并标出关键中转账户',
  },
  {
    title: '识别关联实体',
    label: '合并同人同户同公司线索并标注依据',
    prompt: '帮我识别材料里的关联人员、公司、账户，并说明合并依据',
  },
  {
    title: '提取关键线索',
    label: '从聊天、文档、图片里抓账户、金额、时间',
    prompt: '帮我从现有材料中提取账户、金额、时间点和关键动作',
  },
  {
    title: '定位异常模式',
    label: '识别拆分转账、集中归集、快进快出',
    prompt: '帮我检查这些交易是否存在拆分、归集、过桥或快进快出的异常模式',
  },
  {
    title: '生成证据清单',
    label: '按事实、推断、待核实项结构化输出',
    prompt: '帮我把现有材料整理成证据清单，区分已证实事实、分析推断和待核实问题',
  },
  {
    title: '整理附件内容',
    label: '上传台账、回单、截图后提取重点并建立索引',
    prompt: '我准备上传附件，请先告诉我你会如何提取线索、整理证据并建立索引',
  },
];

export function buildThreadSuggestions(): readonly ThreadSuggestion[] {
  return DEFAULT_THREAD_SUGGESTIONS as unknown as readonly ThreadSuggestion[];
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
