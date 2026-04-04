import { withAuthQuery } from './api';
import type { BootstrapConfig, ConnectionState, MediaItem } from './types';

declare global {
  interface Window {
    __NANOBOT_WEBUI_BOOTSTRAP__?: BootstrapConfig | string;
  }
}

export function bootstrapConfig(): BootstrapConfig {
  const raw = window.__NANOBOT_WEBUI_BOOTSTRAP__;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as BootstrapConfig;
    } catch {
      return { title: 'Nanobot', authRequired: false };
    }
  }
  return raw ?? { title: 'Nanobot', authRequired: false };
}

export function shortChatId(chatId: string | null): string {
  return chatId ? `会话：${chatId.slice(0, 8)}` : '';
}

export function formatDate(value: string | null): string {
  if (!value) {
    return '';
  }
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    return '';
  }
  const diff = Date.now() - date.valueOf();
  if (diff < 60_000) {
    return '刚刚';
  }
  if (diff < 3_600_000) {
    return `${Math.floor(diff / 60_000)}分钟前`;
  }
  if (diff < 86_400_000) {
    return `今天 ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  }
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

export function detectMime(item: MediaItem): string {
  if (item.mime) {
    return item.mime;
  }
  const ext = item.name.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    gif: 'image/gif',
    jpeg: 'image/jpeg',
    jpg: 'image/jpeg',
    mp3: 'audio/mpeg',
    mp4: 'video/mp4',
    pdf: 'application/pdf',
    png: 'image/png',
    webm: 'video/webm',
  };
  return map[ext] ?? 'application/octet-stream';
}

export function fileTypeLabel(mime: string): string {
  if (mime.includes('presentationml.presentation') || mime === 'application/vnd.ms-powerpoint') return '演示文稿';
  if (mime.includes('wordprocessingml.document') || mime === 'application/msword') return '文档';
  if (mime.includes('spreadsheetml.sheet') || mime === 'application/vnd.ms-excel') return '表格';
  if (mime.startsWith('image/')) return '图片';
  if (mime.startsWith('audio/')) return '音频';
  if (mime.startsWith('video/')) return '视频';
  if (mime === 'application/pdf') return 'PDF';
  if (mime === 'application/json') return '数据';
  if (mime === 'text/markdown') return '标记文档';
  if (mime === 'text/plain') return '文本';
  return '文件';
}

export function fileTypeIcon(mime: string): string {
  if (mime.startsWith('audio/')) {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2z"/></svg>`;
  }
  if (mime.startsWith('video/')) {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M15 10l4.553-2.069A1 1 0 0121 8.867v6.266a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>`;
  }
  if (mime === 'application/pdf') {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"/></svg>`;
  }
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>`;
}

export function connectionStatusText(connectionState: ConnectionState): string {
  if (connectionState === 'connected') return '已连接';
  if (connectionState === 'disconnected') return '重连中…';
  if (connectionState === 'auth_required') return '需要认证';
  return '连接中…';
}

export function mediaPreviewUrl(item: MediaItem, token: string): string {
  return withAuthQuery(item.url, token);
}
