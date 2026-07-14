import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { File } from './file';

describe('assistant-ui file', () => {
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
});
