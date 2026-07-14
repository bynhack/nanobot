import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { NodeDetailAnalysisDrawer, type NodeDetailAnalysisRelation } from './node-detail-analysis-drawer';

describe('NodeDetailAnalysisDrawer', () => {
  it('renders transaction review as one table with relation context and current selection status', () => {
    const relation: NodeDetailAnalysisRelation = {
      edgeId: 'edge-1',
      counterpartyName: '冯光彩',
      direction: 'out',
      edge: {
        id: 'edge-1',
        source: 'account:35',
        target: 'account:107',
        from: 'account:35',
        to: 'account:107',
        tradeAmount: 24000,
        tradeCount: 1,
        tradeIds: ['trade-1'],
      },
    };

    const html = renderToStaticMarkup(createElement(NodeDetailAnalysisDrawer, {
      open: true,
      node: { id: 'account:35', label: '冯燕青' },
      relationships: [relation],
      detailByEdgeId: {
        'edge-1': [
          {
            tradeId: 'trade-1',
            serialNumber: null,
            payerAccountName: '冯燕青',
            payerAccountId: '35',
            payerTradeCard: '085e',
            payeeAccountName: '冯光彩',
            payeeAccountId: '107',
            payeeTradeCard: '107',
            tradeAmount: 24000,
            tradeTime: '2026-01-18 23:10:34',
            tradeAbstract: '转账',
          },
        ],
      },
      loadingEdgeIds: {},
      selectedTradeIds: ['trade-1'],
      applying: false,
      onLoadRelation: () => undefined,
      onToggleTrade: () => undefined,
      onToggleTrades: () => undefined,
      onApply: () => undefined,
      onClose: () => undefined,
    }));

    expect(html).toContain('冯燕青 · 1 条关联线 · 已载入 1 笔交易');
    expect(html).toContain('关联主体');
    expect(html).toContain('冯光彩');
    expect(html).toContain('本次核查已勾选排除 1 笔交易');
    expect(html).not.toContain('关联交易线');
  });
});
