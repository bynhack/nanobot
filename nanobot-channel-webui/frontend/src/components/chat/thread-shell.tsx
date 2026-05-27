import {
  SuggestionPrimitive,
  ThreadListItemPrimitive,
  ThreadListPrimitive,
  ThreadPrimitive,
} from '@assistant-ui/react';
import { DRAFT_THREAD_ID } from '../../assistant-ui-runtime';

export function ThreadWelcome({
  title = '从一个问题开始。',
  subtitle = '选择一个常用任务，或直接输入你想处理的内容。',
}: {
  title?: string;
  subtitle?: string;
}) {
  return (
    <div className="thread-welcome">
      <div className="hero-welcome">
        <div className="hero-logo">
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M12 2c0 0 1.2 5.4 6 6-4.8 1.2-6 6-6 6s-1.2-5.4-6-6c4.8-1.2 6-6 6-6z" />
            <path d="M19.5 15c0 0 .6 2.7 2.5 3-1.9.6-2.5 3-2.5 3s-.6-2.7-2.5-3c1.9-.6 2.5-3 2.5-3z" opacity=".72" />
            <path d="M4.5 4c0 0 .4 1.8 1.5 2-1.1.4-1.5 2-1.5 2s-.4-1.8-1.5-2c1.1-.4 1.5-2 1.5-2z" opacity=".48" />
          </svg>
        </div>
        <div className="hero-title">{title}</div>
        <div className="hero-subtitle">{subtitle}</div>
      </div>
      <div className="thread-suggestion-grid">
        <ThreadPrimitive.Suggestions>
          {() => <ThreadSuggestionCard />}
        </ThreadPrimitive.Suggestions>
      </div>
    </div>
  );
}

function ThreadSuggestionCard() {
  return (
    <SuggestionPrimitive.Trigger send className="thread-suggestion-card">
      <span className="thread-suggestion-title">
        <SuggestionPrimitive.Title />
      </span>
      <span className="thread-suggestion-label">
        <SuggestionPrimitive.Description />
      </span>
    </SuggestionPrimitive.Trigger>
  );
}

export function SidebarThreadList({
  canDeleteThread,
  activeThreadId,
}: {
  canDeleteThread: (threadId: string) => boolean;
  activeThreadId: string | null;
}) {
  return (
    <ThreadListPrimitive.Root className="thread-list-root">
      <ThreadListPrimitive.New className="sidebar-primary-action" aria-label="新对话">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M16.862 4.487a2.25 2.25 0 013.182 3.182L9.75 17.963 5.25 18.75l.787-4.5L16.862 4.487z"
          />
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 6.75l2.25 2.25" />
        </svg>
        <span>新对话</span>
      </ThreadListPrimitive.New>
      <div className="thread-list-body">
        <ThreadListPrimitive.Items>
          {({ threadListItem }) => {
            if (threadListItem.id === DRAFT_THREAD_ID) {
              return null;
            }
            return (
              <SidebarThreadListItem
                title={threadListItem.title}
                isActive={threadListItem.id === activeThreadId}
                canDelete={canDeleteThread(threadListItem.id)}
              />
            );
          }}
        </ThreadListPrimitive.Items>
      </div>
    </ThreadListPrimitive.Root>
  );
}

function SidebarThreadListItem({
  title,
  isActive,
  canDelete,
}: {
  title?: string;
  isActive: boolean;
  canDelete: boolean;
}) {
  return (
    <ThreadListItemPrimitive.Root className={`session-item${isActive ? ' active' : ''}`}>
      <ThreadListItemPrimitive.Trigger className="session-trigger">
        <p className="session-title">{title || '新对话'}</p>
      </ThreadListItemPrimitive.Trigger>
      {canDelete ? (
        <ThreadListItemPrimitive.Delete className="delete-pill" aria-label="删除会话">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </ThreadListItemPrimitive.Delete>
      ) : (
        <span className="session-pill">只读</span>
      )}
    </ThreadListItemPrimitive.Root>
  );
}
