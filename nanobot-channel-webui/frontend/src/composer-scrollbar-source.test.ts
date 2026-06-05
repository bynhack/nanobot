import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('composer scrollbar styling', () => {
  it('hides native textarea scrollbars while preserving scroll behavior', () => {
    const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');

    expect(css).toContain('.composer-input');
    expect(css).toContain('scrollbar-width: none');
    expect(css).toContain('.composer-input::-webkit-scrollbar');
  });
});
