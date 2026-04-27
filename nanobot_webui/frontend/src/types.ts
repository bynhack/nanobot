export type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'auth_required';
export type TurnPhase = 'idle' | 'streaming' | 'running_tools' | 'finalizing' | 'completed';

export interface BootstrapConfig {
  title: string;
  authRequired: boolean;
}

export interface SessionSummary {
  chat_id: string;
  session_key?: string;
  channel?: string;
  read_only?: boolean;
  created_at: string | null;
  last_ts: string | null;
  preview: string;
  message_count: number;
}

export interface ToolHistoryItem {
  name: string;
  args: Record<string, unknown>;
  result: string;
  status: 'ok' | 'error';
}

export interface InteractiveSelectOption {
  label: string;
  value: string;
  description?: string;
  disabled?: boolean;
}

export interface InteractiveSelectPayload {
  title?: string;
  description?: string;
  options?: InteractiveSelectOption[];
  multiple?: boolean;
  searchable?: boolean;
  placeholder?: string;
}

export interface InteractiveInputPayload {
  title?: string;
  description?: string;
  placeholder?: string;
  multiline?: boolean;
  password?: boolean;
  required_input?: boolean;
}

export interface InteractiveResultPayload {
  confirmed?: boolean;
  selected?: string | string[];
  value?: string;
  [key: string]: unknown;
}

export interface InteractiveHistoryItem {
  id: string;
  kind: 'confirm' | 'select' | 'input' | string;
  payload: Record<string, unknown>;
  status: 'pending' | 'ok' | 'cancelled' | 'error' | string;
  result?: InteractiveResultPayload;
}

export interface MediaItem {
  url: string;
  name: string;
  mime?: string;
}

export interface UploadedAttachment extends MediaItem {
  path: string;
}

interface HistoryMessageBase {
  id?: string;
}

export type HistoryMessage =
  | (HistoryMessageBase & { type: 'user'; content: string; media?: MediaItem[] })
  | (HistoryMessageBase & { type: 'assistant'; content: string })
  | (HistoryMessageBase & { type: 'tools'; tools: ToolHistoryItem[] })
  | (HistoryMessageBase & InteractiveHistoryItem & { type: 'interactive' })
  | (HistoryMessageBase & { type: 'outbound'; content: string; media: MediaItem[] });

export interface InteractiveCommand {
  type: 'interactive.response' | 'interactive.cancel';
  id: string;
  result?: Record<string, unknown>;
}

export interface ToolCallStart {
  name: string;
  args: Record<string, unknown>;
  hint: string;
}

export interface ToolCallResult {
  name: string;
  status: 'ok' | 'error';
  detail: string;
}

export interface PendingToolBlock {
  tools: ToolCallStart[];
  durationMs?: number;
  results?: ToolCallResult[];
}

export interface ActiveTurnState {
  phase: TurnPhase;
  waiting: boolean;
  messageId: string | null;
  streamBuffer: string;
  streamId: string | null;
  pendingTools: PendingToolBlock | null;
  startedAtMs: number | null;
  lastDurationMs: number | null;
}

export interface AppState {
  bootstrap: BootstrapConfig;
  authToken: string;
  connectionState: ConnectionState;
  currentChatId: string | null;
  sessions: SessionSummary[];
  messagesByChat: Record<string, HistoryMessage[]>;
  activeTurns: Record<string, ActiveTurnState>;
}

export interface SettingsSkillSummary {
  name: string;
  source: 'workspace' | string;
  path: string;
  updated_at: string;
  description: string;
  enabled: boolean;
  can_toggle: boolean;
}

export interface SettingsSkillDetail extends SettingsSkillSummary {
  files: Array<{
    path: string;
    relative_path: string;
    name: string;
    size: number;
  }>;
}

export interface SettingsSkillFile {
  name: string;
  path: string;
  content: string;
  is_markdown: boolean;
}

export interface SettingsConfigSnapshot {
  workspace: string;
  config_path: string;
  config_exists: boolean;
  raw: string;
  sections: string[];
  parsed: Record<string, unknown>;
  omx_files: Array<{
    name: string;
    path: string;
    updated_at: string;
    size: number;
  }>;
}

export interface SettingsRuntimeSnapshot {
  workspace: string;
  session_count: number;
  metrics: Record<string, unknown>;
  recent_logs: Array<{
    name: string;
    path: string;
    updated_at: string;
    size: number;
  }>;
  recent_state_files: Array<{
    name: string;
    path: string;
    updated_at: string;
    size: number;
  }>;
  recent_plans: Array<{
    name: string;
    path: string;
    updated_at: string;
    size: number;
  }>;
  latest_log_preview: string;
}

export type ServerEvent =
  | { type: 'session.init'; chatId: string; sessionId: string }
  | { type: 'session.history'; chatId: string; messages: HistoryMessage[] }
  | { type: 'session.deleted'; chatId: string }
  | { type: 'interactive.request'; chatId: string; sessionKey: string; id: string; kind: string; payload: Record<string, unknown>; createdAt: number }
  | { type: 'interactive.response'; chatId: string; id: string; result: InteractiveResultPayload }
  | { type: 'interactive.cancel'; chatId: string; id: string }
  | { type: 'turn.phase'; chatId: string; phase: TurnPhase; streamId?: string; resuming?: boolean }
  | { type: 'turn.delta'; chatId: string; delta: string; streamId?: string }
  | { type: 'tools.started'; chatId: string; tools: ToolCallStart[] }
  | { type: 'tools.finished'; chatId: string; durationMs: number; results: ToolCallResult[] }
  | { type: 'turn.completed'; chatId: string; content?: string; media?: MediaItem[] }
  | { type: 'error'; code: string; message: string; chatId?: string };
