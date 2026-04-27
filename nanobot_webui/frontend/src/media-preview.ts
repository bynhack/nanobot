import DOMPurify from 'dompurify';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { fetchArrayBuffer, fetchText, withAuthQuery } from './api';
import { renderMarkdown } from './markdown';
import type { MediaItem } from './types';

type PanelMode = 'tool' | 'media';

interface ExternalWindow extends Window {
  pdfjsLib?: any;
  docx?: { renderAsync: (...args: unknown[]) => Promise<void> };
  XLSX?: any;
  JSZip?: unknown;
  $?: any;
}

const extWindow = window as ExternalWindow;
const scriptCache = new Map<string, Promise<void>>();
const stylesheetCache = new Set<string>();

function loadScript(url: string): Promise<void> {
  if (scriptCache.has(url)) {
    return scriptCache.get(url)!;
  }
  const promise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = url;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`加载预览依赖失败：${url}`));
    document.head.appendChild(script);
  });
  scriptCache.set(url, promise);
  return promise;
}

function loadStylesheet(url: string): void {
  if (stylesheetCache.has(url)) {
    return;
  }
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = url;
  document.head.appendChild(link);
  stylesheetCache.add(url);
}

async function ensurePdfJs(): Promise<any> {
  if (!extWindow.pdfjsLib) {
    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js');
    extWindow.pdfjsLib!.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  }
  return extWindow.pdfjsLib;
}

async function ensureDocxPreview(): Promise<void> {
  if (!extWindow.docx) {
    await loadScript('https://cdn.jsdelivr.net/npm/docx-preview@0.3.2/dist/docx-preview.min.js');
  }
}

async function ensureXlsx(): Promise<any> {
  if (!extWindow.XLSX) {
    await loadScript('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js');
  }
  return extWindow.XLSX;
}



function mediaMime(item: MediaItem): string {
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

function loadingNode(label = '正在加载预览…'): HTMLElement {
  const node = document.createElement('div');
  node.className = 'panel-empty';
  node.textContent = label;
  return node;
}

function unsupportedNode(message: string): HTMLElement {
  const node = document.createElement('div');
  node.className = 'panel-empty';
  node.textContent = message;
  return node;
}

function looksLikeJson(value: string): boolean {
  const trimmed = value.trim();
  return (
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'))
  );
}

function normalizeJsonish(value: unknown): unknown {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (looksLikeJson(trimmed)) {
      try {
        return normalizeJsonish(JSON.parse(trimmed));
      } catch {
        return value;
      }
    }
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeJsonish(item));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [key, normalizeJsonish(nested)]),
    );
  }

  return value;
}

function formatStructuredValue(value: unknown): string {
  if (typeof value === 'string') {
    const normalized = normalizeJsonish(value);
    if (normalized !== value) {
      return JSON.stringify(normalized, null, 2);
    }
    return value;
  }

  return JSON.stringify(normalizeJsonish(value), null, 2);
}

function extractLeadingJsonBlock(input: string): { jsonText: string; trailingText: string } | null {
  const trimmed = input.trim();
  if (!trimmed || (trimmed[0] !== '{' && trimmed[0] !== '[')) {
    return null;
  }

  const stack: string[] = [];
  let inString = false;
  let escaped = false;

  for (let index = 0; index < trimmed.length; index += 1) {
    const char = trimmed[index]!;

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === '\\') {
        escaped = true;
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === '{') {
      stack.push('}');
      continue;
    }

    if (char === '[') {
      stack.push(']');
      continue;
    }

    if (char === '}' || char === ']') {
      if (stack.pop() !== char) {
        return null;
      }
      if (!stack.length) {
        return {
          jsonText: trimmed.slice(0, index + 1),
          trailingText: trimmed.slice(index + 1).trim(),
        };
      }
    }
  }

  return null;
}

function stripCommonLineNumberPrefixes(value: string): string {
  const lines = value.split('\n');
  const numberedLines = lines.filter((line) => /^\s*\d+\|/.test(line));
  if (!numberedLines.length) {
    return value;
  }

  if (numberedLines.length < Math.max(3, Math.ceil(lines.length * 0.6))) {
    return value;
  }

  return lines.map((line) => line.replace(/^\s*\d+\|\s?/, '')).join('\n');
}

function normalizeMarkdownFrontmatter(value: string): string {
  const normalized = value.replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) {
    return value;
  }

  const end = normalized.indexOf('\n---\n', 4);
  if (end === -1) {
    return value;
  }

  const frontmatter = normalized.slice(4, end).trimEnd();
  const body = normalized.slice(end + 5).replace(/^\n+/, '');
  return `\`\`\`yaml\n${frontmatter}\n\`\`\`\n\n${body}`;
}

function formatToolResult(result?: string): { primary: string; trailing?: string } {
  if (!result) {
    return { primary: '' };
  }

  const normalizedResult = normalizeMarkdownFrontmatter(stripCommonLineNumberPrefixes(result));
  const extracted = extractLeadingJsonBlock(normalizedResult);
  if (extracted) {
    try {
      const parsed = JSON.parse(extracted.jsonText);
      return {
        primary: JSON.stringify(normalizeJsonish(parsed), null, 2),
        trailing: extracted.trailingText || undefined,
      };
    } catch {
      return { primary: normalizedResult };
    }
  }

  return { primary: formatStructuredValue(normalizedResult) };
}

function looksLikeMarkdown(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }

  return [
    /^#{1,6}\s+/m,
    /^>\s+/m,
    /^[-*+]\s+/m,
    /^\d+\.\s+/m,
    /```[\s\S]*```/,
    /\[[^\]]+\]\([^)]+\)/,
    /\*\*[^*]+\*\*/,
    /`[^`]+`/,
    /\n-{3,}\n|\n\*{3,}\n/,
  ].some((pattern) => pattern.test(trimmed));
}

function createToolSection(title: string, content: string | HTMLElement, extraClassName = ''): HTMLElement {
  const section = document.createElement('section');
  section.className = 'tool-section';

  const heading = document.createElement('div');
  heading.className = 'tool-section-title';
  heading.textContent = title;

  let body: HTMLElement;
  if (typeof content === 'string') {
    body = document.createElement('pre');
    body.className = `tool-block${extraClassName ? ` ${extraClassName}` : ''}`;
    body.textContent = content;
  } else {
    body = content;
    body.classList.add('tool-rich-block');
    if (extraClassName) {
      body.classList.add(extraClassName);
    }
  }

  section.append(heading, body);
  return section;
}

export class MediaPreviewController {
  private readonly panel: HTMLElement;
  private readonly title: HTMLElement;
  private readonly body: HTMLElement;
  private readonly downloadLink: HTMLAnchorElement;
  private readonly closeButton: HTMLButtonElement;
  private readonly getToken: () => string;
  private readonly onClose?: () => void;
  private reactPreviewRoot: Root | null = null;
  private mode: PanelMode = 'tool';

  constructor(options: {
    panel: HTMLElement;
    title: HTMLElement;
    body: HTMLElement;
    downloadLink: HTMLAnchorElement;
    closeButton: HTMLButtonElement;
    getToken: () => string;
    onClose?: () => void;
  }) {
    this.panel = options.panel;
    this.title = options.title;
    this.body = options.body;
    this.downloadLink = options.downloadLink;
    this.closeButton = options.closeButton;
    this.getToken = options.getToken;
    this.onClose = options.onClose;
    this.closeButton.addEventListener('click', () => {
      this.close();
      this.onClose?.();
    });
  }

  openTool(title: string, payload: { args: Record<string, unknown>; result?: string; status?: string; durationMs?: number }): void {
    this.mode = 'tool';
    this.panel.classList.remove('hidden');
    this.title.textContent = title;
    this.downloadLink.classList.add('hidden');
    this.body.innerHTML = '';

    const meta = document.createElement('div');
    meta.className = 'tool-summary';
    meta.textContent = payload.durationMs
      ? `${translateToolStatus(payload.status)} · ${payload.durationMs} 毫秒`
      : translateToolStatus(payload.status);

    const argsSection = createToolSection('参数', formatStructuredValue(payload.args));
    const formattedResult = formatToolResult(payload.result);
    const resultContent = looksLikeMarkdown(formattedResult.primary)
      ? renderMarkdown(formattedResult.primary)
      : formattedResult.primary;
    const resultSection = createToolSection('结果', resultContent);

    this.body.append(meta, argsSection, resultSection);

    if (formattedResult.trailing) {
      this.body.append(createToolSection('附加输出', formattedResult.trailing, 'tool-block-muted'));
    }
  }

  async openMedia(item: MediaItem): Promise<void> {
    this.mode = 'media';
    this.panel.classList.remove('hidden');
    this.title.textContent = item.name || '附件';
    this.body.innerHTML = '';
    this.downloadLink.href = withAuthQuery(item.url, this.getToken());
    this.downloadLink.download = item.name || '下载文件';
    this.downloadLink.classList.remove('hidden');

    const mime = mediaMime(item);
    const authedUrl = withAuthQuery(item.url, this.getToken());
    this.body.appendChild(loadingNode());

    try {
      if (mime.startsWith('image/')) {
        // 对于本地文件，通过 fetchArrayBuffer 下载后转为 Blob URL
        if (!item.url.startsWith('http://') && !item.url.startsWith('https://')) {
          const arrayBuffer = await fetchArrayBuffer(item.url, this.getToken());
          const blob = new Blob([arrayBuffer], { type: mime });
          const blobUrl = URL.createObjectURL(blob);
          
          const image = document.createElement('img');
          image.src = blobUrl;
          image.alt = item.name;
          image.className = 'panel-image';
          image.onload = () => URL.revokeObjectURL(blobUrl);
          this.replaceBody(image);
          return;
        }
        
        // 远程 URL 直接使用
        const image = document.createElement('img');
        image.src = item.url;
        image.alt = item.name;
        image.className = 'panel-image';
        this.replaceBody(image);
        return;
      }

      if (mime.startsWith('audio/')) {
        // 对于本地文件，通过 fetchArrayBuffer 下载后转为 Blob URL
        if (!item.url.startsWith('http://') && !item.url.startsWith('https://')) {
          const arrayBuffer = await fetchArrayBuffer(item.url, this.getToken());
          const blob = new Blob([arrayBuffer], { type: mime });
          const blobUrl = URL.createObjectURL(blob);
          
          const audio = document.createElement('audio');
          audio.src = blobUrl;
          audio.controls = true;
          audio.className = 'panel-media';
          audio.onended = () => URL.revokeObjectURL(blobUrl);
          this.replaceBody(audio);
          return;
        }
        
        // 远程 URL 直接使用
        const audio = document.createElement('audio');
        audio.src = item.url;
        audio.controls = true;
        audio.className = 'panel-media';
        this.replaceBody(audio);
        return;
      }

      if (mime.startsWith('video/')) {
        // 对于本地文件，通过 fetchArrayBuffer 下载后转为 Blob URL
        if (!item.url.startsWith('http://') && !item.url.startsWith('https://')) {
          const arrayBuffer = await fetchArrayBuffer(item.url, this.getToken());
          const blob = new Blob([arrayBuffer], { type: mime });
          const blobUrl = URL.createObjectURL(blob);
          
          const video = document.createElement('video');
          video.src = blobUrl;
          video.controls = true;
          video.className = 'panel-media';
          video.onended = () => URL.revokeObjectURL(blobUrl);
          this.replaceBody(video);
          return;
        }
        
        // 远程 URL 直接使用
        const video = document.createElement('video');
        video.src = item.url;
        video.controls = true;
        video.className = 'panel-media';
        this.replaceBody(video);
        return;
      }

      if (mime === 'application/pdf') {
        const container = document.createElement('div');
        container.className = 'panel-doc';
        this.replaceBody(container);
        const pdfjs = await ensurePdfJs();
        const pdf = await pdfjs.getDocument({ data: await fetchArrayBuffer(item.url, this.getToken()) }).promise;
        for (let index = 1; index <= pdf.numPages; index += 1) {
          const page = await pdf.getPage(index);
          const viewport = page.getViewport({ scale: 1.4 });
          const canvas = document.createElement('canvas');
          const context = canvas.getContext('2d');
          if (!context) {
            continue;
          }
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          canvas.className = 'panel-canvas';
          container.appendChild(canvas);
          await page.render({ canvasContext: context, viewport }).promise;
        }
        return;
      }

      if (mime.includes('wordprocessingml.document')) {
        const container = document.createElement('div');
        container.className = 'panel-doc white';
        this.replaceBody(container);
        await ensureDocxPreview();
        const docxBlob = new Blob([await fetchArrayBuffer(item.url, this.getToken())], { type: mime });
        await extWindow.docx!.renderAsync(docxBlob, container, undefined, {
          className: 'docx-wrapper',
          inWrapper: true,
          ignoreWidth: true,
          ignoreHeight: true,
        });
        return;
      }

      if (mime.includes('spreadsheetml.sheet') || mime === 'text/csv' || mime === 'application/vnd.ms-excel') {
        const XLSX = await ensureXlsx();
        const workbook = XLSX.read(await fetchArrayBuffer(item.url, this.getToken()), { type: 'array' });
        const wrap = document.createElement('div');
        wrap.className = 'panel-doc white';
        this.replaceBody(wrap);
        workbook.SheetNames.forEach((name: string, index: number) => {
          const section = document.createElement('section');
          if (workbook.SheetNames.length > 1) {
            const heading = document.createElement('h3');
            heading.textContent = name;
            section.appendChild(heading);
          }
          const html = XLSX.utils.sheet_to_html(workbook.Sheets[name]);
          const host = document.createElement('div');
          host.className = 'table-wrap';
          host.innerHTML = DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
          section.appendChild(host);
          if (index > 0) {
            section.classList.add('sheet-section');
          }
          wrap.appendChild(section);
        });
        return;
      }

      if (mime.includes('presentationml.presentation') || mime === 'application/vnd.ms-powerpoint') {
        const wrap = document.createElement('div');
        wrap.className = 'panel-doc white panel-ppt-react';
        this.replaceBody(wrap);
        const renderTarget = document.createElement('div');
        renderTarget.className = 'panel-ppt-host';
        wrap.appendChild(renderTarget);

        try {
          const buffer = await fetchArrayBuffer(item.url, this.getToken());
          const previewModule = await import('react-pptx-preview-kit');
          const PptxPreview =
            previewModule.PptxPreview ||
            (previewModule as { default?: unknown }).default;
          if (typeof PptxPreview !== 'function') {
            throw new Error('PPT 预览组件加载失败');
          }
          this.disposeReactPreview();
          this.reactPreviewRoot = createRoot(renderTarget);
          this.reactPreviewRoot.render(createElement(PptxPreview, { file: buffer }));
        } catch (err: unknown) {
          console.error('PPT预览渲染失败', err);
          this.disposeReactPreview();
          renderTarget.textContent = 'PPT 加载失败，可能是文件过大或格式复杂不受支持，请直接下载。';
        }
        return;
      }

      if (mime === 'text/markdown') {
        this.replaceBody(renderMarkdown(await fetchText(item.url, this.getToken())));
        return;
      }

      if (mime === 'application/json') {
        const pre = document.createElement('pre');
        pre.className = 'tool-block';
        const text = await fetchText(item.url, this.getToken());
        try {
          pre.textContent = JSON.stringify(JSON.parse(text), null, 2);
        } catch {
          pre.textContent = text;
        }
        this.replaceBody(pre);
        return;
      }

      if (mime === 'text/html') {
        const wrap = document.createElement('div');
        wrap.className = 'panel-html-shell';
        const iframe = document.createElement('iframe');
        iframe.src = authedUrl;
        iframe.setAttribute('sandbox', 'allow-same-origin allow-scripts allow-forms');
        iframe.className = 'panel-frame';
        wrap.appendChild(iframe);
        this.replaceBody(wrap);
        return;
      }

      if (mime.startsWith('text/')) {
        const pre = document.createElement('pre');
        pre.className = 'tool-block';
        pre.textContent = await fetchText(item.url, this.getToken());
        this.replaceBody(pre);
        return;
      }

      this.replaceBody(unsupportedNode('暂不支持此类型文件预览，请直接下载查看。'));
    } catch (error) {
      this.replaceBody(unsupportedNode(error instanceof Error ? error.message : '预览失败'));
    }
  }

  close(): void {
    this.disposeReactPreview();
    this.panel.classList.add('hidden');
    this.body.innerHTML = '';
  }

  private replaceBody(node: HTMLElement): void {
    this.disposeReactPreview();
    this.body.innerHTML = '';
    this.body.appendChild(node);
  }

  private disposeReactPreview(): void {
    this.reactPreviewRoot?.unmount();
    this.reactPreviewRoot = null;
  }
}

function translateToolStatus(status?: string): string {
  if (status === 'ok') {
    return '成功';
  }
  if (status === 'error') {
    return '失败';
  }
  return '执行中';
}
