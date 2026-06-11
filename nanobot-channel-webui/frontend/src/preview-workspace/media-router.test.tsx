import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./pdf-previewer', () => ({ PdfPreviewer: () => createElement('div', { 'data-preview': 'pdf' }) }));
vi.mock('./docx-previewer', () => ({ DocxPreviewer: () => createElement('div', { 'data-preview': 'docx' }) }));
vi.mock('./sheet-previewer', () => ({ SheetPreviewer: () => createElement('div', { 'data-preview': 'sheet' }) }));
vi.mock('./ppt-previewer', () => ({ PptPreviewer: () => createElement('div', { 'data-preview': 'ppt' }) }));
vi.mock('./text-previewer', () => ({
  TextPreviewer: ({ markdown, jsonText }: { markdown?: boolean; jsonText?: boolean }) =>
    createElement('div', {
      'data-preview': markdown ? 'markdown' : jsonText ? 'json' : 'text',
    }),
  HtmlPreviewer: () => createElement('div', { 'data-preview': 'html' }),
}));

import { MediaPreviewRouter } from './media-router';

describe('MediaPreviewRouter', () => {
  it('routes by mime type', () => {
    expect(
      renderToStaticMarkup(
        createElement(MediaPreviewRouter, {
          item: { url: '/media/report.pdf', name: 'report.pdf', mime: 'application/pdf' },
          downloadUrl: '/media/report.pdf',
          token: '',
        }),
      ),
    ).toContain('data-preview="pdf"');

    expect(
      renderToStaticMarkup(
        createElement(MediaPreviewRouter, {
          item: { url: '/media/report.docx', name: 'report.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
          downloadUrl: '/media/report.docx',
          token: '',
        }),
      ),
    ).toContain('data-preview="docx"');

    expect(
      renderToStaticMarkup(
        createElement(MediaPreviewRouter, {
          item: { url: '/media/report.xlsx', name: 'report.xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
          downloadUrl: '/media/report.xlsx',
          token: '',
        }),
      ),
    ).toContain('data-preview="sheet"');

    expect(
      renderToStaticMarkup(
        createElement(MediaPreviewRouter, {
          item: { url: '/media/report.pptx', name: 'report.pptx', mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' },
          downloadUrl: '/media/report.pptx',
          token: '',
        }),
      ),
    ).toContain('data-preview="ppt"');
  });

  it('handles text/html/json and unsupported types', () => {
    expect(
      renderToStaticMarkup(
        createElement(MediaPreviewRouter, {
          item: { url: '/media/report.md', name: 'report.md', mime: 'text/markdown' },
          downloadUrl: '/media/report.md',
          token: '',
        }),
      ),
    ).toContain('data-preview="markdown"');

    expect(
      renderToStaticMarkup(
        createElement(MediaPreviewRouter, {
          item: { url: '/media/report.json', name: 'report.json', mime: 'application/json' },
          downloadUrl: '/media/report.json',
          token: '',
        }),
      ),
    ).toContain('data-preview="json"');

    expect(
      renderToStaticMarkup(
        createElement(MediaPreviewRouter, {
          item: { url: '/media/report.html', name: 'report.html', mime: 'text/html' },
          downloadUrl: '/media/report.html',
          token: '',
        }),
      ),
    ).toContain('data-preview="html"');

    expect(
      renderToStaticMarkup(
        createElement(MediaPreviewRouter, {
          item: { url: '/api/upstream/media/sig/payload', name: 'hello.html', mime: 'application/octet-stream' },
          downloadUrl: '/api/upstream/media/sig/payload?auth_token=token',
          token: 'token',
        }),
      ),
    ).toContain('data-preview="html"');

    expect(
      renderToStaticMarkup(
        createElement(MediaPreviewRouter, {
          item: { url: '/media/report.bin', name: 'report.bin', mime: 'application/octet-stream' },
          downloadUrl: '/media/report.bin',
          token: '',
        }),
      ),
    ).toContain('暂不支持此类型文件预览');
  });
});
