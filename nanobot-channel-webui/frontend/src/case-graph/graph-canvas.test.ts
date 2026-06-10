import { describe, expect, it, vi } from 'vitest';

import {
  buildGraphPngFilenameForTest,
  createNodeCardBoundsForTest,
  buildNodeContextMenuItemsForTest,
  buildReplayTimelineViewForTest,
  buildGraphBehaviorsForTest,
  clearGraphInteractionStatesForTest,
  clearGraphTransientStatesForTest,
  createGraphRenderSnapshotForTest,
  buildCollapsedInvestigationGroupRenderEdgesForTest,
  buildCollapsedInvestigationGroupRenderNodesForTest,
  buildInvestigationGroupSummariesForTest,
  buildRenderedEdgeMetricsForTest,
  compactLayoutAfterVisibleNodeRemovalForTest,
  resolveNextSelectedNodeIdsForTest,
  resolveGraphEdgeTypeForTest,
  resolveMoneyEdgeStyleForTest,
  resolveNodeFlowDirectionForTest,
  resolveDirectionalEdgePortsForTest,
  resolveGraphCanvasLayoutForTest,
  resolveGraphRenderTransitionForTest,
  expandExportBoundsForTest,
  mergeExportBoundsForTest,
  resolveMenuPositionForTest,
  resolveNodeSubtitleForTest,
  dataUrlToBlobForTest,
  shouldSuppressNativeContextMenuForTest,
  shouldStopNativeContextMenuPropagationForTest,
  shouldEmitFocusChangeForTest,
} from './graph-canvas';
import type { CaseGraphData } from './types';

describe('graph canvas parallel edge offsets', () => {
  it('builds an investigation-friendly PNG export filename', () => {
    expect(buildGraphPngFilenameForTest(new Date('2026-06-04T09:08:07'))).toBe('资金关系图-20260604090807.png');
  });

  it('converts exported graph data URLs into PNG blobs', async () => {
    const blob = dataUrlToBlobForTest('data:image/png;base64,SGVsbG8=');

    expect(blob.type).toBe('image/png');
    expect(blob.size).toBe(5);
    await expect(blob.text()).resolves.toBe('Hello');
  });

  it('expands PNG export bounds to include custom HTML node cards', () => {
    const graphLayerBounds = {
      minX: 0,
      minY: 0,
      maxX: 120,
      maxY: 80,
      width: 120,
      height: 80,
    };
    const nodeBounds = createNodeCardBoundsForTest(200, 100);
    const exportBounds = mergeExportBoundsForTest([graphLayerBounds, nodeBounds]);

    expect(nodeBounds).toEqual({
      minX: 76,
      minY: 58,
      maxX: 324,
      maxY: 142,
      width: 248,
      height: 84,
    });
    expect(exportBounds).toEqual({
      minX: 0,
      minY: 0,
      maxX: 324,
      maxY: 142,
      width: 324,
      height: 142,
    });
  });

  it('adds whitespace around exported PNG bounds', () => {
    expect(expandExportBoundsForTest({
      minX: 10,
      minY: 20,
      maxX: 110,
      maxY: 220,
      width: 100,
      height: 200,
    }, 40)).toEqual({
      minX: -30,
      minY: -20,
      maxX: 150,
      maxY: 260,
      width: 180,
      height: 280,
    });
  });

  it('fills same-column slots after visible nodes are removed', () => {
    const previousNodes: CaseGraphData['nodes'] = [
      { id: 'top', label: '上方主体' },
      { id: 'removed', label: '被排除主体' },
      { id: 'bottom', label: '下方主体' },
      { id: 'right', label: '右侧主体' },
    ];
    const previousLayout = new Map([
      ['top', { x: 320, y: 120 }],
      ['removed', { x: 320, y: 292 }],
      ['bottom', { x: 320, y: 464 }],
      ['right', { x: 640, y: 464 }],
    ]);
    const previous = createGraphRenderSnapshotForTest(previousNodes, [], previousLayout);
    const nextNodes: CaseGraphData['nodes'] = previousNodes.filter((node) => node.id !== 'removed');
    const nextLayout = new Map([
      ['top', { x: 320, y: 120 }],
      ['bottom', { x: 320, y: 464 }],
      ['right', { x: 640, y: 464 }],
    ]);

    const compacted = compactLayoutAfterVisibleNodeRemovalForTest(nextLayout, nextNodes, previous);

    expect(compacted.get('top')).toEqual({ x: 320, y: 120 });
    expect(compacted.get('bottom')).toEqual({ x: 320, y: 292 });
    expect(compacted.get('right')).toEqual({ x: 640, y: 464 });
  });

  it('fills multiple removed slots with following nodes in the same column', () => {
    const previousNodes: CaseGraphData['nodes'] = [
      { id: 'top', label: '上方主体' },
      { id: 'removed-a', label: '被排除主体 A' },
      { id: 'removed-b', label: '被排除主体 B' },
      { id: 'removed-c', label: '被排除主体 C' },
      { id: 'bottom-a', label: '下方主体 A' },
      { id: 'bottom-b', label: '下方主体 B' },
      { id: 'right', label: '右侧主体' },
    ];
    const previousLayout = new Map([
      ['top', { x: 320, y: 120 }],
      ['removed-a', { x: 320, y: 292 }],
      ['removed-b', { x: 320, y: 464 }],
      ['removed-c', { x: 320, y: 636 }],
      ['bottom-a', { x: 320, y: 808 }],
      ['bottom-b', { x: 320, y: 980 }],
      ['right', { x: 640, y: 464 }],
    ]);
    const previous = createGraphRenderSnapshotForTest(previousNodes, [], previousLayout);
    const nextNodes = previousNodes.filter((node) => !node.id.startsWith('removed'));
    const nextLayout = new Map([
      ['top', { x: 320, y: 120 }],
      ['bottom-a', { x: 320, y: 808 }],
      ['bottom-b', { x: 320, y: 980 }],
      ['right', { x: 640, y: 464 }],
    ]);

    const compacted = compactLayoutAfterVisibleNodeRemovalForTest(nextLayout, nextNodes, previous);

    expect(compacted.get('top')).toEqual({ x: 320, y: 120 });
    expect(compacted.get('bottom-a')).toEqual({ x: 320, y: 292 });
    expect(compacted.get('bottom-b')).toEqual({ x: 320, y: 464 });
    expect(compacted.get('right')).toEqual({ x: 640, y: 464 });
  });

  it('does not compact layout when visible nodes have not been removed', () => {
    const nodes: CaseGraphData['nodes'] = [
      { id: 'top', label: '上方主体' },
      { id: 'bottom', label: '下方主体' },
    ];
    const layout = new Map([
      ['top', { x: 320, y: 120 }],
      ['bottom', { x: 320, y: 464 }],
    ]);
    const previous = createGraphRenderSnapshotForTest(nodes, [], layout);

    const compacted = compactLayoutAfterVisibleNodeRemovalForTest(layout, nodes, previous);

    expect(compacted).toBe(layout);
    expect(compacted.get('bottom')).toEqual({ x: 320, y: 464 });
  });

  it('fills hidden member slots after a collapsed investigation group keeps the first selected node as anchor', () => {
    const nodes: CaseGraphData['nodes'] = [
      { id: 'first', label: '首个选择主体' },
      { id: 'grouped-a', label: '成组主体 A' },
      { id: 'grouped-b', label: '成组主体 B' },
      { id: 'following', label: '下方主体' },
    ];
    const layout = new Map([
      ['first', { x: 320, y: 120 }],
      ['grouped-a', { x: 320, y: 292 }],
      ['grouped-b', { x: 320, y: 464 }],
      ['following', { x: 320, y: 636 }],
    ]);
    const previous = createGraphRenderSnapshotForTest(nodes, [], layout);

    const compacted = compactLayoutAfterVisibleNodeRemovalForTest(
      layout,
      nodes,
      previous,
      new Set(['grouped-a', 'grouped-b']),
    );

    expect(compacted.get('first')).toEqual({ x: 320, y: 120 });
    expect(compacted.get('following')).toEqual({ x: 320, y: 292 });
  });

  it('aggregates external money edges when an investigation group is collapsed', () => {
    const nodes: CaseGraphData['nodes'] = [
      { id: 'a', label: '成员A' },
      { id: 'b', label: '成员B' },
      { id: 'c', label: '成员C' },
      { id: 'x', label: '外部主体' },
    ];
    const edges: CaseGraphData['edges'] = [
      {
        id: 'a->x',
        from: 'a',
        to: 'x',
        source: 'a',
        target: 'x',
        tradeAmount: 1000,
        tradeCount: 1,
        tradeIds: ['t1'],
      },
      {
        id: 'b->x',
        from: 'b',
        to: 'x',
        source: 'b',
        target: 'x',
        tradeAmount: 2500,
        tradeCount: 2,
        tradeIds: ['t2', 't3'],
      },
      {
        id: 'x->c',
        from: 'x',
        to: 'c',
        source: 'x',
        target: 'c',
        tradeAmount: 400,
        tradeCount: 1,
        tradeIds: ['t4'],
      },
      {
        id: 'a->b',
        from: 'a',
        to: 'b',
        source: 'a',
        target: 'b',
        tradeAmount: 300,
        tradeCount: 1,
        tradeIds: ['internal'],
      },
    ];

    const collapsedEdges = buildCollapsedInvestigationGroupRenderEdgesForTest(edges, [
      { id: 'group-1', name: '研判组 1', memberNodeIds: ['a', 'b', 'c'], collapsed: true },
    ], nodes);

    expect(collapsedEdges).toHaveLength(2);
    expect(collapsedEdges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'investigation-group-edge:group-1->x',
        source: 'group-1',
        target: 'x',
        tradeAmount: 3500,
        tradeCount: 3,
        tradeIds: ['t1', 't2', 't3'],
      }),
      expect.objectContaining({
        id: 'investigation-group-edge:x->group-1',
        source: 'x',
        target: 'group-1',
        tradeAmount: 400,
        tradeCount: 1,
        tradeIds: ['t4'],
      }),
    ]));
    expect(collapsedEdges.some((edge) => edge.id === 'a->b')).toBe(false);

    const expandedEdges = buildCollapsedInvestigationGroupRenderEdgesForTest(edges, [
      { id: 'group-1', name: '研判组 1', memberNodeIds: ['a', 'b', 'c'], collapsed: false },
    ], nodes);
    expect(expandedEdges).toBe(edges);
  });

  it('renders a collapsed investigation group as a standalone graph node', () => {
    const nodes: CaseGraphData['nodes'] = [
      { id: 'a', label: '成员A' },
      { id: 'b', label: '成员B' },
      { id: 'x', label: '外部主体' },
    ];
    const layout = new Map([
      ['a', { x: 120, y: 80 }],
      ['b', { x: 120, y: 220 }],
      ['x', { x: 420, y: 80 }],
    ]);

    const renderNodes = buildCollapsedInvestigationGroupRenderNodesForTest([
      { id: 'group-1', name: '研判组 1', memberNodeIds: ['a', 'b'], collapsed: true, x: 240, y: 180 },
    ], nodes, layout);

    expect(renderNodes).toEqual([
      expect.objectContaining({
        id: 'group-1',
        name: '研判组 1',
        isGroup: true,
        type: 'group',
      }),
    ]);
  });

  it('computes edge strength from collapsed investigation group render edges', () => {
    const nodes: CaseGraphData['nodes'] = [
      { id: 'a', name: '成员甲' },
      { id: 'b', name: '成员乙' },
      { id: 'x', name: '外部小额' },
      { id: 'y', name: '外部大额' },
    ];
    const groups: CaseGraphData['investigationGroups'] = [
      { id: 'group-1', name: '研判组 1', memberNodeIds: ['a', 'b'], collapsed: true },
    ];
    const edges: CaseGraphData['edges'] = [
      { id: 'a->x', from: 'a', to: 'x', source: 'a', target: 'x', tradeAmount: 100, tradeCount: 1 },
      { id: 'b->y-1', from: 'b', to: 'y', source: 'b', target: 'y', tradeAmount: 120000, tradeCount: 2 },
      { id: 'a->y-2', from: 'a', to: 'y', source: 'a', target: 'y', tradeAmount: 80000, tradeCount: 1 },
    ];

    const metrics = buildRenderedEdgeMetricsForTest(edges, groups, nodes);

    expect(metrics.get('investigation-group-edge:group-1->y')?.amount).toBe(200000);
    expect(metrics.get('investigation-group-edge:group-1->y')?.strength).toBe('strong');
  });

  it('summarizes investigation group money without counting internal transfers as external flow', () => {
    const nodes: CaseGraphData['nodes'] = [
      { id: 'a', label: '成员A' },
      { id: 'b', label: '成员B' },
      { id: 'x', label: '外部甲' },
      { id: 'y', label: '外部乙' },
    ];
    const edges: CaseGraphData['edges'] = [
      {
        id: 'x->a',
        from: 'x',
        to: 'a',
        source: 'x',
        target: 'a',
        tradeAmount: 1200,
        tradeCount: 2,
      },
      {
        id: 'b->y',
        from: 'b',
        to: 'y',
        source: 'b',
        target: 'y',
        tradeAmount: 3400,
        tradeCount: 3,
      },
      {
        id: 'a->b',
        from: 'a',
        to: 'b',
        source: 'a',
        target: 'b',
        tradeAmount: 900,
        tradeCount: 1,
      },
      {
        id: 'y->a',
        from: 'y',
        to: 'a',
        source: 'y',
        target: 'a',
        tradeAmount: 600,
        tradeCount: 1,
      },
    ];

    const summaries = buildInvestigationGroupSummariesForTest([
      { id: 'group-1', name: '研判组 1', memberNodeIds: ['a', 'b'], collapsed: true },
    ], nodes, edges);
    const summary = summaries.get('group-1');

    expect(summary).toEqual(expect.objectContaining({
      memberCount: 2,
      incomingAmount: 1800,
      incomingCount: 3,
      outgoingAmount: 3400,
      outgoingCount: 3,
      internalAmount: 900,
      internalCount: 1,
      externalEdgeCount: 3,
      counterpartCount: 2,
    }));
    expect(summary?.counterpartRows).toEqual([
      expect.objectContaining({ nodeId: 'y', name: '外部乙', direction: 'both', amount: 4000, count: 4 }),
      expect.objectContaining({ nodeId: 'x', name: '外部甲', direction: 'in', amount: 1200, count: 2 }),
    ]);
  });

  it('uses flow-capable horizontal cubic edges for all money relation lines', () => {
    expect(resolveGraphEdgeTypeForTest()).toBe('case-graph-flow-cubic');
  });

  it('marks flow direction relative to the hovered reference node', () => {
    const activeOutgoing: CaseGraphData['edges'][number] = {
      id: 'a->b',
      from: 'a',
      to: 'b',
      source: 'a',
      target: 'b',
      tradeAmount: 1000,
      tradeCount: 1,
    };
    const activeIncoming: CaseGraphData['edges'][number] = {
      id: 'c->a',
      from: 'c',
      to: 'a',
      source: 'c',
      target: 'a',
      tradeAmount: 2000,
      tradeCount: 1,
    };
    const unrelated: CaseGraphData['edges'][number] = {
      id: 'c->d',
      from: 'c',
      to: 'd',
      source: 'c',
      target: 'd',
      tradeAmount: 3000,
      tradeCount: 1,
    };

    expect(resolveNodeFlowDirectionForTest(activeOutgoing, 'a')).toBe('out');
    expect(resolveNodeFlowDirectionForTest(activeIncoming, 'a')).toBe('in');
    expect(resolveNodeFlowDirectionForTest(unrelated, 'a')).toBeNull();
    expect(resolveNodeFlowDirectionForTest(activeOutgoing, null)).toBeNull();
  });

  it('keeps default money edges one color and only colors hovered flow direction', () => {
    const weak = resolveMoneyEdgeStyleForTest(500, { edgeKind: 'money', strength: 'weak' });
    const strong = resolveMoneyEdgeStyleForTest(150000, { edgeKind: 'money', strength: 'strong' });
    const outgoing = resolveMoneyEdgeStyleForTest(150000, {
      edgeKind: 'money',
      strength: 'strong',
      isFlowAnimated: true,
      flowColor: '#0f8b7f',
    });
    const incoming = resolveMoneyEdgeStyleForTest(150000, {
      edgeKind: 'money',
      strength: 'strong',
      isFlowAnimated: true,
      flowColor: '#3158d4',
    });

    expect(weak.stroke).toBe(strong.stroke);
    expect(outgoing.stroke).toBe('#0f8b7f');
    expect(incoming.stroke).toBe('#3158d4');
  });

  it('connects outgoing edges from the right port and incoming edges to the left port', () => {
    const portConfig = resolveDirectionalEdgePortsForTest();

    expect(portConfig.sourcePort).toBe('out-right');
    expect(portConfig.targetPort).toBe('in-left');
    expect(portConfig.ports).toEqual([
      expect.objectContaining({ key: 'in-left', placement: 'left' }),
      expect.objectContaining({ key: 'out-right', placement: 'right' }),
    ]);
  });

  it('keeps context menu inside the graph stage near the bottom edge', () => {
    const position = resolveMenuPositionForTest(
      { x: 980, y: 600 },
      { width: 1028, height: 620 },
      240,
    );

    expect(position.x).toBeLessThanOrEqual(808);
    expect(position.y).toBeLessThanOrEqual(370);
  });

  it('uses official node drag, shift brush select, and middle canvas panning', () => {
    const behaviors = buildGraphBehaviorsForTest();
    const dragCanvasBehavior = behaviors.find(
      (behavior): behavior is Record<string, any> => typeof behavior === 'object' && behavior?.type === 'drag-canvas',
    );
    const brushBehavior = behaviors.find(
      (behavior): behavior is Record<string, any> => typeof behavior === 'object' && behavior?.type === 'brush-select',
    );
    const clickSelectBehavior = behaviors.find(
      (behavior): behavior is Record<string, any> => typeof behavior === 'object' && behavior?.type === 'click-select',
    );
    const dragElementBehavior = behaviors.find(
      (behavior): behavior is Record<string, any> => typeof behavior === 'object' && behavior?.type === 'drag-element',
    );

    expect(dragCanvasBehavior?.enable?.({ button: 0 })).toBe(false);
    expect(dragCanvasBehavior?.enable?.({ button: 1 })).toBe(true);
    expect(dragCanvasBehavior?.enable?.({ button: 0, buttons: 4 })).toBe(true);
    expect(brushBehavior).toEqual(expect.objectContaining({
      type: 'brush-select',
      state: 'selected',
      enableElements: ['node'],
      trigger: ['shift'],
      animation: false,
    }));
    expect(brushBehavior?.enable?.({ targetType: 'canvas', button: 0 })).toBe(true);
    expect(brushBehavior?.enable?.({ targetType: 'canvas', button: 0, buttons: 1 })).toBe(true);
    expect(brushBehavior?.enable?.({ targetType: 'canvas', button: 0, buttons: 4 })).toBe(false);
    expect(brushBehavior?.enable?.({ targetType: 'canvas', button: 1 })).toBe(false);
    expect(brushBehavior?.enable?.({ targetType: 'node', button: 0 })).toBe(false);
    expect(behaviors).toContain('zoom-canvas');
    expect(behaviors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'click-select',
        degree: 1,
        state: 'click-highlight',
        neighborState: 'click-highlight',
        unselectedState: 'click-dim',
        animation: false,
        multiple: true,
        trigger: ['shift'],
      }),
    ]));
    expect(clickSelectBehavior?.enable?.({ targetType: 'node' })).toBe(true);
    expect(clickSelectBehavior?.enable?.({ targetType: 'edge' })).toBe(true);
    expect(clickSelectBehavior?.enable?.({ targetType: 'canvas' })).toBe(true);
    expect(clickSelectBehavior).not.toHaveProperty('onClick');
    expect(dragElementBehavior).toEqual(expect.objectContaining({
      type: 'drag-element',
      key: 'case-graph-drag-node',
      animation: false,
      dropEffect: 'move',
    }));
    expect(dragElementBehavior?.enable?.({ targetType: 'node', button: 0 })).toBe(true);
    expect(dragElementBehavior?.enable?.({ targetType: 'node', button: 1 })).toBe(true);
    expect(dragElementBehavior?.enable?.({ targetType: 'canvas', button: 0 })).toBe(false);
  });

  it('uses G6 drag-element for HTML node positioning', () => {
    const dragBehavior = buildGraphBehaviorsForTest().find(
      (behavior): behavior is Record<string, any> => typeof behavior === 'object' && behavior?.type === 'drag-element',
    );

    expect(dragBehavior?.enable?.({ button: 0 })).toBe(true);
    expect(dragBehavior?.enable?.({ nativeEvent: { button: 2 } })).toBe(true);
    const replayDragBehavior = buildGraphBehaviorsForTest(false, false).find(
      (behavior): behavior is Record<string, any> => typeof behavior === 'object' && behavior?.type === 'drag-element',
    );
    expect(replayDragBehavior?.enable?.({ button: 0 })).toBe(false);
  });

  it('supports shift or command/control multi-select for graph nodes', () => {
    expect(resolveNextSelectedNodeIdsForTest(['a'], 'b', { shiftKey: true })).toEqual(['a', 'b']);
    expect(resolveNextSelectedNodeIdsForTest(['a', 'b'], 'b', { ctrlKey: true })).toEqual(['a']);
    expect(resolveNextSelectedNodeIdsForTest(['a', 'b'], 'c', {})).toEqual(['c']);
  });

  it('suppresses native context menu inside graph stage', () => {
    expect(shouldSuppressNativeContextMenuForTest('case-graph-canvas-stage')).toBe(true);
    expect(shouldSuppressNativeContextMenuForTest('case-graph-g6-host')).toBe(true);
    expect(shouldSuppressNativeContextMenuForTest('case-graph-g6-node')).toBe(true);
    expect(shouldSuppressNativeContextMenuForTest('case-graph-context-menu')).toBe(true);
    expect(shouldSuppressNativeContextMenuForTest('g6-contextmenu')).toBe(true);
    expect(shouldSuppressNativeContextMenuForTest('outside-panel')).toBe(false);
  });

  it('keeps graph contextmenu propagation available for G6 menu events', () => {
    expect(shouldStopNativeContextMenuPropagationForTest()).toBe(false);
  });

  it('uses official G6 hover activation for one-hop node neighborhoods', () => {
    const hoverBehavior = buildGraphBehaviorsForTest().find(
      (behavior): behavior is Record<string, any> => typeof behavior === 'object' && behavior?.type === 'hover-activate',
    );

    expect(hoverBehavior).toEqual(expect.objectContaining({
      type: 'hover-activate',
      degree: 1,
      state: 'highlight',
      inactiveState: 'dim',
      animation: false,
    }));
    expect(hoverBehavior?.enable?.({ targetType: 'node' })).toBe(true);
    expect(hoverBehavior?.enable?.({ targetType: 'edge' })).toBe(false);
    const view = { setCursor: vi.fn() };
    hoverBehavior?.onHover?.({ view });
    hoverBehavior?.onHoverEnd?.({ view });
    expect(view.setCursor).not.toHaveBeenCalled();
  });

  it('suppresses official hover and click interactions while graph operations are settling', () => {
    const behaviors = buildGraphBehaviorsForTest(true);
    const hoverBehavior = behaviors.find(
      (behavior): behavior is Record<string, any> => typeof behavior === 'object' && behavior?.type === 'hover-activate',
    );
    const clickBehavior = behaviors.find(
      (behavior): behavior is Record<string, any> => typeof behavior === 'object' && behavior?.type === 'click-select',
    );

    expect(hoverBehavior?.enable?.({ targetType: 'node' })).toBe(false);
    expect(clickBehavior?.enable?.({ targetType: 'node' })).toBe(false);
    expect(clickBehavior?.enable?.({ targetType: 'canvas' })).toBe(false);
    const brushBehavior = behaviors.find(
      (behavior): behavior is Record<string, any> => typeof behavior === 'object' && behavior?.type === 'brush-select',
    );
    expect(brushBehavior?.enable?.({ targetType: 'canvas', button: 0 })).toBe(false);
  });

  it('animates graph changes only after an existing graph gains or moves elements', () => {
    const emptySnapshot = createGraphRenderSnapshotForTest([], [], new Map());
    const firstGraph = createGraphRenderSnapshotForTest(
      [{ id: 'wu', label: '伍华中' }],
      [],
      new Map([['wu', { x: 120, y: 160 }]]),
    );
    const expandedGraph = createGraphRenderSnapshotForTest(
      [
        { id: 'wu', label: '伍华中' },
        { id: 'feng', label: '冯燕青' },
      ],
      [{ id: 'wu->feng', from: 'wu', to: 'feng', source: 'wu', target: 'feng', tradeAmount: 1, tradeCount: 1 }],
      new Map([
        ['wu', { x: 120, y: 160 }],
        ['feng', { x: 320, y: 180 }],
      ]),
    );
    const unrelatedGraph = createGraphRenderSnapshotForTest(
      [{ id: 'other', label: '其他主体' }],
      [],
      new Map([['other', { x: 260, y: 220 }]]),
    );
    const movedGraph = createGraphRenderSnapshotForTest(
      [{ id: 'wu', label: '伍华中' }],
      [],
      new Map([['wu', { x: 160, y: 160 }]]),
    );

    expect(resolveGraphRenderTransitionForTest(emptySnapshot, firstGraph).shouldAnimate).toBe(false);
    expect(resolveGraphRenderTransitionForTest(emptySnapshot, firstGraph).shouldFitView).toBe(true);
    const expansionTransition = resolveGraphRenderTransitionForTest(firstGraph, expandedGraph);
    expect(expansionTransition.shouldAnimate).toBe(true);
    expect(expansionTransition.shouldFitView).toBe(false);
    expect([...expansionTransition.newNodeIds]).toEqual(['feng']);
    expect([...expansionTransition.newEdgeIds]).toEqual(['wu->feng']);
    expect(resolveGraphRenderTransitionForTest(firstGraph, unrelatedGraph).shouldAnimate).toBe(false);
    expect(resolveGraphRenderTransitionForTest(firstGraph, unrelatedGraph).shouldFitView).toBe(true);
    const movedTransition = resolveGraphRenderTransitionForTest(firstGraph, movedGraph);
    expect(movedTransition.shouldAnimate).toBe(true);
    expect([...movedTransition.movedNodeIds]).toEqual(['wu']);
  });

  it('clears stale official hover and click states without removing reveal state', () => {
    expect(clearGraphInteractionStatesForTest([
      'click-dim',
      'highlight',
      'reveal',
      'selected',
      'click-highlight',
      'dim',
    ])).toEqual(['reveal', 'selected']);
  });

  it('clears stale reveal state before replaying another graph step', () => {
    expect(clearGraphTransientStatesForTest([
      'click-dim',
      'highlight',
      'reveal',
      'selected',
      'click-highlight',
      'dim',
    ])).toEqual(['selected']);
  });

  it('builds the custom replay panel state from persisted steps', () => {
    const steps = [
      { stepId: '0001', time: 1000, label: '步骤 0001', operationLabel: '一跳分析', nodeCount: 9, edgeCount: 9, addedNodeCount: 9, addedEdgeCount: 9 },
      { stepId: '0002', time: 5000, label: '步骤 0002', operationLabel: '下钻', nodeCount: 17, edgeCount: 17, addedNodeCount: 8, addedEdgeCount: 8 },
      { stepId: '0003', time: 9000, label: '步骤 0003', operationLabel: '全图筛选', nodeCount: 12, edgeCount: 12, addedNodeCount: 0, addedEdgeCount: 0 },
    ];

    expect(buildReplayTimelineViewForTest({ steps, activeStepId: '0002', onStepSelect: () => {} })?.previousStep?.stepId).toBe('0001');
    expect(buildReplayTimelineViewForTest({ steps, activeStepId: '0002', onStepSelect: () => {} })?.nextStep?.stepId).toBe('0003');
    expect(buildReplayTimelineViewForTest({ steps, activeStepId: null, onStepSelect: () => {} })?.activeStep.stepId).toBe('0003');
  });

  it('builds node context menu items for the official G6 contextmenu plugin', () => {
    expect(buildNodeContextMenuItemsForTest({ selectedCount: 1, canDrill: true, canExclude: true })).toEqual([
      { name: '双向钻取', value: 'drill:both' },
      { name: '上钻', value: 'drill:in' },
      { name: '下钻', value: 'drill:out' },
      { name: '补充资金往来', value: 'manual-trade' },
      { name: '标注现实关系', value: 'reality-relation' },
      { name: '取消上图', value: 'exclude' },
    ]);
    expect(buildNodeContextMenuItemsForTest({
      selectedCount: 1,
      canDrill: false,
      canSummaryAnalysis: true,
      canExclude: true,
    })).toEqual([
      { name: '综合筛选', value: 'summary-analysis' },
      { name: '补充资金往来', value: 'manual-trade' },
      { name: '标注现实关系', value: 'reality-relation' },
      { name: '取消上图', value: 'exclude' },
    ]);
    expect(buildNodeContextMenuItemsForTest({ selectedCount: 3, canDrill: false, canExclude: true })).toEqual([
      { name: '取消上图 3 个', value: 'exclude' },
    ]);
    expect(buildNodeContextMenuItemsForTest({
      selectedCount: 1,
      canRestore: true,
      canDrill: true,
      canSummaryAnalysis: true,
      canManualActions: true,
      canExclude: true,
    })).toEqual([
      { name: '恢复上图', value: 'restore' },
    ]);
  });

  it('emits focus changes only when the focus identity changes', () => {
    expect(shouldEmitFocusChangeForTest(null, null)).toBe(false);
    expect(shouldEmitFocusChangeForTest(null, { type: 'graph' })).toBe(true);
    expect(shouldEmitFocusChangeForTest({ type: 'node', nodeId: 'a' }, { type: 'node', nodeId: 'a' })).toBe(false);
    expect(shouldEmitFocusChangeForTest({ type: 'node', nodeId: 'a' }, { type: 'node', nodeId: 'b' })).toBe(true);
    expect(shouldEmitFocusChangeForTest({ type: 'node', nodeId: 'a' }, { type: 'edge', from: 'a', to: 'b' })).toBe(true);
    expect(shouldEmitFocusChangeForTest({ type: 'edge', from: 'a', to: 'b' }, { type: 'edge', from: 'a', to: 'b' })).toBe(false);
  });

  it('renders Chinese identity text instead of internal node ids', () => {
    expect(resolveNodeSubtitleForTest({ id: 'subject:suspect:1', type: 'subject', accountIds: ['1', '3', '137'] })).toBe('主体编号 1 · 3 个账号');
    expect(resolveNodeSubtitleForTest({ id: 'subject:冯燕青', type: 'subject', accountIds: ['35'] })).toBe('主体账号 35');
    expect(resolveNodeSubtitleForTest({ id: 'account:35', type: 'account', accountId: '35' })).toBe('账号 35');
  });

  it('reuses persisted node coordinates when graph data is loaded from saved files', () => {
    const layout = resolveGraphCanvasLayoutForTest({
      nodes: [
        { id: 'wu', label: '伍华中', x: 206, y: 68 },
        { id: 'feng', label: '冯燕青', x: 954, y: 1960 },
        { id: 'chen', label: '陈某', x: 580, y: 420 },
      ],
      edges: [
        { id: 'money:chen->wu', from: 'chen', to: 'wu', source: 'chen', target: 'wu', tradeAmount: 10, tradeCount: 1 },
        { id: 'money:wu->feng', from: 'wu', to: 'feng', source: 'wu', target: 'feng', tradeAmount: 20, tradeCount: 1 },
      ],
    });

    expect(layout.get('wu')).toEqual({ x: 206, y: 68 });
    expect(layout.get('feng')).toEqual({ x: 954, y: 1960 });
    expect(layout.get('chen')).toEqual({ x: 580, y: 420 });
  });
});
