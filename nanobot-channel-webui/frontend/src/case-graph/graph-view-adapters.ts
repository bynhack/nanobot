import type { CaseGraphData, CaseGraphGroupMap, CaseGraphNode, CaseGraphTradeCard } from './types';

const GROUP_NODE_PREFIX = 'group:';
const GROUP_EDGE_PREFIX = 'group-edge:';

export function buildMergedNetworkGraph(
  graphData: CaseGraphData | null,
  groupMap: CaseGraphGroupMap,
): CaseGraphData | null {
  return buildGroupedGraph(graphData, groupMap, { prefixGroupIds: false });
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
      existing.startDate = chooseEdgeBoundary(existing.startDate, edge.startDate, 'min');
      existing.endDate = chooseEdgeBoundary(existing.endDate, edge.endDate, 'max');
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
