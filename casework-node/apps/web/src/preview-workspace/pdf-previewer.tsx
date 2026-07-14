import { useEffect, useRef, useState } from 'react';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';
import standardFontUrl from 'pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf?url';

import { withAuthQuery } from '../api';
import type { MediaItem } from '../types';

type PdfPreviewerProps = {
  item: MediaItem;
  token: string;
};

export function PdfPreviewer({ item, token }: PdfPreviewerProps) {
  const shellRef = useRef<HTMLDivElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewportWidth, setViewportWidth] = useState(0);

  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) {
      return;
    }

    const updateWidth = () => {
      const nextWidth = Math.floor(shell.clientWidth);
      setViewportWidth((currentWidth) =>
        Math.abs(currentWidth - nextWidth) >= 2 ? nextWidth : currentWidth,
      );
    };

    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(shell);
    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let loadingTask: { destroy?: () => void; promise: Promise<any> } | null = null;
    let pdfDocument: { destroy?: () => void; cleanup?: () => void } | null = null;

    const host = hostRef.current;
    if (!host) {
      return;
    }
    if (viewportWidth <= 0) {
      return;
    }
    host.innerHTML = '';
    setError(null);

    void (async () => {
      try {
        const pdfjsLib = await import('pdfjs-dist');
        pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
        const standardFontDataUrl = standardFontUrl.replace(/\/[^/]+$/, '/');
        loadingTask = pdfjsLib.getDocument({
          url: withAuthQuery(item.url, token),
          standardFontDataUrl,
        });
        const pdf = await loadingTask.promise;
        pdfDocument = pdf;

        for (let index = 1; index <= pdf.numPages; index += 1) {
          if (cancelled) {
            return;
          }

          const page = await pdf.getPage(index);
          const baseViewport = page.getViewport({ scale: 1 });
          const availableWidth = Math.max(320, viewportWidth - 32);
          const scale = Math.min(1.8, Math.max(1, availableWidth / baseViewport.width));
          const viewport = page.getViewport({ scale });
          const outputScale = window.devicePixelRatio || 1;

          const pageShell = document.createElement('div');
          pageShell.className = 'pdf-page-shell';
          const canvas = document.createElement('canvas');
          canvas.className = 'panel-canvas';
          const context = canvas.getContext('2d');
          if (!context) {
            continue;
          }

          canvas.width = Math.floor(viewport.width * outputScale);
          canvas.height = Math.floor(viewport.height * outputScale);
          canvas.style.width = `${Math.floor(viewport.width)}px`;
          canvas.style.height = `${Math.floor(viewport.height)}px`;
          pageShell.style.width = `${Math.floor(viewport.width)}px`;
          pageShell.style.height = `${Math.floor(viewport.height)}px`;
          pageShell.appendChild(canvas);
          host.appendChild(pageShell);

          await page.render({
            canvasContext: context,
            transform: outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : null,
            viewport,
          }).promise;

          if ('TextLayer' in pdfjsLib) {
            const textContent = await page.getTextContent();
            const textLayerDiv = document.createElement('div');
            textLayerDiv.className = 'pdf-text-layer';
            pageShell.appendChild(textLayerDiv);
            const textLayer = new pdfjsLib.TextLayer({
              container: textLayerDiv,
              textContentSource: textContent,
              viewport,
            });
            await textLayer.render();
          }
        }
      } catch (nextError) {
        if (!cancelled) {
          setError(nextError instanceof Error ? nextError.message : 'PDF 预览失败');
        }
      }
    })();

    return () => {
      cancelled = true;
      host.innerHTML = '';
      loadingTask?.destroy?.();
      pdfDocument?.cleanup?.();
      pdfDocument?.destroy?.();
    };
  }, [item.url, token, viewportWidth]);

  if (error) {
    return <div className="panel-empty">{error}</div>;
  }

  return (
    <div ref={shellRef} className="panel-pdf-shell">
      <div ref={hostRef} className="panel-doc panel-document-workspace panel-pdf-host" />
    </div>
  );
}
