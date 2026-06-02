export type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'auth_required';
export type TurnPhase = 'idle' | 'streaming' | 'running_tools' | 'finalizing' | 'completed';
export type RequestStatus = 'idle' | 'processing' | 'running_tools' | 'completed';
export type AuthStatus = 'anonymous' | 'authenticating' | 'authenticated';
export type UserRole = 'admin' | 'user';

export interface ConversationStarter {
  title: string;
  label?: string;
  prompt: string;
}

export interface WebUIBootstrapUI {
  welcomeTitle?: string;
  welcomeSubtitle?: string;
  composerPlaceholder?: string;
  compactComposerPlaceholder?: string;
  conversationStarters?: ConversationStarter[];
}

export interface BootstrapConfig {
  title: string;
  authRequired: boolean;
  authMode?: 'none' | 'token' | 'pocketbase';
  ui?: WebUIBootstrapUI;
}

export interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
}

export interface AuthResponse {
  token: string;
  user: AuthUser | null;
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

export interface MediaItem {
  url: string;
  name: string;
  mime?: string;
}

export interface UploadedAttachment extends MediaItem {
  path: string;
}

export interface SessionWorkspaceFile {
  id: string;
  name: string;
  url: string;
  mime: string;
  deliveredAt: string;
}

export interface SessionWorkspace {
  chatId: string;
  updatedAt: string | null;
  files: SessionWorkspaceFile[];
}

export interface WorkspacePanelState {
  open: boolean;
  loading: boolean;
  error: string | null;
  chatId: string | null;
  requestId: number | null;
}

interface HistoryMessageBase {
  id?: string;
}

export type HistoryMessage =
  | (HistoryMessageBase & { type: 'user'; content: string; media?: MediaItem[] })
  | (HistoryMessageBase & { type: 'assistant'; content: string; buttons?: string[][] })
  | (HistoryMessageBase & { type: 'tools'; tools: ToolHistoryItem[] })
  | (HistoryMessageBase & { type: 'outbound'; content: string; media: MediaItem[] });

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
  requestStatus: RequestStatus;
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
  workspaceByChat: Record<string, SessionWorkspace>;
  workspacePanel: WorkspacePanelState;
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
  kind?: string;
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
  live_runtime: {
    channel?: {
      name?: string;
      streaming_enabled?: boolean;
      runtime_attached?: boolean;
      runtime_attach_warned?: boolean;
    };
    runtime?: {
      loop_found?: boolean;
      runtime_attached?: boolean;
      hook_count?: number;
      attach_state?: {
        is_wrapped?: boolean;
        wrapper_name?: string;
        wrap_count?: number;
        hook_registered?: boolean;
      };
    };
    connections?: {
      active_chat_count?: number;
      active_connection_count?: number;
      blocked_chat_count?: number;
      chat_connections?: Record<string, number>;
    };
    turns?: {
      active_turn_count?: number;
      turns?: Record<
        string,
        {
          stream_id?: string | null;
          had_stream_output?: boolean;
          finished?: boolean;
        }
      >;
    };
    observer_error?: string;
  };
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

export interface SettingsTenantContractIssue {
  code: string;
  severity: 'error' | 'warning';
  message: string;
}

export interface SettingsTenantContract {
  name: string;
  path: string;
  contract_path: string;
  enabled: boolean;
  commands: string[];
  denied_commands: string[];
  resources: Array<{
    resource: string;
    actions: string[];
    scope_key?: string;
  }>;
  issues: SettingsTenantContractIssue[];
  status: 'ok' | 'warning' | 'error';
}

export interface SettingsTenantContractsSnapshot {
  workspace: string;
  skills_root: string;
  summary: {
    total: number;
    ok: number;
    warning: number;
    error: number;
  };
  contracts: SettingsTenantContract[];
}

export interface SettingsAuditEvent {
  version: string;
  ts: string;
  user_id: string;
  email: string;
  role: string;
  business_role: string;
  chat_id: string;
  tool: string;
  command: string;
  decision: string;
  reason: string;
  scopes: Record<string, string[]>;
  tenant_policy?: Record<string, unknown>;
}

export interface SettingsAuditSnapshot {
  workspace: string;
  audit_path: string;
  scope: 'all' | 'self';
  limit: number;
  summary: {
    total: number;
    allow: number;
    deny: number;
  };
  events: SettingsAuditEvent[];
}

export type ServerEvent =
  | { type: 'session.init'; chatId: string; sessionId: string }
  | { type: 'session.history'; chatId: string; messages: HistoryMessage[] }
  | { type: 'session.deleted'; chatId: string }
  | { type: 'turn.phase'; chatId: string; phase: TurnPhase; streamId?: string; resuming?: boolean }
  | { type: 'turn.delta'; chatId: string; delta: string; streamId?: string }
  | { type: 'tools.started'; chatId: string; tools: ToolCallStart[] }
  | { type: 'tools.finished'; chatId: string; durationMs: number; results: ToolCallResult[] }
  | { type: 'turn.completed'; chatId: string; content?: string; media?: MediaItem[]; buttons?: string[][]; streamId?: string }
  | { type: 'error'; code: string; message: string; chatId?: string };
