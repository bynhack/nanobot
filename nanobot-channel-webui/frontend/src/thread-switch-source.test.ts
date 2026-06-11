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

  it('does not dispatch pending new-thread init before the local message is committed', () => {
    const source = readFileSync(new URL('./use-websocket-session.ts', import.meta.url), 'utf8');
    const pendingIndex = source.indexOf('const resolvingRequestedThread = pendingThreadResolversRef.current.length > 0');
    const resolveIndex = source.indexOf('resolvePendingThreads(normalized.chatId);', pendingIndex);
    const returnIndex = source.indexOf('if (resolvingRequestedThread)', resolveIndex);
    const dispatchIndex = source.indexOf("appStore.dispatch({ type: 'server.event', event: normalized });", returnIndex);

    expect(pendingIndex).toBeGreaterThan(-1);
    expect(resolveIndex).toBeGreaterThan(pendingIndex);
    expect(returnIndex).toBeGreaterThan(resolveIndex);
    expect(dispatchIndex).toBeGreaterThan(returnIndex);
  });

  it('uploads draft attachments without creating an upstream thread first', () => {
    const source = readFileSync(new URL('./use-webui-runtime.ts', import.meta.url), 'utf8');
    const adapterIndex = source.indexOf('const webuiAttachmentAdapter');
    const sendIndex = source.indexOf('async send(attachment)', adapterIndex);
    const endIndex = source.indexOf('const handleNewMessage', sendIndex);
    const adapterSource = source.slice(sendIndex, endIndex);

    expect(adapterSource).toContain('currentChatId ?? DRAFT_THREAD_ID');
    expect(adapterSource).toContain('uploadFiles(uploadChatId');
    expect(adapterSource).not.toContain('ensureThread()');
  });
});
