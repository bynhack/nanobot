import { createHmac, createHash, timingSafeEqual } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { basename, resolve } from 'node:path';

interface MediaTokenPayload {
  path: string;
  exp: number;
}

export class MediaService {
  private readonly secret: Buffer;

  constructor(secret: string, private readonly ttlSeconds: number) {
    this.secret = createHash('sha256').update(secret || 'casework-node-development-secret').digest();
  }

  issue(path: string): string {
    const payload: MediaTokenPayload = { path: resolve(path), exp: Math.floor(Date.now() / 1000) + Math.max(1, this.ttlSeconds) };
    const raw = Buffer.from(JSON.stringify(payload));
    const signature = createHmac('sha256', this.secret).update(raw).digest();
    return `${raw.toString('base64url')}.${signature.toString('base64url')}`;
  }

  async resolve(token: string): Promise<string | null> {
    try {
      const [payloadText, signatureText] = token.split('.');
      if (!payloadText || !signatureText) return null;
      const raw = Buffer.from(payloadText, 'base64url');
      const expected = createHmac('sha256', this.secret).update(raw).digest();
      const actual = Buffer.from(signatureText, 'base64url');
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
      const payload = JSON.parse(raw.toString('utf8')) as MediaTokenPayload;
      if (!payload.path || payload.exp < Math.floor(Date.now() / 1000)) return null;
      if (!(await stat(payload.path)).isFile()) return null;
      return payload.path;
    } catch {
      return null;
    }
  }

  item(path: string): { url: string; name: string; mime: string } {
    return { url: `/media/${this.issue(path)}`, name: basename(path), mime: mimeType(path) };
  }
}

export function mimeType(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.json')) return 'application/json';
  if (lower.endsWith('.md')) return 'text/markdown';
  if (lower.endsWith('.txt')) return 'text/plain';
  if (lower.endsWith('.docx')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (lower.endsWith('.xlsx')) return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (lower.endsWith('.pptx')) return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
  return 'application/octet-stream';
}
