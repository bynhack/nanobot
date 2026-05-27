import { AssistantRuntimeProvider, Suggestions, useAui, type AppendMessage } from '@assistant-ui/react';
import { memo, useCallback, useEffect, useMemo, type ReactNode } from 'react';

import { buildTextAppendMessage } from '../../app-helpers';
import { appStore, useAppSelector } from '../../app-state';
import { DEFAULT_THREAD_SUGGESTIONS } from '../../assistant-ui-runtime';
import type { SkillCandidate } from '../../skill-quick-select';
import type { AuthUser, MediaItem, SessionWorkspaceFile } from '../../types';
import { useAvailableSkills } from '../../use-available-skills';
import { useWebsocketSession } from '../../use-websocket-session';
import { useWebuiRuntime } from '../../use-webui-runtime';
import { DetailPreviewContext, type DetailActions } from './detail-preview-context';
import { CaseGraphActionContext, type CaseGraphActionContextValue } from './case-graph-action-context';
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
  showWorkspaceButton?: boolean;
  showWorkspacePanel?: boolean;
  canOpenWorkspace?: boolean;
  workspaceFileCount?: number;
  workspaceLoading?: boolean;
  onOpenWorkspace?: () => void;
  contentPanelOpen?: boolean;
  onToggleContentPanel?: () => void;
  showContentHeader?: boolean;
  showContentPanelToggle?: boolean;
  onOpenMedia?: (item: MediaItem) => void;
  onSessionReady?: (context: ChatWorkspaceRenderContext) => void;
  headerSlot?: (context: ChatWorkspaceRenderContext) => ReactNode;
  contextSlot?: (context: ChatWorkspaceRenderContext) => ReactNode;
  topControlsSlot?: (context: ChatWorkspaceRenderContext) => ReactNode;
  composerTopSlot?: (context: ChatWorkspaceRenderContext) => ReactNode;
  useDefaultSuggestions?: boolean;
  showThreadWelcome?: boolean;
  caseGraphActions?: CaseGraphActionContextValue | null;
  prepareOutgoingMessage?: (message: AppendMessage, context: { availableSkills: SkillCandidate[] }) => AppendMessage;
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
  showWorkspacePanel = true,
  workspaceFileCount: workspaceFileCountProp,
  workspaceLoading: workspaceLoadingProp,
  contentPanelOpen = false,
  onToggleContentPanel = noop,
  showContentHeader = true,
  showContentPanelToggle = true,
  onOpenMedia,
  onSessionReady,
  headerSlot,
  contextSlot,
  topControlsSlot,
  composerTopSlot,
  useDefaultSuggestions = true,
  showThreadWelcome = true,
  caseGraphActions = null,
  prepareOutgoingMessage,
}: ChatWorkspaceProps) {
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
  const prepareRuntimeMessage = useCallback(
    (message: AppendMessage) => prepareOutgoingMessage?.(message, { availableSkills }) ?? message,
    [availableSkills, prepareOutgoingMessage],
  );
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
    prepareOutgoingMessage: prepareRuntimeMessage,
  });
  const threadSuggestions = useMemo(
    () => (useDefaultSuggestions ? [...DEFAULT_THREAD_SUGGESTIONS] : []),
    [useDefaultSuggestions],
  );
  const aui = useAui({
    suggestions: Suggestions(threadSuggestions),
  });
  const localWorkspaceFileCount = currentWorkspace?.files.length ?? 0;
  const localWorkspaceLoading = Boolean(
    currentChatId && workspacePanel.loading && workspacePanel.chatId === currentChatId,
  );
  const workspaceFileCount = workspaceFileCountProp ?? localWorkspaceFileCount;
  const workspaceLoading = workspaceLoadingProp ?? localWorkspaceLoading;
  const conversationTitle = currentChatId
    ? sessionsById.get(currentChatId)?.preview?.trim() || title
    : title;

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
      conversationTitle={conversationTitle}
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
      contentPanelOpen={contentPanelOpen}
      onToggleContentPanel={onToggleContentPanel}
      showContentHeader={showContentHeader}
      showContentPanelToggle={showContentPanelToggle}
      topControlsSlot={topControlsSlot?.(renderContext)}
      composerTopSlot={composerTopSlot?.(renderContext)}
      showThreadWelcome={showThreadWelcome}
    />
  );

  const resolvedClassName = `${className}${previewOpen ? ' preview-open' : ''}${immersivePreview ? ' immersive-preview' : ''}`;

  return (
    <DetailPreviewContext.Provider value={previewActions}>
      <CaseGraphActionContext.Provider value={caseGraphActions}>
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
      </CaseGraphActionContext.Provider>
    </DetailPreviewContext.Provider>
  );
});

function noop() {}
