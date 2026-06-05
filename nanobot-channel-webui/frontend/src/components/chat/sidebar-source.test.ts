import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('ChatSidebar source', () => {
  it('renders a close button inside the mobile drawer', () => {
    const source = readFileSync(new URL('./sidebar.tsx', import.meta.url), 'utf8');

    expect(source).toContain('onCloseSidebar');
    expect(source).toContain('aria-label="收起侧边栏"');
    expect(source).toContain('className="sidebar-close"');
  });
});
