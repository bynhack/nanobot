import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { File } from './file';
import { STORAGE_KEYS } from '../../store';

describe('assistant-ui file', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders image previews for image mime types backed by direct URLs', () => {
    const html = renderToStaticMarkup(
      createElement(File, {
        type: 'file',
        data: 'https://example.com/cat.png',
        filename: 'cat.png',
        mimeType: 'image/png',
      }),
    );

    expect(html).toContain('<img');
    expect(html).toContain('https://example.com/cat.png');
    expect(html).not.toContain('data-slot="file-name"');
    expect(html).not.toContain('data-slot="file-download"');
  });

  it('renders non-image files as previewable cards', () => {
    const html = renderToStaticMarkup(
      createElement(File, {
        type: 'file',
        data: '/media/report.xlsx',
        filename: '员工名单.xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }),
    );

    expect(html).toContain('role="button"');
    expect(html).toContain('aria-label="预览文件 员工名单.xlsx"');
    expect(html).toContain('data-slot="file-download"');
    expect(html).toContain('员工名单.xlsx');
  });

  it('adds auth query to local direct download links', () => {
    vi.stubGlobal('window', {
      location: { origin: 'http://127.0.0.1:8081' },
      localStorage: {
        getItem: (key: string) => key === STORAGE_KEYS.authToken ? 'access-token' : null,
      },
    });

    const html = renderToStaticMarkup(
      createElement(File, {
        type: 'file',
        data: '/api/upstream/media/sig123/payload456',
        filename: 'preview.html',
        mimeType: 'text/html',
      }),
    );

    expect(html).toContain('/api/upstream/media/sig123/payload456?auth_token=access-token');
  });

  it('does not add auth query to public media links', () => {
    vi.stubGlobal('window', {
      location: { origin: 'http://127.0.0.1:8081' },
      localStorage: {
        getItem: (key: string) => key === STORAGE_KEYS.authToken ? 'access-token' : null,
      },
    });

    const html = renderToStaticMarkup(
      createElement(File, {
        type: 'file',
        data: '/api/public-media/payload456',
        filename: 'preview.html',
        mimeType: 'text/html',
      }),
    );

    expect(html).toContain('href="/api/public-media/payload456"');
    expect(html).not.toContain('auth_token=');
  });
});
