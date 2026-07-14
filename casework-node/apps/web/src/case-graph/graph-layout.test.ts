import { describe, expect, it } from 'vitest';

import { computeCaseGraphLayout } from './graph-layout';
import type { CaseGraphData } from './types';

const OPTIONS = {
  graphWidth: 1028,
  graphHeight: 560,
  nodeWidth: 236,
  nodeHeight: 62,
  columnGap: 130,
  rowGap: 92,
};

describe('case graph layout wrapper', () => {
  it('builds the first graph around the selected investigation center', () => {
    const graphData: CaseGraphData = {
      nodes: [
        { id: 'wu', label: '伍华中', accountId: 'wu-account' },
        { id: 'incoming', label: '来款主体' },
        { id: 'outgoing', label: '去向主体' },
      ],
      edges: [
        { id: 'incoming->wu', from: 'incoming', to: 'wu', source: 'incoming', target: 'wu', tradeAmount: 10, tradeCount: 1 },
        { id: 'wu->outgoing', from: 'wu', to: 'outgoing', source: 'wu', target: 'outgoing', tradeAmount: 20, tradeCount: 1 },
      ],
    };

    const layout = computeCaseGraphLayout(graphData, {
      ...OPTIONS,
      focusAccountIds: ['wu-account'],
    });

    expect(layout.get('incoming')!.x).toBeLessThan(layout.get('wu')!.x);
    expect(layout.get('outgoing')!.x).toBeGreaterThan(layout.get('wu')!.x);
  });

  it('keeps direct node coordinates unchanged when every visible node has a position', () => {
    const graphData: CaseGraphData = {
      nodes: [
        { id: 'wu', label: '伍华中', x: 320, y: 240 },
        { id: 'feng', label: '冯燕青', x: 560, y: 240 },
        { id: 'chen', label: '陈某', x: 120, y: 240 },
      ],
      edges: [
        { id: 'chen->wu', from: 'chen', to: 'wu', source: 'chen', target: 'wu', tradeAmount: 10, tradeCount: 1 },
        { id: 'wu->feng', from: 'wu', to: 'feng', source: 'wu', target: 'feng', tradeAmount: 20, tradeCount: 1 },
      ],
    };

    const layout = computeCaseGraphLayout(graphData, OPTIONS);

    expect(layout.get('wu')).toEqual({ x: 320, y: 240 });
    expect(layout.get('feng')).toEqual({ x: 560, y: 240 });
    expect(layout.get('chen')).toEqual({ x: 120, y: 240 });
  });

  it('places extension nodes without moving existing positioned nodes', () => {
    const graphData: CaseGraphData = {
      nodes: [
        { id: 'wu', label: '伍华中', x: 320, y: 240 },
        { id: 'feng', label: '冯燕青', x: 560, y: 240 },
        { id: 'new-counterparty', label: '新增对手主体' },
      ],
      edges: [
        { id: 'feng->wu', from: 'feng', to: 'wu', source: 'feng', target: 'wu', tradeAmount: 20, tradeCount: 1 },
        { id: 'wu->new-counterparty', from: 'wu', to: 'new-counterparty', source: 'wu', target: 'new-counterparty', tradeAmount: 30, tradeCount: 1 },
      ],
    };

    const layout = computeCaseGraphLayout(graphData, OPTIONS);

    expect(layout.get('wu')).toEqual({ x: 320, y: 240 });
    expect(layout.get('feng')).toEqual({ x: 560, y: 240 });
    expect(layout.get('new-counterparty')).toBeDefined();
    expect(layout.get('new-counterparty')!.x).toBeGreaterThan(layout.get('wu')!.x);
  });

  it('ignores legacy graphContent coordinates', () => {
    const graphData: CaseGraphData = {
      nodes: [
        { id: 'wu', label: '伍华中', accountId: 'wu-account' },
        { id: 'new', label: '去向主体' },
      ],
      edges: [
        { id: 'wu->new', from: 'wu', to: 'new', source: 'wu', target: 'new', tradeAmount: 20, tradeCount: 1 },
      ],
    };

    const layout = computeCaseGraphLayout(graphData, {
      ...OPTIONS,
      focusAccountIds: ['wu-account'],
      graphContent: JSON.stringify({ cells: [{ id: 'wu', x: 10, y: 20, width: 200, height: 40 }] }),
    });

    expect(layout.get('wu')).not.toEqual({ x: 110, y: 40 });
    expect(layout.get('new')!.x).toBeGreaterThan(layout.get('wu')!.x);
  });
});
