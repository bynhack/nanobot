import assert from "node:assert/strict";

const base = process.env.BASE_URL || "http://127.0.0.1:8081";
const get = (path) => request(path);
const post = (path, body) =>
  request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const del = (path) => request(path, { method: "DELETE" });
const evidence = {
  level: "required",
  reasonCode: "acceptance_test",
  reasonLabel: "接口验收",
  note: "自动化接口验收",
};

const cases = await get("/api/case-graph/cases");
const caseId = String(cases.items?.[0]?.id || "");
const accounts = await get(`/api/case-graph/cases/${caseId}/accounts`);
const account = accounts.items?.[0];
assert.ok(caseId && account);
const created = await post("/api/case-graph/graphs", {
  caseId,
  graphName: "Node 全接口验收",
  tradeCards: [account],
});
const graphId = created.graph_id;
try {
  const seed = {
    suspectId: account.suspectId,
    suspectName: account.suspectName,
    accountIds: [account.accountId],
    excludedAccountIds: [],
    accounts: [account],
  };
  let result = await post("/api/case-graph/relation/query", {
    caseId,
    graphId,
    seeds: [seed],
    direction: "both",
    drillNums: 10,
    drillType: 1,
    filters: {},
    options: { nodePositions: {} },
  });
  assert.ok(result.graph.nodes.length >= 2 && result.graph.edges.length >= 1);
  const originalNodeIds = result.graph.nodes.map((node) => node.id);
  const first = result.graph.nodes[0],
    second = result.graph.nodes[1],
    firstEdge = result.graph.edges[0];
  const nodePositions = Object.fromEntries(
    originalNodeIds.map((id, index) => [
      id,
      { x: 100 + index * 20, y: 200 + index * 10 },
    ]),
  );
  let state = await post(
    `/api/case-graph/relation/state/${caseId}/${graphId}/operations/layout`,
    {
      graphName: "Node 全接口验收",
      nodePositions,
      viewport: { x: 1, y: 2, zoom: 1.1 },
    },
  );
  assert.deepStrictEqual(
    state.graph.layout.nodePositions[first.id],
    nodePositions[first.id],
  );
  state = await post(
    `/api/case-graph/relation/state/${caseId}/${graphId}/operations/latest-step-layout`,
    { nodePositions, viewport: { x: 1, y: 2, zoom: 1.1 } },
  );
  assert.deepStrictEqual(
    state.graph.layout.nodePositions[first.id],
    nodePositions[first.id],
  );
  state = await post(
    `/api/case-graph/relation/state/${caseId}/${graphId}/operations/node-note`,
    {
      graphName: "Node 全接口验收",
      nodeId: first.id,
      note: "接口验收备注",
      sourceNote: "接口验收",
    },
  );
  assert.equal(
    state.graph.nodes.find((node) => node.id === first.id)?.note,
    "接口验收备注",
  );

  result = await post("/api/case-graph/relation/filter", {
    caseId,
    graphId,
    filters: {},
    options: { nodePositions },
  });
  assert.deepStrictEqual(
    result.graph.layout.nodePositions[first.id],
    nodePositions[first.id],
  );
  const factId = firstEdge.tradeIds?.[0];
  if (factId) {
    result = await post("/api/case-graph/relation/exclude-trades", {
      caseId,
      graphId,
      excludedTrades: [factId],
      tradeFacts: result.graph.tradeFacts,
      edgeTradeIds: Object.fromEntries(
        result.graph.edges.map((edge) => [edge.id, edge.tradeIds || []]),
      ),
      options: { nodePositions },
      evidence,
    });
    assert.ok(result.graph.excludedTrades.includes(String(factId)));
    result = await post("/api/case-graph/relation/exclude-trades", {
      caseId,
      graphId,
      excludedTrades: [],
      tradeFacts: result.graph.tradeFacts,
      edgeTradeIds: Object.fromEntries(
        result.graph.edges.map((edge) => [edge.id, edge.tradeIds || []]),
      ),
      options: { nodePositions },
    });
    assert.equal(result.graph.excludedTrades.length, 0);
  }

  result = await post("/api/case-graph/relation/exclude-node", {
    caseId,
    graphId,
    node: {
      nodeId: second.id,
      label: second.label,
      accountIds: second.accountIds || [],
      tradeCards: (second.accounts || [])
        .map((x) => x.tradeCard)
        .filter(Boolean),
      node: second,
    },
    evidence,
  });
  assert.ok(
    result.graph.excludedNodes.some((node) => node.nodeId === second.id),
  );
  result = await post("/api/case-graph/relation/restore-node", {
    caseId,
    graphId,
    nodeId: second.id,
    options: { nodePositions },
  });
  assert.ok(
    !result.graph.excludedNodes.some((node) => node.nodeId === second.id),
  );

  result = await post("/api/case-graph/relation/investigation-group", {
    caseId,
    graphId,
    operation: "create",
    groupId: "acceptance-group",
    nodeIds: [first.id, second.id],
    name: "接口验收研判组",
    groupType: "团伙成员",
    note: "验收",
    options: { nodePositions },
  });
  assert.ok(
    result.graph.investigationGroups.some(
      (group) => group.id === "acceptance-group",
    ),
  );
  result = await post("/api/case-graph/relation/investigation-group", {
    caseId,
    graphId,
    operation: "collapse",
    groupId: "acceptance-group",
    groupPosition: { x: 320, y: 240 },
    options: { nodePositions },
  });
  assert.equal(
    result.graph.investigationGroups.find(
      (group) => group.id === "acceptance-group",
    )?.collapsed,
    true,
  );
  result = await post("/api/case-graph/relation/investigation-group", {
    caseId,
    graphId,
    operation: "expand",
    groupId: "acceptance-group",
    options: { nodePositions },
  });
  assert.equal(
    result.graph.investigationGroups.find(
      (group) => group.id === "acceptance-group",
    )?.collapsed,
    false,
  );

  result = await post("/api/case-graph/relation/manual-node", {
    caseId,
    graphId,
    nodeId: "manual:acceptance",
    label: "人工验收主体",
    tradeCard: "acceptance-card",
    note: "验收",
    position: { x: 500, y: 400 },
    options: { nodePositions },
  });
  const manualNode = result.graph.nodes.find(
    (node) => node.label === "人工验收主体",
  );
  assert.ok(manualNode?.id);
  const edgesBeforeManualTrade = result.graph.edges.length;
  result = await post("/api/case-graph/relation/manual-trade", {
    caseId,
    graphId,
    tradeId: "manual-trade:acceptance",
    payer: { nodeId: first.id },
    payee: { nodeId: manualNode.id },
    amount: 123.45,
    tradeTime: "2026-01-01 12:00:00",
    summary: "验收交易",
    sourceNote: "验收",
    options: { nodePositions },
    evidence,
  });
  assert.equal(result.graph.edges.length, edgesBeforeManualTrade + 1);
  result = await post("/api/case-graph/relation/reality-relation", {
    caseId,
    graphId,
    relationId: "reality:acceptance",
    sourceNodeId: first.id,
    targetNodeId: manualNode.id,
    relationType: "同事",
    note: "验收",
    options: { nodePositions },
  });
  assert.ok(
    result.graph.realityRelations.some(
      (edge) =>
        edge.source === first.id &&
        edge.target === manualNode.id &&
        edge.relationType === "同事",
    ),
  );

  const candidates = await post("/api/case-graph/relation/summary-candidates", {
    caseId,
    graphId,
    scope: "global",
  });
  assert.ok(Array.isArray(candidates.items));
  if (candidates.items[0]) {
    const candidate =
      candidates.items.find((item) => item.status === "candidate") ||
      candidates.items[0];
    result = await post("/api/case-graph/relation/summary-selection", {
      caseId,
      graphId,
      scope: "global",
      candidateNodeIds: candidates.items.map((x) => x.nodeId),
      selectedNodeIds: [candidate.nodeId],
      selectedCandidates: [
        {
          nodeId: candidate.nodeId,
          label: candidate.label,
          accounts: candidate.accounts || [],
        },
      ],
      options: { nodePositions },
    });
    assert.ok(result.graph.nodes.some((node) => node.id === candidate.nodeId));
  }

  const context = await post("/api/case-graph/context", {
    caseId,
    graphId,
    graphName: "Node 全接口验收",
    chatId: "acceptance-chat",
    focus: { nodeId: first.id },
  });
  assert.equal(context.caseId, caseId);
  const loaded = await get(
    `/api/case-graph/relation/state/${caseId}/${graphId}`,
  );
  const steps = await get(
    `/api/case-graph/relation/state/${caseId}/${graphId}/steps`,
  );
  assert.ok(loaded.graph && steps.items.length >= 10);
  assert.deepStrictEqual(
    loaded.graph.layout.nodePositions[first.id],
    nodePositions[first.id],
  );

  const audit = await post("/api/case-audit/audits", {
    caseId,
    auditName: "Node 全接口验收审计",
    conditions: { victimCards: [account.tradeCard] },
    filters: {},
  });
  const updatedAudit = await post(`/api/case-audit/audits/${audit.auditId}`, {
    auditName: "Node 全接口验收审计（已更新）",
  });
  assert.equal(updatedAudit.auditName, "Node 全接口验收审计（已更新）");
  const auditList = await get(`/api/case-audit/cases/${caseId}/audits`);
  assert.ok(auditList.items.some((item) => item.auditId === audit.auditId));
  const auditRun = await post("/api/case-audit/run", {
    caseId,
    auditId: audit.auditId,
    victimCards: [account.tradeCard],
    victimNames: [],
    suspectCards: [],
    suspectNames: [],
    startTime: "",
    endTime: "",
    minAmount: "",
    maxAmount: "",
  });
  assert.ok(auditRun.trades.length > 0 && auditRun.reasoningSteps.length > 0);

  const graphList = await get(
    `/api/case-graph/graphs?caseId=${encodeURIComponent(caseId)}`,
  );
  assert.ok(graphList.items.some((item) => item.graphId === graphId));
  const graphRecord = await get(`/api/case-graph/graph/${graphId}`);
  assert.equal(graphRecord.graph_id, graphId);
  await post(`/api/case-graph/graph/${graphId}`, {
    graphName: "Node 全接口验收（已更新）",
    drillNums: 20,
    drillType: 2,
  });
  console.log(
    JSON.stringify(
      {
        ok: true,
        caseId,
        graphId,
        nodes: loaded.graph.nodes.length,
        edges: loaded.graph.edges.length,
        steps: steps.items.length,
        auditTrades: auditRun.trades.length,
        summaryCandidates: candidates.items.length,
      },
      null,
      2,
    ),
  );
} finally {
  await del(`/api/case-graph/graph/${graphId}`).catch(() => {});
}

async function request(path, options) {
  const response = await fetch(`${base}${path}`, options);
  const text = await response.text();
  const value = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(`${path}: ${response.status} ${text}`);
  return value;
}
