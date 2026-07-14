import { useEffect, useRef, useState } from 'react';

import { fetchArrayBuffer } from '../api';
import type { MediaItem } from '../types';
import { mediaMime } from './media-types';

type DocxPreviewerProps = {
  item: MediaItem;
  token: string;
};

export function DocxPreviewer({ item, token }: DocxPreviewerProps) {
  const shellRef = useRef<HTMLDivElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let resizeObserver: ResizeObserver | null = null;
    const host = hostRef.current;
    if (!host) {
      return;
    }
    host.innerHTML = '';
    setError(null);

    const fitPagesToViewport = () => {
      const pages = Array.from(host.querySelectorAll<HTMLElement>('section.docx-preview'));
      if (!pages.length) {
        return;
      }

      const viewportWidth = shellRef.current?.clientWidth ?? host.clientWidth;
      const availableWidth = Math.max(320, viewportWidth - 32);

      pages.forEach((page) => {
        page.style.zoom = '1';
      });

      const pageWidth = pages[0]!.getBoundingClientRect().width;
      if (!pageWidth) {
        return;
      }

      const nextScale = Math.min(1.65, Math.max(1, availableWidth / pageWidth));
      pages.forEach((page) => {
        page.style.zoom = `${nextScale}`;
      });
    };

    void (async () => {
      try {
        const previewModule = await import('docx-preview');
        const buffer = await fetchArrayBuffer(item.url, token);
        const blob = new Blob([buffer], { type: mediaMime(item) });

        if (!cancelled) {
          await previewModule.renderAsync(blob, host, undefined, {
            className: 'docx-preview',
            inWrapper: false,
            hideWrapperOnPrint: false,
            ignoreWidth: false,
            ignoreHeight: false,
            breakPages: true,
            ignoreLastRenderedPageBreak: false,
          });

          const pages = Array.from(host.querySelectorAll<HTMLElement>('section.docx-preview'));
          pages.forEach((page) => page.classList.add('pdf-page-shell'));
          fitPagesToViewport();
          resizeObserver = new ResizeObserver(() => fitPagesToViewport());
          resizeObserver.observe(host);
        }
      } catch (nextError) {
        if (!cancelled) {
          setError(nextError instanceof Error ? nextError.message : 'Word 预览失败');
        }
      }
    })();

    return () => {
      cancelled = true;
      resizeObserver?.disconnect();
      host.innerHTML = '';
    };
  }, [item, token]);

  if (error) {
    return <div className="panel-empty">{error}</div>;
  }

  return (
    <div ref={shellRef} className="panel-pdf-shell">
      <div
        ref={hostRef}
        className="panel-doc panel-document-workspace panel-pdf-host docx-preview-shell"
      />
    </div>
  );
}
