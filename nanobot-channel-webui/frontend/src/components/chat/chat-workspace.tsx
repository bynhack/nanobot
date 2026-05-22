import { AssistantRuntimeProvider, Suggestions, useAui } from '@assistant-ui/react';
import { memo, useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react';

import { buildTextAppendMessage } from '../../app-helpers';
import { appStore, useAppSelector } from '../../app-state';
import { DEFAULT_THREAD_SUGGESTIONS } from '../../assistant-ui-runtime';
import { loadSessionWorkspace } from '../../api';
import type { SkillCandidate } from '../../skill-quick-select';
import type { AuthUser, MediaItem, SessionWorkspaceFile } from '../../types';
import { useAvailableSkills } from '../../use-available-skills';
import { useWebsocketSession } from '../../use-websocket-session';
import { useWebuiRuntime } from '../../use-webui-runtime';
import { DetailPreviewContext, type DetailActions } from './detail-preview-context';
import { ChatSidebar } from './sidebar';
import { ChatThreadContent } from './thread-content';
import { WorkspacePanel } from './workspace-panel';

export type ChatWorkspaceRenderContext = {
  currentChatId: string | null;
  availableSkills: SkillCandidate[];
  sendAppendMessage: ReturnType<typeof useWebuiRuntime>['sendAppendMessage'];
  workspaceFileCount: number;
  workspaceLoading: boolean;
  websocketSession: ReturnType<typeof useWebsocketSession>;
};

export type ChatWorkspaceProps = {
  authResolved: boolean;
  authToken: string;
  currentUser: AuthUser | null;
  title: string;
  showFlash: (message: string) => void;
  previewActions: DetailActions;
  flashMessage?: string | null;
  className?: string;
  threadWrapperClassName?: string;
  previewOpen?: boolean;
  immersivePreview?: boolean;
  compact?: boolean;
  showSidebar?: boolean;
  sidebarCollapsed?: boolean;
  showSidebarToggle?: boolean;
  onToggleSidebar?: () => void;
  onOpenSettings?: () => void;
  onOpenCaseGraph?: () => void;
  showWorkspaceButton?: boolean;
  showWorkspacePanel?: boolean;
  canOpenWorkspace?: boolean;
  onOpenMedia?: (item: MediaItem) => void;
  onSessionReady?: (context: ChatWorkspaceRenderContext) => void;
  headerSlot?: (context: ChatWorkspaceRenderContext) => ReactNode;
  contextSlot?: (context: ChatWorkspaceRenderContext) => ReactNode;
  topControlsSlot?: (context: ChatWorkspaceRenderContext) => ReactNode;
};

export const ChatWorkspace = memo(function ChatWorkspace({
  authResolved,
  authToken,
  currentUser,
  title,
  showFlash,
  previewActions,
  flashMessage = null,
  className = 'chat-workspace',
  threadWrapperClassName,
  previewOpen = false,
  immersivePreview = false,
  compact = false,
  showSidebar = true,
  sidebarCollapsed = false,
  showSidebarToggle = false,
  onToggleSidebar = noop,
  onOpenSettings = noop,
  onOpenCaseGraph = noop,
  showWorkspaceButton = true,
  showWorkspacePanel = true,
  canOpenWorkspace,
  onOpenMedia,
  onSessionReady,
  headerSlot,
  contextSlot,
  topControlsSlot,
}: ChatWorkspaceProps) {
  const workspaceRequestCounterRef = useRef(0);
  const connectionState = useAppSelector((state) => state.connectionState);
  const currentChatId = useAppSelector((state) => state.currentChatId);
  const workspacePanel = useAppSelector((state) => state.workspacePanel);
  const workspaceByChat = useAppSelector((state) => state.workspaceByChat);
  const currentWorkspace = currentChatId ? workspaceByChat[currentChatId] ?? null : null;
  const panelWorkspace = workspacePanel.chatId ? workspaceByChat[workspacePanel.chatId] ?? null : null;
  const websocketSession = useWebsocketSession({
    authResolved,
    showFlash,
  });
  const availableSkills = useAvailableSkills({
    authResolved,
    authToken,
    currentUser,
  });
  const {
    runtime,
    sessionsById,
    isReadOnlySession,
    pendingAskUserPrompt,
    activeTurn,
    sendAppendMessage,
  } = useWebuiRuntime({
    showFlash,
    actions: websocketSession,
  });
  const threadSuggestions = useMemo(() => [...DEFAULT_THREAD_SUGGESTIONS], []);
  const aui = useAui({
    suggestions: Suggestions(threadSuggestions),
  });
  const workspaceFileCount = currentWorkspace?.files.length ?? 0;
  const workspaceLoading = Boolean(
    currentChatId && workspacePanel.loading && workspacePanel.chatId === currentChatId,
  );
  const workspaceEnabled = canOpenWorkspace ?? Boolean(currentChatId);

  const handleOpenWorkspace = useCallback(() => {
    if (!currentChatId) {
      return;
    }
    const chatId = currentChatId;
    workspaceRequestCounterRef.current += 1;
    const requestId = workspaceRequestCounterRef.current;
    appStore.dispatch({ type: 'workspace.open', chatId });
    appStore.dispatch({ type: 'workspace.loading', chatId, requestId });
    loadSessionWorkspace(chatId, authToken)
      .then((workspace) => {
        appStore.dispatch({ type: 'workspace.loaded', chatId, requestId, workspace });
      })
      .catch((error: unknown) => {
        appStore.dispatch({
          type: 'workspace.failed',
          chatId,
          requestId,
          error: error instanceof Error ? error.message : '加载工作空间失败',
        });
      });
  }, [authToken, currentChatId]);

  const handleOpenWorkspaceFile = useCallback((file: SessionWorkspaceFile) => {
    onOpenMedia?.({ url: file.url, name: file.name, mime: file.mime });
  }, [onOpenMedia]);

  const renderContext = useMemo<ChatWorkspaceRenderContext>(() => ({
    currentChatId,
    availableSkills,
    sendAppendMessage,
    workspaceFileCount,
    workspaceLoading,
    websocketSession,
  }), [availableSkills, currentChatId, sendAppendMessage, websocketSession, workspaceFileCount, workspaceLoading]);

  useEffect(() => {
    onSessionReady?.(renderContext);
  }, [onSessionReady, renderContext]);

  const threadContent = (
    <ChatThreadContent
      title={title}
      flashMessage={flashMessage}
      activeTurn={activeTurn}
      pendingAskUserPrompt={pendingAskUserPrompt}
      connectionState={connectionState}
      currentChatId={currentChatId}
      isReadOnlySession={isReadOnlySession}
      onAnswer={(answer) => {
        void sendAppendMessage(buildTextAppendMessage(answer));
      }}
      availableSkills={availableSkills}
      compact={compact}
      sidebarCollapsed={sidebarCollapsed}
      showSidebarToggle={showSidebarToggle}
      onToggleSidebar={onToggleSidebar}
      canOpenWorkspace={workspaceEnabled}
      workspaceFileCount={workspaceFileCount}
      workspaceLoading={workspaceLoading}
      onOpenWorkspace={handleOpenWorkspace}
      showWorkspaceButton={showWorkspaceButton}
      topControlsSlot={topControlsSlot?.(renderContext)}
    />
  );

  const resolvedClassName = `${className}${previewOpen ? ' preview-open' : ''}${immersivePreview ? ' immersive-preview' : ''}`;

  return (
    <DetailPreviewContext.Provider value={previewActions}>
      <AssistantRuntimeProvider runtime={runtime} aui={aui}>
        <div className={resolvedClassName}>
          {showSidebar ? (
            <ChatSidebar
              title={title}
              sidebarCollapsed={sidebarCollapsed}
              activeThreadId={currentChatId}
              sessionsById={sessionsById}
              connectionState={connectionState}
              onOpenSettings={onOpenSettings}
              onOpenCaseGraph={onOpenCaseGraph}
            />
          ) : null}

          {headerSlot?.(renderContext)}
          {contextSlot?.(renderContext)}

          {threadWrapperClassName ? (
            <div className={threadWrapperClassName}>{threadContent}</div>
          ) : threadContent}

          {showWorkspacePanel ? (
            <WorkspacePanel
              open={workspacePanel.open}
              loading={workspacePanel.loading}
              error={workspacePanel.error}
              workspace={panelWorkspace}
              onClose={() => appStore.dispatch({ type: 'workspace.close' })}
              onOpenFile={handleOpenWorkspaceFile}
            />
          ) : null}
        </div>
      </AssistantRuntimeProvider>
    </DetailPreviewContext.Provider>
  );
});

function noop() {}
