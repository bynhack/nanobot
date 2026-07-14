import assert from "node:assert/strict";
import test from "node:test";
import {
  applyTradeExclusions,
  filterGraphFromTradeFacts,
  remapGraphToExistingNodes,
} from "@casework/case-graph";

test("one-hop query reuses an existing account node when it becomes the seed", () => {
  const currentGraph = {
    nodes: [
      {
        id: "subject:suspect:1",
        type: "subject",
        label: "伍华中",
        accounts: [
          { accountId: "1", tradeCard: "W-1", accountName: "伍华中" },
        ],
      },
      {
        id: "account:35",
        type: "account",
        accountId: "35",
        tradeCard: "P-35",
        accountName: "冯燕青",
        label: "冯燕青",
        accounts: [
          { accountId: "35", tradeCard: "P-35", accountName: "冯燕青" },
        ],
      },
    ],
    edges: [],
  };
  const incomingGraph = {
    nodes: [
      {
        id: "subject:冯燕青",
        type: "subject",
        role: "seed",
        label: "冯燕青",
        accountIds: ["35"],
        accounts: [
          { accountId: "35", tradeCard: "P-35", accountName: "冯燕青" },
        ],
      },
      {
        id: "account:1",
        type: "account",
        accountId: "1",
        tradeCard: "W-1",
        label: "伍华中",
      },
    ],
    edges: [
      {
        id: "money:subject:冯燕青->account:1",
        from: "subject:冯燕青",
        to: "account:1",
        source: "subject:冯燕青",
        target: "account:1",
      },
    ],
  };

  const result = remapGraphToExistingNodes(currentGraph, incomingGraph);
  const nodeIds = result.nodes.map(
    (node: Record<string, unknown>) => node.id,
  );
  assert.deepStrictEqual(nodeIds.sort(), ["account:35", "subject:suspect:1"]);
  assert.equal(result.edges[0]?.source, "account:35");
  assert.equal(result.edges[0]?.target, "subject:suspect:1");
  assert.equal(
    result.edges[0]?.id,
    "money:account:35->subject:suspect:1",
  );
});

test("identity remapping drops self loops and duplicate edges", () => {
  const currentGraph = {
    nodes: [
      {
        id: "subject:suspect:2",
        accounts: [
          { accountId: "35", tradeCard: "P-35", accountName: "冯燕青" },
        ],
      },
    ],
  };
  const incomingGraph = {
    nodes: [
      { id: "account:35", accountId: "35", tradeCard: "P-35" },
      {
        id: "subject:冯燕青",
        accounts: [{ accountId: "35", tradeCard: "P-35" }],
      },
    ],
    edges: [
      {
        id: "old-1",
        source: "account:35",
        target: "subject:冯燕青",
      },
    ],
  };

  const result = remapGraphToExistingNodes(currentGraph, incomingGraph);
  assert.deepStrictEqual(
    result.nodes.map((node: Record<string, unknown>) => node.id),
    ["subject:suspect:2"],
  );
  assert.deepStrictEqual(result.edges, []);
});

test("graph filtering removes edges and nodes without matching trade facts", () => {
  const graph = {
    nodes: [
      { id: "account:1", label: "甲" },
      { id: "account:2", label: "乙" },
      { id: "account:3", label: "丙" },
    ],
    edges: [
      {
        id: "money:account:1->account:2",
        source: "account:1",
        target: "account:2",
        tradeIds: ["t1"],
      },
      {
        id: "money:account:2->account:3",
        source: "account:2",
        target: "account:3",
        tradeIds: ["t2"],
      },
    ],
    tradeFacts: {
      t1: { tradeId: "t1", tradeAmount: 100, tradeTime: "2026-01-01" },
      t2: { tradeId: "t2", tradeAmount: 10, tradeTime: "2026-01-02" },
    },
    excludedTrades: [],
  };

  const result = filterGraphFromTradeFacts(graph, { minAmount: 50 });
  assert.deepStrictEqual(
    result.nodes.map((node: Record<string, unknown>) => node.id).sort(),
    ["account:1", "account:2"],
  );
  assert.deepStrictEqual(
    result.edges.map((edge: Record<string, unknown>) => edge.id),
    ["money:account:1->account:2"],
  );
  assert.equal(result.edges[0]?.tradeAmount, 100);
  assert.equal(result.edges[0]?.tradeCount, 1);
});

test("restoring a fully removed trade reconstructs its edge from persisted facts", () => {
  const graph = {
    nodes: [
      {
        id: "account:1",
        accountId: "1",
        accounts: [{ accountId: "1", tradeCard: "A" }],
      },
      {
        id: "account:2",
        accountId: "2",
        accounts: [{ accountId: "2", tradeCard: "B" }],
      },
    ],
    edges: [],
    excludedTrades: ["t1"],
    tradeFacts: {
      t1: {
        tradeId: "t1",
        tradeAmount: 88,
        tradeTime: "2026-01-01",
        payerAccountId: "1",
        payerTradeCard: "A",
        payerAccountName: "甲",
        payeeAccountId: "2",
        payeeTradeCard: "B",
        payeeAccountName: "乙",
      },
    },
  };

  const result = applyTradeExclusions(graph, [], {});
  assert.equal(result.edges.length, 1);
  assert.equal(result.edges[0]?.id, "money:account:1->account:2");
  assert.deepStrictEqual(result.edges[0]?.tradeIds, ["t1"]);
  assert.equal(result.edges[0]?.tradeAmount, 88);
});
