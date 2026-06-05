import type {
  AssistantHistoryPart,
  AuthResponse,
  HistoryMessage,
  SessionSummary,
  SettingsConfigSnapshot,
  SettingsAuditSnapshot,
  SettingsTenantContractsSnapshot,
  SettingsRuntimeSnapshot,
  SettingsSkillDetail,
  SettingsSkillFile,
  SettingsSkillSummary,
  SessionWorkspace,
  UploadedAttachment,
  UpstreamToolEvent,
} from './types';

export function authHeaders(token: string): HeadersInit {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function loadCurrentUser(token: string): Promise<AuthResponse> {
  const response = await fetch('/api/auth/me', {
    headers: authHeaders(token),
  });
  if (!response.ok) {
    let detail = `读取登录状态失败（${response.status}）`;
    try {
      const payload = (await response.json()) as { error?: string };
      if (payload.error) {
        detail = payload.error;
      }
    } catch {
      // ignore
    }
    throw new Error(detail);
  }
  return response.json() as Promise<AuthResponse>;
}

export function withAuthQuery(url: string, token: string): string {
  if (!token) {
    return url;
  }
  
  // 检查是否是远程 URL
  if (url.startsWith('http://') || url.startsWith('https://')) {
    // 远程 URL 直接返回，不添加 auth_token
    return url;
  }
  
  // 本地路径才添加 auth_token
  const value = new URL(url, window.location.origin);
  value.searchParams.set('auth_token', token);
  return `${value.pathname}${value.search}`;
}

export async function loadSessions(token: string): Promise<SessionSummary[]> {
  return loadUpstreamSessions(token);
}

export async function deleteSession(chatId: string, token: string): Promise<void> {
  const response = await fetch(`/api/upstream/sessions/${encodeURIComponent(chatId)}`, {
    method: 'DELETE',
    headers: authHeaders(token),
  });
  if (!response.ok) {
    throw new Error(`删除会话失败（${response.status}）`);
  }
}

function upstreamSessionToSummary(row: {
  key?: string;
  created_at?: string | null;
  updated_at?: string | null;
  title?: string;
  preview?: string;
  run_started_at?: number | null;
}): SessionSummary | null {
  const key = String(row.key ?? '');
  if (!key.startsWith('websocket:')) {
    return null;
  }
  const chatId = key.slice('websocket:'.length);
  return {
    chat_id: chatId,
    session_key: key,
    channel: 'websocket',
    created_at: row.created_at ?? null,
    last_ts: row.updated_at ?? row.created_at ?? null,
    preview: row.preview || row.title || '新对话',
    message_count: 0,
  };
}

export async function loadUpstreamSessions(token: string): Promise<SessionSummary[]> {
  const response = await fetch('/api/upstream/sessions', {
    headers: authHeaders(token),
  });
  if (!response.ok) {
    throw new Error(`加载会话失败（${response.status}）`);
  }
  const payload = (await response.json()) as { sessions?: unknown[] };
  return (payload.sessions ?? [])
    .map((row) => upstreamSessionToSummary(row as Parameters<typeof upstreamSessionToSummary>[0]))
    .filter((row): row is SessionSummary => row !== null);
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (!value) {
    return {};
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : {};
    } catch {
      return {};
    }
  }
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringifyToolResult(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (value == null) {
    return '';
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function toolNameFromTrace(line: string, fallback: string): string {
  const match = line.match(/^\s*([A-Za-z0-9_.:-]+)\s*\(/);
  return match?.[1] || fallback;
}

function toolArgsFromTrace(line: string): Record<string, unknown> {
  const match = line.match(/^\s*[A-Za-z0-9_.:-]+\s*\((.*)\)\s*$/s);
  return match ? parseJsonObject(match[1]) : {};
}

function upstreamToolEventToPart(event: UpstreamToolEvent, index: number): AssistantHistoryPart {
  const name = String(event.name || `tool_${index + 1}`);
  return {
    type: 'tool-call',
    tool: {
      callId: typeof event.call_id === 'string' ? event.call_id : undefined,
      name,
      args: parseJsonObject(event.arguments),
      result: event.error ? stringifyToolResult(event.error) : stringifyToolResult(event.result),
      status: event.error ? 'error' : 'ok',
    },
  };
}

function traceLineToPart(line: string, index: number): AssistantHistoryPart {
  return {
    type: 'tool-call',
    tool: {
      name: toolNameFromTrace(line, `tool_${index + 1}`),
      args: toolArgsFromTrace(line),
      result: '',
      status: 'ok',
    },
  };
}

function upstreamTraceMessageToParts(row: Record<string, unknown>): AssistantHistoryPart[] {
  const toolEvents = Array.isArray(row.toolEvents) ? row.toolEvents as UpstreamToolEvent[] : [];
  if (toolEvents.length) {
    return toolEvents
      .filter((event) => event.phase === 'end' || event.phase === 'error')
      .map(upstreamToolEventToPart);
  }
  const traces = Array.isArray(row.traces)
    ? row.traces.filter((line): line is string => typeof line === 'string')
    : typeof row.content === 'string' && row.content
      ? [row.content]
      : [];
  return traces.map(traceLineToPart);
}

function upstreamThreadMessagesToHistory(messages: unknown[]): HistoryMessage[] {
  const result: HistoryMessage[] = [];
  let activityParts: AssistantHistoryPart[] = [];

  const flushActivity = () => {
    if (!activityParts.length) {
      return;
    }
    result.push({
      type: 'assistant',
      content: '',
      parts: activityParts,
    });
    activityParts = [];
  };

  for (const message of messages) {
    if (!message || typeof message !== 'object') {
      continue;
    }
    const row = message as Record<string, unknown>;
    const role = String(row.role ?? '');
    const kind = String(row.kind ?? 'message');
    const content = String(row.content ?? row.text ?? '');

    if (role === 'user') {
      flushActivity();
      result.push({ type: 'user', content });
      continue;
    }

    if (role === 'tool' && kind === 'trace') {
      activityParts = [...activityParts, ...upstreamTraceMessageToParts(row)];
      continue;
    }

    if (role === 'assistant') {
      const reasoning = typeof row.reasoning === 'string' ? row.reasoning : '';
      if (reasoning) {
        activityParts.push({ type: 'reasoning', text: reasoning });
      }
      if (content) {
        if (activityParts.length) {
          result.push({
            type: 'assistant',
            content,
            parts: [...activityParts, { type: 'text', text: content }],
          });
          activityParts = [];
        } else {
          result.push({ type: 'assistant', content, parts: [{ type: 'text', text: content }] });
        }
      }
    }
  }

  flushActivity();
  return result;
}

export async function loadUpstreamThread(chatId: string, token: string): Promise<HistoryMessage[]> {
  const response = await fetch(`/api/upstream/sessions/${encodeURIComponent(chatId)}/webui-thread`, {
    headers: authHeaders(token),
  });
  if (response.status === 404) {
    return [];
  }
  if (!response.ok) {
    throw new Error(`加载会话历史失败（${response.status}）`);
  }
  const payload = (await response.json()) as { messages?: unknown[] };
  return upstreamThreadMessagesToHistory(payload.messages ?? []);
}

export async function uploadFiles(chatId: string, files: File[], token: string): Promise<UploadedAttachment[]> {
  const formData = new FormData();
  for (const file of files) {
    formData.append('files', file, file.name);
  }

  const response = await fetch(`/uploads/${encodeURIComponent(chatId)}`, {
    method: 'POST',
    headers: authHeaders(token),
    body: formData,
  });
  if (!response.ok) {
    throw new Error(`上传文件失败（${response.status}）`);
  }
  const payload = (await response.json()) as { files?: UploadedAttachment[] };
  return payload.files ?? [];
}

interface SessionWorkspaceResponse {
  chat_id: string;
  updated_at: string | null;
  files?: unknown;
}

function isSessionWorkspaceFilePayload(value: unknown): value is {
  id: string;
  name: string;
  url: string;
  mime: string;
  delivered_at: string;
} {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const file = value as Record<string, unknown>;
  return (
    typeof file.id === 'string'
    && typeof file.name === 'string'
    && typeof file.url === 'string'
    && typeof file.mime === 'string'
    && typeof file.delivered_at === 'string'
  );
}

export async function loadSessionWorkspace(chatId: string, token: string): Promise<SessionWorkspace> {
  const response = await fetch(`/api/workspaces/${encodeURIComponent(chatId)}`, {
    headers: authHeaders(token),
  });
  if (!response.ok) {
    throw new Error(`加载工作空间失败（${response.status}）`);
  }
  const payload = (await response.json()) as SessionWorkspaceResponse;
  return {
    chatId: payload.chat_id,
    updatedAt: payload.updated_at,
    files: (Array.isArray(payload.files) ? payload.files : [])
      .filter(isSessionWorkspaceFilePayload)
      .map((file) => ({
        id: file.id,
        name: file.name,
        url: file.url,
        mime: file.mime,
        deliveredAt: file.delivered_at,
      })),
  };
}

export async function fetchText(url: string, token: string): Promise<string> {
  const response = await fetch(withAuthQuery(url, token));
  if (!response.ok) {
    throw new Error(`加载资源失败（${response.status}）`);
  }
  return response.text();
}

export async function fetchArrayBuffer(url: string, token: string): Promise<ArrayBuffer> {
  const response = await fetch(withAuthQuery(url, token));
  if (!response.ok) {
    throw new Error(`加载资源失败（${response.status}）`);
  }
  return response.arrayBuffer();
}

export async function loadSettingsSkills(token: string): Promise<SettingsSkillSummary[]> {
  const response = await fetch('/api/settings/skills', {
    headers: authHeaders(token),
  });
  if (!response.ok) {
    throw new Error(`加载技能失败（${response.status}）`);
  }
  const payload = (await response.json()) as { skills?: SettingsSkillSummary[] };
  return payload.skills ?? [];
}

export async function loadSettingsSkillDetail(
  name: string,
  source: string,
  token: string,
): Promise<SettingsSkillDetail> {
  const url = new URL(`/api/settings/skills/${encodeURIComponent(name)}`, window.location.origin);
  if (source) {
    url.searchParams.set('source', source);
  }
  const response = await fetch(`${url.pathname}${url.search}`, {
    headers: authHeaders(token),
  });
  if (!response.ok) {
    throw new Error(`加载技能详情失败（${response.status}）`);
  }
  return response.json() as Promise<SettingsSkillDetail>;
}

export async function loadSettingsSkillFile(
  name: string,
  source: string,
  filePath: string,
  token: string,
): Promise<SettingsSkillFile> {
  const url = new URL(`/api/settings/skills/${encodeURIComponent(name)}/file`, window.location.origin);
  url.searchParams.set('path', filePath);
  if (source) {
    url.searchParams.set('source', source);
  }
  const response = await fetch(`${url.pathname}${url.search}`, {
    headers: authHeaders(token),
  });
  if (!response.ok) {
    throw new Error(`加载技能文件失败（${response.status}）`);
  }
  return response.json() as Promise<SettingsSkillFile>;
}

export async function toggleSettingsSkill(
  name: string,
  source: string,
  enabled: boolean,
  token: string,
): Promise<SettingsSkillDetail> {
  const url = new URL(`/api/settings/skills/${encodeURIComponent(name)}/toggle`, window.location.origin);
  if (source) {
    url.searchParams.set('source', source);
  }
  const response = await fetch(`${url.pathname}${url.search}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(token),
    },
    body: JSON.stringify({ enabled }),
  });
  if (!response.ok) {
    throw new Error(`切换技能状态失败（${response.status}）`);
  }
  return response.json() as Promise<SettingsSkillDetail>;
}

export async function loadSettingsConfig(token: string): Promise<SettingsConfigSnapshot> {
  const response = await fetch('/api/settings/config', {
    headers: authHeaders(token),
  });
  if (!response.ok) {
    throw new Error(`加载配置失败（${response.status}）`);
  }
  return response.json() as Promise<SettingsConfigSnapshot>;
}

export async function saveSettingsConfig(raw: string, token: string): Promise<SettingsConfigSnapshot> {
  const response = await fetch('/api/settings/config', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(token),
    },
    body: JSON.stringify({ raw }),
  });
  if (!response.ok) {
    let detail = `保存配置失败（${response.status}）`;
    try {
      const payload = (await response.json()) as { error?: string };
      if (payload.error) {
        detail = payload.error;
      }
    } catch {
      // ignore
    }
    throw new Error(detail);
  }
  return response.json() as Promise<SettingsConfigSnapshot>;
}

export async function loadSettingsRuntime(token: string): Promise<SettingsRuntimeSnapshot> {
  const response = await fetch('/api/settings/runtime', {
    headers: authHeaders(token),
  });
  if (!response.ok) {
    throw new Error(`加载运行状态失败（${response.status}）`);
  }
  return response.json() as Promise<SettingsRuntimeSnapshot>;
}

export async function loadSettingsAudit(token: string, limit = 100): Promise<SettingsAuditSnapshot> {
  const response = await fetch(`/api/settings/audit?limit=${encodeURIComponent(String(limit))}`, {
    headers: authHeaders(token),
  });
  if (!response.ok) {
    throw new Error(`加载审计日志失败（${response.status}）`);
  }
  return response.json() as Promise<SettingsAuditSnapshot>;
}

export async function loadSettingsTenantContracts(token: string): Promise<SettingsTenantContractsSnapshot> {
  const response = await fetch('/api/settings/tenant-contracts', {
    headers: authHeaders(token),
  });
  if (!response.ok) {
    throw new Error(`加载技能契约失败（${response.status}）`);
  }
  return response.json() as Promise<SettingsTenantContractsSnapshot>;
}
