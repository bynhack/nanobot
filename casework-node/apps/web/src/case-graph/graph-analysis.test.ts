import { describe, expect, it } from 'vitest';

import { buildCaseGraphViewModel } from './graph-analysis';
import type { CaseGraphData } from './types';

describe('case graph analysis', () => {
  it('prioritizes selected account ids over broad label hints when resolving focus nodes', () => {
    const graphData: CaseGraphData = {
      nodes: [
        { id: 'source', accountId: 'source-account', label: '来款人' },
        { id: 'focus', accountId: 'focus-account', label: '核心主体' },
        { id: 'sink', accountId: 'sink-account', label: '去向人' },
      ],
      edges: [
        {
          id: 'source->focus',
          from: 'source',
          to: 'focus',
          source: 'source',
          target: 'focus',
          tradeAmount: 88000,
          tradeCount: 3,
        },
        {
          id: 'focus->sink',
          from: 'focus',
          to: 'sink',
          source: 'focus',
          target: 'sink',
          tradeAmount: 91000,
          tradeCount: 4,
        },
      ],
    };

    const viewModel = buildCaseGraphViewModel(graphData, {
      focusAccountIds: ['focus-account'],
      focusLabels: ['来款人', '核心主体', '去向人'],
    });

    expect(viewModel.focusNodeIds).toEqual(['focus']);
    expect(viewModel.nodeMetricsById.get('focus')?.role).toBe('peripheral');
    expect(viewModel.nodeMetricsById.get('focus')?.roleLabel).toBe('主体');
    expect(viewModel.roleCounts.peripheral).toBe(3);
  });

  it('keeps bidirectional hubs as ordinary subjects when explicit focus exists', () => {
    const graphData: CaseGraphData = {
      nodes: [
        { id: 'focus', accountId: 'focus-account', label: '目标主体' },
        { id: 'bridge', accountId: 'bridge-account', label: '过桥账户' },
        { id: 'upstream', accountId: 'upstream-account', label: '来款方' },
        { id: 'downstream', accountId: 'downstream-account', label: '去向方' },
      ],
      edges: [
        { id: 'upstream->focus', from: 'upstream', to: 'focus', source: 'upstream', target: 'focus', tradeAmount: 50_000, tradeCount: 3 },
        { id: 'focus->bridge', from: 'focus', to: 'bridge', source: 'focus', target: 'bridge', tradeAmount: 45_000, tradeCount: 2 },
        { id: 'bridge->focus', from: 'bridge', to: 'focus', source: 'bridge', target: 'focus', tradeAmount: 42_000, tradeCount: 2 },
        { id: 'bridge->downstream', from: 'bridge', to: 'downstream', source: 'bridge', target: 'downstream', tradeAmount: 40_000, tradeCount: 2 },
      ],
    };

    const viewModel = buildCaseGraphViewModel(graphData, {
      focusAccountIds: ['focus-account'],
      focusLabels: ['目标主体'],
    });

    expect(viewModel.nodeMetricsById.get('focus')?.role).toBe('peripheral');
    expect(viewModel.nodeMetricsById.get('bridge')?.role).toBe('peripheral');
    expect(viewModel.nodeMetricsById.get('upstream')?.role).toBe('peripheral');
    expect(viewModel.nodeMetricsById.get('downstream')?.role).toBe('peripheral');
    expect(viewModel.roleCounts.peripheral).toBe(4);
  });

  it('ignores broad label lists as focus fallbacks and infers a single core instead', () => {
    const graphData: CaseGraphData = {
      nodes: [
        { id: 'hub', label: '中心账户' },
        { id: 'left-1', label: '左一' },
        { id: 'left-2', label: '左二' },
        { id: 'right-1', label: '右一' },
        { id: 'right-2', label: '右二' },
        { id: 'tail-1', label: '尾一' },
        { id: 'tail-2', label: '尾二' },
      ],
      edges: [
        { id: 'left-1->hub', from: 'left-1', to: 'hub', source: 'left-1', target: 'hub', tradeAmount: 60_000, tradeCount: 2 },
        { id: 'left-2->hub', from: 'left-2', to: 'hub', source: 'left-2', target: 'hub', tradeAmount: 58_000, tradeCount: 2 },
        { id: 'hub->right-1', from: 'hub', to: 'right-1', source: 'hub', target: 'right-1', tradeAmount: 54_000, tradeCount: 2 },
        { id: 'hub->right-2', from: 'hub', to: 'right-2', source: 'hub', target: 'right-2', tradeAmount: 53_000, tradeCount: 2 },
        { id: 'hub->tail-1', from: 'hub', to: 'tail-1', source: 'hub', target: 'tail-1', tradeAmount: 22_000, tradeCount: 1 },
        { id: 'tail-2->hub', from: 'tail-2', to: 'hub', source: 'tail-2', target: 'hub', tradeAmount: 20_000, tradeCount: 1 },
      ],
    };

    const viewModel = buildCaseGraphViewModel(graphData, {
      focusLabels: ['中心账户', '左一', '左二', '右一', '右二', '尾一', '尾二'],
    });

    expect(viewModel.focusNodeIds).toEqual(['hub']);
    expect(viewModel.roleCounts.core).toBe(0);
    expect(viewModel.roleCounts.peripheral).toBe(7);
    expect(viewModel.nodeMetricsById.get('hub')?.role).toBe('peripheral');
  });

  it('does not treat a broad restored account selection as all core nodes', () => {
    const nodes: CaseGraphData['nodes'] = [
      { id: 'hub', accountId: 'account-hub', label: '中心账户' },
      ...Array.from({ length: 28 }, (_, index) => ({
        id: `node-${index}`,
        accountId: `account-${index}`,
        label: `主体${index}`,
      })),
    ];
    const edges: CaseGraphData['edges'] = Array.from({ length: 28 }, (_, index) => ({
      id: index % 2 === 0 ? `node-${index}->hub` : `hub->node-${index}`,
      from: index % 2 === 0 ? `node-${index}` : 'hub',
      to: index % 2 === 0 ? 'hub' : `node-${index}`,
      source: index % 2 === 0 ? `node-${index}` : 'hub',
      target: index % 2 === 0 ? 'hub' : `node-${index}`,
      tradeAmount: 10_000 + index * 1_000,
      tradeCount: 1 + (index % 4),
    }));

    const viewModel = buildCaseGraphViewModel({ nodes, edges }, {
      focusAccountIds: nodes.map((node) => String(node.accountId || '')).filter(Boolean),
    });

    expect(viewModel.roleCounts.core).toBe(0);
    expect(viewModel.roleCounts.peripheral).toBe(29);
    expect(viewModel.nodeMetricsById.get('hub')?.role).toBe('peripheral');
  });
});
