import { describe, expect, test } from 'vitest';

import { applyTurnEvent, createEmptyTurnState, normalizeIncomingDelta, startLocalTurn } from './turn-state';

describe('turn-state', () => {
  test('ignores late phase after stream completion', () => {
    const finished = applyTurnEvent(
      startLocalTurn(createEmptyTurnState(), { messageId: 'msg-0', startedAtMs: 0 }),
      {
        type: 'turn.phase',
        chatId: 'c1',
        phase: 'finalizing',
        resuming: false,
      },
      {
        allocateMessageId: () => 'msg-1',
        nowMs: () => 100,
      },
    );

    const next = applyTurnEvent(
      finished,
      {
        type: 'turn.phase',
        chatId: 'c1',
        phase: 'running_tools',
      },
      {
        allocateMessageId: () => 'msg-2',
        nowMs: () => 120,
      },
    );

    expect(next.phase).toBe('finalizing');
    expect(next.requestStatus).toBe('completed');
    expect(next.waiting).toBe(false);
  });

  test('commits completed content without ending the overall request', () => {
    let state = createEmptyTurnState();
    state = applyTurnEvent(
      state,
      { type: 'turn.delta', chatId: 'c1', delta: 'hel', streamId: 's1' },
      {
        allocateMessageId: () => 'msg-1',
        nowMs: () => 100,
      },
    );
    state = applyTurnEvent(
      state,
      { type: 'turn.delta', chatId: 'c1', delta: 'lo', streamId: 's1' },
      {
        allocateMessageId: () => 'msg-2',
        nowMs: () => 110,
      },
    );
    state = applyTurnEvent(
      state,
      { type: 'turn.completed', chatId: 'c1', content: '' },
      {
        allocateMessageId: () => 'msg-3',
        nowMs: () => 120,
      },
    );

    expect(state.streamBuffer).toBe('');
    expect(state.phase).toBe('streaming');
    expect(state.requestStatus).toBe('processing');
    expect(state.waiting).toBe(true);
  });

  test('tools finished and resuming true never end the overall request', () => {
    let state = startLocalTurn(createEmptyTurnState(), { messageId: 'msg-0', startedAtMs: 0 });
    state = applyTurnEvent(
      state,
      { type: 'tools.started', chatId: 'c1', tools: [{ name: 'read_file', args: {}, hint: '' }] },
      {
        allocateMessageId: () => 'msg-1',
        nowMs: () => 100,
      },
    );
    state = applyTurnEvent(
      state,
      { type: 'tools.finished', chatId: 'c1', durationMs: 4, results: [{ name: 'read_file', args: {}, status: 'ok', detail: 'ok' }] },
      {
        allocateMessageId: () => 'msg-2',
        nowMs: () => 120,
      },
    );
    expect(state.requestStatus).toBe('running_tools');
    expect(state.waiting).toBe(true);

    state = applyTurnEvent(
      state,
      { type: 'turn.phase', chatId: 'c1', phase: 'running_tools', streamId: 's1', resuming: true },
      {
        allocateMessageId: () => 'msg-3',
        nowMs: () => 140,
      },
    );
    expect(state.requestStatus).toBe('running_tools');
    expect(state.waiting).toBe(true);
  });


  test('uses resuming false as the final stream completion signal', () => {
    let state = startLocalTurn(createEmptyTurnState(), { messageId: 'msg-0', startedAtMs: 0 });
    state = applyTurnEvent(
      state,
      { type: 'turn.phase', chatId: 'c1', phase: 'streaming' },
      {
        allocateMessageId: () => 'msg-1',
        nowMs: () => 100,
      },
    );
    expect(state.requestStatus).toBe('processing');
    expect(state.waiting).toBe(true);

    state = applyTurnEvent(
      state,
      { type: 'tools.started', chatId: 'c1', tools: [{ name: 'exec', args: {}, hint: '' }] },
      {
        allocateMessageId: () => 'msg-2',
        nowMs: () => 110,
      },
    );
    expect(state.requestStatus).toBe('running_tools');
    expect(state.waiting).toBe(true);

    state = applyTurnEvent(
      state,
      { type: 'turn.phase', chatId: 'c1', phase: 'running_tools', resuming: true },
      {
        allocateMessageId: () => 'msg-3',
        nowMs: () => 120,
      },
    );
    expect(state.requestStatus).toBe('running_tools');
    expect(state.waiting).toBe(true);

    state = applyTurnEvent(
      state,
      { type: 'turn.phase', chatId: 'c1', phase: 'finalizing', streamId: 's1', resuming: false },
      {
        allocateMessageId: () => 'msg-4',
        nowMs: () => 5000,
      },
    );
    expect(state.phase).toBe('finalizing');
    expect(state.requestStatus).toBe('completed');
    expect(state.waiting).toBe(false);
    expect(state.lastDurationMs).toBe(5000);
  });

  test('appends turn.delta chunks exactly as received', () => {
    expect(normalizeIncomingDelta('', '你好')).toBe('你好');
    expect(normalizeIncomingDelta('你好', '你好！有什么我可以帮你的吗？')).toBe('你好！有什么我可以帮你的吗？');
    expect(normalizeIncomingDelta('你好！有什么', '什么')).toBe('什么');
  });

  test('preserves legitimate repeated leading characters in true incremental chunks', () => {
    expect(normalizeIncomingDelta('202', '2-09-05')).toBe('2-09-05');
    expect(normalizeIncomingDelta('|------|', '|------|')).toBe('|------|');
    expect(normalizeIncomingDelta('|------', '------|')).toBe('------|');
    expect(normalizeIncomingDelta('P11-G2:620', '0')).toBe('0');
    expect(normalizeIncomingDelta('490', '0+100(全勤）')).toBe('0+100(全勤）');
  });

  test('concatenates turn.delta chunks in arrival order', () => {
    let state = createEmptyTurnState();
    state = applyTurnEvent(
      state,
      { type: 'turn.delta', chatId: 'c1', delta: '你好', streamId: 's1' },
      {
        allocateMessageId: () => 'msg-1',
        nowMs: () => 100,
      },
    );
    state = applyTurnEvent(
      state,
      { type: 'turn.delta', chatId: 'c1', delta: '你好！有什么我可以帮你的吗？', streamId: 's1' },
      {
        allocateMessageId: () => 'msg-2',
        nowMs: () => 110,
      },
    );

    expect(state.streamBuffer).toBe('你好你好！有什么我可以帮你的吗？');
  });
});
