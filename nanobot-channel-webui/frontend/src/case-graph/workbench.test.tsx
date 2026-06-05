import * as React from 'react';
import { createElement, isValidElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ChatSidebar } from '../components/chat/sidebar';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('case graph workbench', () => {
  it('restores drill settings from the persisted relation graph state', async () => {
    vi.stubGlobal('window', {
      __NANOBOT_WEBUI_BOOTSTRAP__: { title: 'Nanobot', authRequired: false },
      localStorage: {
        getItem: () => null,
        setItem: () => undefined,
      },
      innerWidth: 1440,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    });
    const { graphStateToTabForTest } = await import('./workbench');

    const tab = graphStateToTabForTest({
      schemaVersion: 'case-graph.state.v1',
      caseId: '37',
      graphId: 'graph-1',
      graphName: '图1',
      revision: 1,
      updatedAt: '2026-01-01T00:00:00Z',
      lastStepId: '0001',
      graph: {
        nodes: [],
        edges: [],
        tradeFacts: {},
        tradeCards: [],
        groupMap: {},
        sourceSelectId: [],
        summarySelectedAccountId: [],
        summarySelectedAccountName: [],
        excludedTrades: [],
        excludedAccountId: [],
        excludedAccountName: [],
        layout: { nodePositions: {}, viewport: { x: 0, y: 0, zoom: 1 } },
        filters: { minAmount: null, maxAmount: null, startTime: '', endTime: '' },
        drillNums: 3,
        drillType: 2,
        excludedNodes: [],
        manualEdges: [],
        annotations: [],
        graphData: null,
      },
    });

    expect(tab.drillNums).toBe(3);
    expect(tab.drillType).toBe(2);
  });

  it('merges drill results as an extension from the selected node without moving existing nodes', async () => {
    vi.stubGlobal('window', {
      __NANOBOT_WEBUI_BOOTSTRAP__: { title: 'Nanobot', authRequired: false },
      localStorage: {
        getItem: () => null,
        setItem: () => undefined,
      },
      innerWidth: 1440,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    });
    const { mergeGraphDataForTest } = await import('./workbench');

    const merged = mergeGraphDataForTest(
      {
        nodes: [
          { id: 'wu', label: '伍华中', accountId: '1', x: 320, y: 240 },
          { id: 'feng', label: '冯燕青', accountId: '35', x: 560, y: 240 },
        ],
        edges: [
          { id: 'wu->feng', from: 'wu', to: 'feng', source: 'wu', target: 'feng', tradeAmount: 100, tradeCount: 1 },
        ],
      },
      {
        nodes: [
          { id: 'wu', label: '伍华中', accountId: '1' },
          { id: 'chen', label: '陈某', accountId: '88' },
        ],
        edges: [
          { id: 'chen->wu', from: 'chen', to: 'wu', source: 'chen', target: 'wu', tradeAmount: 50, tradeCount: 1 },
        ],
      },
      { mode: 'drill', direction: 'in', anchorNodeId: 'wu' },
    );

    expect(merged?.nodes.find((node) => node.id === 'wu')).toMatchObject({ x: 320, y: 240 });
    expect(merged?.nodes.find((node) => node.id === 'feng')).toMatchObject({ x: 560, y: 240 });
    expect(merged?.nodes.find((node) => node.id === 'chen')?.x).toBeLessThan(320);
    expect(merged?.edges.map((edge) => edge.id).sort()).toEqual(['money:chen->wu', 'money:wu->feng']);
  });

  it('keeps drill extension positions as the layout snapshot to persist', async () => {
    vi.stubGlobal('window', {
      __NANOBOT_WEBUI_BOOTSTRAP__: { title: 'Nanobot', authRequired: false },
      localStorage: {
        getItem: () => null,
        setItem: () => undefined,
      },
      innerWidth: 1440,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    });
    const { buildRelationOptionsForTest, mergeGraphDataForTest } = await import('./workbench');
    const current = {
      nodes: [
        { id: 'subject:suspect:1', label: '伍华中', x: 720, y: 355 },
        { id: 'account:35', label: '冯燕青', x: 346, y: 68 },
      ],
      edges: [
        { id: 'money:account:35->subject:suspect:1', from: 'account:35', to: 'subject:suspect:1', source: 'account:35', target: 'subject:suspect:1', tradeAmount: 100, tradeCount: 1 },
      ],
    };
    const incoming = {
      nodes: [
        { id: 'account:35', label: '冯燕青' },
        { id: 'account:107', label: '冯光彩' },
      ],
      edges: [
        { id: 'money:account:107->account:35', from: 'account:107', to: 'account:35', source: 'account:107', target: 'account:35', tradeAmount: 50, tradeCount: 1 },
      ],
    };

    const merged = mergeGraphDataForTest(current, incoming, { mode: 'drill', direction: 'in', anchorNodeId: 'account:35' });
    const options = buildRelationOptionsForTest(merged, {});

    expect(merged?.nodes.find((node) => node.id === 'subject:suspect:1')).toMatchObject({ x: 720, y: 355 });
    expect(merged?.nodes.find((node) => node.id === 'account:35')).toMatchObject({ x: 346, y: 68 });
    expect(merged?.nodes.find((node) => node.id === 'account:107')?.x).toBeLessThan(346);
    expect(options.nodePositions).toMatchObject({
      'subject:suspect:1': { x: 720, y: 355 },
      'account:35': { x: 346, y: 68 },
      'account:107': merged?.nodes.find((node) => node.id === 'account:107')
        ? {
            x: merged.nodes.find((node) => node.id === 'account:107')!.x,
            y: merged.nodes.find((node) => node.id === 'account:107')!.y,
          }
        : undefined,
    });
  });

  it('places drilled nodes away from occupied existing nodes', async () => {
    vi.stubGlobal('window', {
      __NANOBOT_WEBUI_BOOTSTRAP__: { title: 'Nanobot', authRequired: false },
      localStorage: {
        getItem: () => null,
        setItem: () => undefined,
      },
      innerWidth: 1440,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    });
    const { mergeGraphDataForTest } = await import('./workbench');
    const merged = mergeGraphDataForTest(
      {
        nodes: [
          { id: 'anchor', label: '冯燕青', x: 346, y: 68 },
          { id: 'occupied', label: '伍华中', x: 720, y: 68 },
        ],
        edges: [
          { id: 'anchor->occupied', from: 'anchor', to: 'occupied', source: 'anchor', target: 'occupied', tradeAmount: 1, tradeCount: 1 },
        ],
      },
      {
        nodes: [
          { id: 'anchor', label: '冯燕青' },
          { id: 'new-1', label: '冯光彩' },
        ],
        edges: [
          { id: 'anchor->new-1', from: 'anchor', to: 'new-1', source: 'anchor', target: 'new-1', tradeAmount: 1, tradeCount: 1 },
        ],
      },
      { mode: 'drill', direction: 'out', anchorNodeId: 'anchor' },
    );

    const newNode = merged?.nodes.find((node) => node.id === 'new-1');
    expect(nodesOverlap(newNode, { id: 'occupied', x: 720, y: 68 })).toBe(false);
  });

  it('keeps a multi-node drill column from covering existing center nodes', async () => {
    vi.stubGlobal('window', {
      __NANOBOT_WEBUI_BOOTSTRAP__: { title: 'Nanobot', authRequired: false },
      localStorage: {
        getItem: () => null,
        setItem: () => undefined,
      },
      innerWidth: 1440,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    });
    const { mergeGraphDataForTest } = await import('./workbench');
    const incomingNodes = Array.from({ length: 8 }, (_, index) => ({ id: `new-${index}`, label: `新增${index}` }));
    const merged = mergeGraphDataForTest(
      {
        nodes: [
          { id: 'anchor', label: '冯燕青', x: 346, y: 68 },
          { id: 'center', label: '伍华中', x: 720, y: 355 },
        ],
        edges: [
          { id: 'anchor->center', from: 'anchor', to: 'center', source: 'anchor', target: 'center', tradeAmount: 1, tradeCount: 1 },
        ],
      },
      {
        nodes: [{ id: 'anchor', label: '冯燕青' }, ...incomingNodes],
        edges: incomingNodes.map((node) => ({
          id: `anchor->${node.id}`,
          from: 'anchor',
          to: node.id,
          source: 'anchor',
          target: node.id,
          tradeAmount: 1,
          tradeCount: 1,
        })),
      },
      { mode: 'drill', direction: 'out', anchorNodeId: 'anchor' },
    );

    for (const node of merged?.nodes.filter((item) => item.id.startsWith('new-')) ?? []) {
      expect(nodesOverlap(node, { id: 'center', x: 720, y: 355 })).toBe(false);
    }
  });

  it('merges a subject seed back into an existing account node with the same account identity', async () => {
    vi.stubGlobal('window', {
      __NANOBOT_WEBUI_BOOTSTRAP__: { title: 'Nanobot', authRequired: false },
      localStorage: {
        getItem: () => null,
        setItem: () => undefined,
      },
      innerWidth: 1440,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    });
    const { mergeGraphDataForTest } = await import('./workbench');

    const merged = mergeGraphDataForTest(
      {
        nodes: [
          {
            id: 'subject:suspect:1',
            type: 'subject',
            label: '伍华中',
            accounts: [{ accountId: '1', tradeCard: 'W-1', accountName: '伍华中' }],
            x: 320,
            y: 240,
          },
          {
            id: 'account:35',
            type: 'account',
            label: '冯燕青',
            accountId: '35',
            tradeCard: 'P-35',
            accounts: [{ accountId: '35', tradeCard: 'P-35', accountName: '冯燕青' }],
            x: 120,
            y: 240,
          },
        ],
        edges: [
          { id: 'money:account:35->subject:suspect:1', from: 'account:35', to: 'subject:suspect:1', source: 'account:35', target: 'subject:suspect:1', tradeAmount: 40000, tradeCount: 2 },
        ],
      },
      {
        nodes: [
          {
            id: 'subject:冯燕青',
            type: 'subject',
            label: '冯燕青',
            accountIds: ['35'],
            accounts: [{ accountId: '35', tradeCard: 'P-35', accountName: '冯燕青' }],
          },
          { id: 'account:1', type: 'account', label: '伍华中', accountId: '1', tradeCard: 'W-1' },
        ],
        edges: [
          { id: 'money:subject:冯燕青->account:1', from: 'subject:冯燕青', to: 'account:1', source: 'subject:冯燕青', target: 'account:1', tradeAmount: 40000, tradeCount: 2 },
        ],
      },
      { mode: 'drill', direction: 'out', anchorNodeId: 'account:35' },
    );

    expect(merged?.nodes.map((node) => node.id).sort()).toEqual(['account:35', 'subject:suspect:1']);
    expect(merged?.nodes.find((node) => node.id === 'account:35')).toMatchObject({ x: 120, y: 240 });
    expect(merged?.edges.some((edge) => edge.source === 'subject:冯燕青' || edge.target === 'account:1')).toBe(false);
    expect(merged?.edges.some((edge) => edge.source === 'account:35' && edge.target === 'subject:suspect:1')).toBe(true);
  });

  it('builds relation request options from the current rendered node positions', async () => {
    vi.stubGlobal('window', {
      __NANOBOT_WEBUI_BOOTSTRAP__: { title: 'Nanobot', authRequired: false },
      localStorage: {
        getItem: () => null,
        setItem: () => undefined,
      },
      innerWidth: 1440,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    });
    const { buildRelationOptionsForTest } = await import('./workbench');

    const options = buildRelationOptionsForTest(
      {
        nodes: [
          { id: 'subject:suspect:1', label: '伍华中', x: 10, y: 20 },
          { id: 'account:35', label: '冯燕青' },
        ],
        edges: [],
      },
      {
        'subject:suspect:1': { x: 320, y: 240 },
        'account:35': { x: 560, y: 240 },
      },
    );

    expect(options).toEqual({
      nodePositions: {
        'subject:suspect:1': { x: 320, y: 240 },
        'account:35': { x: 560, y: 240 },
      },
    });
  });

  it('persists graph positions only after an explicit node drag', async () => {
    vi.stubGlobal('window', {
      __NANOBOT_WEBUI_BOOTSTRAP__: { title: 'Nanobot', authRequired: false },
      localStorage: {
        getItem: () => null,
        setItem: () => undefined,
      },
      innerWidth: 1440,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    });
    const { shouldPersistGraphPositionsForTest } = await import('./workbench');
    const graphData = {
      nodes: [{ id: 'subject:suspect:1', label: '伍华中', x: 100, y: 200 }],
      edges: [],
    };
    const positions = { 'subject:suspect:1': { x: 320, y: 240 } };

    expect(shouldPersistGraphPositionsForTest(graphData, positions, 'layout')).toBe(false);
    expect(shouldPersistGraphPositionsForTest(graphData, positions, 'drag')).toBe(true);
  });

  it('allows relation-operation layout callbacks to patch the latest step snapshot', async () => {
    vi.stubGlobal('window', {
      __NANOBOT_WEBUI_BOOTSTRAP__: { title: 'Nanobot', authRequired: false },
      localStorage: {
        getItem: () => null,
        setItem: () => undefined,
      },
      innerWidth: 1440,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    });
    const { shouldPersistGraphPositionsForTest, shouldPersistLatestStepLayoutForTest } = await import('./workbench');
    const graphData = {
      nodes: [
        { id: 'subject:suspect:1', label: '伍华中' },
        { id: 'account:35', label: '冯燕青' },
      ],
      edges: [],
    };
    const positions = {
      'subject:suspect:1': { x: 320, y: 240 },
      'account:35': { x: 560, y: 240 },
    };

    expect(shouldPersistGraphPositionsForTest(graphData, positions, 'layout')).toBe(false);
    expect(shouldPersistLatestStepLayoutForTest(graphData, positions)).toBe(true);
  });

  it('keeps existing trade exclusions while applying only the current review selection', async () => {
    const { buildAppliedExcludedTradeIdsForTest } = await import('./workbench');

    expect(buildAppliedExcludedTradeIdsForTest(['old-1', ' old-2 ', 'old-1'], ['new-1', 'old-2', ''])).toEqual([
      'old-1',
      'old-2',
      'new-1',
    ]);
  });

  it('opens graph workbench from sidebar entry', async () => {
    const onOpenCaseGraph = () => {};
    const sidebar = ChatSidebar({
      title: 'Nanobot',
      sidebarCollapsed: false,
      activeThreadId: null,
      sessionsById: new Map(),
      connectionState: 'connected',
      onOpenSettings: () => {},
      onOpenCaseGraph,
    });
    const entryButton = findButton(sidebar, '上图');

    expect(entryButton).not.toBeNull();
    expect(entryButton?.props.onClick).toBe(onOpenCaseGraph);

    vi.stubGlobal('window', {
      __NANOBOT_WEBUI_BOOTSTRAP__: { title: 'Nanobot', authRequired: false },
      localStorage: {
        getItem: () => null,
        setItem: () => undefined,
      },
    });
    const { CaseGraphWorkbench } = await import('./workbench');
    const html = renderToStaticMarkup(createElement(CaseGraphWorkbench, { token: '', onBack: () => {} }));
    expect(html).toContain('返回');
    expect(html).toContain('新增');
  });

  it('renders graph filter controls as part of the graph workbench', async () => {
    vi.stubGlobal('window', {
      __NANOBOT_WEBUI_BOOTSTRAP__: { title: 'Nanobot', authRequired: false },
      localStorage: {
        getItem: () => null,
        setItem: () => undefined,
      },
      innerWidth: 1440,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    });
    const { CaseGraphWorkbench } = await import('./workbench');
    const html = renderToStaticMarkup(createElement(CaseGraphWorkbench, { token: '', onBack: () => {} }));

    expect(html).toContain('金额');
    expect(html).toContain('时间');
    expect(html).toContain('应用筛选');
    expect(html).toContain('当前筛选');
    expect(html).toContain('排除项 0');
    expect(html).toContain('显示排除');
  });

  it('keeps only create action in the topbar and moves investigation entry into the graph area', async () => {
    vi.stubGlobal('window', {
      __NANOBOT_WEBUI_BOOTSTRAP__: { title: 'Nanobot', authRequired: false },
      localStorage: {
        getItem: () => null,
        setItem: () => undefined,
      },
      innerWidth: 1440,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    });
    const { CaseGraphWorkbench } = await import('./workbench');
    const html = renderToStaticMarkup(createElement(CaseGraphWorkbench, { token: '', onBack: () => {} }));

    const topbarHtml = html.slice(html.indexOf('case-graph-topbar'), html.indexOf('case-graph-layout'));
    expect(topbarHtml).toContain('新增');
    expect(topbarHtml).not.toContain('钻取配置');
    expect(topbarHtml).not.toContain('分析图上节点关系');
    expect(topbarHtml).not.toContain('分析上图');
    expect(html).toContain('先点击新增，创建图形页签。');
    expect(html).toContain('应用筛选');
  });
});

function findButton(element: React.ReactNode, label: string): React.ReactElement<{ onClick?: () => void }> | null {
  if (!isValidElement(element)) {
    return null;
  }
  const reactElement = element as React.ReactElement<{ children?: React.ReactNode; onClick?: () => void }>;
  if (typeof reactElement.type === 'function') {
    return findButton(reactElement.type(reactElement.props), label);
  }
  if (reactElement.type === 'button' && containsText(reactElement.props.children, label)) {
    return reactElement as React.ReactElement<{ onClick?: () => void }>;
  }
  const children = React.Children.toArray(reactElement.props.children);
  for (const child of children) {
    const found = findButton(child, label);
    if (found) {
      return found;
    }
  }
  return null;
}

function containsText(node: React.ReactNode, text: string): boolean {
  if (typeof node === 'string') {
    return node.includes(text);
  }
  if (Array.isArray(node)) {
    return node.some((child) => containsText(child, text));
  }
  if (node && typeof node === 'object' && 'props' in node) {
    return containsText((node as React.ReactElement<{ children?: React.ReactNode }>).props.children, text);
  }
  return false;
}

function nodesOverlap(
  left: { x?: number; y?: number } | undefined,
  right: { x?: number; y?: number },
): boolean {
  if (left?.x == null || left.y == null || right.x == null || right.y == null) {
    return false;
  }
  const width = 248 + 64;
  const height = 84 + 56;
  return Math.abs(left.x - right.x) < width && Math.abs(left.y - right.y) < height;
}
