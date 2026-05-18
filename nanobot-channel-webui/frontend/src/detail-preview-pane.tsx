import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import json from 'highlight.js/lib/languages/json';
import python from 'highlight.js/lib/languages/python';
import typescript from 'highlight.js/lib/languages/typescript';
import { useEffect, useMemo, useRef, type ReactNode } from 'react';

import { withAuthQuery } from './api';
import type { ToolDetailPayload } from './components/chat/detail-preview-context';
import { enhanceMarkdownHost, renderMarkdownHtml } from './markdown';
import { MediaPreviewRouter } from './preview-workspace/media-router';
import type { MediaItem } from './types';

hljs.registerLanguage('bash', bash);
hljs.registerLanguage('json', json);
hljs.registerLanguage('python', python);
hljs.registerLanguage('typescript', typescript);

export type DetailView =
  | { type: 'media'; item: MediaItem }
  | { type: 'tool'; title: string; payload: ToolDetailPayload };

type DetailPreviewPaneProps = {
  detailView: DetailView | null;
  open: boolean;
  width: number;
  immersive?: boolean;
  token: string;
  onClose: () => void;
  onResizeStart: () => void;
};

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
  ].some((pattern) => pattern.test(trimmed));
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

function MarkdownBlock({ value }: { value: string }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const html = useMemo(() => renderMarkdownHtml(value), [value]);

  useEffect(() => {
    if (ref.current) {
      enhanceMarkdownHost(ref.current);
    }
  }, [html]);

  return <div ref={ref} className="markdown-body" dangerouslySetInnerHTML={{ __html: html }} />;
}

function JsonOrTextBlock({ value, muted = false }: { value: string; muted?: boolean }) {
  const highlighted = useMemo(() => {
    const trimmed = value.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        return hljs.highlight(value, { language: 'json' }).value;
      } catch {
        return null;
      }
    }
    return null;
  }, [value]);

  if (highlighted) {
    return (
      <pre
        className={`tool-block hljs${muted ? ' tool-block-muted' : ''}`}
        dangerouslySetInnerHTML={{ __html: highlighted }}
      />
    );
  }

  return <pre className={`tool-block${muted ? ' tool-block-muted' : ''}`}>{value}</pre>;
}

function ToolArgsBlock({ args }: { args: Record<string, unknown> }) {
  return (
    <div className="tool-args-block">
      {Object.entries(args).map(([key, value]) => {
        const strValue = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
        return (
          <div key={key} className="tool-arg-row">
            <div className="tool-arg-key">{key}</div>
            {strValue.includes('\n') ? (
              <JsonOrTextBlock value={strValue} />
            ) : (
              <span className="tool-arg-value-inline">{strValue}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ToolSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="tool-section">
      <div className="tool-section-title">{title}</div>
      {children}
    </section>
  );
}

function ToolPreview({
  title,
  payload,
  onClose,
}: {
  title: string;
  payload: ToolDetailPayload;
  onClose: () => void;
}) {
  const formattedResult = useMemo(() => formatToolResult(payload.result), [payload.result]);

  return (
    <>
      <div className="detail-header">
        <div>
          <div className="detail-kicker">查看器</div>
          <h3>{title}</h3>
        </div>
        <div className="detail-actions">
          <button className="ghost-button" type="button" onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
      <div className="detail-body">
        <div className="tool-summary">
          {payload.durationMs
            ? `${translateToolStatus(payload.status)} · ${payload.durationMs} 毫秒`
            : translateToolStatus(payload.status)}
        </div>
        <ToolSection title="参数">
          <ToolArgsBlock args={payload.args} />
        </ToolSection>
        <ToolSection title="结果">
          {looksLikeMarkdown(formattedResult.primary) ? (
            <MarkdownBlock value={formattedResult.primary} />
          ) : (
            <JsonOrTextBlock value={formattedResult.primary} />
          )}
        </ToolSection>
        {formattedResult.trailing ? (
          <ToolSection title="附加输出">
            <JsonOrTextBlock value={formattedResult.trailing} muted />
          </ToolSection>
        ) : null}
      </div>
    </>
  );
}

function MediaPane({ item, token, onClose }: { item: MediaItem; token: string; onClose: () => void }) {
  const downloadUrl = useMemo(() => withAuthQuery(item.url, token), [item.url, token]);

  return (
    <>
      <div className="detail-header">
        <div>
          <div className="detail-kicker">查看器</div>
          <h3>{item.name || '附件'}</h3>
        </div>
        <div className="detail-actions">
          <a className="ghost-button" href={downloadUrl} download={item.name || '下载文件'}>
            下载
          </a>
          <button className="ghost-button" type="button" onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
      <div className="detail-body">
        <MediaPreviewRouter item={item} downloadUrl={downloadUrl} token={token} />
      </div>
    </>
  );
}

export function DetailPreviewPane({
  detailView,
  open,
  width,
  immersive = false,
  token,
  onClose,
  onResizeStart,
}: DetailPreviewPaneProps) {
  return (
    <section
      className={`detail-panel${open ? '' : ' hidden'}${immersive ? ' immersive' : ''}`}
      style={{ width: `${width}px` }}
    >
      <button
        type="button"
        className="detail-resize-handle"
        aria-label="调整查看器宽度"
        onMouseDown={onResizeStart}
      />
      {detailView?.type === 'media' ? (
        <MediaPane item={detailView.item} token={token} onClose={onClose} />
      ) : detailView?.type === 'tool' ? (
        <ToolPreview title={detailView.title} payload={detailView.payload} onClose={onClose} />
      ) : (
        <>
          <div className="detail-header">
            <div>
              <div className="detail-kicker">查看器</div>
              <h3>详情</h3>
            </div>
          </div>
          <div className="detail-body">
            <div className="panel-empty">请选择一项内容查看详情</div>
          </div>
        </>
      )}
    </section>
  );
}
