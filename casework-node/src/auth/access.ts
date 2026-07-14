import type { FastifyRequest } from 'fastify';
import type { CaseworkConfig } from '../config/config.js';

export interface CurrentUser {
  id: string;
  email: string;
  role: 'admin' | 'user';
  token: string;
}

export class AccessControl {
  constructor(private readonly config: CaseworkConfig) {}

  get mode(): 'none' | 'token' | 'pocketbase' {
    const webui = this.config.channels.webui_plugin;
    if (webui.pocketbaseUrl.trim()) return 'pocketbase';
    if (webui.authToken.trim()) return 'token';
    return 'none';
  }

  get required(): boolean {
    return this.mode !== 'none';
  }

  async authorize(request: FastifyRequest): Promise<CurrentUser | null> {
    const token = bearerToken(request) || queryToken(request);
    if (this.mode === 'none') return null;
    if (this.mode === 'token') {
      if (token && token === this.config.channels.webui_plugin.authToken) {
        return { id: 'local-admin', email: '', role: 'admin', token };
      }
      throw new AccessError(401, '认证失败');
    }
    if (!token) throw new AccessError(401, '请先登录');
    return this.refreshPocketBase(token);
  }

  async login(identity: string, password: string): Promise<CurrentUser> {
    if (this.mode !== 'pocketbase') throw new AccessError(404, '当前未启用 PocketBase 登录');
    const webui = this.config.channels.webui_plugin;
    const response = await fetch(`${trimSlash(webui.pocketbaseUrl)}/api/collections/${encodeURIComponent(webui.pocketbaseUsersCollection)}/auth-with-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identity, password }),
    });
    if (!response.ok) throw new AccessError(401, '邮箱或密码错误');
    return pocketBaseUser(await response.json());
  }

  private async refreshPocketBase(token: string): Promise<CurrentUser> {
    const webui = this.config.channels.webui_plugin;
    const response = await fetch(`${trimSlash(webui.pocketbaseUrl)}/api/collections/${encodeURIComponent(webui.pocketbaseUsersCollection)}/auth-refresh`, {
      method: 'POST',
      headers: { Authorization: token },
    });
    if (!response.ok) throw new AccessError(401, '登录状态已失效');
    const user = pocketBaseUser(await response.json());
    return { ...user, token };
  }
}

export class AccessError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function pocketBaseUser(value: unknown): CurrentUser {
  const data = record(value);
  const user = record(data.record);
  const role = user.role === 'admin' ? 'admin' : 'user';
  return { id: String(user.id || ''), email: String(user.email || ''), role, token: String(data.token || '') };
}

function bearerToken(request: FastifyRequest): string {
  const value = request.headers.authorization || '';
  return value.toLowerCase().startsWith('bearer ') ? value.slice(7).trim() : value.trim();
}

function queryToken(request: FastifyRequest): string {
  const query = record(request.query);
  return typeof query.auth_token === 'string' ? query.auth_token.trim() : '';
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function trimSlash(value: string): string {
  return value.replace(/\/+$/, '');
}
