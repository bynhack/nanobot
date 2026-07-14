import { describe, expect, it } from 'vitest';

import {
  buildSummaryAnalysisItemsForTest,
  filterSummaryAnalysisItemsForTest,
} from './summary-analysis-drawer';
import type { CaseGraphData, CaseGraphNode } from './types';

const focusNode: CaseGraphNode = {
  id: 'account:1',
  label: '伍华中',
  accountId: '1',
};

const graphData: CaseGraphData = {
  nodes: [
    focusNode,
    { id: 'account:35', label: '冯燕青', accountId: '35', tradeCard: 'P-35' },
    { id: 'account:39', label: '蔡金海', accountId: '39', tradeCard: 'P-39' },
  ],
  edges: [
    {
      id: 'money:account:35->account:1',
      from: 'account:35',
      to: 'account:1',
      source: 'account:35',
      target: 'account:1',
      tradeAmount: 10000,
      tradeCount: 2,
      tradeIds: ['1', '2'],
    },
    {
      id: 'money:account:1->account:39',
      from: 'account:1',
      to: 'account:39',
      source: 'account:1',
      target: 'account:39',
      tradeAmount: 8000,
      tradeCount: 1,
      tradeIds: ['3'],
    },
  ],
  tradeFacts: {
    '1': { tradeId: '1', tradeAmount: 4000, tradeTime: '2026-01-01 10:00:00' },
    '2': { tradeId: '2', tradeAmount: 6000, tradeTime: '2026-01-02 10:00:00' },
    '3': { tradeId: '3', tradeAmount: 8000, tradeTime: '2026-01-03 10:00:00' },
  },
};

describe('summary analysis drawer helpers', () => {
  it('aggregates in and out counterparties from current graph trade facts', () => {
    const items = buildSummaryAnalysisItemsForTest(focusNode, graphData, ['2']);
    const byId = new Map(items.map((item) => [item.nodeId, item]));

    expect(items.map((item) => item.nodeId)).toEqual(['account:39', 'account:35']);
    expect(byId.get('account:35')).toEqual(expect.objectContaining({
      label: '冯燕青',
      receivedAmount: 4000,
      receivedCount: 1,
      paidAmount: 0,
      paidCount: 0,
      totalAmount: 4000,
      tradeIds: ['1'],
    }));
    expect(byId.get('account:39')).toEqual(expect.objectContaining({
      label: '蔡金海',
      receivedAmount: 0,
      receivedCount: 0,
      paidAmount: 8000,
      paidCount: 1,
      totalAmount: 8000,
      netAmount: -8000,
      tradeIds: ['3'],
    }));
  });

  it('filters summary candidates by direction, amount, count and keyword', () => {
    const items = buildSummaryAnalysisItemsForTest(focusNode, graphData, ['2']);

    expect(filterSummaryAnalysisItemsForTest(items, { direction: 'in' }).map((item) => item.nodeId)).toEqual(['account:35']);
    expect(filterSummaryAnalysisItemsForTest(items, { direction: 'out' }).map((item) => item.nodeId)).toEqual(['account:39']);
    expect(filterSummaryAnalysisItemsForTest(items, { minAmount: '5000' }).map((item) => item.nodeId)).toEqual(['account:39']);
    expect(filterSummaryAnalysisItemsForTest(items, { minInCount: '1' }).map((item) => item.nodeId)).toEqual(['account:35']);
    expect(filterSummaryAnalysisItemsForTest(items, { keyword: '蔡金' }).map((item) => item.nodeId)).toEqual(['account:39']);
  });
});
