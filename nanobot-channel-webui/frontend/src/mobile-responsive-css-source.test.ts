import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('mobile responsive CSS', () => {
  it('keeps the history drawer from resizing the chat area', () => {
    const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');

    expect(css).toContain('.chat-workspace > .sidebar');
    expect(css).toContain('transform: translateX(-100%)');
  });

  it('keeps compact composer controls on one row', () => {
    const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');

    expect(css).toContain('.composer-host.compact .composer-surface');
    expect(css).toContain('grid-template-columns: minmax(0, 1fr) auto');
    expect(css).toContain('.composer-host.compact .composer-action-row');
  });
});
