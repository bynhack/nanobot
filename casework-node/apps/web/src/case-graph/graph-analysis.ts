import type { CaseGraphData } from './types';

export type CaseGraphNodeRole =
  | 'core'
  | 'bridge'
  | 'upstream'
  | 'downstream'
  | 'transit'
  | 'peripheral';

export interface CaseGraphViewOptions {
  focusNodeIds?: string[];
  focusAccountIds?: string[];
  focusLabels?: string[];
}

export interface CaseGraphNodeMetrics {
  nodeId: string;
  displayName: string;
  identifier: string;
  role: CaseGraphNodeRole;
  roleLabel: string;
  rolePriority: number;
  isFocus: boolean;
  importanceScore: number;
  bridgeScore: number;
  totalAmount: number;
  totalCount: number;
  sentAmount: number;
  receivedAmount: number;
  sentCount: number;
  receivedCount: number;
  incomingNeighbors: string[];
  outgoingNeighbors: string[];
  neighborIds: string[];
  inDegree: number;
  outDegree: number;
  degree: number;
  connectedFocusCount: number;
}

export interface CaseGraphEdgeMetrics {
  edgeId: string;
  amount: number;
  count: number;
  isFocusEdge: boolean;
  strength: 'weak' | 'medium' | 'strong';
}

export interface CaseGraphSummaryCard {
  key: 'upstream' | 'downstream' | 'bridge' | 'edge';
  label: string;
  primary: string;
  secondary: string;
}

export interface CaseGraphViewModel {
  focusNodeIds: string[];
  nodeMetricsById: Map<string, CaseGraphNodeMetrics>;
  edgeMetricsById: Map<string, CaseGraphEdgeMetrics>;
  roleCounts: Record<CaseGraphNodeRole, number>;
  summaryCards: CaseGraphSummaryCard[];
}

interface MutableNodeStats {
  node: CaseGraphData['nodes'][number];
  displayName: string;
  identifier: string;
  sentAmount: number;
  receivedAmount: number;
  sentCount: number;
  receivedCount: number;
  incomingNeighbors: Set<string>;
  outgoingNeighbors: Set<string>;
}

const DEFAULT_NODE_ROLE: CaseGraphNodeRole = 'peripheral';
const DEFAULT_NODE_ROLE_LABEL = '主体';
const DEFAULT_NODE_ROLE_PRIORITY = 4;
const MAX_EXPLICIT_FOCUS_HINTS = 6;

export function buildCaseGraphViewModel(
  graphData: CaseGraphData | null,
  options: CaseGraphViewOptions = {},
): CaseGraphViewModel {
  const nodes = graphData?.nodes ?? [];
  const edges = graphData?.edges ?? [];

  const nodeStatsById = new Map<string, MutableNodeStats>();
  for (const node of nodes) {
    nodeStatsById.set(node.id, {
      node,
      displayName: resolveNodeDisplayName(node),
      identifier: resolveNodeIdentifier(node),
      sentAmount: 0,
      receivedAmount: 0,
      sentCount: 0,
      receivedCount: 0,
      incomingNeighbors: new Set<string>(),
      outgoingNeighbors: new Set<string>(),
    });
  }

  for (const edge of edges) {
    const sourceStats = nodeStatsById.get(edge.source);
    const targetStats = nodeStatsById.get(edge.target);
    if (!sourceStats || !targetStats) {
      continue;
    }
    const amount = Number(edge.tradeAmount || 0);
    const count = Number(edge.tradeCount || 0);
    sourceStats.sentAmount += amount;
    sourceStats.sentCount += count;
    sourceStats.outgoingNeighbors.add(edge.target);
    targetStats.receivedAmount += amount;
    targetStats.receivedCount += count;
    targetStats.incomingNeighbors.add(edge.source);
  }

  const focusIds = (options.focusNodeIds ?? []).map((item) => String(item || '').trim()).filter(Boolean);
  const focusAccounts = (options.focusAccountIds ?? []).map((item) => String(item || '').trim()).filter(Boolean);
  const focusLabels = (options.focusLabels ?? []).map((item) => String(item || '').trim()).filter(Boolean);
  const matchedFocusNodeIds = resolveFocusNodeIds(nodeStatsById, {
    focusIds,
    focusAccounts,
    focusLabels,
  });
  const orderedFocusNodeIds = matchedFocusNodeIds.length
    ? matchedFocusNodeIds
    : inferFallbackFocusNodeIds(nodeStatsById);
  const explicitFocusNodeIds = new Set<string>(orderedFocusNodeIds);

  const draftMetrics = new Map<
    string,
    Omit<CaseGraphNodeMetrics, 'role' | 'roleLabel' | 'rolePriority'> & { role?: CaseGraphNodeRole }
  >();

  for (const stats of nodeStatsById.values()) {
    const incomingNeighbors = [...stats.incomingNeighbors];
    const outgoingNeighbors = [...stats.outgoingNeighbors];
    const neighborIds = [...new Set([...incomingNeighbors, ...outgoingNeighbors])];
    const connectedFocusCount = neighborIds.filter((nodeId) => explicitFocusNodeIds.has(nodeId)).length;
    const totalAmount = stats.sentAmount + stats.receivedAmount;
    const totalCount = stats.sentCount + stats.receivedCount;
    const hasBidirectionalFlow = stats.sentAmount > 0 && stats.receivedAmount > 0;
    const importanceScore =
      Math.log10(totalAmount + 1) * 4.2 +
      Math.log10(totalCount + 1) * 1.9 +
      neighborIds.length * 1.6 +
      (hasBidirectionalFlow ? 2.4 : 0) +
      Math.min(connectedFocusCount, 2) * 1.8 +
      (explicitFocusNodeIds.has(stats.node.id) ? 8 : 0);
    const bridgeScore = hasBidirectionalFlow
      ? Math.log10(Math.min(stats.sentAmount, stats.receivedAmount) + 1) * 4.4 +
        neighborIds.length * 1.7 +
        connectedFocusCount * 2.2
      : 0;

    draftMetrics.set(stats.node.id, {
      nodeId: stats.node.id,
      displayName: stats.displayName,
      identifier: stats.identifier,
      isFocus: explicitFocusNodeIds.has(stats.node.id),
      importanceScore,
      bridgeScore,
      totalAmount,
      totalCount,
      sentAmount: stats.sentAmount,
      receivedAmount: stats.receivedAmount,
      sentCount: stats.sentCount,
      receivedCount: stats.receivedCount,
      incomingNeighbors,
      outgoingNeighbors,
      neighborIds,
      inDegree: incomingNeighbors.length,
      outDegree: outgoingNeighbors.length,
      degree: neighborIds.length,
      connectedFocusCount,
    });
  }

  const nodeMetricsById = new Map<string, CaseGraphNodeMetrics>();
  const roleCounts: Record<CaseGraphNodeRole, number> = {
    core: 0,
    bridge: 0,
    upstream: 0,
    downstream: 0,
    transit: 0,
    peripheral: 0,
  };

  for (const draft of draftMetrics.values()) {
    const metrics: CaseGraphNodeMetrics = {
      ...draft,
      role: DEFAULT_NODE_ROLE,
      roleLabel: DEFAULT_NODE_ROLE_LABEL,
      rolePriority: DEFAULT_NODE_ROLE_PRIORITY,
    };
    nodeMetricsById.set(metrics.nodeId, metrics);
    roleCounts[DEFAULT_NODE_ROLE] += 1;
  }

  const amounts = edges.map((edge) => Number(edge.tradeAmount || 0));
  const counts = edges.map((edge) => Number(edge.tradeCount || 0));
  const weakAmountThreshold = percentile(amounts, 0.35);
  const strongAmountThreshold = percentile(amounts, 0.74);
  const weakCountThreshold = percentile(counts, 0.35);
  const strongCountThreshold = percentile(counts, 0.72);

  const edgeMetricsById = new Map<string, CaseGraphEdgeMetrics>();
  for (const edge of edges) {
    const amount = Number(edge.tradeAmount || 0);
    const count = Number(edge.tradeCount || 0);
    const isFocusEdge = explicitFocusNodeIds.has(edge.source) || explicitFocusNodeIds.has(edge.target);
    let strength: CaseGraphEdgeMetrics['strength'] = 'medium';
    if (
      amount >= strongAmountThreshold ||
      count >= strongCountThreshold ||
      (isFocusEdge && amount >= weakAmountThreshold)
    ) {
      strength = 'strong';
    } else if (
      amount <= weakAmountThreshold &&
      count <= weakCountThreshold &&
      !isFocusEdge
    ) {
      strength = 'weak';
    }
    edgeMetricsById.set(edge.id, {
      edgeId: edge.id,
      amount,
      count,
      isFocusEdge,
      strength,
    });
  }

  return {
    focusNodeIds: orderedFocusNodeIds,
    nodeMetricsById,
    edgeMetricsById,
    roleCounts,
    summaryCards: buildSummaryCards(graphData, nodeMetricsById),
  };
}

export function formatCompactAmount(value: number): string {
  const amount = Number(value || 0);
  if (Math.abs(amount) >= 100_000_000) {
    return `${trimTrailingZero((amount / 100_000_000).toFixed(2))}亿`;
  }
  if (Math.abs(amount) >= 10_000) {
    return `${trimTrailingZero((amount / 10_000).toFixed(2))}万`;
  }
  if (Number.isInteger(amount)) {
    return String(amount);
  }
  return trimTrailingZero(amount.toFixed(2));
}

function buildSummaryCards(
  graphData: CaseGraphData | null,
  nodeMetricsById: Map<string, CaseGraphNodeMetrics>,
): CaseGraphSummaryCard[] {
  const nodes = [...nodeMetricsById.values()];
  const topPayer = [...nodes]
    .filter((item) => item.sentAmount > 0)
    .sort((left, right) => right.sentAmount - left.sentAmount || right.sentCount - left.sentCount)[0];
  const topReceiver = [...nodes]
    .filter((item) => item.receivedAmount > 0)
    .sort((left, right) => right.receivedAmount - left.receivedAmount || right.receivedCount - left.receivedCount)[0];
  const topConnected = [...nodes]
    .filter((item) => item.degree > 0)
    .sort((left, right) => right.degree - left.degree || right.totalAmount - left.totalAmount)[0];
  const strongestEdge = [...(graphData?.edges ?? [])]
    .sort((left, right) => Number(right.tradeAmount || 0) - Number(left.tradeAmount || 0))[0];

  return [
    {
      key: 'upstream',
      label: '转出最多主体',
      primary: topPayer?.displayName || '-',
      secondary: topPayer ? `转出 ${formatCompactAmount(topPayer.sentAmount)} 元` : '暂无数据',
    },
    {
      key: 'downstream',
      label: '收款最多主体',
      primary: topReceiver?.displayName || '-',
      secondary: topReceiver ? `收款 ${formatCompactAmount(topReceiver.receivedAmount)} 元` : '暂无数据',
    },
    {
      key: 'bridge',
      label: '关联最多主体',
      primary: topConnected?.displayName || '-',
      secondary: topConnected ? `${topConnected.degree} 个关联对象` : '暂无数据',
    },
    {
      key: 'edge',
      label: '最大单线',
      primary: strongestEdge
        ? `${nodeMetricsById.get(strongestEdge.source)?.displayName || strongestEdge.source} -> ${nodeMetricsById.get(strongestEdge.target)?.displayName || strongestEdge.target}`
        : '-',
      secondary: strongestEdge ? `${formatCompactAmount(Number(strongestEdge.tradeAmount || 0))} 元` : '暂无数据',
    },
  ];
}

function resolveNodeDisplayName(node: CaseGraphData['nodes'][number]): string {
  return String(node.name || node.label || node.accountName || node.tradeCard || node.accountId || node.id);
}

function resolveNodeIdentifier(node: CaseGraphData['nodes'][number]): string {
  return String(node.tradeCard || node.accountId || node.id);
}

function collectNodeAliases(node: CaseGraphData['nodes'][number]): string[] {
  return [
    String(node.id || '').trim(),
    String(node.accountId || '').trim(),
    String(node.tradeCard || '').trim(),
    String(node.name || '').trim(),
    String(node.label || '').trim(),
    String(node.accountName || '').trim(),
  ].filter(Boolean);
}

function resolveFocusNodeIds(
  nodeStatsById: Map<string, MutableNodeStats>,
  options: {
    focusIds: string[];
    focusAccounts: string[];
    focusLabels: string[];
  },
): string[] {
  const aliasToNodeIds = new Map<string, string[]>();
  for (const stats of nodeStatsById.values()) {
    for (const alias of collectNodeAliases(stats.node)) {
      const existing = aliasToNodeIds.get(alias);
      if (existing) {
        existing.push(stats.node.id);
      } else {
        aliasToNodeIds.set(alias, [stats.node.id]);
      }
    }
  }

  const orderedNodeIds: string[] = [];
  const seen = new Set<string>();

  const appendMatches = (values: string[]) => {
    for (const value of values) {
      const matchedNodeIds = aliasToNodeIds.get(value) ?? [];
      for (const nodeId of matchedNodeIds) {
        if (seen.has(nodeId)) {
          continue;
        }
        seen.add(nodeId);
        orderedNodeIds.push(nodeId);
      }
    }
  };

  if (options.focusIds.length <= MAX_EXPLICIT_FOCUS_HINTS) {
    appendMatches(options.focusIds);
  }
  if (options.focusAccounts.length <= MAX_EXPLICIT_FOCUS_HINTS) {
    appendMatches(options.focusAccounts);
  }
  if (orderedNodeIds.length) {
    return orderedNodeIds;
  }

  if (options.focusLabels.length && options.focusLabels.length <= MAX_EXPLICIT_FOCUS_HINTS) {
    appendMatches(options.focusLabels);
  }
  return orderedNodeIds;
}

function inferFallbackFocusNodeIds(nodeStatsById: Map<string, MutableNodeStats>): string[] {
  const ranked = [...nodeStatsById.values()]
    .map((stats) => ({
      nodeId: stats.node.id,
      score:
        Math.log10(stats.sentAmount + stats.receivedAmount + 1) * 4 +
        Math.log10(stats.sentCount + stats.receivedCount + 1) * 2 +
        new Set([...stats.incomingNeighbors, ...stats.outgoingNeighbors]).size * 1.5 +
        (stats.sentAmount > 0 && stats.receivedAmount > 0 ? 2 : 0),
    }))
    .sort((left, right) => right.score - left.score);
  const top = ranked[0];
  return top && top.score > 0 ? [top.nodeId] : [];
}

function percentile(values: number[], ratio: number): number {
  if (!values.length) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const index = (sorted.length - 1) * ratio;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) {
    return sorted[lower] ?? 0;
  }
  const lowerValue = sorted[lower] ?? 0;
  const upperValue = sorted[upper] ?? lowerValue;
  return lowerValue + (upperValue - lowerValue) * (index - lower);
}

function trimTrailingZero(value: string): string {
  return value.replace(/\.0+$|(\.\d*?)0+$/u, '$1');
}
