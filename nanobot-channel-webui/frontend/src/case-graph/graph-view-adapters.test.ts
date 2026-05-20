import { describe, expect, it } from 'vitest';

import { buildMergedNetworkGraph, parseGroupEdgeId } from './graph-view-adapters';
import type { CaseGraphData, CaseGraphGroupMap } from './types';

describe('graph view adapters', () => {
  it('keeps the default network merged to raw group ids', () => {
    const graphData: CaseGraphData = {
      nodes: [
        { id: '1', accountId: '1', accountName: '伍华中-微信1' },
        { id: '3', accountId: '3', accountName: '伍华中-微信2' },
        { id: '137', accountId: '137', accountName: '伍华中-农行' },
        { id: '35', accountId: '35', accountName: '冯燕青' },
      ],
      edges: [
        { id: '35->1', from: '35', to: '1', source: '35', target: '1', tradeAmount: 20_000, tradeCount: 1 },
        { id: '35->3', from: '35', to: '3', source: '35', target: '3', tradeAmount: 10_000, tradeCount: 1 },
        { id: '137->35', from: '137', to: '35', source: '137', target: '35', tradeAmount: 8_000, tradeCount: 1 },
      ],
    };
    const groupMap: CaseGraphGroupMap = {
      '1': {
        groupId: '1_3_137',
        groupName: '伍华中',
        tradeCard: [
          { accountId: '1', accountName: '伍华中-微信1' },
          { accountId: '3', accountName: '伍华中-微信2' },
          { accountId: '137', accountName: '伍华中-农行' },
        ],
      },
      '3': {
        groupId: '1_3_137',
        groupName: '伍华中',
        tradeCard: [
          { accountId: '1', accountName: '伍华中-微信1' },
          { accountId: '3', accountName: '伍华中-微信2' },
          { accountId: '137', accountName: '伍华中-农行' },
        ],
      },
      '137': {
        groupId: '1_3_137',
        groupName: '伍华中',
        tradeCard: [
          { accountId: '1', accountName: '伍华中-微信1' },
          { accountId: '3', accountName: '伍华中-微信2' },
          { accountId: '137', accountName: '伍华中-农行' },
        ],
      },
    };

    const result = buildMergedNetworkGraph(graphData, groupMap);

    expect(result?.nodes.map((node) => node.id)).toEqual(['1_3_137', '35']);
    expect(result?.edges).toEqual([
      expect.objectContaining({
        source: '35',
        target: '1_3_137',
        tradeAmount: 30_000,
        tradeCount: 2,
      }),
      expect.objectContaining({
        source: '1_3_137',
        target: '35',
        tradeAmount: 8_000,
        tradeCount: 1,
      }),
    ]);
    expect(parseGroupEdgeId(result!.edges[0]!.id)).toEqual({ sourceId: '35', targetId: '1_3_137' });
  });
});
