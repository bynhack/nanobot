import { useEffect, useState } from 'react';
import { AuiIf, ThreadPrimitive } from '@assistant-ui/react';

import { AskUserPromptCard } from '../../ask-user-prompt';
import { formatElapsedMs, turnPhaseText } from '../../app-helpers';
import { AssistantMessage, UserMessage } from './messages';
import { Composer } from './composer';
import { ThreadWelcome } from './thread-shell';
import type { PendingAskUserPrompt } from '../../ask-user';
import type { SkillCandidate } from '../../skill-quick-select';
import type { ActiveTurnState } from '../../types';

export function ChatThreadContent({
  title,
  flashMessage,
  activeTurn,
  pendingAskUserPrompt,
  connectionState,
  currentChatId,
  isReadOnlySession,
  onAnswer,
  availableSkills,
  onToggleSidebar,
  showSidebarToggle,
  compact,
  sidebarCollapsed,
  canOpenWorkspace,
  workspaceFileCount,
  workspaceLoading,
  onOpenWorkspace,
}: {
  title: string;
  flashMessage: string | null;
  activeTurn: ActiveTurnState | null;
  pendingAskUserPrompt: PendingAskUserPrompt | null;
  connectionState: string;
  currentChatId: string | null;
  isReadOnlySession: boolean;
  onAnswer: (answer: string) => void;
  availableSkills: SkillCandidate[];
  onToggleSidebar: () => void;
  showSidebarToggle: boolean;
  compact: boolean;
  sidebarCollapsed: boolean;
  canOpenWorkspace: boolean;
  workspaceFileCount: number;
  workspaceLoading: boolean;
  onOpenWorkspace: () => void;
}) {
  return (
    <main className={`chat${compact ? ' compact' : ''}`}>
      <div className="chat-top-controls">
        {showSidebarToggle ? (
          compact && sidebarCollapsed ? (
            <button
              className="compact-sidebar-chip"
              type="button"
              aria-label="展开侧边栏"
              onClick={onToggleSidebar}
            >
              <span className="compact-sidebar-chip-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </span>
              <span className="compact-sidebar-chip-title">{title}</span>
            </button>
          ) : (
            <button
              className="icon-button chat-sidebar-toggle"
              type="button"
              aria-label="切换侧边栏"
              onClick={onToggleSidebar}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
          )
        ) : null}
        <button
          className="workspace-open-button"
          type="button"
          disabled={!canOpenWorkspace || workspaceLoading}
          onClick={onOpenWorkspace}
        >
          {workspaceLoading ? '读取中' : '查看工作空间'}
          {workspaceFileCount > 0 ? <span>{workspaceFileCount}</span> : null}
        </button>
      </div>

      {flashMessage ? <div className="flash">{flashMessage}</div> : null}

      <ThreadPrimitive.Root className="thread-root">
        <ThreadPrimitive.Viewport className="messages">
          <AuiIf condition={(s) => s.thread.isEmpty}>
            <ThreadWelcome />
          </AuiIf>
          <ThreadPrimitive.Messages components={{ UserMessage, AssistantMessage }} />
          <ThreadPrimitive.ViewportFooter className="thread-footer">
            <TurnStatusLine activeTurn={activeTurn} />
            {pendingAskUserPrompt ? (
              <div className="ask-user-block">
                <AskUserPromptCard
                  prompt={pendingAskUserPrompt}
                  disabled={connectionState !== 'connected' || !currentChatId || isReadOnlySession}
                  onAnswer={onAnswer}
                />
              </div>
            ) : null}
            <ThreadPrimitive.ScrollToBottom className="thread-scroll-bottom">
              ↓
            </ThreadPrimitive.ScrollToBottom>
            <Composer skills={availableSkills} compact={compact} />
          </ThreadPrimitive.ViewportFooter>
        </ThreadPrimitive.Viewport>
      </ThreadPrimitive.Root>
    </main>
  );
}

function TurnStatusLine({ activeTurn }: { activeTurn: ActiveTurnState | null }) {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (!(activeTurn?.waiting && activeTurn.startedAtMs)) {
      return;
    }

    setNowMs(Date.now());
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => window.clearInterval(timer);
  }, [activeTurn?.startedAtMs, activeTurn?.waiting]);

  if (!activeTurn?.startedAtMs) {
    return null;
  }

  const elapsedMs = activeTurn.waiting
    ? Math.max(0, nowMs - activeTurn.startedAtMs)
    : activeTurn.lastDurationMs;
  if (elapsedMs === null) {
    return null;
  }

  return (
    <div className="turn-status-line">
      {turnPhaseText(activeTurn.phase)} · {formatElapsedMs(elapsedMs)}
    </div>
  );
}
