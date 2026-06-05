import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('app mobile responsive wiring', () => {
  it('exposes history and compact composer controls on narrow screens', () => {
    const source = readFileSync(new URL('./app.tsx', import.meta.url), 'utf8');

    expect(source).toContain('showSidebarToggle={true}');
    expect(source).toContain('compact={viewportWidth <= MOBILE_SIDEBAR_BREAKPOINT}');
  });
});
