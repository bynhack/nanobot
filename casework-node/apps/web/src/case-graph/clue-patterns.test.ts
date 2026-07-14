import { describe, expect, it } from 'vitest';

import { buildCaseGraphViewModel } from './graph-analysis';
import { detectCaseGraphCluePatterns } from './clue-patterns';
import type { CaseGraphData } from './types';

describe('case graph clue pattern detection', () => {
  it('detects transit chains and convergence clues from the current graph', () => {
    const graphData: CaseGraphData = {
      nodes: [
        { id: 'source-a', label: '上游甲' },
        { id: 'source-b', label: '上游乙' },
        { id: 'middle', label: '中转人' },
        { id: 'target', label: '去向人' },
      ],
      edges: [
        { id: 'source-a->middle', from: 'source-a', to: 'middle', source: 'source-a', target: 'middle', tradeAmount: 20_000, tradeCount: 2 },
        { id: 'source-b->middle', from: 'source-b', to: 'middle', source: 'source-b', target: 'middle', tradeAmount: 16_000, tradeCount: 1 },
        { id: 'middle->target', from: 'middle', to: 'target', source: 'middle', target: 'target', tradeAmount: 18_000, tradeCount: 1 },
      ],
    };

    const matches = detectCaseGraphCluePatterns(graphData, buildCaseGraphViewModel(graphData));

    expect(matches.some((match) => match.type === 'transit_chain' && match.nodeIds.includes('middle'))).toBe(true);
    expect(matches.some((match) => match.type === 'convergence' && match.nodeIds[0] === 'middle')).toBe(true);
    expect(matches.every((match) => match.caseTypes.length > 0 && match.suggestion.includes('核查'))).toBe(true);
  });

  it('returns no clue patterns when the graph has no money edges', () => {
    const graphData: CaseGraphData = {
      nodes: [
        { id: 'a', label: '主体甲' },
        { id: 'b', label: '主体乙' },
      ],
      edges: [],
    };

    expect(detectCaseGraphCluePatterns(graphData, buildCaseGraphViewModel(graphData))).toEqual([]);
  });
});
