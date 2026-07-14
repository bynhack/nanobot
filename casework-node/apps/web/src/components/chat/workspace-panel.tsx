import type { SessionWorkspace, SessionWorkspaceFile } from '../../types';

export function WorkspacePanel({
  open,
  loading,
  error,
  workspace,
  onClose,
  onOpenFile,
}: {
  open: boolean;
  loading: boolean;
  error: string | null;
  workspace: SessionWorkspace | null;
  onClose: () => void;
  onOpenFile: (file: SessionWorkspaceFile) => void;
}) {
  if (!open) {
    return null;
  }

  const files = workspace?.files ?? [];

  return (
    <aside className="workspace-panel" aria-label="会话工作空间">
      <div className="workspace-panel-header">
        <div className="workspace-panel-title-block">
          <h2 className="workspace-panel-title">工作空间</h2>
          <p className="workspace-panel-subtitle">
            {loading ? '正在读取当前会话文件' : `${files.length} 个交付文件`}
          </p>
        </div>
        <button className="workspace-panel-close" type="button" aria-label="关闭工作空间" onClick={onClose}>
          ×
        </button>
      </div>

      <div className="workspace-panel-body">
        {loading ? (
          <div className="workspace-panel-state">正在加载工作空间...</div>
        ) : error ? (
          <div className="workspace-panel-state error">{error}</div>
        ) : files.length === 0 ? (
          <div className="workspace-panel-state">当前会话还没有最终交付文件</div>
        ) : (
          <div className="workspace-file-list">
            {files.map((file) => (
              <button
                key={file.id}
                className="workspace-file-row"
                type="button"
                onClick={() => onOpenFile(file)}
              >
                <span className="workspace-file-name">{file.name}</span>
                <span className="workspace-file-meta">
                  <span>{file.mime || '未知类型'}</span>
                  <span>{formatDeliveredAt(file.deliveredAt)}</span>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}

function formatDeliveredAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
