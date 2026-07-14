import type { MediaItem } from '../types';

export function mediaMime(item: MediaItem): string {
  if (item.mime) {
    return item.mime.toLowerCase();
  }

  const match = item.url.match(/^data:([^;]+);base64,/);
  if (match) {
    return match[1].toLowerCase();
  }

  const ext = item.name.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    csv: 'text/csv',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    gif: 'image/gif',
    html: 'text/html',
    jpeg: 'image/jpeg',
    jpg: 'image/jpeg',
    json: 'application/json',
    md: 'text/markdown',
    mp3: 'audio/mpeg',
    mp4: 'video/mp4',
    pdf: 'application/pdf',
    png: 'image/png',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    svg: 'image/svg+xml',
    txt: 'text/plain',
    wav: 'audio/wav',
    webm: 'video/webm',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  };

  return map[ext] ?? 'application/octet-stream';
}

export function isWordMime(mime: string): boolean {
  return mime.includes('wordprocessingml.document');
}

export function isSheetMime(mime: string): boolean {
  return (
    mime.includes('spreadsheetml.sheet') ||
    mime === 'text/csv' ||
    mime === 'application/vnd.ms-excel'
  );
}

export function isPptMime(mime: string): boolean {
  return mime.includes('presentationml.presentation') || mime === 'application/vnd.ms-powerpoint';
}
