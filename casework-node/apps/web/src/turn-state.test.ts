import { describe, expect, test } from 'vitest';

import { applyTurnEvent, createEmptyTurnState, normalizeIncomingDelta } from './turn-state';

describe('turn-state', () => {
  test('ignores late phase after completion', () => {
    const finished = applyTurnEvent(
      createEmptyTurnState(),
      {
        type: 'turn.completed',
        chatId: 'c1',
        content: 'done',
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

    expect(next.phase).toBe('completed');
    expect(next.waiting).toBe(false);
  });

  test('clears active stream buffer on completion', () => {
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
    expect(state.phase).toBe('completed');
    expect(state.waiting).toBe(false);
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
