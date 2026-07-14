import { describe, expect, it } from 'vitest';

import { createInitialState, reducer } from '../store';
import { createCaseGraphState, reduceCaseGraphState } from './store';

describe('case graph store reducer', () => {
  it('stores graph query result', () => {
    const state = createCaseGraphState();
    const next = reduceCaseGraphState(state, {
      type: 'caseGraph.graph.query.loaded',
      result: {
        nodes: [{ id: '1001', label: '张三' }],
        money: [],
        phone: [],
        groups: {},
        sourceSelectId: ['张三'],
        excludedTrades: [],
      },
    });

    expect(next.graphData?.nodes[0]?.id).toBe('1001');
    expect(next.originData?.sourceSelectId).toEqual(['张三']);
  });

  it('hydrates graph detail into active state', () => {
    const next = reduceCaseGraphState(createCaseGraphState(), {
      type: 'caseGraph.graph.loaded',
      graph: {
        graph_id: 'graph-1',
        caseId: 'case-1',
        graphName: '主图',
        tradeCards: [{ accountId: '1001', tradeCard: '6222', accountName: '张三' }],
        groupMap: {},
        excludedTrades: [],
        excludedAccountId: null,
        drillNums: 10,
        drillType: null,
        graphData: {
          nodes: [{ id: '1001', label: '张三' }],
          money: [],
          phone: [],
          groups: {},
          sourceSelectId: ['张三'],
        },
      },
    });

    expect(next.activeCaseId).toBe('case-1');
    expect(next.activeGraphId).toBe('graph-1');
    expect(next.tradeCards[0]?.accountId).toBe('1001');
    expect(next.graphData?.nodes[0]?.id).toBe('1001');
  });

  it('delegates case-graph actions through the root app reducer', () => {
    const state = createInitialState({ title: 'Nanobot', authRequired: false });
    const next = reducer(state, {
      type: 'caseGraph.graph.drilldown.loaded',
      tradeCards: [{ accountId: '2001', tradeCard: '9558', accountName: '李四' }],
    });

    expect(next.caseGraph.tradeCards).toEqual([
      { accountId: '2001', tradeCard: '9558', accountName: '李四' },
    ]);
  });
});
