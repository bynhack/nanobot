import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('app remount boundaries', () => {
  it('does not remount the websocket-owning ChatWorkspace when switching threads', () => {
    const source = readFileSync(new URL('./app.tsx', import.meta.url), 'utf8');

    expect(source).not.toContain('<ChatWorkspace\n          key={threadRenderKey(currentChatId)}');
  });
});
