import { describe, expect, it } from 'vitest';

import { buildFundFlowView } from './fund-flow-analysis';
import type { CaseGraphData } from './types';

function createGraph(): CaseGraphData {
  return {
    nodes: [
      { id: 'a', label: '上游账户', accountId: 'account-a', tradeCard: 'card-a' },
      { id: 'b', label: '下游账户', accountId: 'account-b', tradeCard: 'card-b' },
      { id: 'c', label: '已取消账户', accountId: 'account-c', tradeCard: 'card-c' },
    ],
    edges: [
      {
        id: 'a-b',
        from: 'a',
        to: 'b',
        source: 'a',
        target: 'b',
        tradeAmount: 160,
        tradeCount: 3,
        tradeIds: ['a-to-b-1', 'a-to-b-2', 'b-to-a'],
      },
      {
        id: 'a-c',
        from: 'a',
        to: 'c',
        source: 'a',
        target: 'c',
        tradeAmount: 999,
        tradeCount: 1,
        tradeIds: ['a-to-c'],
      },
      {
        id: 'excluded-edge',
        from: 'b',
        to: 'c',
        source: 'b',
        target: 'c',
        tradeAmount: 888,
        tradeCount: 1,
        tradeIds: ['excluded-edge-trade'],
        isExcluded: true,
      },
    ],
    excludedNodes: [{ nodeId: 'c', label: '已取消账户' }],
    tradeFacts: {
      'a-to-b-1': {
        tradeId: 'a-to-b-1',
        tradeAmount: 100,
        payerAccountId: 'account-a',
        payeeAccountId: 'account-b',
      },
      'a-to-b-2': {
        tradeId: 'a-to-b-2',
        tradeAmount: 40,
        payerTradeCard: 'card-a',
        payeeTradeCard: 'card-b',
      },
      'b-to-a': {
        tradeId: 'b-to-a',
        tradeAmount: 20,
        payerAccountId: 'account-b',
        payeeAccountId: 'account-a',
      },
      'a-to-c': { tradeId: 'a-to-c', tradeAmount: 999 },
      'excluded-edge-trade': { tradeId: 'excluded-edge-trade', tradeAmount: 888 },
      orphan: {
        tradeId: 'orphan',
        tradeAmount: 10_000,
        payerAccountId: 'account-a',
        payeeAccountId: 'account-b',
      },
    },
  };
}

describe('fund flow analysis', () => {
  it('aggregates both directions into one net relation using payer and payee endpoints', () => {
    const result = buildFundFlowView(createGraph(), { minNetAmount: 100, minDirectionStrength: 0.5 });

    expect(result.nodes.map((node) => node.id)).toEqual(['a', 'b']);
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0]).toMatchObject({
      source: 'a',
      target: 'b',
      sourceToTargetAmount: 140,
      targetToSourceAmount: 20,
      sourceToTargetCount: 2,
      targetToSourceCount: 1,
      netAmount: 120,
      grossAmount: 160,
      directionStrength: 0.75,
      direction: 'clear',
    });
  });

  it('keeps a relation visible as neutral when it misses a selected threshold', () => {
    const result = buildFundFlowView(createGraph(), { minNetAmount: 200, minDirectionStrength: 0.8 });

    expect(result.edges).toHaveLength(1);
    expect(result.edges[0]).toMatchObject({
      source: 'a',
      target: 'b',
      direction: 'neutral',
      netAmount: 120,
    });
  });

  it('uses only current effective edge facts and removes excluded nodes and edges', () => {
    const graph = createGraph();
    graph.edges[0]!.tradeIds = ['a-to-b-1', 'b-to-a'];

    const result = buildFundFlowView(graph, { minNetAmount: 0, minDirectionStrength: 0 });

    expect(result.nodes.map((node) => node.id)).toEqual(['a', 'b']);
    expect(result.edges[0]).toMatchObject({ grossAmount: 120, netAmount: 80 });
    expect(result.edges[0]?.tradeFacts.map((fact) => fact.tradeId)).toEqual(['a-to-b-1', 'b-to-a']);
  });

  it('falls back to the current edge direction when an older trade fact has no endpoints', () => {
    const graph: CaseGraphData = {
      nodes: [{ id: 'a', label: '甲' }, { id: 'b', label: '乙' }],
      edges: [{
        id: 'a-b',
        from: 'a',
        to: 'b',
        source: 'a',
        target: 'b',
        tradeAmount: 300,
        tradeCount: 1,
        tradeIds: ['legacy'],
      }],
      tradeFacts: { legacy: { tradeId: 'legacy', tradeAmount: 300 } },
    };

    const result = buildFundFlowView(graph, { minNetAmount: 0, minDirectionStrength: 0 });

    expect(result.edges[0]).toMatchObject({ source: 'a', target: 'b', netAmount: 300, direction: 'clear' });
  });
});
