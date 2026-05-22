import { describe, expect, it } from 'vitest';

import { buildEdgeDetailSummaryForTest, getPaginatedEdgeDetail, resolveEdgeDetailParty } from './edge-detail-drawer';
import type { CaseGraphTargetDetailItem } from './types';

const detailItem: CaseGraphTargetDetailItem = {
  tradeId: 't-1',
  serialNumber: 's-1',
  tradeAmount: 1200,
  tradeTime: '2026-05-20 10:00:00',
  tradeAbstract: '',
  payerAccountId: 'payer-account',
  payerAccountName: '',
  payerTradeCard: '085e9858ee415e117f9003838@wx.tenpay.com',
  payeeAccountId: 'payee-account',
  payeeAccountName: '伍华中-微信账户',
  payeeTradeCard: 'wx-payee',
};

describe('edge detail display names', () => {
  it('prefers merged party names from the clicked edge context', () => {
    expect(resolveEdgeDetailParty(detailItem, 'payer', { payerName: '冯燕青', payeeName: '伍华中' })).toEqual({
      name: '冯燕青',
      account: '085e9858ee415e117f9003838@wx.tenpay.com',
    });
    expect(resolveEdgeDetailParty(detailItem, 'payee', { payerName: '冯燕青', payeeName: '伍华中' })).toEqual({
      name: '伍华中',
      account: 'wx-payee',
    });
  });

  it('paginates transaction detail rows', () => {
    const rows = Array.from({ length: 18 }, (_, index) => ({
      ...detailItem,
      tradeId: `t-${index + 1}`,
      tradeAmount: index + 1,
    }));

    expect(getPaginatedEdgeDetail(rows, 1, 10).items).toHaveLength(10);
    expect(getPaginatedEdgeDetail(rows, 2, 10).items.map((item) => item.tradeId)).toEqual([
      't-11',
      't-12',
      't-13',
      't-14',
      't-15',
      't-16',
      't-17',
      't-18',
    ]);
    expect(getPaginatedEdgeDetail(rows, 3, 10).page).toBe(2);
  });

  it('summarizes all accounts involved when one side is an aggregated node', () => {
    const summary = buildEdgeDetailSummaryForTest(
      [
        detailItem,
        {
          ...detailItem,
          tradeId: 't-2',
          payeeTradeCard: 'wx-payee-2',
          tradeAmount: 800,
          tradeTime: '2026-05-20 11:00:00',
        },
        {
          ...detailItem,
          tradeId: 't-3',
          payerTradeCard: '085e9858ee415e117f9003838@wx.tenpay.com',
          payeeTradeCard: 'wx-payee-2',
          tradeAmount: 600,
          tradeTime: '2026-05-20 12:00:00',
        },
      ],
      { payerName: '冯燕青', payeeName: '伍华中' },
    );

    expect(summary?.payer).toEqual({
      name: '冯燕青',
      account: '085e9858ee415e117f9003838@wx.tenpay.com',
    });
    expect(summary?.payee).toEqual({
      name: '伍华中',
      account: 'wx-payee、wx-payee-2',
    });
  });
});
