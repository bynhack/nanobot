import { createElement, useEffect, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { fetchArrayBuffer } from '../api';
import type { MediaItem } from '../types';

type PptPreviewerProps = {
  item: MediaItem;
  token: string;
};

export function PptPreviewer({ item, token }: PptPreviewerProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<Root | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const host = hostRef.current;
    if (!host) {
      return;
    }
    host.innerHTML = '';
    setError(null);

    void (async () => {
      try {
        const buffer = await fetchArrayBuffer(item.url, token);
        const previewModule = await import('react-pptx-preview-kit');
        const PptxPreview =
          previewModule.PptxPreview ||
          (previewModule as { default?: unknown }).default;
        if (typeof PptxPreview !== 'function') {
          throw new Error('PPT 预览组件加载失败');
        }
        if (cancelled) {
          return;
        }
        rootRef.current?.unmount();
        rootRef.current = createRoot(host);
        rootRef.current.render(createElement(PptxPreview, { file: buffer }));
      } catch (nextError) {
        if (!cancelled) {
          setError(nextError instanceof Error ? nextError.message : 'PPT 预览失败');
        }
      }
    })();

    return () => {
      cancelled = true;
      rootRef.current?.unmount();
      rootRef.current = null;
      host.innerHTML = '';
    };
  }, [item.url, token]);

  if (error) {
    return <div className="panel-empty">{error}</div>;
  }

  return (
    <div className="panel-doc white panel-document-workspace panel-ppt-react">
      <div ref={hostRef} className="panel-ppt-host" />
    </div>
  );
}
