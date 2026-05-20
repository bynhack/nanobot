import type {
  CaseGraphData,
  CaseGraphGroupMap,
  CaseGraphMoneyEdge,
  CaseGraphNode,
  CaseGraphOriginData,
  CaseGraphQueryResult,
  CaseGraphSnapshot,
  CaseGraphTradeCard,
} from './types';

export function normalizeCaseGraphOriginData(
  value: CaseGraphQueryResult | CaseGraphSnapshot['graphData'] | null | undefined,
): CaseGraphOriginData | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const nodes = Array.isArray((value as CaseGraphQueryResult).nodes)
    ? [...(value as CaseGraphQueryResult).nodes]
    : Array.isArray((value as { graph?: { nodes?: CaseGraphNode[] } }).graph?.nodes)
      ? [...((value as { graph?: { nodes?: CaseGraphNode[] } }).graph?.nodes ?? [])]
      : [];

  const money = Array.isArray((value as CaseGraphQueryResult).money)
    ? [...(value as CaseGraphQueryResult).money]
    : Array.isArray((value as { graph?: { edges?: CaseGraphMoneyEdge[] } }).graph?.edges)
      ? [...(((value as { graph?: { edges?: CaseGraphMoneyEdge[] } }).graph?.edges ?? []).map(legacyEdgeToMoney))]
      : [];

  const phone = Array.isArray((value as CaseGraphQueryResult).phone)
    ? [...(value as CaseGraphQueryResult).phone]
    : [];

  const groups = normalizeCaseGraphGroupMap(
    isPlainObject((value as CaseGraphQueryResult).groups)
      ? ((value as CaseGraphQueryResult).groups as CaseGraphGroupMap)
      : {},
  );

  return {
    graphId: isPlainObject(value) && 'graphId' in value ? String((value as { graphId?: string }).graphId || '') : '',
    nodes,
    money,
    phone,
    groups,
    excludedTrades: Array.isArray((value as CaseGraphQueryResult).excludedTrades)
      ? [...((value as CaseGraphQueryResult).excludedTrades ?? [])]
      : [],
    excludedAccountId:
      'excludedAccountId' in (value as object)
        ? ((value as CaseGraphQueryResult).excludedAccountId ?? null)
        : null,
    sourceSelectId: Array.isArray((value as CaseGraphQueryResult).sourceSelectId)
      ? [...((value as CaseGraphQueryResult).sourceSelectId ?? [])]
      : [],
  };
}

export function normalizeCaseGraphGroupMap(groupMap: CaseGraphGroupMap | null | undefined): CaseGraphGroupMap {
  if (!isPlainObject(groupMap)) {
    return {};
  }
  const normalized: CaseGraphGroupMap = {};
  for (const [rawKey, rawValue] of Object.entries(groupMap)) {
    if (!isPlainObject(rawValue)) {
      continue;
    }
    const groupId = String(rawValue.groupId || rawKey || '').trim();
    if (!groupId) {
      continue;
    }
    const normalizedGroupItem = {
      ...rawValue,
      groupId,
      groupName: String(rawValue.groupName || groupId || '').trim(),
      tradeCard: Array.isArray(rawValue.tradeCard) ? [...rawValue.tradeCard] : [],
    };
    const memberIds = normalizedGroupItem.tradeCard
      .map((card) => String(card.accountId || '').trim())
      .filter(Boolean);
    const normalizedKeys = memberIds.length
      ? memberIds
      : [String(rawKey || '').trim()].filter(Boolean);
    for (const key of normalizedKeys) {
      normalized[key] = normalizedGroupItem;
    }
  }
  return normalized;
}

export function originDataToCanvasData(originData: CaseGraphOriginData | null): CaseGraphData | null {
  if (!originData) {
    return null;
  }

  const validNodeIds = new Set(
    originData.nodes
      .map((node) => String(node.id || '').trim())
      .filter(Boolean),
  );

  return {
    nodes: originData.nodes.map((node) => ({
      ...node,
      name: node.name || node.label || node.accountName || node.tradeCard || node.id,
    })),
    edges: originData.money
      .filter((edge) => validNodeIds.has(String(edge.from || '').trim()) && validNodeIds.has(String(edge.to || '').trim()))
      .map((edge) => normalizeMoneyEdge(edge)),
  };
}

export function snapshotTradeCards(snapshot: Pick<CaseGraphSnapshot, 'tradeCards'>): CaseGraphTradeCard[] {
  return Array.isArray(snapshot.tradeCards) ? [...snapshot.tradeCards] : [];
}

export function mergeTradeCards(existing: CaseGraphTradeCard[], incoming: CaseGraphTradeCard[]): CaseGraphTradeCard[] {
  const seen = new Set<string>();
  const merged: CaseGraphTradeCard[] = [];
  for (const card of [...existing, ...incoming]) {
    const key = `${String(card.accountId || '').trim()}::${String(card.tradeCard || '').trim()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(card);
  }
  return merged;
}

function legacyEdgeToMoney(edge: CaseGraphMoneyEdge): CaseGraphMoneyEdge {
  return normalizeMoneyEdge({
    ...edge,
    from: edge.from || edge.source || '',
    to: edge.to || edge.target || '',
  });
}

function normalizeMoneyEdge(edge: CaseGraphMoneyEdge): CaseGraphMoneyEdge {
  const source = String(edge.source || edge.from || '').trim();
  const target = String(edge.target || edge.to || '').trim();
  return {
    ...edge,
    id: String(edge.id || `${source}->${target}`).trim(),
    from: edge.from || source,
    to: edge.to || target,
    source,
    target,
    tradeCount: Number(edge.tradeCount ?? edge.count ?? 0),
    tradeAmount: Number(edge.tradeAmount ?? edge.amount ?? 0),
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
