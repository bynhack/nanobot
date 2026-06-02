import { useEffect, useState, type ReactNode } from 'react';
import { AuiIf, ThreadPrimitive } from '@assistant-ui/react';

import { AskUserPromptCard } from '../../ask-user-prompt';
import { formatElapsedMs, requestStatusText } from '../../app-helpers';
import { AssistantMessage, UserMessage } from './messages';
import { Composer } from './composer';
import { ThreadWelcome } from './thread-shell';
import type { PendingAskUserPrompt } from '../../ask-user';
import type { SkillCandidate } from '../../skill-quick-select';
import type { ActiveTurnState } from '../../types';

export function ChatThreadContent({
  title,
  conversationTitle,
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
  contentPanelOpen,
  onToggleContentPanel,
  showContentHeader = true,
  showContentPanelToggle = true,
  topControlsSlot,
  composerTopSlot,
  showThreadWelcome = true,
  welcomeTitle,
  welcomeSubtitle,
  composerPlaceholder,
  compactComposerPlaceholder,
}: {
  title: string;
  conversationTitle: string;
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
  contentPanelOpen: boolean;
  onToggleContentPanel: () => void;
  showContentHeader?: boolean;
  showContentPanelToggle?: boolean;
  topControlsSlot?: ReactNode;
  composerTopSlot?: ReactNode;
  showThreadWelcome?: boolean;
  welcomeTitle?: string;
  welcomeSubtitle?: string;
  composerPlaceholder?: string;
  compactComposerPlaceholder?: string;
}) {
  return (
    <main className={`chat${compact ? ' compact' : ''}${showContentHeader ? ' with-content-header' : ' without-content-header'}`}>
      {showContentHeader ? (
        <header className="chat-content-header">
          <div className="chat-content-title-block">
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
            <h1>{conversationTitle || title}</h1>
          </div>
          <div className="chat-content-header-actions">
            {topControlsSlot}
            {showContentPanelToggle ? (
              <button
                className={`content-panel-toggle${contentPanelOpen ? ' is-active' : ''}`}
                type="button"
                aria-label={contentPanelOpen ? '关闭内容区' : '打开内容区'}
                aria-pressed={contentPanelOpen}
                onClick={onToggleContentPanel}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <rect x="3" y="4" width="18" height="16" rx="3" />
                  <path d="M14 4v16" />
                </svg>
              </button>
            ) : null}
          </div>
        </header>
      ) : null}

      {flashMessage ? <div className="flash">{flashMessage}</div> : null}

      <ThreadPrimitive.Root className="thread-root">
        <ThreadPrimitive.Viewport className="messages">
          {showThreadWelcome ? (
            <AuiIf condition={(s) => s.thread.isEmpty}>
              <ThreadWelcome title={welcomeTitle} subtitle={welcomeSubtitle} />
            </AuiIf>
          ) : null}
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
            {composerTopSlot}
            <ThreadPrimitive.ScrollToBottom className="thread-scroll-bottom">
              ↓
            </ThreadPrimitive.ScrollToBottom>
            <Composer
              skills={availableSkills}
              compact={compact}
              placeholder={composerPlaceholder}
              compactPlaceholder={compactComposerPlaceholder}
            />
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
      {requestStatusText(activeTurn.requestStatus)} · {formatElapsedMs(elapsedMs)}
    </div>
  );
}
