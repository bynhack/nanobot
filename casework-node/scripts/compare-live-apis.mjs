import assert from 'node:assert/strict';

const oldBase = process.env.OLD_BASE_URL || 'http://127.0.0.1:8082';
const newBase = process.env.NEW_BASE_URL || 'http://127.0.0.1:8081';
const get = (base, path) => request(base, path);
const post = (base, path, body) => request(base, path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const del = (base, path) => request(base, path, { method: 'DELETE' });

const [oldCases, newCases] = await Promise.all([get(oldBase, '/api/case-graph/cases'), get(newBase, '/api/case-graph/cases')]);
assert.deepStrictEqual(newCases, oldCases, '案件列表不一致');
const caseId = String(oldCases.items?.[0]?.id || '');
assert.ok(caseId, '没有可用于对照的案件');
const [oldAccounts, newAccounts, oldOverview, newOverview] = await Promise.all([
  get(oldBase, `/api/case-graph/cases/${caseId}/accounts`), get(newBase, `/api/case-graph/cases/${caseId}/accounts`),
  get(oldBase, `/api/case-audit/cases/${caseId}/overview`), get(newBase, `/api/case-audit/cases/${caseId}/overview`),
]);
assert.deepStrictEqual(newAccounts, oldAccounts, '案件账号列表不一致');
assert.deepStrictEqual(newOverview, oldOverview, '审计概览不一致');
const account = oldAccounts.items?.[0];
assert.ok(account, '没有可用于对照的案件账号');

const graphInput = { caseId, graphName: 'Node 接口对照', tradeCards: [account] };
const [oldGraph, newGraph] = await Promise.all([post(oldBase, '/api/case-graph/graphs', graphInput), post(newBase, '/api/case-graph/graphs', graphInput)]);
const relationInput = (graphId) => ({ caseId, graphId, seeds: [{ suspectId: account.suspectId, suspectName: account.suspectName, accountIds: [account.accountId], excludedAccountIds: [], accounts: [account] }], direction: 'both', drillNums: 10, drillType: 1, filters: {}, options: { nodePositions: {} } });
const [oldRelation, newRelation] = await Promise.all([post(oldBase, '/api/case-graph/relation/query', relationInput(oldGraph.graph_id)), post(newBase, '/api/case-graph/relation/query', relationInput(newGraph.graph_id))]);
assert.deepStrictEqual(normalizeGraph(newRelation.graph), normalizeGraph(oldRelation.graph), '首层关系图不一致');

const edge = oldRelation.graph.edges[0];
const oldNodes = new Map(oldRelation.graph.nodes.map((node) => [node.id, node]));
const payerCards = oldNodes.get(edge.source)?.accounts || [];
const payeeCards = oldNodes.get(edge.target)?.accounts || [];
const [oldDetail, newDetail] = await Promise.all([
  post(oldBase, '/api/case-graph/target-detail', { caseId, graphId: oldGraph.graph_id, payerCards, payeeCards, limit: 1000 }),
  post(newBase, '/api/case-graph/target-detail', { caseId, graphId: newGraph.graph_id, payerCards, payeeCards, limit: 1000 }),
]);
assert.deepStrictEqual(newDetail, oldDetail, '交易明细不一致');
const auditInput = { caseId, victimCards: [account.tradeCard], victimNames: [], suspectCards: [], suspectNames: [], startTime: '', endTime: '', minAmount: '', maxAmount: '' };
const [oldAudit, newAudit] = await Promise.all([post(oldBase, '/api/case-audit/run', auditInput), post(newBase, '/api/case-audit/run', auditInput)]);
assert.deepStrictEqual(newAudit, oldAudit, '涉诈资金审计结果不一致');
console.log(JSON.stringify({ ok: true, caseId, cases: oldCases.items.length, accounts: oldAccounts.items.length, nodes: oldRelation.graph.nodes.length, edges: oldRelation.graph.edges.length, tradeFacts: Object.keys(oldRelation.graph.tradeFacts || {}).length, detailRows: oldDetail.length, auditTrades: oldAudit.trades.length, auditSteps: oldAudit.reasoningSteps.length }, null, 2));
await Promise.all([del(oldBase, `/api/case-graph/graph/${oldGraph.graph_id}`), del(newBase, `/api/case-graph/graph/${newGraph.graph_id}`)]);

async function request(base, path, options) { const response = await fetch(`${base}${path}`, options); const value = await response.json(); if (!response.ok) throw new Error(`${base}${path}: ${response.status} ${JSON.stringify(value)}`); return value; }
function normalizeGraph(graph) { return { nodes: [...graph.nodes].sort(byId), edges: [...graph.edges].sort(byId), tradeFacts: graph.tradeFacts }; }
function byId(a, b) { return String(a.id).localeCompare(String(b.id)); }
