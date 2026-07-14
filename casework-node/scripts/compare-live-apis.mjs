import assert from "node:assert/strict";

const oldBase = process.env.OLD_BASE_URL || "http://127.0.0.1:8082";
const newBase = process.env.NEW_BASE_URL || "http://127.0.0.1:8081";
const get = (base, path) => request(base, path);
const post = (base, path, body) =>
  request(base, path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const del = (base, path) => request(base, path, { method: "DELETE" });

const [oldCases, newCases] = await Promise.all([
  get(oldBase, "/api/case-graph/cases"),
  get(newBase, "/api/case-graph/cases"),
]);
assert.deepStrictEqual(newCases, oldCases, "案件列表不一致");
const caseId = String(oldCases.items?.[0]?.id || "");
assert.ok(caseId, "没有可用于对照的案件");
const [oldAccounts, newAccounts, oldOverview, newOverview] = await Promise.all([
  get(oldBase, `/api/case-graph/cases/${caseId}/accounts`),
  get(newBase, `/api/case-graph/cases/${caseId}/accounts`),
  get(oldBase, `/api/case-audit/cases/${caseId}/overview`),
  get(newBase, `/api/case-audit/cases/${caseId}/overview`),
]);
assert.deepStrictEqual(newAccounts, oldAccounts, "案件账号列表不一致");
assert.deepStrictEqual(newOverview, oldOverview, "审计概览不一致");
const account = oldAccounts.items?.[0];
assert.ok(account, "没有可用于对照的案件账号");

const graphInput = {
  caseId,
  graphName: "Node 接口对照",
  tradeCards: [account],
};
const [oldGraph, newGraph] = await Promise.all([
  post(oldBase, "/api/case-graph/graphs", graphInput),
  post(newBase, "/api/case-graph/graphs", graphInput),
]);
const relationInput = (graphId) => ({
  caseId,
  graphId,
  seeds: [
    {
      suspectId: account.suspectId,
      suspectName: account.suspectName,
      accountIds: [account.accountId],
      excludedAccountIds: [],
      accounts: [account],
    },
  ],
  direction: "both",
  drillNums: 10,
  drillType: 1,
  filters: {},
  options: { nodePositions: {} },
});
const [oldRelation, newRelation] = await Promise.all([
  post(
    oldBase,
    "/api/case-graph/relation/query",
    relationInput(oldGraph.graph_id),
  ),
  post(
    newBase,
    "/api/case-graph/relation/query",
    relationInput(newGraph.graph_id),
  ),
]);
let oldCurrent = oldRelation;
let newCurrent = newRelation;
assert.deepStrictEqual(
  normalizeGraph(newRelation.graph),
  normalizeGraph(oldRelation.graph),
  "首层关系图不一致",
);

const oldCounterparty = pickExistingCounterparty(oldRelation.graph, account);
const newCounterparty = oldCounterparty
  ? newRelation.graph.nodes.find(
      (node) =>
        String(node.id) === String(oldCounterparty.id) ||
        (String(node.label) === String(oldCounterparty.label) &&
          accountIds(node).some((id) => accountIds(oldCounterparty).includes(id))),
    )
  : null;
if (oldCounterparty && newCounterparty) {
  const [oldSecondHop, newSecondHop] = await Promise.all([
    post(
      oldBase,
      "/api/case-graph/relation/query",
      counterpartyRelationInput(oldGraph.graph_id, caseId, oldCounterparty),
    ),
    post(
      newBase,
      "/api/case-graph/relation/query",
      counterpartyRelationInput(newGraph.graph_id, caseId, newCounterparty),
    ),
  ]);
  assert.deepStrictEqual(
    normalizeGraph(newSecondHop.graph),
    normalizeGraph(oldSecondHop.graph),
    "已有交易对手再次上钻后的累计图不一致",
  );
  oldCurrent = oldSecondHop;
  newCurrent = newSecondHop;
}

const currentAccounts = uniqueAccounts(oldCurrent.graph.nodes);
if (currentAccounts.length >= 2) {
  [oldCurrent, newCurrent] = await Promise.all([
    post(oldBase, "/api/case-graph/relation/complete", {
      caseId,
      graphId: oldGraph.graph_id,
      accounts: currentAccounts,
      filters: {},
      options: { nodePositions: {} },
      evidence: evidence("关系补全"),
    }),
    post(newBase, "/api/case-graph/relation/complete", {
      caseId,
      graphId: newGraph.graph_id,
      accounts: currentAccounts,
      filters: {},
      options: { nodePositions: {} },
      evidence: evidence("关系补全"),
    }),
  ]);
  assertGraphStateEqual(newCurrent.graph, oldCurrent.graph, "图内关系补全不一致");
}

[oldCurrent, newCurrent] = await Promise.all([
  post(oldBase, "/api/case-graph/relation/filter", {
    caseId,
    graphId: oldGraph.graph_id,
    filters: {},
    options: { nodePositions: {} },
  }),
  post(newBase, "/api/case-graph/relation/filter", {
    caseId,
    graphId: newGraph.graph_id,
    filters: {},
    options: { nodePositions: {} },
  }),
]);
assertGraphStateEqual(newCurrent.graph, oldCurrent.graph, "全图筛选不一致");

const excludedTradeId = oldCurrent.graph.edges[0]?.tradeIds?.[0];
if (excludedTradeId) {
  for (const excludedTrades of [[excludedTradeId], []]) {
    [oldCurrent, newCurrent] = await Promise.all([
      post(oldBase, "/api/case-graph/relation/exclude-trades", {
        caseId,
        graphId: oldGraph.graph_id,
        excludedTrades,
        tradeFacts: oldCurrent.graph.tradeFacts,
        edgeTradeIds: Object.fromEntries(
          oldCurrent.graph.edges.map((edge) => [edge.id, edge.tradeIds || []]),
        ),
        evidence: excludedTrades.length ? evidence("交易核查") : undefined,
      }),
      post(newBase, "/api/case-graph/relation/exclude-trades", {
        caseId,
        graphId: newGraph.graph_id,
        excludedTrades,
        tradeFacts: newCurrent.graph.tradeFacts,
        edgeTradeIds: Object.fromEntries(
          newCurrent.graph.edges.map((edge) => [edge.id, edge.tradeIds || []]),
        ),
        evidence: excludedTrades.length ? evidence("交易核查") : undefined,
      }),
    ]);
    assertGraphStateEqual(
      newCurrent.graph,
      oldCurrent.graph,
      excludedTrades.length ? "排除交易不一致" : "恢复交易不一致",
    );
  }
}

const groupNodes = oldCurrent.graph.nodes.slice(0, 3).map((node) => node.id);
if (groupNodes.length >= 3) {
  const operations = [
    { operation: "create", groupId: "contract-group", nodeIds: groupNodes.slice(0, 2), name: "契约研判组", collapsed: false },
    { operation: "add_members", groupId: "contract-group", memberNodeIds: [groupNodes[2]] },
    { operation: "update", groupId: "contract-group", name: "契约研判组（更新）", note: "契约测试", groupType: "review" },
    { operation: "collapse", groupId: "contract-group", groupPosition: { x: 320, y: 160 } },
    { operation: "expand", groupId: "contract-group" },
    { operation: "remove_member", groupId: "contract-group", memberNodeId: groupNodes[2] },
    { operation: "ungroup", groupId: "contract-group" },
  ];
  for (const operation of operations) {
    [oldCurrent, newCurrent] = await Promise.all([
      post(oldBase, "/api/case-graph/relation/investigation-group", {
        caseId,
        graphId: oldGraph.graph_id,
        ...operation,
        options: { nodePositions: {} },
      }),
      post(newBase, "/api/case-graph/relation/investigation-group", {
        caseId,
        graphId: newGraph.graph_id,
        ...operation,
        options: { nodePositions: {} },
      }),
    ]);
    assertGraphStateEqual(newCurrent.graph, oldCurrent.graph, `研判组 ${operation.operation} 不一致`);
  }
}

const excludedNode = oldCurrent.graph.nodes.find(
  (node) => String(node.role || "") === "counterparty",
);
if (excludedNode) {
  [oldCurrent, newCurrent] = await Promise.all([
    post(oldBase, "/api/case-graph/relation/exclude-node", {
      caseId,
      graphId: oldGraph.graph_id,
      node: exclusionPayload(excludedNode),
      evidence: evidence("节点排除"),
    }),
    post(newBase, "/api/case-graph/relation/exclude-node", {
      caseId,
      graphId: newGraph.graph_id,
      node: exclusionPayload(excludedNode),
      evidence: evidence("节点排除"),
    }),
  ]);
  assertGraphStateEqual(newCurrent.graph, oldCurrent.graph, "节点排除不一致");
  [oldCurrent, newCurrent] = await Promise.all([
    post(oldBase, "/api/case-graph/relation/restore-node", {
      caseId,
      graphId: oldGraph.graph_id,
      nodeId: excludedNode.id,
    }),
    post(newBase, "/api/case-graph/relation/restore-node", {
      caseId,
      graphId: newGraph.graph_id,
      nodeId: excludedNode.id,
    }),
  ]);
  assertGraphStateEqual(newCurrent.graph, oldCurrent.graph, "节点恢复不一致");
}

const batchExcludedNodes = oldCurrent.graph.nodes
  .filter((node) => String(node.role || "") === "counterparty")
  .slice(0, 2);
if (batchExcludedNodes.length === 2) {
  for (const node of batchExcludedNodes) {
    [oldCurrent, newCurrent] = await Promise.all([
      post(oldBase, "/api/case-graph/relation/exclude-node", {
        caseId,
        graphId: oldGraph.graph_id,
        node: exclusionPayload(node),
        evidence: evidence("批量节点恢复前排除"),
      }),
      post(newBase, "/api/case-graph/relation/exclude-node", {
        caseId,
        graphId: newGraph.graph_id,
        node: exclusionPayload(node),
        evidence: evidence("批量节点恢复前排除"),
      }),
    ]);
  }
  [oldCurrent, newCurrent] = await Promise.all([
    post(oldBase, "/api/case-graph/relation/restore-nodes", {
      caseId,
      graphId: oldGraph.graph_id,
      nodeIds: batchExcludedNodes.map((node) => node.id),
      options: { nodePositions: {} },
    }),
    post(newBase, "/api/case-graph/relation/restore-nodes", {
      caseId,
      graphId: newGraph.graph_id,
      nodeIds: batchExcludedNodes.map((node) => node.id),
      options: { nodePositions: {} },
    }),
  ]);
  assertGraphStateEqual(newCurrent.graph, oldCurrent.graph, "批量节点恢复不一致");
}

const [oldCandidates, newCandidates] = await Promise.all([
  post(oldBase, "/api/case-graph/relation/summary-candidates", {
    caseId,
    graphId: oldGraph.graph_id,
    scope: "global",
  }),
  post(newBase, "/api/case-graph/relation/summary-candidates", {
    caseId,
    graphId: newGraph.graph_id,
    scope: "global",
  }),
]);
assert.deepStrictEqual(
  { ...newCandidates, graphId: "<graph>" },
  { ...oldCandidates, graphId: "<graph>" },
  "全局线索候选不一致",
);

const selectedCandidate = oldCandidates.items.find(
  (item) => item.status === "candidate" && !item.isOnGraph,
);
if (selectedCandidate) {
  [oldCurrent, newCurrent] = await Promise.all([
    post(oldBase, "/api/case-graph/relation/summary-selection", {
      caseId,
      graphId: oldGraph.graph_id,
      scope: "global",
      candidateNodeIds: [selectedCandidate.nodeId],
      selectedNodeIds: [selectedCandidate.nodeId],
      selectedCandidates: [selectedCandidate],
      evidence: evidence("全局线索选择"),
      options: { nodePositions: {} },
    }),
    post(newBase, "/api/case-graph/relation/summary-selection", {
      caseId,
      graphId: newGraph.graph_id,
      scope: "global",
      candidateNodeIds: [selectedCandidate.nodeId],
      selectedNodeIds: [selectedCandidate.nodeId],
      selectedCandidates: [selectedCandidate],
      evidence: evidence("全局线索选择"),
      options: { nodePositions: {} },
    }),
  ]);
  assertGraphStateEqual(newCurrent.graph, oldCurrent.graph, "全局线索选择不一致");
}

const manualLabel = "契约人工主体";
const [oldManual, newManual] = await Promise.all([
  post(oldBase, "/api/case-graph/relation/manual-node", {
    caseId,
    graphId: oldGraph.graph_id,
    label: manualLabel,
    tradeCard: "contract-manual-card",
    note: "契约测试",
    position: { x: 500, y: 400 },
  }),
  post(newBase, "/api/case-graph/relation/manual-node", {
    caseId,
    graphId: newGraph.graph_id,
    label: manualLabel,
    tradeCard: "contract-manual-card",
    note: "契约测试",
    position: { x: 500, y: 400 },
  }),
]);
const oldManualNode = oldManual.graph.nodes.find((node) => node.label === manualLabel);
const newManualNode = newManual.graph.nodes.find((node) => node.label === manualLabel);
assert.ok(oldManualNode && newManualNode, "人工主体未创建");
assertGraphStateEqual(
  canonicalizeGeneratedIds(newManual.graph, newManualNode.id),
  canonicalizeGeneratedIds(oldManual.graph, oldManualNode.id),
  "人工主体不一致",
);

const anchorNodeId = oldManual.graph.nodes.find((node) => node.id !== oldManualNode.id)?.id;
if (anchorNodeId) {
  const [oldTrade, newTrade] = await Promise.all([
    post(oldBase, "/api/case-graph/relation/manual-trade", {
      caseId,
      graphId: oldGraph.graph_id,
      payer: { nodeId: anchorNodeId },
      payee: { nodeId: oldManualNode.id },
      amount: 123.45,
      tradeTime: "2026-01-01 12:00:00",
      summary: "契约交易",
      sourceNote: "契约测试",
      evidence: evidence("人工交易"),
    }),
    post(newBase, "/api/case-graph/relation/manual-trade", {
      caseId,
      graphId: newGraph.graph_id,
      payer: { nodeId: anchorNodeId },
      payee: { nodeId: newManualNode.id },
      amount: 123.45,
      tradeTime: "2026-01-01 12:00:00",
      summary: "契约交易",
      sourceNote: "契约测试",
      evidence: evidence("人工交易"),
    }),
  ]);
  assertGraphStateEqual(
    canonicalizeGeneratedIds(newTrade.graph, newManualNode.id),
    canonicalizeGeneratedIds(oldTrade.graph, oldManualNode.id),
    "人工交易不一致",
  );
  const [oldReality, newReality] = await Promise.all([
    post(oldBase, "/api/case-graph/relation/reality-relation", {
      caseId,
      graphId: oldGraph.graph_id,
      sourceNodeId: anchorNodeId,
      targetNodeId: oldManualNode.id,
      relationType: "associate",
      label: "现实关联",
      note: "契约测试",
      evidence: evidence("现实关系"),
    }),
    post(newBase, "/api/case-graph/relation/reality-relation", {
      caseId,
      graphId: newGraph.graph_id,
      sourceNodeId: anchorNodeId,
      targetNodeId: newManualNode.id,
      relationType: "associate",
      label: "现实关联",
      note: "契约测试",
      evidence: evidence("现实关系"),
    }),
  ]);
  assertGraphStateEqual(
    canonicalizeGeneratedIds(newReality.graph, newManualNode.id),
    canonicalizeGeneratedIds(oldReality.graph, oldManualNode.id),
    "现实关系不一致",
  );
}

const edge = oldRelation.graph.edges[0];
const oldNodes = new Map(
  oldRelation.graph.nodes.map((node) => [node.id, node]),
);
const payerCards = oldNodes.get(edge.source)?.accounts || [];
const payeeCards = oldNodes.get(edge.target)?.accounts || [];
const [oldDetail, newDetail] = await Promise.all([
  post(oldBase, "/api/case-graph/target-detail", {
    caseId,
    graphId: oldGraph.graph_id,
    payerCards,
    payeeCards,
    limit: 1000,
  }),
  post(newBase, "/api/case-graph/target-detail", {
    caseId,
    graphId: newGraph.graph_id,
    payerCards,
    payeeCards,
    limit: 1000,
  }),
]);
assert.deepStrictEqual(newDetail, oldDetail, "交易明细不一致");
const auditInput = {
  caseId,
  victimCards: [account.tradeCard],
  victimNames: [],
  suspectCards: [],
  suspectNames: [],
  startTime: "",
  endTime: "",
  minAmount: "",
  maxAmount: "",
};
const [oldAudit, newAudit] = await Promise.all([
  post(oldBase, "/api/case-audit/run", auditInput),
  post(newBase, "/api/case-audit/run", auditInput),
]);
assert.deepStrictEqual(newAudit, oldAudit, "涉诈资金审计结果不一致");
console.log(
  JSON.stringify(
    {
      ok: true,
      caseId,
      cases: oldCases.items.length,
      accounts: oldAccounts.items.length,
      nodes: oldRelation.graph.nodes.length,
      edges: oldRelation.graph.edges.length,
      tradeFacts: Object.keys(oldRelation.graph.tradeFacts || {}).length,
      detailRows: oldDetail.length,
      auditTrades: oldAudit.trades.length,
      auditSteps: oldAudit.reasoningSteps.length,
    },
    null,
    2,
  ),
);
await Promise.all([
  del(oldBase, `/api/case-graph/graph/${oldGraph.graph_id}`),
  del(newBase, `/api/case-graph/graph/${newGraph.graph_id}`),
]);

async function request(base, path, options) {
  const response = await fetch(`${base}${path}`, options);
  const value = await response.json();
  if (!response.ok)
    throw new Error(
      `${base}${path}: ${response.status} ${JSON.stringify(value)}`,
    );
  return value;
}
function normalizeGraph(graph) {
  return {
    nodes: [...graph.nodes].sort(byId),
    edges: [...graph.edges].sort(byId),
    tradeFacts: graph.tradeFacts,
  };
}
function pickExistingCounterparty(graph, initialAccount) {
  const initialIds = new Set([String(initialAccount.accountId || "")]);
  return (
    graph.nodes.find(
      (node) =>
        String(node.label || "") === "冯燕青" &&
        accountIds(node).some((id) => !initialIds.has(id)),
    ) ||
    graph.nodes.find(
      (node) =>
        String(node.role || "") === "counterparty" &&
        accountIds(node).some((id) => !initialIds.has(id)),
    )
  );
}
function accountIds(node) {
  return [
    node.accountId,
    ...(Array.isArray(node.accountIds) ? node.accountIds : []),
    ...(Array.isArray(node.accounts)
      ? node.accounts.map((item) => item?.accountId)
      : []),
  ]
    .map(String)
    .filter(Boolean);
}
function counterpartyRelationInput(graphId, caseId, node) {
  const accounts = Array.isArray(node.accounts) && node.accounts.length
    ? node.accounts
    : [
        {
          accountId: node.accountId,
          tradeCard: node.tradeCard || node.payAccount,
          accountName: node.accountName || node.label,
        },
      ];
  return {
    caseId,
    graphId,
    seeds: [
      {
        suspectId: node.suspectId || "",
        suspectName: node.suspectName || node.label || "",
        accountIds: accountIds(node),
        excludedAccountIds: [],
        activeAccountIds: accountIds(node),
        accounts,
      },
    ],
    direction: "in",
    drillNums: 10,
    drillType: 1,
    filters: {},
    options: { nodePositions: {} },
  };
}
function byId(a, b) {
  return String(a.id).localeCompare(String(b.id));
}
function evidence(note) {
  return {
    level: "required",
    reasonCode: "acceptance_test",
    reasonLabel: "接口验收",
    note,
  };
}
function uniqueAccounts(nodes) {
  const items = new Map();
  for (const node of nodes || []) {
    const accounts = Array.isArray(node.accounts) && node.accounts.length
      ? node.accounts
      : [node];
    for (const account of accounts) {
      const accountId = String(account.accountId || "");
      const tradeCard = String(account.tradeCard || account.payAccount || "");
      const key = accountId || tradeCard;
      if (!key) continue;
      items.set(key, {
        accountId,
        tradeCard,
        accountName: String(account.accountName || account.name || node.label || ""),
        suspectId: String(account.suspectId || node.suspectId || ""),
        suspectName: String(account.suspectName || node.suspectName || ""),
      });
    }
  }
  return [...items.values()];
}
function exclusionPayload(node) {
  return {
    nodeId: node.id,
    label: node.label,
    accountIds: accountIds(node),
    tradeCards: (node.accounts || []).map((item) => item.tradeCard).filter(Boolean),
    node,
  };
}
function assertGraphStateEqual(actual, expected, message) {
  assert.deepStrictEqual(normalizeBusinessGraph(actual), normalizeBusinessGraph(expected), message);
}
function canonicalizeGeneratedIds(graph, manualNodeId) {
  let serialized = JSON.stringify(graph, (_key, value) => {
    if (typeof value !== "string") return value;
    if (value === manualNodeId) return "manual:node:generated";
    if (/^manual:trade:[0-9a-f-]+$/i.test(value)) return "manual:trade:generated";
    if (/^manual:edge:[0-9a-f-]+$/i.test(value)) return "manual:edge:generated";
    if (/^reality:[0-9a-f-]+$/i.test(value)) return "reality:generated";
    return value.replaceAll(manualNodeId, "manual:node:generated");
  });
  serialized = serialized
    .replaceAll(manualNodeId, "manual:node:generated")
    .replace(/manual:trade:[0-9a-f-]+/gi, "manual:trade:generated")
    .replace(/manual:edge:[0-9a-f-]+/gi, "manual:edge:generated")
    .replace(/reality:[0-9a-f-]+/gi, "reality:generated");
  return JSON.parse(serialized);
}
function normalizeBusinessGraph(graph) {
  const clean = JSON.parse(JSON.stringify(graph, (key, value) => {
    if (["createdAt", "updatedAt", "excludedAt"].includes(key)) return undefined;
    return value;
  }));
  if (Array.isArray(clean.nodes)) clean.nodes.sort(byId);
  if (Array.isArray(clean.edges)) clean.edges.sort(byId);
  if (Array.isArray(clean.investigationGroups)) clean.investigationGroups.sort(byId);
  if (Array.isArray(clean.excludedNodes))
    clean.excludedNodes.sort((a, b) => String(a.nodeId).localeCompare(String(b.nodeId)));
  if (Array.isArray(clean.realityRelations)) clean.realityRelations.sort(byId);
  return clean;
}
