import { useEffect, useMemo, useState } from 'react';

import { DetailPreviewPane, type DetailView } from '../../detail-preview-pane';
import type { SessionWorkspace, SessionWorkspaceFile } from '../../types';
import { WorkspacePanel } from './workspace-panel';

type ContentTab = 'launcher' | 'viewer' | 'files';

export function ConversationContentPane({
  detailView,
  open,
  immersive,
  width,
  token,
  workspaceAvailable,
  workspaceOpen,
  workspaceLoading,
  workspaceError,
  workspace,
  workspaceFileCount,
  onOpenWorkspace,
  onCloseWorkspace,
  onOpenWorkspaceFile,
  onCloseDetail,
  onResizeStart,
}: {
  detailView: DetailView | null;
  open: boolean;
  immersive: boolean;
  width: number;
  token: string;
  workspaceAvailable: boolean;
  workspaceOpen: boolean;
  workspaceLoading: boolean;
  workspaceError: string | null;
  workspace: SessionWorkspace | null;
  workspaceFileCount: number;
  onOpenWorkspace: () => void;
  onCloseWorkspace: () => void;
  onOpenWorkspaceFile: (file: SessionWorkspaceFile) => void;
  onCloseDetail: () => void;
  onResizeStart: () => void;
}) {
  const [activeTab, setActiveTab] = useState<ContentTab>('launcher');
  const viewerKey = detailView
    ? detailView.type === 'media'
      ? `media:${detailView.item.url}`
      : `tool:${detailView.title}`
    : '';

  useEffect(() => {
    if (!open) {
      setActiveTab('launcher');
    }
  }, [open]);

  useEffect(() => {
    if (detailView) {
      setActiveTab('viewer');
    }
  }, [detailView, viewerKey]);

  useEffect(() => {
    if (!detailView && workspaceOpen) {
      setActiveTab('files');
    }
  }, [detailView, workspaceOpen]);

  useEffect(() => {
    if (activeTab === 'viewer' && !detailView) {
      setActiveTab(workspaceOpen ? 'files' : 'launcher');
      return;
    }
    if (activeTab === 'files' && !workspaceOpen) {
      setActiveTab(detailView ? 'viewer' : 'launcher');
    }
  }, [activeTab, detailView, workspaceOpen]);

  const tabs = (
    <>
      {detailView ? (
        <div
          className={`detail-workspace-tab detail-workspace-tab--closable${activeTab === 'viewer' ? ' is-active' : ''}`}
          role="tab"
          aria-selected={activeTab === 'viewer'}
        >
          <button
            className="detail-workspace-tab-label"
            type="button"
            onClick={() => setActiveTab('viewer')}
          >
            <span>查看器</span>
          </button>
          <button
            className="detail-workspace-tab-close"
            type="button"
            aria-label="关闭查看器"
            onClick={onCloseDetail}
          >
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      ) : null}
      {workspaceOpen ? (
        <div
          className={`detail-workspace-tab detail-workspace-tab--closable${activeTab === 'files' ? ' is-active' : ''}`}
          role="tab"
          aria-selected={activeTab === 'files'}
        >
          <button
            className="detail-workspace-tab-label"
            type="button"
            onClick={() => setActiveTab('files')}
          >
            <span>文件</span>
            {workspaceFileCount > 0 ? <em>{workspaceFileCount}</em> : null}
          </button>
          <button
            className="detail-workspace-tab-close"
            type="button"
            aria-label="关闭文件"
            onClick={onCloseWorkspace}
          >
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      ) : null}
      <button
        className="detail-workspace-add"
        type="button"
        aria-label="添加内容页"
        onClick={() => setActiveTab('launcher')}
      >
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M8 3v10M3 8h10" strokeLinecap="round" />
        </svg>
      </button>
    </>
  );

  const mainContent = useMemo(() => {
    if (activeTab === 'viewer' && detailView) {
      return null;
    }
    if (activeTab === 'files') {
      return (
        <WorkspacePanel
          open={true}
          loading={workspaceLoading}
          error={workspaceError}
          workspace={workspace}
          onClose={onCloseWorkspace}
          onOpenFile={onOpenWorkspaceFile}
        />
      );
    }
    return (
      <div className="content-launcher">
        <button
          className="content-launcher-card"
          type="button"
          disabled={!workspaceAvailable || workspaceLoading}
          onClick={() => {
            setActiveTab('files');
            if (!workspaceOpen) {
              onOpenWorkspace();
            }
          }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H10l2 2h6.5A2.5 2.5 0 0 1 21 9.5v7A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5v-9Z" />
          </svg>
          <strong>{workspaceLoading ? '读取中' : '文件'}</strong>
          <span>浏览工作空间文件</span>
        </button>
      </div>
    );
  }, [
    activeTab,
    detailView,
    onCloseWorkspace,
    onOpenWorkspace,
    onOpenWorkspaceFile,
    workspace,
    workspaceAvailable,
    workspaceError,
    workspaceLoading,
    workspaceOpen,
  ]);

  return (
    <DetailPreviewPane
      detailView={activeTab === 'viewer' ? detailView : null}
      immersive={immersive}
      open={open}
      width={width}
      token={token}
      headerTabs={tabs}
      mainContent={mainContent ?? undefined}
      emptyTitle="内容区"
      emptyMessage="从上方加号选择要打开的内容。"
      onClose={onCloseDetail}
      onResizeStart={onResizeStart}
    />
  );
}
