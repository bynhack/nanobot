import { describe, expect, it } from 'vitest';

import { computeCaseGraphLayout, extractGraphContentNodePositions } from './graph-layout';
import type { CaseGraphData } from './types';

const OPTIONS = {
  graphWidth: 1028,
  graphHeight: 560,
  nodeWidth: 236,
  nodeHeight: 62,
  columnGap: 130,
  rowGap: 92,
};

describe('case graph layout helpers', () => {
  it('reuses saved node positions from graphContent cells', () => {
    const positions = extractGraphContentNodePositions(
      JSON.stringify({
        cells: [
          {
            id: 'node-1',
            x: 10,
            y: 20,
            width: 200,
            height: 40,
          },
          {
            id: 'edge-1',
            source: { cell: 'node-1' },
            target: { cell: 'node-2' },
          },
        ],
      }),
      236,
      62,
    );

    expect(positions.get('node-1')).toEqual({ x: 110, y: 40 });
    expect(positions.has('edge-1')).toBe(false);
  });

  it('builds anchor-gap columns that keep major nodes apart like the legacy graph', () => {
    const graphData: CaseGraphData = {
      nodes: [
        { id: 'wu', label: '伍华中', accountId: 'wu-account' },
        { id: 'feng', label: '冯燕青', accountId: 'feng-account' },
        { id: 'a-in-1', label: '左一' },
        { id: 'a-in-2', label: '左二' },
        { id: 'a-out', label: '中一' },
        { id: 'bridge', label: '中二' },
        { id: 'b-in', label: '中三' },
        { id: 'b-out', label: '右一' },
      ],
      edges: [
        { id: 'a-in-1->wu', from: 'a-in-1', to: 'wu', source: 'a-in-1', target: 'wu', tradeAmount: 10, tradeCount: 1 },
        { id: 'a-in-2->wu', from: 'a-in-2', to: 'wu', source: 'a-in-2', target: 'wu', tradeAmount: 10, tradeCount: 1 },
        { id: 'wu->a-out', from: 'wu', to: 'a-out', source: 'wu', target: 'a-out', tradeAmount: 20, tradeCount: 1 },
        { id: 'wu->bridge', from: 'wu', to: 'bridge', source: 'wu', target: 'bridge', tradeAmount: 30, tradeCount: 1 },
        { id: 'bridge->feng', from: 'bridge', to: 'feng', source: 'bridge', target: 'feng', tradeAmount: 40, tradeCount: 1 },
        { id: 'b-in->feng', from: 'b-in', to: 'feng', source: 'b-in', target: 'feng', tradeAmount: 50, tradeCount: 1 },
        { id: 'feng->b-out', from: 'feng', to: 'b-out', source: 'feng', target: 'b-out', tradeAmount: 60, tradeCount: 1 },
        { id: 'feng->wu', from: 'feng', to: 'wu', source: 'feng', target: 'wu', tradeAmount: 70, tradeCount: 1 },
      ],
    };

    const layout = computeCaseGraphLayout(graphData, {
      ...OPTIONS,
      focusAccountIds: ['wu-account', 'feng-account'],
      preferPersistedPositions: false,
    });

    const x = (nodeId: string) => layout.get(nodeId)!.x;

    expect(x('a-in-1')).toBeLessThan(x('wu'));
    expect(x('a-in-2')).toBeLessThan(x('wu'));
    expect(x('wu')).toBeLessThan(x('a-out'));
    expect(x('wu')).toBeLessThan(x('bridge'));
    expect(x('wu')).toBeLessThan(x('bridge'));
    expect(x('a-out')).toBeLessThan(x('feng'));
    expect(x('bridge')).toBeLessThan(x('feng'));
    expect(x('b-in')).toBeLessThan(x('feng'));
    expect(x('feng')).toBeLessThan(x('b-out'));
  });

  it('ignores null persisted positions and falls back to structured layout', () => {
    const graphData: CaseGraphData = {
      nodes: [
        { id: 'wu', label: '伍华中', x: null as unknown as number, y: null as unknown as number },
        { id: 'feng', label: '冯燕青', x: null as unknown as number, y: null as unknown as number },
        { id: 'bridge', label: '桥接节点', x: null as unknown as number, y: null as unknown as number },
      ],
      edges: [
        { id: 'bridge->wu', from: 'bridge', to: 'wu', source: 'bridge', target: 'wu', tradeAmount: 10, tradeCount: 1 },
        { id: 'wu->feng', from: 'wu', to: 'feng', source: 'wu', target: 'feng', tradeAmount: 20, tradeCount: 1 },
      ],
    };
    const layout = computeCaseGraphLayout(graphData, OPTIONS);

    const distinctPositions = new Set(
      graphData.nodes.map((node) => {
        const point = layout.get(node.id);
        return point ? `${point.x},${point.y}` : 'missing';
      }),
    );

    expect(distinctPositions.size).toBeGreaterThan(1);
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

  it('keeps existing coordinates unchanged when extension nodes need new positions', () => {
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
    expect(layout.get('new-counterparty')).not.toEqual({ x: 320, y: 240 });
    expect(layout.get('new-counterparty')).not.toEqual({ x: 560, y: 240 });
  });

  it('prefers investigator layout over persisted coordinates when requested', () => {
    const graphData: CaseGraphData = {
      nodes: [
        { id: 'upstream', label: '来款', accountId: 'upstream-account', x: 920, y: 40 },
        { id: 'core', label: '核心', accountId: 'core-account', x: 120, y: 220 },
        { id: 'downstream', label: '去向', accountId: 'downstream-account', x: 220, y: 420 },
      ],
      edges: [
        { id: 'upstream->core', from: 'upstream', to: 'core', source: 'upstream', target: 'core', tradeAmount: 20, tradeCount: 1 },
        { id: 'core->downstream', from: 'core', to: 'downstream', source: 'core', target: 'downstream', tradeAmount: 30, tradeCount: 1 },
      ],
    };

    const layout = computeCaseGraphLayout(graphData, {
      ...OPTIONS,
      focusAccountIds: ['core-account'],
      preferPersistedPositions: false,
    });

    expect(layout.get('upstream')!.x).toBeLessThan(layout.get('core')!.x);
    expect(layout.get('core')!.x).toBeLessThan(layout.get('downstream')!.x);
  });

  it('renders flow graphs as a left-to-right directed layout', () => {
    const graphData: CaseGraphData = {
      nodes: [
        { id: 'source', label: '资金来源', x: 900, y: 40 },
        { id: 'middle', label: '中转账户', x: 500, y: 40 },
        { id: 'sink', label: '资金去向', x: 100, y: 40 },
      ],
      edges: [
        { id: 'source->middle', from: 'source', to: 'middle', source: 'source', target: 'middle', tradeAmount: 100, tradeCount: 1 },
        { id: 'middle->sink', from: 'middle', to: 'sink', source: 'middle', target: 'sink', tradeAmount: 80, tradeCount: 1 },
      ],
    };

    const layout = computeCaseGraphLayout(graphData, {
      ...OPTIONS,
      layoutMode: 'directed-flow',
    });

    expect(layout.get('source')!.x).toBeLessThan(layout.get('middle')!.x);
    expect(layout.get('middle')!.x).toBeLessThan(layout.get('sink')!.x);
  });
});
