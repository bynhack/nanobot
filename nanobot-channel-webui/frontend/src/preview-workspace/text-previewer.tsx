import DOMPurify from 'dompurify';
import { useEffect, useMemo, useRef, useState } from 'react';

import { fetchText } from '../api';
import { enhanceMarkdownHost, renderMarkdownHtml } from '../markdown';
import type { MediaItem } from '../types';

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

type TextPreviewerProps = {
  item: MediaItem;
  token: string;
  markdown?: boolean;
  jsonText?: boolean;
};

export function TextPreviewer({ item, token, markdown = false, jsonText = false }: TextPreviewerProps) {
  const [value, setValue] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const text = await fetchText(item.url, token);
        if (!active) {
          return;
        }
        if (jsonText) {
          try {
            setValue(JSON.stringify(JSON.parse(text), null, 2));
          } catch {
            setValue(text);
          }
          return;
        }
        setValue(text);
      } catch (nextError) {
        if (active) {
          setError(nextError instanceof Error ? nextError.message : '文本预览失败');
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [item.url, jsonText, token]);

  if (error) {
    return <div className="panel-empty">{error}</div>;
  }
  if (value == null) {
    return <div className="panel-empty">正在加载预览…</div>;
  }
  if (markdown) {
    return (
      <div className="panel-doc">
        <MarkdownBlock value={value} />
      </div>
    );
  }
  return <pre className="tool-block">{value}</pre>;
}

export function HtmlPreviewer({ item, downloadUrl }: { item: MediaItem; downloadUrl: string }) {
  return (
    <div className="panel-html-shell">
      <iframe
        title={item.name || 'HTML 预览'}
        src={downloadUrl}
        sandbox="allow-same-origin allow-scripts allow-forms"
        className="panel-frame"
      />
    </div>
  );
}

export function HtmlSheetPreview({ html }: { html: string }) {
  return (
    <div
      className="panel-doc white"
      dangerouslySetInnerHTML={{
        __html: DOMPurify.sanitize(html, { USE_PROFILES: { html: true } }),
      }}
    />
  );
}
