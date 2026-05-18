import { describe, expect, it } from 'vitest';

const fsModule = 'node:fs';
const { readFileSync } = (await import(fsModule)) as {
  readFileSync(path: URL, encoding: 'utf8'): string;
};
const styles = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');

function readRule(selector: string) {
  const start = styles.indexOf(`${selector} {`);
  expect(start).toBeGreaterThan(-1);
  const bodyStart = styles.indexOf('{', start) + 1;
  const bodyEnd = styles.indexOf('\n  }', bodyStart);
  return styles.slice(bodyStart, bodyEnd);
}

describe('content tool affordance visibility', () => {
  it('hides streamdown table controls until hover or keyboard focus', () => {
    expect(styles).toContain('.streamdown-body [data-streamdown="table-wrapper"] > div:first-child:not(:last-child)');
    expect(styles).toContain('opacity: 0;');
    expect(styles).toContain('.streamdown-body [data-streamdown="table-wrapper"]:hover > div:first-child:not(:last-child)');
    expect(styles).toContain('.streamdown-body [data-streamdown="table-wrapper"]:focus-within > div:first-child:not(:last-child)');
  });

  it('keeps content media and file tools quiet until interaction', () => {
    expect(styles).toContain('.streamdown-body [data-streamdown="image-wrapper"] > button[title="下载图片"]');
    expect(styles).toContain('.aui-file-root [data-slot="file-download"]');
    expect(styles).toContain('.aui-file-root:hover [data-slot="file-download"]');
    expect(styles).toContain('.aui-file-root:focus-within [data-slot="file-download"]');
  });

  it('does not add an outer chrome layer for streamdown table tools', () => {
    const tableWrapper = readRule('.streamdown-body [data-streamdown="table-wrapper"]');
    expect(tableWrapper).toContain('position: relative;');
    expect(tableWrapper).toContain('gap: 0;');
    expect(tableWrapper).toContain('padding: 0;');
    expect(tableWrapper).toContain('border: 0;');
    expect(tableWrapper).toContain('border-radius: 0;');
    expect(tableWrapper).toContain('background: transparent;');
    expect(tableWrapper).toContain('box-shadow: none;');

    const tableToolbar = readRule('.streamdown-body [data-streamdown="table-wrapper"] > div:first-child:not(:last-child)');
    expect(tableToolbar).toContain('position: absolute;');
    expect(tableToolbar).toContain('pointer-events: none;');

    const tableScroller = readRule('.streamdown-body [data-streamdown="table-wrapper"] > div:last-child');
    expect(tableScroller).toContain('border: 0;');
    expect(tableScroller).toContain('box-shadow: none;');
    expect(tableScroller).not.toContain('border: 1px');

    const tableCells = readRule('.streamdown-body [data-streamdown="table-header-cell"],\n  .streamdown-body [data-streamdown="table-cell"]');
    expect(tableCells).toContain('border: 0;');
    expect(tableCells).not.toContain('border: 1px');
    expect(styles).toContain('.streamdown-body [data-streamdown="table-row"] > :not(:first-child)');
    expect(styles).toContain('.streamdown-body [data-streamdown="table-body"] [data-streamdown="table-row"] > [data-streamdown="table-cell"]');
  });

  it('keeps plain streamdown tables from inheriting markdown outer frame styles', () => {
    const streamdownTable = readRule('.streamdown-body table');
    expect(streamdownTable).toContain('border: 0;');
    expect(streamdownTable).toContain('outline: 0;');

    const streamdownCells = readRule('.streamdown-body th, .streamdown-body td');
    expect(streamdownCells).toContain('border: 0;');
    expect(streamdownCells).not.toContain('border: 1px');

    expect(styles).toContain('.streamdown-body tr > :not(:first-child)');
    expect(styles).toContain('.streamdown-body tbody tr > td');
  });

  it('hides markdown horizontal rules in streamdown responses', () => {
    const horizontalRule = readRule('.streamdown-body [data-streamdown="horizontal-rule"]');
    expect(horizontalRule).toContain('display: none;');
  });

  it('keeps mermaid diagrams content-sized instead of stretching a full-width chrome frame', () => {
    const mermaid = readRule('.streamdown-body [data-streamdown="mermaid"]');
    expect(mermaid).toContain('display: inline-block;');
    expect(mermaid).toContain('width: auto;');
    expect(mermaid).toContain('max-width: 100%;');

    const mermaidShell = readRule('.streamdown-body [data-streamdown="mermaid"] > div');
    expect(mermaidShell).toContain('background: transparent;');
    expect(mermaidShell).toContain('border: 0;');
    expect(mermaidShell).toContain('box-shadow: none;');
  });

  it('renders unlabeled code blocks as content-sized preformatted blocks without outer chrome', () => {
    const codeBlock = readRule('.streamdown-body [data-streamdown="code-block"]:not([data-language])');
    expect(codeBlock).toContain('display: inline-flex;');
    expect(codeBlock).toContain('width: auto;');
    expect(codeBlock).toContain('padding: 0;');
    expect(codeBlock).toContain('border: 0;');
    expect(codeBlock).toContain('background: transparent;');

    const codeBody = readRule('.streamdown-body [data-streamdown="code-block"]:not([data-language]) [data-streamdown="code-block-body"]');
    expect(codeBody).toContain('padding: 0;');
    expect(codeBody).toContain('border: 0;');
    expect(codeBody).toContain('background: transparent;');
  });
});
