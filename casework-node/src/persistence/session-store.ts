import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { HistoryMessage } from '../contracts/protocol.js';

export interface StoredSession {
  chat_id: string;
  session_key: string;
  channel: string;
  read_only: boolean;
  created_at: string;
  last_ts: string;
  preview: string;
  messages: HistoryMessage[];
  owner_id?: string;
}

export class SessionStore {
  constructor(private readonly root: string) {}

  async create(ownerId = ''): Promise<StoredSession> {
    const now = new Date().toISOString();
    const chatId = randomUUID().replaceAll('-', '');
    const session: StoredSession = {
      chat_id: chatId,
      session_key: `webui:${chatId}`,
      channel: 'webui_plugin',
      read_only: false,
      created_at: now,
      last_ts: now,
      preview: '新对话',
      messages: [],
      ...(ownerId ? { owner_id: ownerId } : {}),
    };
    await this.save(session);
    return session;
  }

  async get(chatId: string): Promise<StoredSession | null> {
    if (!validChatId(chatId)) return null;
    try {
      return JSON.parse(await readFile(this.path(chatId), 'utf8')) as StoredSession;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async list(ownerId = ''): Promise<Array<Omit<StoredSession, 'messages'> & { message_count: number }>> {
    await mkdir(this.root, { recursive: true });
    const results = [];
    for (const name of await readdir(this.root)) {
      if (!name.endsWith('.json')) continue;
      try {
        const session = JSON.parse(await readFile(join(this.root, name), 'utf8')) as StoredSession;
        if (ownerId && session.owner_id !== ownerId) continue;
        const { messages, ...summary } = session;
        results.push({ ...summary, message_count: messages.length });
      } catch {
        // A corrupt session is ignored in the list but remains on disk for diagnosis.
      }
    }
    return results.sort((a, b) => b.last_ts.localeCompare(a.last_ts));
  }

  async append(chatId: string, message: HistoryMessage, ownerId = ''): Promise<StoredSession> {
    const session = (await this.get(chatId)) ?? (await this.createWithId(chatId, ownerId));
    session.messages.push(message);
    session.last_ts = new Date().toISOString();
    const text = 'content' in message ? message.content.trim() : '';
    if (text) session.preview = text.slice(0, 60) + (text.length > 60 ? '…' : '');
    await this.save(session);
    return session;
  }

  async delete(chatId: string): Promise<boolean> {
    if (!validChatId(chatId)) return false;
    try {
      await rm(this.path(chatId));
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
  }

  async count(): Promise<number> {
    await mkdir(this.root, { recursive: true });
    const names = await readdir(this.root);
    return names.filter((name) => name.endsWith('.json')).length;
  }

  private async createWithId(chatId: string, ownerId = ''): Promise<StoredSession> {
    if (!validChatId(chatId)) throw new Error('无效的会话 ID');
    const now = new Date().toISOString();
    const session: StoredSession = {
      chat_id: chatId,
      session_key: `webui:${chatId}`,
      channel: 'webui_plugin',
      read_only: false,
      created_at: now,
      last_ts: now,
      preview: '新对话',
      messages: [],
      ...(ownerId ? { owner_id: ownerId } : {}),
    };
    await this.save(session);
    return session;
  }

  private async save(session: StoredSession): Promise<void> {
    await mkdir(this.root, { recursive: true });
    const path = this.path(session.chat_id);
    const temp = `${path}.${process.pid}.tmp`;
    await writeFile(temp, `${JSON.stringify(session, null, 2)}\n`, 'utf8');
    await import('node:fs/promises').then(({ rename }) => rename(temp, path));
  }

  private path(chatId: string): string {
    return join(this.root, `${chatId}.json`);
  }
}

export function validChatId(value: string): boolean {
  return /^[A-Za-z0-9_.:-]{1,160}$/.test(value);
}
