import { connectionStatusText } from '../../ui-utils';
import { SidebarThreadList } from './thread-shell';
import type { ConnectionState, SessionSummary } from '../../types';

export function ChatSidebar({
  title,
  sidebarCollapsed,
  activeThreadId,
  sessionsById,
  connectionState,
  onOpenSettings,
  onCloseSidebar,
}: {
  title: string;
  sidebarCollapsed: boolean;
  activeThreadId: string | null;
  sessionsById: Map<string, SessionSummary>;
  connectionState: ConnectionState;
  onOpenSettings: () => void;
  onCloseSidebar: () => void;
}) {
  return (
    <aside className={`sidebar${sidebarCollapsed ? ' collapsed' : ''}`}>
      <div className="sidebar-header">
        <div className="brand">
          <div className="brand-mark">
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12 2c0 0 1.2 5.4 6 6-4.8 1.2-6 6-6 6s-1.2-5.4-6-6c4.8-1.2 6-6 6-6z" />
              <path d="M19.5 15c0 0 .6 2.7 2.5 3-1.9.6-2.5 3-2.5 3s-.6-2.7-2.5-3c1.9-.6 2.5-3 2.5-3z" opacity=".72" />
              <path d="M4.5 4c0 0 .4 1.8 1.5 2-1.1.4-1.5 2-1.5 2s-.4-1.8-1.5-2c1.1-.4 1.5-2 1.5-2z" opacity=".48" />
            </svg>
          </div>
          <div className="brand-title">{title}</div>
        </div>
        <button className="sidebar-close" type="button" aria-label="收起侧边栏" onClick={onCloseSidebar}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
      <div className="sidebar-history">
        <SidebarThreadList
          activeThreadId={activeThreadId}
          isVisibleThread={(threadId) => sessionsById.has(threadId)}
          canDeleteThread={(threadId) => !sessionsById.get(threadId)?.read_only}
        />
      </div>
      <div className="sidebar-footer">
        <div className={`status-badge ${connectionState}`}>
          <span className="status-dot" />
          <span>{connectionStatusText(connectionState)}</span>
        </div>
        <button
          className="icon-button"
          type="button"
          aria-label="打开设置"
          onClick={onOpenSettings}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 15.5A3.5 3.5 0 1012 8.5a3.5 3.5 0 000 7z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.4 15a1.7 1.7 0 00.34 1.87l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.7 1.7 0 00-1.87-.34 1.7 1.7 0 00-1.03 1.56V21a2 2 0 01-4 0v-.09A1.7 1.7 0 008.98 19.35a1.7 1.7 0 00-1.87.34l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.7 1.7 0 004.63 15a1.7 1.7 0 00-1.56-1.03H3a2 2 0 010-4h.09A1.7 1.7 0 004.65 8.98a1.7 1.7 0 00-.34-1.87l-.06-.06a2 2 0 012.83-2.83l.06.06A1.7 1.7 0 008.98 4.65 1.7 1.7 0 0010.01 3.09V3a2 2 0 014 0v.09a1.7 1.7 0 001.03 1.56 1.7 1.7 0 001.87-.34l.06-.06a2 2 0 012.83 2.83l-.06.06A1.7 1.7 0 0019.35 8.98c.2.63.81 1.05 1.47 1.03H21a2 2 0 010 4h-.09A1.7 1.7 0 0019.4 15z" />
          </svg>
        </button>
      </div>
    </aside>
  );
}
