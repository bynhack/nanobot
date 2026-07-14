import { describe, expect, it } from 'vitest';

import { computeCaseGraphLayoutPlan, computeInitialG6LayoutPlan } from './index';
import type { CaseGraphData } from '../types';

const DIMENSIONS = {
  graphWidth: 1000,
  graphHeight: 600,
  nodeWidth: 240,
  nodeHeight: 84,
  columnGap: 120,
  rowGap: 64,
};

describe('case graph incremental layout engine', () => {
  it('uses G6 built-in layout for the initial graph plan', async () => {
    const graphData: CaseGraphData = {
      nodes: [
        { id: 'core', label: '核心主体' },
        { id: 'incoming', label: '来款账户' },
        { id: 'outgoing', label: '去向账户' },
      ],
      edges: [
        { id: 'incoming->core', from: 'incoming', to: 'core', source: 'incoming', target: 'core', tradeAmount: 100, tradeCount: 2 },
        { id: 'core->outgoing', from: 'core', to: 'outgoing', source: 'core', target: 'outgoing', tradeAmount: 80, tradeCount: 1 },
      ],
    };

    const plan = await computeInitialG6LayoutPlan({
      ...DIMENSIONS,
      graphData,
      event: { type: 'initial_graph', primaryAnchorIds: ['core'] },
    });

    expect(Object.keys(plan.nodePositions).sort()).toEqual(['core', 'incoming', 'outgoing']);
    expect(plan.positionMeta.core).toEqual({ source: 'initial', locked: false });
    expect(plan.diagnostics.some((item) => item.code === 'g6-initial-layout')).toBe(true);
    expect(plan.nodePositions.incoming.x).toBeLessThan(plan.nodePositions.outgoing.x);
  });

  it('normalizes row spacing inside G6 initial layout columns', async () => {
    const graphData: CaseGraphData = {
      nodes: [
        { id: 'core', label: '核心主体' },
        ...Array.from({ length: 6 }, (_, index) => ({ id: `incoming-${index}`, label: `来款账户${index}` })),
      ],
      edges: Array.from({ length: 6 }, (_, index) => ({
        id: `incoming-${index}->core`,
        from: `incoming-${index}`,
        to: 'core',
        source: `incoming-${index}`,
        target: 'core',
        tradeAmount: 100,
        tradeCount: 1,
      })),
    };

    const plan = await computeInitialG6LayoutPlan({
      ...DIMENSIONS,
      graphData,
      event: { type: 'initial_graph', primaryAnchorIds: ['core'] },
    });
    const incomingNodes = Object.entries(plan.nodePositions)
      .filter(([nodeId]) => nodeId.startsWith('incoming-'))
      .sort((left, right) => left[1].y - right[1].y);
    const gaps = incomingNodes.slice(1).map(([, point], index) => point.y - incomingNodes[index][1].y);

    expect(new Set(gaps).size).toBe(1);
  });

  it('builds an initial mixed direction skeleton around the selected primary anchor', () => {
    const graphData: CaseGraphData = {
      nodes: [
        { id: 'core', label: '核心主体', accountId: 'core-account' },
        { id: 'incoming', label: '来款账户' },
        { id: 'outgoing', label: '去向账户' },
        { id: 'cash', label: '现金断点', type: 'cash', isCash: true },
      ],
      edges: [
        { id: 'incoming->core', from: 'incoming', to: 'core', source: 'incoming', target: 'core', tradeAmount: 100, tradeCount: 2 },
        { id: 'core->outgoing', from: 'core', to: 'outgoing', source: 'core', target: 'outgoing', tradeAmount: 80, tradeCount: 1 },
      ],
    };

    const plan = computeCaseGraphLayoutPlan({
      ...DIMENSIONS,
      graphData,
      event: { type: 'initial_graph', primaryAnchorIds: ['core'] },
    });

    expect(plan.nodePositions.incoming.x).toBeLessThan(plan.nodePositions.core.x);
    expect(plan.nodePositions.outgoing.x).toBeGreaterThan(plan.nodePositions.core.x);
    expect(plan.nodePositions.cash.y).toBeGreaterThan(plan.nodePositions.core.y);
  });

  it('places new nodes near their anchor without moving existing nodes', () => {
    const graphData: CaseGraphData = {
      nodes: [
        { id: 'core', label: '核心主体' },
        { id: 'old', label: '已有下游' },
        { id: 'new', label: '新增下游' },
      ],
      edges: [
        { id: 'core->old', from: 'core', to: 'old', source: 'core', target: 'old', tradeAmount: 10, tradeCount: 1 },
        { id: 'core->new', from: 'core', to: 'new', source: 'core', target: 'new', tradeAmount: 20, tradeCount: 1 },
      ],
    };

    const plan = computeCaseGraphLayoutPlan({
      ...DIMENSIONS,
      graphData,
      previousLayout: {
        nodePositions: {
          core: { x: 480, y: 288 },
          old: { x: 840, y: 288 },
        },
      },
      event: { type: 'relation_drill', anchorNodeIds: ['core'], addedNodeIds: ['new'] },
    });

    expect(plan.nodePositions.core).toEqual({ x: 480, y: 288 });
    expect(plan.nodePositions.old).toEqual({ x: 840, y: 288 });
    expect(plan.nodePositions.new.x).toBeGreaterThan(plan.nodePositions.core.x);
    expect(plan.positionPatch).toEqual({ new: plan.nodePositions.new });
  });

  it('does not regenerate positions for restored nodes that already have coordinates', () => {
    const graphData: CaseGraphData = {
      nodes: [
        { id: 'core', label: '核心主体' },
        { id: 'restored-a', label: '恢复主体A', x: 120, y: 120 },
        { id: 'restored-b', label: '恢复主体B', x: 120, y: 216 },
        { id: 'other', label: '其他主体', x: 480, y: 216 },
      ],
      edges: [
        { id: 'restored-a->core', from: 'restored-a', to: 'core', source: 'restored-a', target: 'core', tradeAmount: 10, tradeCount: 1 },
        { id: 'restored-b->core', from: 'restored-b', to: 'core', source: 'restored-b', target: 'core', tradeAmount: 20, tradeCount: 1 },
      ],
    };

    const plan = computeCaseGraphLayoutPlan({
      ...DIMENSIONS,
      graphData,
      previousLayout: {
        nodePositions: {
          core: { x: 480, y: 120 },
          'restored-a': { x: 120, y: 120 },
          'restored-b': { x: 120, y: 216 },
          other: { x: 480, y: 216 },
        },
        positionMeta: {
          core: { source: 'manual', locked: true },
          'restored-a': { source: 'initial' },
          'restored-b': { source: 'initial' },
          other: { source: 'manual', locked: true },
        },
      },
      event: { type: 'restore_node', restoredNodeIds: ['restored-a', 'restored-b'] },
    });

    expect(plan.nodePositions).toEqual({
      core: { x: 480, y: 120 },
      'restored-a': { x: 120, y: 120 },
      'restored-b': { x: 120, y: 216 },
      other: { x: 480, y: 216 },
    });
    expect(plan.positionPatch).toEqual({});
    expect(plan.positionMeta['restored-a']).toEqual({ source: 'initial' });
    expect(plan.positionMeta['restored-b']).toEqual({ source: 'initial' });
  });

  it('moves restored nodes to the nearest free slot when their original position is occupied', () => {
    const graphData: CaseGraphData = {
      nodes: [
        { id: 'core', label: '核心主体' },
        { id: 'visible', label: '当前可见主体' },
        { id: 'restored', label: '恢复主体', x: 120, y: 120 },
      ],
      edges: [
        { id: 'restored->core', from: 'restored', to: 'core', source: 'restored', target: 'core', tradeAmount: 10, tradeCount: 1 },
      ],
    };

    const plan = computeCaseGraphLayoutPlan({
      ...DIMENSIONS,
      graphData,
      previousLayout: {
        nodePositions: {
          core: { x: 480, y: 120 },
          visible: { x: 120, y: 120 },
        },
        positionMeta: {
          core: { source: 'manual', locked: true },
          visible: { source: 'manual', locked: true },
        },
      },
      event: { type: 'restore_node', restoredNodeIds: ['restored'] },
    });

    expect(plan.nodePositions.core).toEqual({ x: 480, y: 120 });
    expect(plan.nodePositions.visible).toEqual({ x: 120, y: 120 });
    expect(plan.nodePositions.restored).not.toEqual({ x: 120, y: 120 });
    expect(plan.positionPatch).toEqual({ restored: plan.nodePositions.restored });
    expect(plan.positionMeta.restored).toMatchObject({ source: 'restored' });
    expect(Math.abs(plan.nodePositions.restored.x - 120)).toBeLessThanOrEqual(384);
    expect(Math.abs(plan.nodePositions.restored.y - 120)).toBeLessThanOrEqual(192);
  });

  it('aligns incremental nodes to existing initial-layout columns and rows', () => {
    const graphData: CaseGraphData = {
      nodes: [
        { id: 'core', label: '核心主体' },
        { id: 'old-1', label: '已有下游1' },
        { id: 'old-2', label: '已有下游2' },
        { id: 'new', label: '新增下游' },
      ],
      edges: [
        { id: 'core->old-1', from: 'core', to: 'old-1', source: 'core', target: 'old-1', tradeAmount: 10, tradeCount: 1 },
        { id: 'core->old-2', from: 'core', to: 'old-2', source: 'core', target: 'old-2', tradeAmount: 20, tradeCount: 1 },
        { id: 'core->new', from: 'core', to: 'new', source: 'core', target: 'new', tradeAmount: 30, tradeCount: 1 },
      ],
    };

    const plan = computeCaseGraphLayoutPlan({
      ...DIMENSIONS,
      graphData,
      previousLayout: {
        nodePositions: {
          core: { x: 480, y: 96 },
          'old-1': { x: 816, y: 96 },
          'old-2': { x: 816, y: 192 },
        },
      },
      event: { type: 'relation_drill', anchorNodeIds: ['core'], addedNodeIds: ['new'] },
    });

    expect(plan.nodePositions.new.x).toBe(816);
    expect(plan.nodePositions.new.y).toBe(288);
  });

  it('keeps multi-node branch growth on the initial-layout grid', () => {
    const generatedNodeIds = ['account:107', 'account:55', 'account:9', 'account:59', 'account:52', 'account:89', 'account:90', 'account:46'];
    const graphData: CaseGraphData = {
      nodes: [
        { id: 'subject:suspect:1', label: '嫌疑人' },
        { id: 'account:35', label: '冯燕青' },
        { id: 'cash:withdraw:240', label: '现金取现', type: 'cash', isCash: true },
        ...generatedNodeIds.map((id) => ({ id, label: id })),
      ],
      edges: [
        { id: 'money:account:35->subject:suspect:1', from: 'account:35', to: 'subject:suspect:1', source: 'account:35', target: 'subject:suspect:1', tradeAmount: 40000, tradeCount: 2 },
        { id: 'money:subject:suspect:1->cash:withdraw:240', from: 'subject:suspect:1', to: 'cash:withdraw:240', source: 'subject:suspect:1', target: 'cash:withdraw:240', tradeAmount: 20000, tradeCount: 1 },
        ...generatedNodeIds.map((id, index) => ({
          id: `money:account:35->${id}`,
          from: 'account:35',
          to: id,
          source: 'account:35',
          target: id,
          tradeAmount: 10000 - index,
          tradeCount: 1,
        })),
      ],
    };

    const plan = computeCaseGraphLayoutPlan({
      ...DIMENSIONS,
      graphData,
      previousLayout: {
        nodePositions: {
          'account:35': { x: 72, y: -72 },
          'subject:suspect:1': { x: 504, y: 408 },
          'cash:withdraw:240': { x: 960, y: 168 },
        },
      },
      event: { type: 'relation_drill', anchorNodeIds: ['account:35'], addedNodeIds: generatedNodeIds },
    });
    const generatedPositions = generatedNodeIds.map((nodeId) => plan.nodePositions[nodeId]);
    const columnYs = ['subject:suspect:1', ...generatedNodeIds]
      .map((nodeId) => plan.nodePositions[nodeId].y)
      .sort((left, right) => left - right);
    const gaps = columnYs.slice(1).map((y, index) => y - columnYs[index]);

    expect(new Set(generatedPositions.map((point) => point.x))).toEqual(new Set([504]));
    expect(new Set(gaps)).toEqual(new Set([96]));
    expect(generatedPositions).not.toContainEqual({ x: 504, y: 408 });
  });

  it('keeps upstream branch growth out of overlapping near columns', () => {
    const generatedNodeIds = ['account:114', 'account:115', 'account:113', 'account:111', 'account:134', 'account:127', 'account:69'];
    const graphData: CaseGraphData = {
      nodes: [
        { id: 'account:35', label: '冯燕青' },
        { id: 'cash:deposit:239', label: '现金存入', type: 'cash', isCash: true },
        { id: 'account:191', label: '已有上游1' },
        { id: 'account:38', label: '已有上游2' },
        { id: 'subject:suspect:1', label: '伍华中' },
        ...generatedNodeIds.map((id) => ({ id, label: id })),
      ],
      edges: [
        { id: 'account:35->subject:suspect:1', from: 'account:35', to: 'subject:suspect:1', source: 'account:35', target: 'subject:suspect:1', tradeAmount: 40000, tradeCount: 2 },
        ...generatedNodeIds.map((id, index) => ({
          id: `${id}->account:35`,
          from: id,
          to: 'account:35',
          source: id,
          target: 'account:35',
          tradeAmount: 10000 - index,
          tradeCount: 1,
        })),
      ],
    };

    const plan = computeCaseGraphLayoutPlan({
      ...DIMENSIONS,
      graphData,
      previousLayout: {
        nodePositions: {
          'account:35': { x: 72, y: -72 },
          'cash:deposit:239': { x: 72, y: 24 },
          'account:191': { x: 72, y: 120 },
          'account:38': { x: 72, y: 216 },
          'subject:suspect:1': { x: 504, y: 408 },
        },
      },
      event: { type: 'relation_drill', anchorNodeIds: ['account:35'], addedNodeIds: generatedNodeIds },
    });
    const generatedPositions = generatedNodeIds.map((nodeId) => plan.nodePositions[nodeId]);
    const generatedXs = new Set(generatedPositions.map((point) => point.x));

    expect(generatedXs.size).toBe(1);
    expect([...generatedXs][0]).toBeLessThan(72 - DIMENSIONS.nodeWidth);
    expect(generatedPositions).not.toContainEqual({ x: 0, y: -96 });
  });

  it('places bridge nodes between multiple positioned anchors', () => {
    const graphData: CaseGraphData = {
      nodes: [
        { id: 'left', label: '左侧主体' },
        { id: 'right', label: '右侧主体' },
        { id: 'bridge', label: '中转主体' },
      ],
      edges: [
        { id: 'left->bridge', from: 'left', to: 'bridge', source: 'left', target: 'bridge', tradeAmount: 40, tradeCount: 1 },
        { id: 'bridge->right', from: 'bridge', to: 'right', source: 'bridge', target: 'right', tradeAmount: 35, tradeCount: 1 },
      ],
    };

    const plan = computeCaseGraphLayoutPlan({
      ...DIMENSIONS,
      graphData,
      previousLayout: {
        nodePositions: {
          left: { x: 120, y: 288 },
          right: { x: 840, y: 288 },
        },
      },
      event: { type: 'relation_complete', anchorNodeIds: ['left', 'right'], addedNodeIds: ['bridge'] },
    });

    expect(plan.nodePositions.bridge.x).toBeGreaterThan(plan.nodePositions.left.x);
    expect(plan.nodePositions.bridge.x).toBeLessThan(plan.nodePositions.right.x);
  });

  it('permanently locks manual move positions', () => {
    const graphData: CaseGraphData = {
      nodes: [{ id: 'core', label: '核心主体' }],
      edges: [],
    };

    const plan = computeCaseGraphLayoutPlan({
      ...DIMENSIONS,
      graphData,
      previousLayout: { nodePositions: { core: { x: 480, y: 288 } } },
      event: { type: 'manual_move', movedPositions: { core: { x: 333, y: 211 } } },
    });

    expect(plan.nodePositions.core).toEqual({ x: 336, y: 216 });
    expect(plan.positionMeta.core).toEqual({ source: 'manual', locked: true });
    expect(plan.lockedNodeIds).toEqual(['core']);
  });

  it('snaps manually moved collapsed groups', () => {
    const graphData: CaseGraphData = {
      nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
      edges: [],
    };

    const plan = computeCaseGraphLayoutPlan({
      ...DIMENSIONS,
      graphData,
      previousLayout: {
        nodePositions: {
          a: { x: 120, y: 120 },
          b: { x: 360, y: 360 },
        },
        groupLayout: {
          'group-1': {
            groupId: 'group-1',
            collapsedPosition: { x: 240, y: 240 },
            memberPositionsBeforeCollapse: {
              a: { x: 120, y: 120 },
              b: { x: 360, y: 360 },
            },
          },
        },
      },
      event: { type: 'manual_move', movedPositions: { 'group-1': { x: 253, y: 371 } } },
    });

    expect(plan.groupLayout['group-1']).toMatchObject({
      collapsedPosition: { x: 264, y: 360 },
      locked: true,
    });
    expect(plan.nodePositions.a).toEqual({ x: 120, y: 120 });
    expect(plan.nodePositions.b).toEqual({ x: 360, y: 360 });
  });

  it('collapses a group at the member bounding-box center', () => {
    const graphData: CaseGraphData = {
      nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
      edges: [],
    };

    const plan = computeCaseGraphLayoutPlan({
      ...DIMENSIONS,
      graphData,
      previousLayout: {
        nodePositions: {
          a: { x: 120, y: 120 },
          b: { x: 360, y: 360 },
        },
      },
      event: { type: 'group_collapse', groupId: 'group-1', memberNodeIds: ['a', 'b'] },
    });

    expect(plan.groupLayout['group-1']).toMatchObject({
      groupId: 'group-1',
      collapsedPosition: { x: 240, y: 240 },
      memberPositionsBeforeCollapse: {
        a: { x: 120, y: 120 },
        b: { x: 360, y: 360 },
      },
    });
  });

  it('expands group members from stored positions and only moves conflicting members', () => {
    const graphData: CaseGraphData = {
      nodes: [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
        { id: 'outside', label: '外部节点' },
      ],
      edges: [],
    };

    const plan = computeCaseGraphLayoutPlan({
      ...DIMENSIONS,
      graphData,
      previousLayout: {
        nodePositions: {
          outside: { x: 120, y: 120 },
          a: { x: 500, y: 500 },
          b: { x: 700, y: 500 },
        },
        groupLayout: {
          'group-1': {
            groupId: 'group-1',
            collapsedPosition: { x: 240, y: 240 },
            memberPositionsBeforeCollapse: {
              a: { x: 120, y: 120 },
              b: { x: 360, y: 360 },
            },
          },
        },
      },
      event: { type: 'group_expand', groupId: 'group-1', memberNodeIds: ['a', 'b'] },
    });

    expect(plan.nodePositions.outside).toEqual({ x: 120, y: 120 });
    expect(plan.nodePositions.b).toEqual({ x: 360, y: 360 });
    expect(plan.nodePositions.a).not.toEqual({ x: 120, y: 120 });
  });
});
