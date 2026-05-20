import { MessageSquareText, Network } from 'lucide-react';

export type WorkspaceMode = 'chat' | 'case_graph';

interface WorkspaceModeSwitchProps {
  activeMode: WorkspaceMode;
  onSelectChat?: () => void;
  onSelectCaseGraph?: () => void;
  className?: string;
}

export function WorkspaceModeSwitch({
  activeMode,
  onSelectChat,
  onSelectCaseGraph,
  className,
}: WorkspaceModeSwitchProps) {
  return (
    <div className={`workspace-mode-switch${className ? ` ${className}` : ''}`} aria-label="工作模式">
      <button
        type="button"
        className={`workspace-mode-button${activeMode === 'chat' ? ' is-active' : ''}`}
        aria-pressed={activeMode === 'chat'}
        onClick={onSelectChat}
      >
        <MessageSquareText size={16} />
        <span>对话</span>
      </button>
      <button
        type="button"
        className={`workspace-mode-button${activeMode === 'case_graph' ? ' is-active' : ''}`}
        aria-pressed={activeMode === 'case_graph'}
        onClick={onSelectCaseGraph}
      >
        <Network size={16} />
        <span>上图</span>
      </button>
    </div>
  );
}
