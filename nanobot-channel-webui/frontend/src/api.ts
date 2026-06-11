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
import type { MediaItem } from './types';

export const AUTH_EXPIRED_EVENT = 'nanobot:auth-expired';

export class AuthExpiredError extends Error {
  readonly status = 401;

  constructor(message = '登录已失效，请重新登录') {
    super(message);
    this.name = 'AuthExpiredError';
  }
}

export function authHeaders(token: string): HeadersInit {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function authExpiredEvent(message: string): Event {
  if (typeof CustomEvent === 'function') {
    return new CustomEvent(AUTH_EXPIRED_EVENT, { detail: { message } });
  }
  const event = new Event(AUTH_EXPIRED_EVENT) as Event & { detail?: { message: string } };
  event.detail = { message };
  return event;
}

export function notifyAuthExpired(message = '登录已失效，请重新登录'): void {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') {
    return;
  }
  window.dispatchEvent(authExpiredEvent(message));
}

async function errorMessage(response: Response, fallback: string): Promise<string> {
  let detail = fallback;
  try {
    const payload = (await response.json()) as { error?: string };
    if (payload.error) {
      detail = payload.error;
    }
  } catch {
    // ignore non-JSON error payloads
  }
  return detail;
}

export async function ensureOk(response: Response, fallback: string): Promise<void> {
  if (response.ok) {
    return;
  }
  const detail = await errorMessage(response, fallback);
  if (response.status === 401) {
    notifyAuthExpired(detail);
    throw new AuthExpiredError(detail);
  }
  throw new Error(detail);
}

export async function loadCurrentUser(token: string): Promise<AuthResponse> {
  const response = await fetch('/api/auth/me', {
    headers: authHeaders(token),
  });
  await ensureOk(response, `读取登录状态失败（${response.status}）`);
  return response.json() as Promise<AuthResponse>;
}

export function withAuthQuery(url: string, token: string): string {
  if (!token) {
    return url;
  }

  if (url.startsWith('/api/public-media/')) {
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
  await ensureOk(response, `删除会话失败（${response.status}）`);
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
  await ensureOk(response, `加载会话失败（${response.status}）`);
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

function upstreamFileEditToPart(edit: Record<string, unknown>, index: number): AssistantHistoryPart {
  const name = typeof edit.tool === 'string' && edit.tool ? edit.tool : `file_edit_${index + 1}`;
  const status = edit.phase === 'error' || edit.status === 'error' ? 'error' : 'ok';
  const result = typeof edit.status === 'string' && edit.status
    ? edit.status
    : typeof edit.phase === 'string' && edit.phase
      ? edit.phase
      : '';
  return {
    type: 'tool-call',
    tool: {
      callId: typeof edit.call_id === 'string' ? edit.call_id : undefined,
      name,
      args: {
        ...(typeof edit.path === 'string' ? { path: edit.path } : {}),
        ...(typeof edit.absolute_path === 'string' ? { absolute_path: edit.absolute_path } : {}),
        ...(Number.isFinite(edit.added) ? { added: edit.added } : {}),
        ...(Number.isFinite(edit.deleted) ? { deleted: edit.deleted } : {}),
      },
      result,
      status,
    },
  };
}

function upstreamFileEditsToParts(row: Record<string, unknown>): AssistantHistoryPart[] {
  const edits = Array.isArray(row.fileEdits)
    ? row.fileEdits
    : Array.isArray(row.file_edits)
      ? row.file_edits
      : [];
  return edits
    .filter((edit): edit is Record<string, unknown> => Boolean(edit) && typeof edit === 'object')
    .map(upstreamFileEditToPart);
}

function upstreamTraceMessageToParts(row: Record<string, unknown>): AssistantHistoryPart[] {
  const toolEvents = Array.isArray(row.toolEvents)
    ? row.toolEvents as UpstreamToolEvent[]
    : Array.isArray(row.tool_events)
      ? row.tool_events as UpstreamToolEvent[]
      : [];
  const parts = [
    ...toolEvents
      .filter((event) => event.phase === 'end' || event.phase === 'error')
      .map(upstreamToolEventToPart),
    ...upstreamFileEditsToParts(row),
  ];
  if (parts.length) {
    return parts;
  }
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

function toolCallFunctionPayload(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function upstreamAssistantToolCallsToParts(row: Record<string, unknown>): AssistantHistoryPart[] {
  const toolCalls = Array.isArray(row.tool_calls)
    ? row.tool_calls
    : Array.isArray(row.toolCalls)
      ? row.toolCalls
      : [];

  return toolCalls
    .filter((call): call is Record<string, unknown> => Boolean(call) && typeof call === 'object')
    .map((call, index) => {
      const fn = toolCallFunctionPayload(call.function);
      const name = typeof fn.name === 'string' && fn.name ? fn.name : `tool_${index + 1}`;
      return {
        type: 'tool-call',
        tool: {
          callId: typeof call.id === 'string' ? call.id : undefined,
          name,
          args: parseJsonObject(fn.arguments),
          result: '',
          status: 'ok',
        },
      };
    });
}

function applyToolResultToParts(
  parts: AssistantHistoryPart[],
  row: Record<string, unknown>,
): AssistantHistoryPart[] {
  const callId = typeof row.tool_call_id === 'string'
    ? row.tool_call_id
    : typeof row.toolCallId === 'string'
      ? row.toolCallId
      : '';
  const name = typeof row.name === 'string' && row.name ? row.name : 'tool';
  const result = stringifyToolResult(row.content ?? row.result ?? '');

  let matched = false;
  const next = parts.map((part) => {
    if (part.type !== 'tool-call') {
      return part;
    }
    const isMatch = callId
      ? part.tool.callId === callId
      : part.tool.name === name && !part.tool.result;
    if (!isMatch) {
      return part;
    }
    matched = true;
    return {
      ...part,
      tool: {
        ...part.tool,
        result,
        status: row.error ? 'error' as const : 'ok' as const,
      },
    };
  });

  if (matched) {
    return next;
  }

  return [
    ...parts,
    {
      type: 'tool-call',
      tool: {
        callId: callId || undefined,
        name,
        args: {},
        result,
        status: row.error ? 'error' : 'ok',
      },
    },
  ];
}

function isMediaItemPayload(value: unknown): value is MediaItem {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const item = value as Record<string, unknown>;
  return typeof item.url === 'string'
    && typeof item.name === 'string'
    && (item.mime == null || typeof item.mime === 'string');
}

function upstreamMediaFromRow(row: Record<string, unknown>): MediaItem[] {
  const rawMedia = Array.isArray(row.media)
    ? row.media
    : Array.isArray(row.media_urls)
      ? row.media_urls
      : [];
  return rawMedia
    .flatMap((item) => {
      if (isMediaItemPayload(item)) {
        return [{
          url: item.url,
          name: item.name,
          mime: item.mime ?? '',
        }];
      }
      if (typeof item === 'string' && item.trim()) {
        const normalized = item.trim();
        return [{
          url: normalized,
          name: normalized.split('/').filter(Boolean).at(-1) ?? normalized,
          mime: '',
        }];
      }
      return [];
    });
}

function upstreamMediaDeliveryToPart(content: string, media: MediaItem[]): AssistantHistoryPart {
  return {
    type: 'tool-call',
    tool: {
      name: 'message',
      args: {
        content,
        media: media.map((item) => item.url),
      },
      result: `Message delivered with ${media.length} attachment${media.length === 1 ? '' : 's'}`,
      status: 'ok',
    },
  };
}

function shouldInferMediaDeliveryTool(row: Record<string, unknown>): boolean {
  const rawMedia = Array.isArray(row.media) ? row.media : [];
  return rawMedia.some(
    (item) => Boolean(item)
      && typeof item === 'object'
      && typeof (item as Record<string, unknown>).kind === 'string',
  );
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

  const hasPendingToolResult = () => activityParts.some(
    (part) => part.type === 'tool-call' && !part.tool.result,
  );

  for (const message of messages) {
    if (!message || typeof message !== 'object') {
      continue;
    }
    const row = message as Record<string, unknown>;
    const role = String(row.role ?? '');
    const kind = String(row.kind ?? 'message');
    const type = String(row.type ?? '');
    const content = String(row.content ?? row.text ?? '');
    const media = upstreamMediaFromRow(row);

    if ((type === 'outbound' || role === 'assistant') && media.length) {
      if (role === 'assistant' && shouldInferMediaDeliveryTool(row)) {
        activityParts.push(upstreamMediaDeliveryToPart(content, media));
      }
      if (!hasPendingToolResult()) {
        flushActivity();
      }
      result.push({ type: 'outbound', content, media });
      continue;
    }

    if (role === 'user') {
      flushActivity();
      result.push({ type: 'user', content });
      continue;
    }

    if (role === 'tool') {
      if (kind === 'trace') {
        activityParts = [...activityParts, ...upstreamTraceMessageToParts(row)];
      } else {
        activityParts = applyToolResultToParts(activityParts, row);
      }
      continue;
    }

    if (role === 'assistant') {
      const toolCallParts = upstreamAssistantToolCallsToParts(row);
      if (toolCallParts.length) {
        activityParts = [...activityParts, ...toolCallParts];
      }

      const reasoning = typeof row.reasoning === 'string'
        ? row.reasoning
        : typeof row.reasoning_content === 'string'
          ? row.reasoning_content
          : '';
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
  await ensureOk(response, `加载会话历史失败（${response.status}）`);
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
  await ensureOk(response, `上传文件失败（${response.status}）`);
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
  await ensureOk(response, `加载工作空间失败（${response.status}）`);
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
  await ensureOk(response, `加载资源失败（${response.status}）`);
  return response.text();
}

export async function fetchArrayBuffer(url: string, token: string): Promise<ArrayBuffer> {
  const response = await fetch(withAuthQuery(url, token));
  await ensureOk(response, `加载资源失败（${response.status}）`);
  return response.arrayBuffer();
}

export async function loadSettingsSkills(token: string): Promise<SettingsSkillSummary[]> {
  const response = await fetch('/api/settings/skills', {
    headers: authHeaders(token),
  });
  await ensureOk(response, `加载技能失败（${response.status}）`);
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
  await ensureOk(response, `加载技能详情失败（${response.status}）`);
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
  await ensureOk(response, `加载技能文件失败（${response.status}）`);
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
  await ensureOk(response, `切换技能状态失败（${response.status}）`);
  return response.json() as Promise<SettingsSkillDetail>;
}

export async function loadSettingsConfig(token: string): Promise<SettingsConfigSnapshot> {
  const response = await fetch('/api/settings/config', {
    headers: authHeaders(token),
  });
  await ensureOk(response, `加载配置失败（${response.status}）`);
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
  await ensureOk(response, `保存配置失败（${response.status}）`);
  return response.json() as Promise<SettingsConfigSnapshot>;
}

export async function loadSettingsRuntime(token: string): Promise<SettingsRuntimeSnapshot> {
  const response = await fetch('/api/settings/runtime', {
    headers: authHeaders(token),
  });
  await ensureOk(response, `加载运行状态失败（${response.status}）`);
  return response.json() as Promise<SettingsRuntimeSnapshot>;
}

export async function loadSettingsAudit(token: string, limit = 100): Promise<SettingsAuditSnapshot> {
  const response = await fetch(`/api/settings/audit?limit=${encodeURIComponent(String(limit))}`, {
    headers: authHeaders(token),
  });
  await ensureOk(response, `加载审计日志失败（${response.status}）`);
  return response.json() as Promise<SettingsAuditSnapshot>;
}

export async function loadSettingsTenantContracts(token: string): Promise<SettingsTenantContractsSnapshot> {
  const response = await fetch('/api/settings/tenant-contracts', {
    headers: authHeaders(token),
  });
  await ensureOk(response, `加载技能契约失败（${response.status}）`);
  return response.json() as Promise<SettingsTenantContractsSnapshot>;
}
