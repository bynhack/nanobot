import type {
  AuthResponse,
  SessionSummary,
  SettingsConfigSnapshot,
  SettingsRuntimeSnapshot,
  SettingsSkillDetail,
  SettingsSkillFile,
  SettingsSkillSummary,
  SessionWorkspace,
  UploadedAttachment,
} from './types';

export function authHeaders(token: string): HeadersInit {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function login(identity: string, password: string): Promise<AuthResponse> {
  const response = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identity, password }),
  });
  if (!response.ok) {
    let detail = `登录失败（${response.status}）`;
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

export async function logout(token: string): Promise<void> {
  await fetch('/api/auth/logout', {
    method: 'POST',
    headers: authHeaders(token),
  });
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
  const response = await fetch('/sessions', {
    headers: authHeaders(token),
  });
  if (!response.ok) {
    throw new Error(`加载会话失败（${response.status}）`);
  }
  return response.json() as Promise<SessionSummary[]>;
}

export async function deleteSession(chatId: string, token: string): Promise<void> {
  const response = await fetch(`/sessions/${encodeURIComponent(chatId)}`, {
    method: 'DELETE',
    headers: authHeaders(token),
  });
  if (!response.ok) {
    throw new Error(`删除会话失败（${response.status}）`);
  }
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
