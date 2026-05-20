import { describe, expect, it } from 'vitest';

import { normalizeCaseGraphOriginData, originDataToCanvasData } from './adapters';

describe('case graph adapters', () => {
  it('filters money edges whose endpoints are missing from the node set', () => {
    const originData = normalizeCaseGraphOriginData({
      nodes: [
        { id: '1', label: '伍华中' },
        { id: '35', label: '冯燕青' },
      ],
      money: [
        { id: '35->1', from: '35', to: '1', tradeAmount: 40000, tradeCount: 2 },
        { id: '42->35', from: '42', to: '35', tradeAmount: 2000, tradeCount: 1 },
        { id: '35->96', from: '35', to: '96', tradeAmount: 1200, tradeCount: 1 },
      ],
      phone: [],
      groups: {},
      sourceSelectId: ['伍华中', '冯燕青'],
      excludedTrades: [],
    });

    const canvasData = originDataToCanvasData(originData);

    expect(canvasData?.nodes.map((node) => node.id)).toEqual(['1', '35']);
    expect(canvasData?.edges).toEqual([
      {
        id: '35->1',
        from: '35',
        to: '1',
        source: '35',
        target: '1',
        tradeAmount: 40000,
        tradeCount: 2,
      },
    ]);
  });

  it('backfills a stable edge id when the backend payload omits it', () => {
    const originData = normalizeCaseGraphOriginData({
      nodes: [
        { id: 'payer', label: '付款方' },
        { id: 'payee', label: '收款方' },
      ],
      money: [
        { id: '' as unknown as string, from: 'payer', to: 'payee', tradeAmount: 12.5, tradeCount: 1 },
      ],
      phone: [],
      groups: {},
      sourceSelectId: ['付款方', '收款方'],
      excludedTrades: [],
    });

    const canvasData = originDataToCanvasData(originData);

    expect(canvasData?.edges[0]?.id).toBe('payer->payee');
    expect(canvasData?.edges[0]?.source).toBe('payer');
    expect(canvasData?.edges[0]?.target).toBe('payee');
  });

  it('normalizes groupMap back to member account ids instead of collapsing to group id', () => {
    const originData = normalizeCaseGraphOriginData({
      nodes: [],
      money: [],
      phone: [],
      groups: {
        group_zhang: {
          groupId: 'group_zhang',
          groupName: '张三',
          tradeCard: [
            { accountId: 'a1', accountName: '张三-1' },
            { accountId: 'a2', accountName: '张三-2' },
          ],
        },
      },
      sourceSelectId: [],
      excludedTrades: [],
    });

    expect(originData?.groups.a1?.groupId).toBe('group_zhang');
    expect(originData?.groups.a2?.groupId).toBe('group_zhang');
    expect(originData?.groups.group_zhang).toBeUndefined();
  });
});
