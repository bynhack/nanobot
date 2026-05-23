import { describe, expect, it } from 'vitest';

import {
  buildNodeContextMenuItemsForTest,
  buildConnectedNeighborhoodForTest,
  buildGraphBehaviorsForTest,
  computeParallelEdgeOffsetsForTest,
  resolveNextSelectedNodeIdsForTest,
  resolveEdgeTypeForTest,
  resolveGraphCanvasLayoutForTest,
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

  it('enables left-button node dragging and disables it while brush mode is active', () => {
    const clickSelectBehavior = buildGraphBehaviorsForTest(false).find(
      (behavior): behavior is Record<string, any> => typeof behavior === 'object' && behavior?.type === 'click-select',
    );

    expect(buildGraphBehaviorsForTest(false)).toContain('drag-canvas');
    expect(buildGraphBehaviorsForTest(true)).not.toContain('drag-canvas');
    expect(buildGraphBehaviorsForTest(true)).toContain('zoom-canvas');
    expect(buildGraphBehaviorsForTest(false)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'click-select',
        degree: Number.MAX_SAFE_INTEGER,
        multiple: true,
        trigger: ['shift'],
      }),
    ]));
    expect(clickSelectBehavior).not.toHaveProperty('onClick');
    expect(buildGraphBehaviorsForTest(false)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'drag-element',
        dropEffect: 'none',
      }),
    ]));
    expect(buildGraphBehaviorsForTest(true)).not.toContain('drag-element');
  });

  it('allows drag-element to start from G6 node drag events without targetType', () => {
    const dragBehavior = buildGraphBehaviorsForTest(false).find(
      (behavior): behavior is Record<string, any> => typeof behavior === 'object' && behavior?.type === 'drag-element',
    );

    expect(dragBehavior?.enable?.({ button: 0 })).toBe(true);
    expect(dragBehavior?.enable?.({ nativeEvent: { button: 2 } })).toBe(false);
  });

  it('supports shift or command/control multi-select for graph nodes', () => {
    expect(resolveNextSelectedNodeIdsForTest(['a'], 'b', { shiftKey: true })).toEqual(['a', 'b']);
    expect(resolveNextSelectedNodeIdsForTest(['a', 'b'], 'b', { ctrlKey: true })).toEqual(['a']);
    expect(resolveNextSelectedNodeIdsForTest(['a', 'b'], 'c', {})).toEqual(['c']);
  });

  it('highlights the full connected component when a node is selected', () => {
    const neighborhood = buildConnectedNeighborhoodForTest('A', [
      { id: 'A-B', source: 'A', target: 'B', from: 'A', to: 'B', tradeAmount: 1, tradeCount: 1 },
      { id: 'B-C', source: 'B', target: 'C', from: 'B', to: 'C', tradeAmount: 1, tradeCount: 1 },
      { id: 'C-D', source: 'C', target: 'D', from: 'C', to: 'D', tradeAmount: 1, tradeCount: 1 },
      { id: 'D-F', source: 'D', target: 'F', from: 'D', to: 'F', tradeAmount: 1, tradeCount: 1 },
      { id: 'E-F', source: 'E', target: 'F', from: 'E', to: 'F', tradeAmount: 1, tradeCount: 1 },
      { id: 'X-Y', source: 'X', target: 'Y', from: 'X', to: 'Y', tradeAmount: 1, tradeCount: 1 },
    ]);

    expect(neighborhood.relatedNodeIds).toEqual(['A', 'B', 'C', 'D', 'E', 'F']);
    expect(neighborhood.relatedEdgeIds).toEqual(['A-B', 'B-C', 'C-D', 'D-F', 'E-F']);
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

  it('uses G6 brush-select while brush selecting', () => {
    expect(buildGraphBehaviorsForTest(true)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'brush-select',
        state: 'selected',
        enableElements: ['node'],
      }),
      'zoom-canvas',
    ]));
  });

  it('builds node context menu items for the official G6 contextmenu plugin', () => {
    expect(buildNodeContextMenuItemsForTest({ selectedCount: 1, canDrill: true, canExclude: true })).toEqual([
      { name: '双向钻取', value: 'drill:both' },
      { name: '上钻', value: 'drill:in' },
      { name: '下钻', value: 'drill:out' },
      { name: '取消上图', value: 'exclude' },
    ]);
    expect(buildNodeContextMenuItemsForTest({ selectedCount: 3, canDrill: false, canExclude: true })).toEqual([
      { name: '取消上图 3 个', value: 'exclude' },
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
