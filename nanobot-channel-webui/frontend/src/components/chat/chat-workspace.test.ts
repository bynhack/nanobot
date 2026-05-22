import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const projectRoot = resolve(__dirname, '../../..');

function readSource(path: string): string {
  return readFileSync(resolve(projectRoot, path), 'utf8');
}

describe('ChatWorkspace component boundary', () => {
  it('keeps primary chat and case-graph chat on the shared workspace component', () => {
    const appSource = readSource('src/app.tsx');
    const caseGraphSource = readSource('src/case-graph/workbench.tsx');

    expect(appSource).toContain("from './components/chat/chat-workspace'");
    expect(caseGraphSource).toContain("from '../components/chat/chat-workspace'");

    for (const source of [appSource, caseGraphSource]) {
      expect(source).not.toMatch(/import .*AssistantRuntimeProvider.* from '@assistant-ui\/react'/);
      expect(source).not.toMatch(/from ['"].*thread-content['"]/);
      expect(source).not.toMatch(/from ['"].*workspace-panel['"]/);
      expect(source).not.toContain('<AssistantRuntimeProvider');
      expect(source).not.toContain('<ChatThreadContent');
      expect(source).not.toContain('<WorkspacePanel');
    }
  });

  it('keeps case-graph fullscreen on the shared chat workbench without the primary sidebar', () => {
    const caseGraphSource = readSource('src/case-graph/workbench.tsx');
    const fullscreenBlock = caseGraphSource.slice(
      caseGraphSource.indexOf('case-graph-chat-fullscreen-mask'),
      caseGraphSource.indexOf('{newGraphDialogOpen'),
    );

    expect(fullscreenBlock).toContain('<ChatWorkspace');
    expect(fullscreenBlock).toContain('showSidebar={false}');
    expect(fullscreenBlock).toContain('showSidebarToggle={false}');
    expect(fullscreenBlock).toContain('showWorkspacePanel={true}');
    expect(fullscreenBlock).toContain('showWorkspaceButton={true}');
    expect(fullscreenBlock).toContain('<DetailPreviewPane');
    expect(fullscreenBlock).toContain('onResizeStart={() => setResizingDetailPanel(true)}');
    expect(fullscreenBlock).toContain('topControlsSlot={renderFullscreenTopControls}');
    expect(fullscreenBlock).not.toContain('headerSlot=');
    expect(fullscreenBlock).not.toContain('case-graph-chat-fullscreen-header');
    expect(caseGraphSource).not.toContain('setPreviewSidebarOpen');
    expect(caseGraphSource).not.toContain('previewSidebarOpen');
    expect(caseGraphSource).not.toContain('setChatFullscreenSidebarCollapsed');
    expect(caseGraphSource).not.toContain('chatFullscreenSidebarCollapsed');
  });

  it('keeps graph edge selection from being overwritten by node focus', () => {
    const graphCanvasSource = readSource('src/case-graph/graph-canvas.tsx');
    const edgeClickBlock = graphCanvasSource.slice(
      graphCanvasSource.indexOf("graph.on('edge:click'"),
      graphCanvasSource.indexOf("graph.on('canvas:click'"),
    );
    const focusEffectBlock = graphCanvasSource.slice(
      graphCanvasSource.indexOf('if (selectedEdge)'),
      graphCanvasSource.indexOf('if (selectedNode)'),
    );

    expect(edgeClickBlock).toContain('setActiveNodeId(null)');
    expect(edgeClickBlock).toContain('setActiveEdgeId(edgeId)');
    expect(edgeClickBlock).toContain('onOpenEdgeDetailRef.current(edgeId, edgeFocus ?? undefined)');
    expect(focusEffectBlock).toContain("type: 'edge'");
    expect(focusEffectBlock).toContain('from: selectedEdge.source');
    expect(focusEffectBlock).toContain('to: selectedEdge.target');
  });

  it('syncs edge focus on the same click that opens edge detail', () => {
    const graphCanvasSource = readSource('src/case-graph/graph-canvas.tsx');
    const workbenchSource = readSource('src/case-graph/workbench.tsx');
    const edgeClickBlock = graphCanvasSource.slice(
      graphCanvasSource.indexOf("graph.on('edge:click'"),
      graphCanvasSource.indexOf("graph.on('canvas:click'"),
    );

    expect(edgeClickBlock).toContain('const edgeFocus = buildEdgeFocusPayload');
    expect(edgeClickBlock).toContain('onOpenEdgeDetailRef.current(edgeId, edgeFocus ?? undefined)');
    expect(workbenchSource).toContain('const handleOpenEdgeDetail = useCallback((edgeId: string, edgeFocus?: CaseGraphConversationFocus)');
    expect(workbenchSource).toContain("if (edgeFocus?.type === 'edge')");
    expect(workbenchSource).toContain('syncGraphContext(edgeFocus)');
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
