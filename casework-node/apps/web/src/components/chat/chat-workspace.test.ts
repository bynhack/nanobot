import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const projectRoot = resolve(__dirname, '../../..');

function readSource(path: string): string {
  return readFileSync(resolve(projectRoot, path), 'utf8');
}

describe('ChatWorkspace component boundary', () => {
  it('keeps case-graph chat on the shared workspace component without restoring the standalone chat entry', () => {
    const appSource = readSource('src/app.tsx');
    const caseGraphSource = readSource('src/case-graph/workbench.tsx');

    expect(appSource).not.toContain("from './components/chat/chat-workspace'");
    expect(appSource).toContain("useState<AppView>('case_graph')");
    expect(caseGraphSource).toContain("from '../components/chat/chat-workspace'");

    for (const source of [caseGraphSource]) {
      expect(source).not.toMatch(/import .*AssistantRuntimeProvider.* from '@assistant-ui\/react'/);
      expect(source).not.toMatch(/from ['"].*thread-content['"]/);
      expect(source).not.toMatch(/from ['"].*workspace-panel['"]/);
      expect(source).not.toContain('<AssistantRuntimeProvider');
      expect(source).not.toContain('<ChatThreadContent');
      expect(source).not.toContain('<WorkspacePanel');
    }
  });

  it('keeps case-graph chat as one stable workspace when toggling fullscreen', () => {
    const caseGraphSource = readSource('src/case-graph/workbench.tsx');
    const chatBlock = caseGraphSource.slice(
      caseGraphSource.indexOf('<aside className="case-graph-detail case-graph-chat-panel">'),
      caseGraphSource.indexOf('</aside>', caseGraphSource.indexOf('<aside className="case-graph-detail case-graph-chat-panel">')),
    );

    expect((caseGraphSource.match(/<ChatWorkspace(?:\s|>)/g) ?? []).length).toBe(1);
    expect(chatBlock).toContain('<ChatWorkspace');
    expect(chatBlock).toContain("className={chatFullscreen ? 'chat-workspace case-graph-chat-fullscreen-workspace' : 'case-graph-chat-workspace'}");
    expect(chatBlock).toContain("threadWrapperClassName={chatFullscreen ? 'case-graph-chat-thread case-graph-chat-thread--fullscreen' : 'case-graph-chat-thread'}");
    expect(chatBlock).toContain('showSidebar={false}');
    expect(chatBlock).toContain('showSidebarToggle={false}');
    expect(chatBlock).toContain('showWorkspacePanel={false}');
    expect(chatBlock).toContain('<ConversationContentPane');
    expect(chatBlock).toContain('onResizeStart={() => setResizingDetailPanel(true)}');
    expect(chatBlock).toContain('{chatFullscreen ? renderFullscreenTopControls() : null}');
    expect(chatBlock).toContain('showContentPanelToggle={false}');
    expect(chatBlock).toContain('showContentHeader={chatFullscreen}');
    expect(chatBlock).toContain('headerSlot={chatFullscreen ? undefined :');
    expect(chatBlock).not.toContain('contextSlot=');
    expect(chatBlock).toContain('useDefaultSuggestions={false}');
    expect(chatBlock).toContain('showThreadWelcome={false}');
    expect(chatBlock).toContain('composerTopSlot={renderComposerSuggestions}');
    expect(caseGraphSource).toContain('case-graph-chat-fullscreen-controls');
    expect(caseGraphSource).toContain('className="content-panel-toggle case-graph-chat-fullscreen-exit"');
    expect(caseGraphSource).not.toContain('setPreviewSidebarOpen');
    expect(caseGraphSource).not.toContain('previewSidebarOpen');
    expect(caseGraphSource).not.toContain('setChatFullscreenSidebarCollapsed');
    expect(caseGraphSource).not.toContain('chatFullscreenSidebarCollapsed');
  });

  it('keeps graph edge selection from being overwritten by node focus', () => {
    const graphCanvasSource = readSource('src/case-graph/graph-canvas.tsx');
    const edgeClickBlock = graphCanvasSource.slice(
      graphCanvasSource.indexOf('graph.on(EdgeEvent.CLICK'),
      graphCanvasSource.indexOf('graph.on(CanvasEvent.CLICK'),
    );
    const focusEffectBlock = graphCanvasSource.slice(
      graphCanvasSource.indexOf('if (selectedEdge)'),
      graphCanvasSource.indexOf('if (selectedNode)'),
    );

    expect(edgeClickBlock).toContain('setActiveNodeId(null)');
    expect(edgeClickBlock).toContain('setActiveEdgeId(edgeId)');
    expect(edgeClickBlock).toContain('edgeLookupRef.current.get(edgeId)');
    expect(edgeClickBlock).toContain('nodeLookupRef.current');
    expect(edgeClickBlock).toContain('onOpenEdgeDetailRef.current(edgeId, edgeFocus ?? undefined, edge)');
    expect(focusEffectBlock).toContain("type: 'edge'");
    expect(focusEffectBlock).toContain('from: selectedEdge.source');
    expect(focusEffectBlock).toContain('to: selectedEdge.target');
  });

  it('syncs edge focus on the same click that opens edge detail', () => {
    const graphCanvasSource = readSource('src/case-graph/graph-canvas.tsx');
    const workbenchSource = readSource('src/case-graph/workbench.tsx');
    const edgeClickBlock = graphCanvasSource.slice(
      graphCanvasSource.indexOf('graph.on(EdgeEvent.CLICK'),
      graphCanvasSource.indexOf('graph.on(CanvasEvent.CLICK'),
    );
    const focusChangeBlock = workbenchSource.slice(
      workbenchSource.indexOf('onFocusChange={(focus) => {'),
      workbenchSource.indexOf('onNodePositionsChange={(positions, reason) => {'),
    );

    expect(edgeClickBlock).toContain('const edgeFocus = buildEdgeFocusPayload');
    expect(edgeClickBlock).toContain('edgeLookupRef.current.get(edgeId)');
    expect(edgeClickBlock).toContain('nodeLookupRef.current');
    expect(edgeClickBlock).toContain('onOpenEdgeDetailRef.current(edgeId, edgeFocus ?? undefined, edge)');
    expect(workbenchSource).toContain("const handleOpenEdgeDetail = useCallback((edgeId: string, edgeFocus?: CaseGraphConversationFocus, edgeOverride?: CaseGraphData['edges'][number])");
    expect(workbenchSource).toContain("if (edgeFocus?.type === 'edge')");
    expect(workbenchSource).toContain('syncGraphContext(edgeFocus)');
    expect(focusChangeBlock).toContain("if (focus.type === 'edge')");
    expect(focusChangeBlock).toContain('fromName: focus.fromName || resolveNodeDisplayName');
    expect(focusChangeBlock).toContain('toName: focus.toName || resolveNodeDisplayName');
    expect(focusChangeBlock).toContain('syncGraphContext({');
  });

  it('clears stale case data before loading a newly selected case', () => {
    const caseGraphSource = readSource('src/case-graph/workbench.tsx');
    const caseChangeBlock = caseGraphSource.slice(
      caseGraphSource.indexOf('const handleCaseIdChange = useCallback((value: string) => {'),
      caseGraphSource.indexOf('const openNewGraphDialog = useCallback'),
    );

    expect(caseChangeBlock).toContain('setCaseIdDraft(value)');
    expect(caseChangeBlock).toContain("setAccountQuery('')");
    expect(caseChangeBlock).toContain('setAvailableAccounts([])');
    expect(caseChangeBlock).toContain('setSavedGraphs([])');
    expect(caseChangeBlock).toContain('setGraphTabs([])');
    expect(caseChangeBlock).toContain('setActiveTabId(null)');
    expect(caseChangeBlock).toContain('setConversationFocus(null)');
    expect(caseChangeBlock).toContain('setEdgeDetailOpen(false)');
    expect(caseChangeBlock).toContain('setDetailView(null)');
    expect(caseGraphSource).toContain('onCaseIdChange={handleCaseIdChange}');
  });

  it('binds the case-graph assistant session to the active graph snapshot', () => {
    const caseGraphSource = readSource('src/case-graph/workbench.tsx');
    const chatWorkspaceSource = readSource('src/components/chat/chat-workspace.tsx');

    expect(caseGraphSource).toContain('chatId: string;');
    expect(caseGraphSource).toContain('chatId: graph.chatId ||');
    expect(caseGraphSource).toContain('handleCaseGraphSessionReady');
    expect(caseGraphSource).toContain('context.websocketSession.switchThread(graphChatId)');
    expect(caseGraphSource).toContain('context.websocketSession.createServerThread()');
    expect(caseGraphSource).toContain('updateCaseGraphConfig(graphId, { chatId }, token)');
    expect(caseGraphSource).toContain('onSessionReady={handleCaseGraphSessionReady}');
    expect(chatWorkspaceSource).toContain('onSessionReady?:');
    expect(chatWorkspaceSource).toContain('websocketSession: ReturnType<typeof useWebsocketSession>');
  });
});
