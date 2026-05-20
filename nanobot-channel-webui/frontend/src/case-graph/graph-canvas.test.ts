import { describe, expect, it } from 'vitest';

import { computeParallelEdgeOffsetsForTest, resolveEdgeTypeForTest } from './graph-canvas';
import type { CaseGraphData } from './types';

describe('graph canvas parallel edge offsets', () => {
  it('keeps bidirectional quadratic edges on matching curve offset signs', () => {
    const edges: CaseGraphData['edges'] = [
      {
        id: 'a->b',
        from: 'a',
        to: 'b',
        source: 'a',
        target: 'b',
        tradeAmount: 1000,
        tradeCount: 1,
      },
      {
        id: 'b->a',
        from: 'b',
        to: 'a',
        source: 'b',
        target: 'a',
        tradeAmount: 2000,
        tradeCount: 1,
      },
    ];

    const offsets = computeParallelEdgeOffsetsForTest(edges);

    expect(offsets.get('a->b')).toBeGreaterThan(0);
    expect(offsets.get('b->a')).toBeGreaterThan(0);
    expect(offsets.get('a->b')).toBe(offsets.get('b->a'));
  });

  it('uses quadratic edges for stable two-sided bidirectional rendering', () => {
    expect(resolveEdgeTypeForTest()).toBe('quadratic');
  });
});
