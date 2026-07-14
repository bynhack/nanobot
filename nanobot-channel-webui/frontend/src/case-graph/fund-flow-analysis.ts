import type { CaseGraphData, CaseGraphNode, CaseGraphTradeFact } from './types';

export interface FundFlowThresholds {
  minNetAmount: number;
  minDirectionStrength: number;
}

export interface FundFlowNode {
  id: string;
  label: string;
  identifier: string;
  totalIn: number;
  totalOut: number;
  netAmount: number;
  tradeCount: number;
}

export interface FundFlowEdge {
  id: string;
  source: string;
  target: string;
  sourceToTargetAmount: number;
  targetToSourceAmount: number;
  sourceToTargetCount: number;
  targetToSourceCount: number;
  netAmount: number;
  grossAmount: number;
  directionStrength: number;
  direction: 'clear' | 'neutral';
  tradeFacts: CaseGraphTradeFact[];
}

export interface FundFlowView {
  nodes: FundFlowNode[];
  edges: FundFlowEdge[];
  referencedTradeCount: number;
}

interface PairAccumulator {
  leftId: string;
  rightId: string;
  leftToRightAmount: number;
  rightToLeftAmount: number;
  leftToRightCount: number;
  rightToLeftCount: number;
  tradeFacts: CaseGraphTradeFact[];
}

interface MutableNodeTotals {
  totalIn: number;
  totalOut: number;
  tradeCount: number;
}

export function buildFundFlowView(graphData: CaseGraphData | null, thresholds: FundFlowThresholds): FundFlowView {
  if (!graphData) {
    return { nodes: [], edges: [], referencedTradeCount: 0 };
  }

  const excludedNodeIds = new Set((graphData.excludedNodes ?? []).map((item) => item.nodeId));
  const activeNodes = graphData.nodes.filter((node) => !excludedNodeIds.has(node.id));
  const activeNodeIds = new Set(activeNodes.map((node) => node.id));
  const nodeIdByAlias = buildNodeAliasIndex(activeNodes);
  const facts = graphData.tradeFacts ?? {};
  const pairs = new Map<string, PairAccumulator>();
  const nodeTotals = new Map<string, MutableNodeTotals>();
  const processedTradeIds = new Set<string>();

  for (const node of activeNodes) {
    nodeTotals.set(node.id, { totalIn: 0, totalOut: 0, tradeCount: 0 });
  }

  for (const edge of graphData.edges) {
    const edgeSource = String(edge.source || edge.from || '').trim();
    const edgeTarget = String(edge.target || edge.to || '').trim();
    if (edge.isExcluded || !activeNodeIds.has(edgeSource) || !activeNodeIds.has(edgeTarget) || edgeSource === edgeTarget) {
      continue;
    }

    for (const rawTradeId of edge.tradeIds ?? []) {
      const tradeId = String(rawTradeId || '').trim();
      const fact = facts[tradeId];
      if (!tradeId || !fact || processedTradeIds.has(tradeId)) {
        continue;
      }

      const resolvedPayer = resolveFactNodeId(fact, 'payer', nodeIdByAlias);
      const resolvedPayee = resolveFactNodeId(fact, 'payee', nodeIdByAlias);
      const payerId = resolvedPayer && resolvedPayee ? resolvedPayer : edgeSource;
      const payeeId = resolvedPayer && resolvedPayee ? resolvedPayee : edgeTarget;
      if (!activeNodeIds.has(payerId) || !activeNodeIds.has(payeeId) || payerId === payeeId) {
        continue;
      }

      const amount = Math.max(0, Number(fact.tradeAmount || 0));
      if (!Number.isFinite(amount)) {
        continue;
      }

      processedTradeIds.add(tradeId);
      addFactToPair(pairs, payerId, payeeId, amount, fact);
      const payerTotals = nodeTotals.get(payerId);
      const payeeTotals = nodeTotals.get(payeeId);
      if (payerTotals) {
        payerTotals.totalOut += amount;
        payerTotals.tradeCount += 1;
      }
      if (payeeTotals) {
        payeeTotals.totalIn += amount;
        payeeTotals.tradeCount += 1;
      }
    }
  }

  const edges = [...pairs.values()]
    .map((pair) => finalizePair(pair, thresholds))
    .sort((left, right) => right.netAmount - left.netAmount || right.grossAmount - left.grossAmount || left.id.localeCompare(right.id));
  const connectedNodeIds = new Set(edges.flatMap((edge) => [edge.source, edge.target]));
  const nodes = activeNodes
    .filter((node) => connectedNodeIds.has(node.id))
    .map((node) => toFundFlowNode(node, nodeTotals.get(node.id)))
    .sort((left, right) => (right.totalIn + right.totalOut) - (left.totalIn + left.totalOut) || left.label.localeCompare(right.label, 'zh-CN'));

  return { nodes, edges, referencedTradeCount: processedTradeIds.size };
}

function buildNodeAliasIndex(nodes: CaseGraphNode[]): Map<string, string> {
  const result = new Map<string, string>();
  for (const node of nodes) {
    const aliases = [node.id, node.accountId, node.tradeCard];
    for (const account of node.accounts ?? []) {
      aliases.push(account.accountId, account.tradeCard);
    }
    for (const value of aliases) {
      const alias = normalizeAlias(value);
      if (alias && !result.has(alias)) {
        result.set(alias, node.id);
      }
    }
  }
  return result;
}

function resolveFactNodeId(
  fact: CaseGraphTradeFact,
  side: 'payer' | 'payee',
  nodeIdByAlias: Map<string, string>,
): string | null {
  const aliases = side === 'payer'
    ? [fact.payerAccountId, fact.payerTradeCard]
    : [fact.payeeAccountId, fact.payeeTradeCard];
  for (const value of aliases) {
    const nodeId = nodeIdByAlias.get(normalizeAlias(value));
    if (nodeId) return nodeId;
  }
  return null;
}

function addFactToPair(
  pairs: Map<string, PairAccumulator>,
  payerId: string,
  payeeId: string,
  amount: number,
  fact: CaseGraphTradeFact,
): void {
  const [leftId, rightId] = payerId.localeCompare(payeeId) <= 0 ? [payerId, payeeId] : [payeeId, payerId];
  const key = `${leftId}\u0000${rightId}`;
  const pair = pairs.get(key) ?? {
    leftId,
    rightId,
    leftToRightAmount: 0,
    rightToLeftAmount: 0,
    leftToRightCount: 0,
    rightToLeftCount: 0,
    tradeFacts: [],
  };
  if (payerId === leftId) {
    pair.leftToRightAmount += amount;
    pair.leftToRightCount += 1;
  } else {
    pair.rightToLeftAmount += amount;
    pair.rightToLeftCount += 1;
  }
  pair.tradeFacts.push(fact);
  pairs.set(key, pair);
}

function finalizePair(pair: PairAccumulator, thresholds: FundFlowThresholds): FundFlowEdge {
  const signedNet = pair.leftToRightAmount - pair.rightToLeftAmount;
  const grossAmount = pair.leftToRightAmount + pair.rightToLeftAmount;
  const netAmount = Math.abs(signedNet);
  const directionStrength = grossAmount > 0 ? netAmount / grossAmount : 0;
  const isClear = netAmount >= Math.max(0, thresholds.minNetAmount)
    && directionStrength >= clamp(thresholds.minDirectionStrength, 0, 1)
    && netAmount > 0;
  const reverse = signedNet < 0;
  const source = reverse ? pair.rightId : pair.leftId;
  const target = reverse ? pair.leftId : pair.rightId;

  return {
    id: `fund-flow:${pair.leftId}:${pair.rightId}`,
    source,
    target,
    sourceToTargetAmount: reverse ? pair.rightToLeftAmount : pair.leftToRightAmount,
    targetToSourceAmount: reverse ? pair.leftToRightAmount : pair.rightToLeftAmount,
    sourceToTargetCount: reverse ? pair.rightToLeftCount : pair.leftToRightCount,
    targetToSourceCount: reverse ? pair.leftToRightCount : pair.rightToLeftCount,
    netAmount,
    grossAmount,
    directionStrength,
    direction: isClear ? 'clear' : 'neutral',
    tradeFacts: [...pair.tradeFacts].sort(compareTradeFacts),
  };
}

function toFundFlowNode(node: CaseGraphNode, totals?: MutableNodeTotals): FundFlowNode {
  const totalIn = totals?.totalIn ?? 0;
  const totalOut = totals?.totalOut ?? 0;
  return {
    id: node.id,
    label: node.label || node.name || node.accountName || node.tradeCard || node.id,
    identifier: node.tradeCard || String(node.accountId || ''),
    totalIn,
    totalOut,
    netAmount: totalIn - totalOut,
    tradeCount: totals?.tradeCount ?? 0,
  };
}

function compareTradeFacts(left: CaseGraphTradeFact, right: CaseGraphTradeFact): number {
  const leftTime = Date.parse(String(left.tradeTime || ''));
  const rightTime = Date.parse(String(right.tradeTime || ''));
  if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
    return rightTime - leftTime;
  }
  return Number(right.tradeAmount || 0) - Number(left.tradeAmount || 0);
}

function normalizeAlias(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

function clamp(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.min(maximum, Math.max(minimum, value));
}
