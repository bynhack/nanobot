import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('websocket thread switching source contract', () => {
  it('loads thread history before attaching the websocket channel', () => {
    const source = readFileSync(new URL('./use-websocket-session.ts', import.meta.url), 'utf8');
    const loadIndex = source.indexOf('loadUpstreamThread(threadId');
    const dispatchIndex = source.indexOf("event: { type: 'session.history'");
    const attachIndex = source.indexOf("send({ type: 'attach'");

    expect(loadIndex).toBeGreaterThan(-1);
    expect(dispatchIndex).toBeGreaterThan(loadIndex);
    expect(attachIndex).toBeGreaterThan(dispatchIndex);
  });

  it('guards against stale thread history responses', () => {
    const source = readFileSync(new URL('./use-websocket-session.ts', import.meta.url), 'utf8');

    expect(source).toContain('createThreadSwitchGuard');
    expect(source).toContain('isCurrent(switchRequestId)');
  });
});
