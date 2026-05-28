import { describe, expect, it } from 'vitest';

import {
  buildNodeContextMenuItemsForTest,
  buildReplayTimelineViewForTest,
  buildGraphBehaviorsForTest,
  clearGraphInteractionStatesForTest,
  clearGraphTransientStatesForTest,
  createGraphRenderSnapshotForTest,
  computeParallelEdgeOffsetsForTest,
  resolveNextSelectedNodeIdsForTest,
  resolveEdgeTypeForTest,
  resolveGraphCanvasLayoutForTest,
  resolveGraphRenderTransitionForTest,
  resolveMenuPositionForTest,
  resolveNodeSubtitleForTest,
  shouldSuppressNativeContextMenuForTest,
  shouldStopNativeContextMenuPropagationForTest,
  shouldEmitFocusChangeForTest,
} from './graph-canvas';
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

  it('keeps context menu inside the graph stage near the bottom edge', () => {
    const position = resolveMenuPositionForTest(
      { x: 980, y: 600 },
      { width: 1028, height: 620 },
      240,
    );

    expect(position.x).toBeLessThanOrEqual(808);
    expect(position.y).toBeLessThanOrEqual(370);
  });

  it('uses left drag for node positioning and middle drag for canvas panning', () => {
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
      trigger: ['drag'],
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
      dropEffect: 'none',
    }));
    expect(dragElementBehavior?.enable?.({ button: 0 })).toBe(true);
    expect(dragElementBehavior?.enable?.({ button: 1 })).toBe(false);
  });

  it('allows drag-element to start from G6 node drag events without targetType', () => {
    const dragBehavior = buildGraphBehaviorsForTest().find(
      (behavior): behavior is Record<string, any> => typeof behavior === 'object' && behavior?.type === 'drag-element',
    );

    expect(dragBehavior?.enable?.({ button: 0 })).toBe(true);
    expect(dragBehavior?.enable?.({ nativeEvent: { button: 2 } })).toBe(false);
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
      canDetailAnalysis: true,
      canSummaryAnalysis: true,
      canExclude: true,
    })).toEqual([
      { name: '交易核查', value: 'detail-analysis' },
      { name: '线索扩展', value: 'summary-analysis' },
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
      canDetailAnalysis: true,
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
