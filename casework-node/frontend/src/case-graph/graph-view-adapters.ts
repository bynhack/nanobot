import type { CaseGraphData, CaseGraphGroupMap, CaseGraphNode, CaseGraphTradeCard } from './types';

const GROUP_NODE_PREFIX = 'group:';
const GROUP_EDGE_PREFIX = 'group-edge:';

export function buildMergedNetworkGraph(
  graphData: CaseGraphData | null,
  groupMap: CaseGraphGroupMap,
): CaseGraphData | null {
  return buildGroupedGraph(graphData, groupMap, { prefixGroupIds: false });
}

export function buildFlowGraphProjection(
  graphData: CaseGraphData | null,
  groupMap: CaseGraphGroupMap,
): CaseGraphData | null {
  const groupedGraph = buildGroupedGraph(graphData, groupMap, { prefixGroupIds: false });
  if (!groupedGraph) {
    return null;
  }

  const reciprocalPairs = new Map<string, {
    first?: CaseGraphData['edges'][number];
    second?: CaseGraphData['edges'][number];
  }>();
  for (const edge of groupedGraph.edges) {
    const source = String(edge.source || edge.from || '').trim();
    const target = String(edge.target || edge.to || '').trim();
    if (!source || !target || source === target) {
      continue;
    }
    const key = source < target ? `${source}::${target}` : `${target}::${source}`;
    const pair = reciprocalPairs.get(key) ?? {};
    if (!pair.first) {
      pair.first = { ...edge, source, target, from: source, to: target };
    } else if (!pair.second) {
      pair.second = { ...edge, source, target, from: source, to: target };
    } else {
      pair.first = mergeSameDirectionEdges(pair.first, { ...edge, source, target, from: source, to: target });
    }
    reciprocalPairs.set(key, pair);
  }

  const flowEdges: CaseGraphData['edges'] = [];
  for (const pair of reciprocalPairs.values()) {
    if (pair.first && pair.second) {
      const netEdge = buildNetFlowEdge(pair.first, pair.second);
      if (netEdge) {
        flowEdges.push(netEdge);
      }
      continue;
    }
    if (pair.first) {
      flowEdges.push(normalizeFlowEdge(pair.first));
    }
  }

  return {
    nodes: groupedGraph.nodes.map((node) => ({ ...node })),
    edges: flowEdges,
    tradeFacts: { ...(groupedGraph.tradeFacts ?? {}) },
    investigationGroups: [...(groupedGraph.investigationGroups ?? [])],
    realityRelations: [...(groupedGraph.realityRelations ?? [])],
  };
}

function buildGroupedGraph(
  graphData: CaseGraphData | null,
  groupMap: CaseGraphGroupMap,
  options: { prefixGroupIds: boolean },
): CaseGraphData | null {
  if (!graphData) {
    return null;
  }

  const memberToGroup = new Map<string, { key: string; rawGroupId: string; label: string; members: CaseGraphTradeCard[] }>();
  for (const [memberId, groupItem] of Object.entries(groupMap)) {
    const groupId = String(groupItem?.groupId || '').trim();
    if (!groupId) {
      continue;
    }
    const key = options.prefixGroupIds ? `${GROUP_NODE_PREFIX}${groupId}` : groupId;
    memberToGroup.set(String(memberId).trim(), {
      key,
      rawGroupId: groupId,
      label: String(groupItem.groupName || groupId).trim() || groupId,
      members: Array.isArray(groupItem.tradeCard) ? groupItem.tradeCard : [],
    });
  }

  const nodesByKey = new Map<string, CaseGraphNode>();
  const memberNames = new Map<string, string[]>();
  for (const node of graphData.nodes) {
    const nodeKey = resolveGroupNodeKey(node, memberToGroup);
    const grouping = memberToGroup.get(String(node.id || '').trim()) ?? null;
    const label = grouping?.label || node.label || node.name || node.accountName || node.tradeCard || node.accountId || node.id;
    const existing = nodesByKey.get(nodeKey);
    const aliases = memberNames.get(nodeKey) ?? [];
    aliases.push(String(node.accountName || node.label || node.name || node.tradeCard || node.accountId || node.id));
    memberNames.set(nodeKey, aliases);
    if (existing) {
      continue;
    }
    nodesByKey.set(nodeKey, grouping
      ? {
          id: nodeKey,
          label,
          name: label,
          accountName: label,
          groupId: grouping.rawGroupId,
          groupName: label,
          isGroup: true,
        }
      : {
          ...node,
          id: nodeKey,
        });
  }

  const edgeMap = new Map<string, CaseGraphData['edges'][number]>();
  for (const edge of graphData.edges) {
    const sourceNode = graphData.nodes.find((node) => node.id === edge.source || node.id === edge.from);
    const targetNode = graphData.nodes.find((node) => node.id === edge.target || node.id === edge.to);
    const sourceKey = sourceNode ? resolveGroupNodeKey(sourceNode, memberToGroup) : String(edge.source || edge.from || '').trim();
    const targetKey = targetNode ? resolveGroupNodeKey(targetNode, memberToGroup) : String(edge.target || edge.to || '').trim();
    if (!sourceKey || !targetKey || sourceKey === targetKey) {
      continue;
    }
    const edgeId = `${GROUP_EDGE_PREFIX}${sourceKey}->${targetKey}`;
    const existing = edgeMap.get(edgeId);
    if (existing) {
      existing.tradeAmount += Number(edge.tradeAmount || 0);
      existing.tradeCount += Number(edge.tradeCount || 0);
      existing.amount = existing.tradeAmount;
      existing.count = existing.tradeCount;
      existing.tradeIds = [...new Set([...(existing.tradeIds ?? []), ...(edge.tradeIds ?? [])].map(String).filter(Boolean))];
      existing.startDate = chooseEdgeBoundary(existing.startDate, edge.startDate, 'min');
      existing.endDate = chooseEdgeBoundary(existing.endDate, edge.endDate, 'max');
      existing.startTime = chooseEdgeBoundary(existing.startTime, edge.startTime, 'min');
      existing.endTime = chooseEdgeBoundary(existing.endTime, edge.endTime, 'max');
      continue;
    }
    edgeMap.set(edgeId, {
      ...edge,
      id: edgeId,
      from: sourceKey,
      to: targetKey,
      source: sourceKey,
      target: targetKey,
      tradeAmount: Number(edge.tradeAmount || 0),
      tradeCount: Number(edge.tradeCount || 0),
      amount: Number(edge.tradeAmount || 0),
      count: Number(edge.tradeCount || 0),
    });
  }

  for (const [nodeKey, node] of nodesByKey) {
    const aliases = [...new Set((memberNames.get(nodeKey) ?? []).filter(Boolean))];
    if (aliases.length > 1 && node.isGroup) {
      node.tradeCard = aliases.slice(0, 2).join(' / ');
      node.name = `${node.label} (${aliases.length})`;
    }
  }

  return {
    nodes: [...nodesByKey.values()],
    edges: [...edgeMap.values()],
    tradeFacts: { ...(graphData.tradeFacts ?? {}) },
    investigationGroups: [...(graphData.investigationGroups ?? [])],
    realityRelations: (graphData.realityRelations ?? [])
      .map((relation) => {
        const sourceNode = graphData.nodes.find((node) => node.id === relation.source || node.id === relation.sourceNodeId);
        const targetNode = graphData.nodes.find((node) => node.id === relation.target || node.id === relation.targetNodeId);
        const source = sourceNode ? resolveGroupNodeKey(sourceNode, memberToGroup) : String(relation.source || relation.sourceNodeId || '').trim();
        const target = targetNode ? resolveGroupNodeKey(targetNode, memberToGroup) : String(relation.target || relation.targetNodeId || '').trim();
        return source && target && source !== target ? { ...relation, source, target, sourceNodeId: source, targetNodeId: target } : null;
      })
      .filter((relation): relation is NonNullable<CaseGraphData['realityRelations']>[number] => Boolean(relation)),
  };
}

function buildNetFlowEdge(
  first: CaseGraphData['edges'][number],
  second: CaseGraphData['edges'][number],
): CaseGraphData['edges'][number] | null {
  const firstAmount = Number(first.tradeAmount || first.amount || 0);
  const secondAmount = Number(second.tradeAmount || second.amount || 0);
  const netAmount = Math.abs(firstAmount - secondAmount);
  if (netAmount <= 0) {
    return null;
  }
  const dominant = firstAmount >= secondAmount ? first : second;
  const source = String(dominant.source || dominant.from || '').trim();
  const target = String(dominant.target || dominant.to || '').trim();
  if (!source || !target) {
    return null;
  }
  return {
    ...dominant,
    id: `${GROUP_EDGE_PREFIX}${source}->${target}`,
    from: source,
    to: target,
    source,
    target,
    tradeAmount: netAmount,
    amount: netAmount,
    tradeCount: Number(dominant.tradeCount || dominant.count || 0),
    count: Number(dominant.tradeCount || dominant.count || 0),
    tradeIds: [...(dominant.tradeIds ?? [])],
  };
}

function normalizeFlowEdge(edge: CaseGraphData['edges'][number]): CaseGraphData['edges'][number] {
  const source = String(edge.source || edge.from || '').trim();
  const target = String(edge.target || edge.to || '').trim();
  const amount = Number(edge.tradeAmount || edge.amount || 0);
  const count = Number(edge.tradeCount || edge.count || 0);
  return {
    ...edge,
    id: `${GROUP_EDGE_PREFIX}${source}->${target}`,
    from: source,
    to: target,
    source,
    target,
    tradeAmount: amount,
    amount,
    tradeCount: count,
    count,
  };
}

function mergeSameDirectionEdges(
  current: CaseGraphData['edges'][number],
  next: CaseGraphData['edges'][number],
): CaseGraphData['edges'][number] {
  const tradeAmount = Number(current.tradeAmount || 0) + Number(next.tradeAmount || 0);
  const tradeCount = Number(current.tradeCount || 0) + Number(next.tradeCount || 0);
  return {
    ...current,
    tradeAmount,
    amount: tradeAmount,
    tradeCount,
    count: tradeCount,
    tradeIds: [...new Set([...(current.tradeIds ?? []), ...(next.tradeIds ?? [])].map(String).filter(Boolean))],
    startDate: chooseEdgeBoundary(current.startDate, next.startDate, 'min'),
    endDate: chooseEdgeBoundary(current.endDate, next.endDate, 'max'),
    startTime: chooseEdgeBoundary(current.startTime, next.startTime, 'min'),
    endTime: chooseEdgeBoundary(current.endTime, next.endTime, 'max'),
  };
}

export function isGroupEdgeId(edgeId: string): boolean {
  return edgeId.startsWith(GROUP_EDGE_PREFIX);
}

export function parseGroupEdgeId(edgeId: string): { sourceId: string; targetId: string } | null {
  if (!isGroupEdgeId(edgeId)) {
    return null;
  }
  const raw = edgeId.slice(GROUP_EDGE_PREFIX.length);
  const [sourceId, targetId] = raw.split('->');
  if (!sourceId || !targetId) {
    return null;
  }
  return { sourceId, targetId };
}

export function isGroupNodeId(nodeId: string): boolean {
  return nodeId.startsWith(GROUP_NODE_PREFIX);
}

function resolveGroupNodeKey(
  node: CaseGraphNode,
  memberToGroup: Map<string, { key: string; label: string; members: CaseGraphTradeCard[] }>,
): string {
  const nodeId = String(node.id || '').trim();
  const accountId = String(node.accountId || '').trim();
  return memberToGroup.get(nodeId)?.key || memberToGroup.get(accountId)?.key || nodeId;
}

function chooseEdgeBoundary(
  currentValue: string | null | undefined,
  nextValue: string | null | undefined,
  mode: 'min' | 'max',
): string | null | undefined {
  if (!currentValue) return nextValue;
  if (!nextValue) return currentValue;
  return mode === 'min'
    ? (currentValue <= nextValue ? currentValue : nextValue)
    : (currentValue >= nextValue ? currentValue : nextValue);
}
