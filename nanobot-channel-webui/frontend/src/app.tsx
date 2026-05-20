import { AssistantRuntimeProvider, Suggestions, useAui } from '@assistant-ui/react';
import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';

import { AuthTokenModal } from './auth-token-modal';
import { buildTextAppendMessage, readAppearanceMode, readUiTheme } from './app-helpers';
import { appStore, bootstrap, DETAIL_PANEL_WIDTH_KEY, useAppSelector } from './app-state';
import { loadSessionWorkspace } from './api';
import { DetailPreviewContext, type ToolDetailPayload } from './components/chat/detail-preview-context';
import { ChatSidebar } from './components/chat/sidebar';
import { ChatThreadContent } from './components/chat/thread-content';
import { WorkspacePanel } from './components/chat/workspace-panel';
import { WorkspaceModeSwitch } from './components/workspace-mode-switch';
import { DEFAULT_UI_THEME } from './components/settings/types';
import { CaseGraphWorkbench } from './case-graph/workbench';
import { DetailPreviewPane, type DetailView } from './detail-preview-pane';
import { LoginPage } from './login-page';
import { SettingsScreen, type AppearanceMode, type UiTheme } from './settings-page';
import { STORAGE_KEYS } from './store';
import './styles.css';
import type { MediaItem, SessionWorkspaceFile } from './types';
import { useAuthSession } from './use-auth-session';
import { useAvailableSkills } from './use-available-skills';
import { useWebsocketSession } from './use-websocket-session';
import { useWebuiRuntime } from './use-webui-runtime';
import { DEFAULT_THREAD_SUGGESTIONS } from './assistant-ui-runtime';
import {
  DETAIL_PANEL_MAX_WIDTH,
  DETAIL_PANEL_MIN_WIDTH,
  IMMERSIVE_DETAIL_PANEL_MIN_WIDTH,
  IMMERSIVE_CHAT_CONTENT_MAX,
  IMMERSIVE_CHAT_CONTENT_MIN,
  MOBILE_SIDEBAR_BREAKPOINT,
  SIDEBAR_EXPANDED_WIDTH,
  getPreferredDetailPanelWidth,
  shouldUseImmersivePreview,
} from './preview-layout';

type AppView = 'chat' | 'settings' | 'case_graph';

function clampDetailWidth(width: number, viewportWidth: number, immersive: boolean, sidebarOpen: boolean): number {
  if (!immersive) {
    return Math.min(DETAIL_PANEL_MAX_WIDTH, Math.max(DETAIL_PANEL_MIN_WIDTH, width));
  }

  const sidebarWidth = sidebarOpen ? SIDEBAR_EXPANDED_WIDTH : 0;
  const minWidth = Math.max(IMMERSIVE_DETAIL_PANEL_MIN_WIDTH, viewportWidth - sidebarWidth - IMMERSIVE_CHAT_CONTENT_MAX);
  const maxWidth = Math.min(DETAIL_PANEL_MAX_WIDTH, viewportWidth - sidebarWidth - IMMERSIVE_CHAT_CONTENT_MIN);
  return Math.min(maxWidth, Math.max(minWidth, width));
}

export function App() {
  const authToken = useAppSelector((state) => state.authToken);
  const connectionState = useAppSelector((state) => state.connectionState);
  const currentChatId = useAppSelector((state) => state.currentChatId);
  const [flashMessage, setFlashMessage] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [previewSidebarOpen, setPreviewSidebarOpen] = useState(false);
  const [appView, setAppView] = useState<AppView>('chat');
  const [detailView, setDetailView] = useState<DetailView | null>(null);
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  const [detailPanelWidth, setDetailPanelWidth] = useState(() => {
    const raw = window.localStorage.getItem(DETAIL_PANEL_WIDTH_KEY);
    const width = raw ? Number(raw) : 440;
    return Number.isFinite(width)
      ? Math.min(DETAIL_PANEL_MAX_WIDTH, Math.max(DETAIL_PANEL_MIN_WIDTH, width))
      : 440;
  });
  const [resizingDetailPanel, setResizingDetailPanel] = useState(false);
  const [appearanceMode, setAppearanceMode] = useState<AppearanceMode>(() => readAppearanceMode());
  const [uiTheme, setUiTheme] = useState<UiTheme>(() => readUiTheme(DEFAULT_UI_THEME));

  const flashTimerRef = useRef<number | null>(null);

  const showFlash = useCallback((message: string) => {
    setFlashMessage(message);
    if (flashTimerRef.current !== null) {
      window.clearTimeout(flashTimerRef.current);
    }
    flashTimerRef.current = window.setTimeout(() => {
      setFlashMessage(null);
    }, 3500);
  }, []);

  const {
    authModalOpen,
    setAuthModalOpen,
    draftToken,
    setDraftToken,
    currentUser,
    authBusy,
    authError,
    authResolved,
    handlePocketBaseLogin,
    handleLogout,
  } = useAuthSession(authToken);

  const previewOpen = appView === 'chat' && Boolean(detailView);
  const immersivePreview = previewOpen && shouldUseImmersivePreview(viewportWidth);
  const effectiveSidebarCollapsed = immersivePreview ? !previewSidebarOpen : sidebarCollapsed;
  const immersiveSidebarWidth = immersivePreview && previewSidebarOpen ? SIDEBAR_EXPANDED_WIDTH : 0;
  const immersiveChatContentWidth = immersivePreview
    ? Math.min(
        IMMERSIVE_CHAT_CONTENT_MAX,
        Math.max(IMMERSIVE_CHAT_CONTENT_MIN, viewportWidth - detailPanelWidth - immersiveSidebarWidth),
      )
    : null;
  const immersiveChatWorkspaceWidth =
    immersiveChatContentWidth === null ? null : immersiveChatContentWidth + immersiveSidebarWidth;

  const ensurePreferredDetailWidth = useCallback(() => {
    const preferredWidth = getPreferredDetailPanelWidth(window.innerWidth);
    setDetailPanelWidth((current) =>
      clampDetailWidth(
        Math.max(current, preferredWidth),
        window.innerWidth,
        shouldUseImmersivePreview(window.innerWidth),
        false,
      ),
    );
  }, []);

  const openMedia = useCallback((item: MediaItem) => {
    setAppView('chat');
    ensurePreferredDetailWidth();
    setDetailView({ type: 'media', item });
  }, [ensurePreferredDetailWidth]);

  const openTool = useCallback((title: string, payload: ToolDetailPayload) => {
    setAppView('chat');
    ensurePreferredDetailWidth();
    setDetailView({ type: 'tool', title, payload });
  }, [ensurePreferredDetailWidth]);

  const previewActions = useMemo(
    () => ({ openMedia, openTool }),
    [openMedia, openTool],
  );
  const handleOpenSettings = useCallback(() => {
    setPreviewSidebarOpen(false);
    setDetailView(null);
    setAppView('settings');
  }, []);
  const handleToggleSidebar = useCallback(() => {
    if (previewOpen && shouldUseImmersivePreview(window.innerWidth)) {
      setPreviewSidebarOpen((value) => !value);
      return;
    }
    setSidebarCollapsed((value) => !value);
  }, [previewOpen]);

  useEffect(() => {
    document.title = bootstrap.title;
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = appearanceMode;
    window.localStorage.setItem(STORAGE_KEYS.appearanceMode, appearanceMode);
  }, [appearanceMode]);

  useEffect(() => {
    document.documentElement.dataset.uiTheme = uiTheme;
    window.localStorage.setItem(STORAGE_KEYS.uiTheme, uiTheme);
  }, [uiTheme]);

  useEffect(() => {
    window.localStorage.setItem(DETAIL_PANEL_WIDTH_KEY, String(detailPanelWidth));
  }, [detailPanelWidth]);

  useEffect(() => {
    setDetailPanelWidth((current) => clampDetailWidth(current, viewportWidth, immersivePreview, previewSidebarOpen));
  }, [viewportWidth, immersivePreview, previewSidebarOpen]);

  useEffect(() => {
    setDetailView(null);
  }, [currentChatId]);

  useEffect(() => {
    setPreviewSidebarOpen(false);
  }, [currentChatId]);

  useEffect(() => {
    if (appView !== 'chat') {
      setPreviewSidebarOpen(false);
      setDetailView(null);
    }
  }, [appView]);

  useEffect(() => {
    if (!immersivePreview) {
      setPreviewSidebarOpen(false);
    }
  }, [immersivePreview]);

  useEffect(() => {
    const syncResponsiveSidebar = () => {
      const width = window.innerWidth;
      setViewportWidth(width);
      if (width <= MOBILE_SIDEBAR_BREAKPOINT) {
        setSidebarCollapsed(true);
        return;
      }
      setSidebarCollapsed(false);
    };
    syncResponsiveSidebar();
    window.addEventListener('resize', syncResponsiveSidebar);
    return () => window.removeEventListener('resize', syncResponsiveSidebar);
  }, []);

  useEffect(() => {
    if (!resizingDetailPanel) {
      return;
    }

    const onMouseMove = (event: MouseEvent) => {
      const nextWidth = window.innerWidth - event.clientX;
      setDetailPanelWidth(
        clampDetailWidth(
          nextWidth,
          window.innerWidth,
          shouldUseImmersivePreview(window.innerWidth),
          previewOpen && previewSidebarOpen,
        ),
      );
    };

    const onMouseUp = () => {
      setResizingDetailPanel(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);

    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [resizingDetailPanel]);

  return (
    <DetailPreviewContext.Provider value={previewActions}>
      <div
        className={`shell${previewOpen ? ' detail-open' : ''}${immersivePreview ? ' detail-immersive' : ''}${
          previewSidebarOpen ? ' preview-sidebar-open' : ''
        }`}
        style={
          immersiveChatWorkspaceWidth !== null && immersiveChatContentWidth !== null
            ? ({
                '--immersive-chat-workspace-width': `${immersiveChatWorkspaceWidth}px`,
                '--immersive-chat-content-width': `${immersiveChatContentWidth}px`,
              } as CSSProperties)
            : undefined
        }
      >
        {resizingDetailPanel ? <div className="detail-resize-overlay" aria-hidden="true" /> : null}
        {appView === 'case_graph' ? (
          <CaseGraphWorkbench
            token={authToken}
            onBack={() => setAppView('chat')}
            headerSlot={(
              <WorkspaceModeSwitch
                activeMode="case_graph"
                onSelectChat={() => setAppView('chat')}
              />
            )}
          />
        ) : (
          <>
            <ChatWorkspace
              authResolved={authResolved}
              authToken={authToken}
              currentUser={currentUser}
              title={bootstrap.title}
              flashMessage={flashMessage}
              onOpenSettings={handleOpenSettings}
              onOpenCaseGraph={() => setAppView('case_graph')}
              sidebarCollapsed={effectiveSidebarCollapsed}
              onToggleSidebar={handleToggleSidebar}
              previewOpen={previewOpen}
              immersivePreview={immersivePreview}
              showFlash={showFlash}
              onOpenMedia={openMedia}
            />

            <DetailPreviewPane
              detailView={detailView}
              immersive={immersivePreview}
              open={Boolean(detailView)}
              width={detailPanelWidth}
              token={authToken}
              onClose={() => setDetailView(null)}
              onResizeStart={() => setResizingDetailPanel(true)}
            />
          </>
        )}

        {appView === 'settings' ? (
          <SettingsScreen
            authRequired={bootstrap.authRequired}
            connectionState={connectionState}
            currentChatId={currentChatId}
            onBack={() => setAppView('chat')}
            onOpenAuth={() => setAuthModalOpen(true)}
            appearanceMode={appearanceMode}
            onAppearanceModeChange={setAppearanceMode}
            uiTheme={uiTheme}
            onUiThemeChange={setUiTheme}
            token={authToken}
            currentUser={currentUser}
            authMode={bootstrap.authMode}
            onLogout={handleLogout}
          />
        ) : null}

        {bootstrap.authMode === 'pocketbase' && (!authToken || !currentUser) ? (
          <LoginPage busy={authBusy} error={authError} onSubmit={handlePocketBaseLogin} />
        ) : null}

        {bootstrap.authMode !== 'pocketbase' ? (
          <AuthTokenModal
            open={authModalOpen}
            draftToken={draftToken}
            setDraftToken={setDraftToken}
            onClose={() => setAuthModalOpen(false)}
          />
        ) : null}
      </div>
    </DetailPreviewContext.Provider>
  );
}

const ChatWorkspace = memo(function ChatWorkspace({
  authResolved,
  authToken,
  currentUser,
  title,
  flashMessage,
  onOpenSettings,
  onOpenCaseGraph,
  sidebarCollapsed,
  onToggleSidebar,
  previewOpen,
  immersivePreview,
  showFlash,
  onOpenMedia,
}: {
  authResolved: boolean;
  authToken: string;
  currentUser: ReturnType<typeof useAuthSession>['currentUser'];
  title: string;
  flashMessage: string | null;
  onOpenSettings: () => void;
  onOpenCaseGraph: () => void;
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  previewOpen: boolean;
  immersivePreview: boolean;
  showFlash: (message: string) => void;
  onOpenMedia: (item: MediaItem) => void;
}) {
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
  const workspaceLoadingForCurrentChat = Boolean(
    currentChatId && workspacePanel.loading && workspacePanel.chatId === currentChatId,
  );
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
    onOpenMedia({ url: file.url, name: file.name, mime: file.mime });
  }, [onOpenMedia]);

  return (
    <AssistantRuntimeProvider runtime={runtime} aui={aui}>
      <div className={`chat-workspace${previewOpen ? ' preview-open' : ''}${immersivePreview ? ' immersive-preview' : ''}`}>
        <ChatSidebar
          title={title}
          sidebarCollapsed={sidebarCollapsed}
          activeThreadId={currentChatId}
          sessionsById={sessionsById}
          connectionState={connectionState}
          onOpenSettings={onOpenSettings}
          onOpenCaseGraph={onOpenCaseGraph}
        />

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
          compact={immersivePreview}
          sidebarCollapsed={sidebarCollapsed}
          showSidebarToggle={previewOpen || sidebarCollapsed}
          onToggleSidebar={onToggleSidebar}
          canOpenWorkspace={Boolean(currentChatId)}
          workspaceFileCount={workspaceFileCount}
          workspaceLoading={workspaceLoadingForCurrentChat}
          onOpenWorkspace={handleOpenWorkspace}
        />
        <WorkspacePanel
          open={workspacePanel.open}
          loading={workspacePanel.loading}
          error={workspacePanel.error}
          workspace={panelWorkspace}
          onClose={() => appStore.dispatch({ type: 'workspace.close' })}
          onOpenFile={handleOpenWorkspaceFile}
        />
      </div>
    </AssistantRuntimeProvider>
  );
});
