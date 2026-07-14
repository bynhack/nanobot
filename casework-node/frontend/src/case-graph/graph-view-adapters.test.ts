import { describe, expect, it } from 'vitest';

import { buildFlowGraphProjection, buildMergedNetworkGraph, parseGroupEdgeId } from './graph-view-adapters';
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

  it('builds a net one-way flow projection from the current graph', () => {
    const graphData: CaseGraphData = {
      nodes: [
        { id: 'subject:suspect:1', label: '伍华中', accountIds: ['1', '3'] },
        { id: 'account:32', accountId: '32', accountName: '赵引' },
        { id: 'account:8', accountId: '8', accountName: '雷桂莲' },
      ],
      edges: [
        {
          id: 'subject->32',
          from: 'subject:suspect:1',
          to: 'account:32',
          source: 'subject:suspect:1',
          target: 'account:32',
          tradeAmount: 1400,
          tradeCount: 3,
          tradeIds: ['54', '44', '479'],
        },
        {
          id: '32->subject',
          from: 'account:32',
          to: 'subject:suspect:1',
          source: 'account:32',
          target: 'subject:suspect:1',
          tradeAmount: 1300,
          tradeCount: 4,
          tradeIds: ['48', '39', '36', '497'],
        },
        {
          id: '8->subject',
          from: 'account:8',
          to: 'subject:suspect:1',
          source: 'account:8',
          target: 'subject:suspect:1',
          tradeAmount: 1500,
          tradeCount: 2,
          tradeIds: ['7', '504'],
        },
        {
          id: 'subject->8',
          from: 'subject:suspect:1',
          to: 'account:8',
          source: 'subject:suspect:1',
          target: 'account:8',
          tradeAmount: 580,
          tradeCount: 2,
          tradeIds: ['487', '466'],
        },
      ],
    };

    const result = buildFlowGraphProjection(graphData, {});

    expect(result?.edges).toEqual([
      expect.objectContaining({
        id: 'group-edge:subject:suspect:1->account:32',
        source: 'subject:suspect:1',
        target: 'account:32',
        tradeAmount: 100,
        tradeCount: 3,
        tradeIds: ['54', '44', '479'],
      }),
      expect.objectContaining({
        id: 'group-edge:account:8->subject:suspect:1',
        source: 'account:8',
        target: 'subject:suspect:1',
        tradeAmount: 920,
        tradeCount: 2,
        tradeIds: ['7', '504'],
      }),
    ]);
  });
});
