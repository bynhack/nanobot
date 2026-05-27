import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';

import { AuthTokenModal } from './auth-token-modal';
import { readAppearanceMode, readUiTheme } from './app-helpers';
import { bootstrap, DETAIL_PANEL_WIDTH_KEY, appStore, useAppSelector } from './app-state';
import { loadSessionWorkspace } from './api';
import { ChatWorkspace } from './components/chat/chat-workspace';
import { ConversationContentPane } from './components/chat/conversation-content-pane';
import { DetailPreviewContext, type ToolDetailPayload } from './components/chat/detail-preview-context';
import { DEFAULT_UI_THEME } from './components/settings/types';
import type { DetailView } from './detail-preview-pane';
import { LoginPage } from './login-page';
import { SettingsScreen, type AppearanceMode, type UiTheme } from './settings-page';
import { STORAGE_KEYS } from './store';
import './styles.css';
import type { MediaItem, SessionWorkspaceFile } from './types';
import { useAuthSession } from './use-auth-session';
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

type AppView = 'chat' | 'settings';

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
  const workspacePanel = useAppSelector((state) => state.workspacePanel);
  const workspaceByChat = useAppSelector((state) => state.workspaceByChat);
  const [flashMessage, setFlashMessage] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [previewSidebarOpen, setPreviewSidebarOpen] = useState(false);
  const [appView, setAppView] = useState<AppView>('chat');
  const [detailView, setDetailView] = useState<DetailView | null>(null);
  const [contentPanelPinnedOpen, setContentPanelPinnedOpen] = useState(false);
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
  const workspaceRequestCounterRef = useRef(0);

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

  const currentWorkspace = currentChatId ? workspaceByChat[currentChatId] ?? null : null;
  const panelWorkspace = workspacePanel.chatId ? workspaceByChat[workspacePanel.chatId] ?? null : null;
  const workspacePanelOpen = appView === 'chat' && workspacePanel.open;
  const workspaceLoading = Boolean(
    currentChatId && workspacePanel.loading && workspacePanel.chatId === currentChatId,
  );
  const workspaceFileCount = currentWorkspace?.files.length ?? 0;
  const contentPanelOpen = appView === 'chat' && (contentPanelPinnedOpen || Boolean(detailView) || workspacePanelOpen);
  const previewOpen = contentPanelOpen;
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
    setDetailPanelWidth(() =>
      clampDetailWidth(
        preferredWidth,
        window.innerWidth,
        shouldUseImmersivePreview(window.innerWidth),
        false,
      ),
    );
  }, []);

  const openMedia = useCallback((item: MediaItem) => {
    setAppView('chat');
    ensurePreferredDetailWidth();
    setContentPanelPinnedOpen(true);
    setDetailView({ type: 'media', item });
  }, [ensurePreferredDetailWidth]);

  const openTool = useCallback((title: string, payload: ToolDetailPayload) => {
    setAppView('chat');
    ensurePreferredDetailWidth();
    setContentPanelPinnedOpen(true);
    setDetailView({ type: 'tool', title, payload });
  }, [ensurePreferredDetailWidth]);

  const openWorkspace = useCallback(() => {
    if (!currentChatId) {
      return;
    }
    setAppView('chat');
    ensurePreferredDetailWidth();
    setContentPanelPinnedOpen(true);
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
  }, [authToken, currentChatId, ensurePreferredDetailWidth]);

  const closeWorkspacePanel = useCallback(() => {
    appStore.dispatch({ type: 'workspace.close' });
  }, []);

  const openWorkspaceFile = useCallback((file: SessionWorkspaceFile) => {
    openMedia({ url: file.url, name: file.name, mime: file.mime });
  }, [openMedia]);

  const closeContentDetail = useCallback(() => {
    setDetailView(null);
  }, []);

  const closeContentPanel = useCallback(() => {
    setContentPanelPinnedOpen(false);
    setDetailView(null);
    appStore.dispatch({ type: 'workspace.close' });
  }, []);

  const toggleContentPanel = useCallback(() => {
    if (contentPanelOpen) {
      closeContentPanel();
      return;
    }
    setAppView('chat');
    ensurePreferredDetailWidth();
    setContentPanelPinnedOpen(true);
  }, [closeContentPanel, contentPanelOpen, ensurePreferredDetailWidth]);

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
    setContentPanelPinnedOpen(false);
  }, [currentChatId]);

  useEffect(() => {
    setPreviewSidebarOpen(false);
  }, [currentChatId]);

  useEffect(() => {
    if (appView !== 'chat') {
      setPreviewSidebarOpen(false);
      setDetailView(null);
      appStore.dispatch({ type: 'workspace.close' });
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
        <ChatWorkspace
          authResolved={authResolved}
          authToken={authToken}
          currentUser={currentUser}
          title={bootstrap.title}
          flashMessage={flashMessage}
          onOpenSettings={handleOpenSettings}
          sidebarCollapsed={effectiveSidebarCollapsed}
          onToggleSidebar={handleToggleSidebar}
          previewOpen={previewOpen}
          immersivePreview={immersivePreview}
          showFlash={showFlash}
          previewActions={previewActions}
          onOpenMedia={openMedia}
          showWorkspacePanel={false}
          workspaceFileCount={workspaceFileCount}
          workspaceLoading={workspaceLoading}
          onOpenWorkspace={openWorkspace}
          contentPanelOpen={contentPanelOpen}
          onToggleContentPanel={toggleContentPanel}
        />

        <ConversationContentPane
          detailView={detailView}
          immersive={immersivePreview}
          open={contentPanelOpen}
          width={detailPanelWidth}
          token={authToken}
          workspaceAvailable={Boolean(currentChatId)}
          workspaceOpen={workspacePanelOpen}
          workspaceLoading={workspaceLoading}
          workspaceError={workspacePanel.error}
          workspace={panelWorkspace}
          workspaceFileCount={workspaceFileCount}
          onOpenWorkspace={openWorkspace}
          onCloseWorkspace={closeWorkspacePanel}
          onOpenWorkspaceFile={openWorkspaceFile}
          onCloseDetail={closeContentDetail}
          onResizeStart={() => setResizingDetailPanel(true)}
        />

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
