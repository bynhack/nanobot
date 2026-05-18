import { useEffect, useMemo, useRef } from 'react';
import { enhanceMarkdownHost, renderMarkdownHtml } from '../../../markdown';

export function MarkdownPreview({ content }: { content: string }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const html = useMemo(() => renderMarkdownHtml(content), [content]);

  useEffect(() => {
    if (hostRef.current) {
      enhanceMarkdownHost(hostRef.current);
    }
  }, [html]);

  return <div ref={hostRef} className="markdown-body" dangerouslySetInnerHTML={{ __html: html }} />;
}
