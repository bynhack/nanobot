import {
  buildCaseGraphViewModel,
  type CaseGraphNodeMetrics,
  type CaseGraphViewModel,
} from './graph-analysis';
import type { CaseGraphData } from './types';

export interface GraphPoint {
  x: number;
  y: number;
}

interface LayoutOptions {
  graphContent?: string | null;
  graphWidth: number;
  graphHeight: number;
  nodeWidth: number;
  nodeHeight: number;
  columnGap: number;
  rowGap: number;
  focusNodeIds?: string[];
  focusAccountIds?: string[];
  focusLabels?: string[];
  preferPersistedPositions?: boolean;
  viewModel?: CaseGraphViewModel | null;
}

interface EdgeStats {
  sources: Set<string>;
  targets: Set<string>;
  totalDegree: number;
}

interface AnchorRelation {
  incomingAmount: number;
  outgoingAmount: number;
}

interface StructuredLayoutInput {
  nodes: CaseGraphData['nodes'];
  edges: CaseGraphData['edges'];
  options: LayoutOptions;
  viewModel: CaseGraphViewModel;
}

export function computeCaseGraphLayout(
  graphData: CaseGraphData | null,
  options: LayoutOptions,
): Map<string, GraphPoint> {
  const nodes = graphData?.nodes ?? [];
  const edges = graphData?.edges ?? [];
  if (!nodes.length) {
    return new Map();
  }

  const viewModel =
    options.viewModel ??
    buildCaseGraphViewModel(graphData, {
      focusNodeIds: options.focusNodeIds,
      focusAccountIds: options.focusAccountIds,
      focusLabels: options.focusLabels,
    });

  if (options.preferPersistedPositions !== false) {
    const persistedPositions = resolvePersistedPositions(nodes, options);
    if (persistedPositions.size === nodes.length) {
      return persistedPositions;
    }
    if (persistedPositions.size >= minimumPersistedCoverage(nodes.length)) {
      return fitPositionsToCanvas(persistedPositions, options);
    }
  }

  return buildStructuredLayout({ nodes, edges, options, viewModel });
}

export function extractGraphContentNodePositions(
  graphContent: string | null | undefined,
  nodeWidth: number,
  nodeHeight: number,
): Map<string, GraphPoint> {
  const text = String(graphContent || '').trim();
  if (!text) {
    return new Map();
  }
  try {
    const payload = JSON.parse(text) as { cells?: unknown[] };
    if (!Array.isArray(payload.cells)) {
      return new Map();
    }
    const positions = new Map<string, GraphPoint>();
    for (const rawCell of payload.cells) {
      if (!rawCell || typeof rawCell !== 'object') {
        continue;
      }
      const cell = rawCell as Record<string, unknown>;
      if (cell.source || cell.target) {
        continue;
      }
      const cellData =
        cell.data && typeof cell.data === 'object'
          ? (cell.data as Record<string, unknown>)
          : null;
      const nodeId = String(
        cellData?.id ??
        cellData?.nodeId ??
        cell.accountId ??
        cell.id ??
        '',
      ).trim();
      if (!nodeId) {
        continue;
      }

      const x = coerceNumber(
        (cell.position as { x?: unknown } | undefined)?.x ??
        cell.x,
      );
      const y = coerceNumber(
        (cell.position as { y?: unknown } | undefined)?.y ??
        cell.y,
      );
      if (x == null || y == null) {
        continue;
      }

      const width =
        coerceNumber(
          (cell.size as { width?: unknown } | undefined)?.width ??
          cell.width,
        ) ?? nodeWidth;
      const height =
        coerceNumber(
          (cell.size as { height?: unknown } | undefined)?.height ??
          cell.height,
        ) ?? nodeHeight;

      positions.set(nodeId, {
        x: x + width / 2,
        y: y + height / 2,
      });
    }
    return positions;
  } catch {
    return new Map();
  }
}

function resolvePersistedPositions(
  nodes: CaseGraphData['nodes'],
  options: LayoutOptions,
): Map<string, GraphPoint> {
  const directNodePositions = new Map<string, GraphPoint>();
  for (const node of nodes) {
    const x = coerceNumber(node.x);
    const y = coerceNumber(node.y);
    if (x == null || y == null) {
      continue;
    }
    directNodePositions.set(node.id, { x, y });
  }
  if (directNodePositions.size >= minimumPersistedCoverage(nodes.length)) {
    return directNodePositions;
  }

  const graphContentPositions = extractGraphContentNodePositions(
    options.graphContent,
    options.nodeWidth,
    options.nodeHeight,
  );
  if (!graphContentPositions.size) {
    return new Map();
  }

  const filtered = new Map<string, GraphPoint>();
  for (const node of nodes) {
    const point = graphContentPositions.get(node.id);
    if (point) {
      filtered.set(node.id, point);
    }
  }
  return filtered;
}

function minimumPersistedCoverage(nodeCount: number): number {
  return Math.max(3, Math.ceil(nodeCount * 0.6));
}

function fitPositionsToCanvas(
  positions: Map<string, GraphPoint>,
  options: LayoutOptions,
): Map<string, GraphPoint> {
  const points = [...positions.values()];
  if (!points.length) {
    return new Map();
  }

  let minX = points[0]!.x;
  let maxX = points[0]!.x;
  let minY = points[0]!.y;
  let maxY = points[0]!.y;

  for (const point of points) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }

  const contentWidth = Math.max(maxX - minX, options.nodeWidth);
  const contentHeight = Math.max(maxY - minY, options.nodeHeight);
  const availableWidth = Math.max(options.graphWidth - options.nodeWidth - 48, options.nodeWidth);
  const availableHeight = Math.max(options.graphHeight - options.nodeHeight - 48, options.nodeHeight);
  const scale = Math.min(availableWidth / contentWidth, availableHeight / contentHeight, 1);
  const scaledWidth = contentWidth * scale;
  const scaledHeight = contentHeight * scale;
  const offsetX = Math.max(24, (options.graphWidth - scaledWidth) / 2);
  const offsetY = Math.max(24, (options.graphHeight - scaledHeight) / 2);

  const fitted = new Map<string, GraphPoint>();
  for (const [nodeId, point] of positions) {
    fitted.set(nodeId, {
      x: offsetX + (point.x - minX) * scale,
      y: offsetY + (point.y - minY) * scale,
    });
  }
  return fitted;
}

function buildStructuredLayout({
  nodes,
  edges,
  options,
  viewModel,
}: StructuredLayoutInput): Map<string, GraphPoint> {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const nodeMetricsById = viewModel.nodeMetricsById;
  const adjacency = new Map<string, EdgeStats>();
  for (const node of nodes) {
    adjacency.set(node.id, { sources: new Set(), targets: new Set(), totalDegree: 0 });
  }
  for (const edge of edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
      continue;
    }
    adjacency.get(edge.source)!.targets.add(edge.target);
    adjacency.get(edge.source)!.totalDegree += 1;
    adjacency.get(edge.target)!.sources.add(edge.source);
    adjacency.get(edge.target)!.totalDegree += 1;
  }

  const edgeAmounts = buildEdgeAmounts(edges);
  const anchorIds = buildAnchorChain(nodes, adjacency, edgeAmounts, nodeMetricsById, viewModel.focusNodeIds);
  const anchorColumns = new Map<string, number>();
  anchorIds.forEach((nodeId, index) => {
    anchorColumns.set(nodeId, index * 2 + 1);
  });

  const nodeColumns = new Map<string, number>();
  for (const anchorId of anchorIds) {
    nodeColumns.set(anchorId, anchorColumns.get(anchorId)!);
  }

  for (const node of nodes) {
    if (nodeColumns.has(node.id)) {
      continue;
    }
    const metrics = nodeMetricsById.get(node.id);
    const directAnchors = anchorIds
      .map((anchorId, anchorIndex) => ({
        anchorId,
        anchorIndex,
        relation: resolveAnchorRelation(node.id, anchorId, edgeAmounts),
        totalAmount: relationTotalAmount(resolveAnchorRelation(node.id, anchorId, edgeAmounts)),
      }))
      .filter((item) => item.totalAmount > 0)
      .sort((left, right) => right.totalAmount - left.totalAmount || left.anchorIndex - right.anchorIndex);

    if (
      directAnchors.length >= 2 &&
      metrics &&
      (metrics.role === 'bridge' || metrics.role === 'transit' || metrics.role === 'core')
    ) {
      const earliest = [...directAnchors].sort((left, right) => left.anchorIndex - right.anchorIndex)[0]!;
      const latest = [...directAnchors].sort((left, right) => right.anchorIndex - left.anchorIndex)[0]!;
      const earliestColumn = anchorColumns.get(earliest.anchorId) ?? 0;
      const latestColumn = anchorColumns.get(latest.anchorId) ?? earliestColumn;
      if (latestColumn > earliestColumn) {
        nodeColumns.set(node.id, Math.round((earliestColumn + latestColumn) / 2));
        continue;
      }
    }

    if (directAnchors.length === 1) {
      const anchorMatch = directAnchors[0]!;
      const anchorColumn = anchorColumns.get(anchorMatch.anchorId)!;
      const prefersRight = relationPrefersRight(
        anchorMatch.anchorIndex,
        anchorIds.length,
        anchorMatch.relation,
      );
      const columnBias = resolveRoleColumnBias(metrics?.role, prefersRight);
      nodeColumns.set(node.id, Math.max(0, anchorColumn + columnBias));
      continue;
    }

    if (directAnchors.length > 1) {
      const anchorMatch = directAnchors[0]!;
      const anchorColumn = anchorColumns.get(anchorMatch.anchorId)!;
      const prefersRight = relationPrefersRight(
        anchorMatch.anchorIndex,
        anchorIds.length,
        anchorMatch.relation,
      );
      const columnBias = resolveRoleColumnBias(metrics?.role, prefersRight);
      nodeColumns.set(node.id, Math.max(0, anchorColumn + columnBias));
      continue;
    }

    nodeColumns.set(node.id, resolveFallbackColumn(metrics, anchorColumns));
  }

  const unresolved = nodes
    .map((node) => node.id)
    .filter((nodeId) => !nodeColumns.has(nodeId));
  if (unresolved.length) {
    fillUnresolvedColumns(unresolved, nodeColumns, adjacency, nodeMetricsById, anchorColumns);
  }

  const grouped = new Map<number, CaseGraphData['nodes']>();
  for (const node of nodes) {
    const column = nodeColumns.get(node.id) ?? 0;
    const bucket = grouped.get(column);
    if (bucket) {
      bucket.push(node);
    } else {
      grouped.set(column, [node]);
    }
  }

  const orderedColumns = [...grouped.keys()].sort((left, right) => left - right);
  const totalWidth = orderedColumns.length
    ? orderedColumns.length * options.nodeWidth + (orderedColumns.length - 1) * options.columnGap
    : options.nodeWidth;
  const left = Math.max(24, (options.graphWidth - totalWidth) / 2);
  const orderedColumnNodes = orderColumnNodes(orderedColumns, grouped, adjacency, nodeMetricsById);

  const positions = new Map<string, GraphPoint>();
  orderedColumns.forEach((column, columnIndex) => {
    const columnNodes = orderedColumnNodes.get(column) ?? [];
    const columnHeight =
      columnNodes.length * options.nodeHeight +
      Math.max(columnNodes.length - 1, 0) * options.rowGap;
    const top = Math.max(26, (options.graphHeight - columnHeight) / 2);
    columnNodes.forEach((node, rowIndex) => {
      positions.set(node.id, {
        x: left + columnIndex * (options.nodeWidth + options.columnGap) + options.nodeWidth / 2,
        y: top + rowIndex * (options.nodeHeight + options.rowGap) + options.nodeHeight / 2,
      });
    });
  });

  return positions;
}

function buildAnchorChain(
  nodes: CaseGraphData['nodes'],
  adjacency: Map<string, EdgeStats>,
  edgeAmounts: Map<string, number>,
  nodeMetricsById: Map<string, CaseGraphNodeMetrics>,
  focusNodeIds: string[],
): string[] {
  const availableNodeIds = new Set(nodes.map((node) => node.id));
  const orderedFocusIds = focusNodeIds.filter((nodeId) => availableNodeIds.has(nodeId));
  if (orderedFocusIds.length) {
    const focusDrivenChain = buildFocusDrivenAnchorChain(
      orderedFocusIds,
      nodeMetricsById,
      edgeAmounts,
    );
    if (focusDrivenChain.length) {
      return focusDrivenChain;
    }
  }

  const fallbackChain = buildFallbackAnchorChain(nodes, adjacency, edgeAmounts, nodeMetricsById);
  if (!fallbackChain.length) {
    return [];
  }
  return fallbackChain;
}

function buildFocusDrivenAnchorChain(
  focusNodeIds: string[],
  nodeMetricsById: Map<string, CaseGraphNodeMetrics>,
  edgeAmounts: Map<string, number>,
): string[] {
  const trimmedFocusIds = focusNodeIds.slice(0, 5);
  if (trimmedFocusIds.length >= 4) {
    return trimmedFocusIds;
  }

  const candidates = [...nodeMetricsById.values()]
    .filter((metrics) => !trimmedFocusIds.includes(metrics.nodeId))
    .filter((metrics) => metrics.role === 'bridge' || metrics.role === 'transit' || metrics.role === 'core')
    .sort((left, right) => {
      const importanceDelta = right.importanceScore - left.importanceScore;
      if (importanceDelta !== 0) return importanceDelta;
      return right.bridgeScore - left.bridgeScore;
    })
    .map((metrics) => metrics.nodeId);

  const chain: string[] = [];
  const used = new Set<string>();
  trimmedFocusIds.forEach((focusId, index) => {
    if (!used.has(focusId)) {
      used.add(focusId);
      chain.push(focusId);
    }
    const nextFocusId = trimmedFocusIds[index + 1];
    if (!nextFocusId) {
      return;
    }
    const connector = findConnectorBetween(focusId, nextFocusId, candidates, used, nodeMetricsById, edgeAmounts);
    if (connector) {
      used.add(connector);
      chain.push(connector);
    }
  });
  return chain;
}

function buildFallbackAnchorChain(
  nodes: CaseGraphData['nodes'],
  adjacency: Map<string, EdgeStats>,
  edgeAmounts: Map<string, number>,
  nodeMetricsById: Map<string, CaseGraphNodeMetrics>,
): string[] {
  const sortedCandidates = [...nodes]
    .map((node) => ({
      nodeId: node.id,
      metrics: nodeMetricsById.get(node.id),
      degree: adjacency.get(node.id)?.totalDegree || 0,
    }))
    .filter((item) => item.metrics)
    .sort((left, right) => {
      const roleDelta = (left.metrics?.rolePriority ?? 99) - (right.metrics?.rolePriority ?? 99);
      if (roleDelta !== 0) return roleDelta;
      const importanceDelta = (right.metrics?.importanceScore ?? 0) - (left.metrics?.importanceScore ?? 0);
      if (importanceDelta !== 0) return importanceDelta;
      return right.degree - left.degree;
    });

  if (!sortedCandidates.length) {
    return [];
  }

  const candidates = sortedCandidates.slice(0, 5).map((item) => item.nodeId);
  const chain = [candidates[0]!];
  const remaining = candidates.slice(1);

  while (remaining.length && chain.length < 4) {
    const current = chain[chain.length - 1]!;
    const next = [...remaining].sort((left, right) => {
      const relationDelta =
        directionalRelationScore(current, right, edgeAmounts, nodeMetricsById) -
        directionalRelationScore(current, left, edgeAmounts, nodeMetricsById);
      if (relationDelta !== 0) return relationDelta;
      return (nodeMetricsById.get(right)?.importanceScore ?? 0) - (nodeMetricsById.get(left)?.importanceScore ?? 0);
    })[0];
    chain.push(next);
    remaining.splice(remaining.indexOf(next), 1);
  }

  return chain;
}

function buildEdgeAmounts(
  edges: CaseGraphData['edges'],
): Map<string, number> {
  const amounts = new Map<string, number>();
  for (const edge of edges) {
    const key = `${edge.source}::${edge.target}`;
    amounts.set(key, (amounts.get(key) || 0) + Number(edge.tradeAmount || 0));
  }
  return amounts;
}

function resolveAnchorRelation(
  nodeId: string,
  anchorId: string,
  edgeAmounts: Map<string, number>,
): AnchorRelation {
  return {
    incomingAmount: edgeAmounts.get(`${nodeId}::${anchorId}`) || 0,
    outgoingAmount: edgeAmounts.get(`${anchorId}::${nodeId}`) || 0,
  };
}

function relationPrefersRight(
  anchorIndex: number,
  anchorCount: number,
  relation: AnchorRelation,
): boolean {
  if (relation.outgoingAmount > 0 && relation.incomingAmount === 0) {
    return true;
  }
  if (relation.incomingAmount > 0 && relation.outgoingAmount === 0) {
    return false;
  }
  if (relation.outgoingAmount !== relation.incomingAmount) {
    return relation.outgoingAmount > relation.incomingAmount;
  }
  if (anchorCount === 1) {
    return true;
  }
  return anchorIndex < anchorCount - 1;
}

function fillUnresolvedColumns(
  unresolved: string[],
  nodeColumns: Map<string, number>,
  adjacency: Map<string, EdgeStats>,
  nodeMetricsById: Map<string, CaseGraphNodeMetrics>,
  anchorColumns: Map<string, number>,
): void {
  let progress = true;
  while (progress) {
    progress = false;
    for (const nodeId of unresolved) {
      if (nodeColumns.has(nodeId)) {
        continue;
      }
      const stats = adjacency.get(nodeId);
      if (!stats) {
        nodeColumns.set(nodeId, 0);
        progress = true;
        continue;
      }
      const neighborColumns = [...stats.sources, ...stats.targets]
        .map((neighborId) => nodeColumns.get(neighborId))
        .filter((column): column is number => typeof column === 'number');
      if (!neighborColumns.length) {
        continue;
      }
      const average = neighborColumns.reduce((sum, value) => sum + value, 0) / neighborColumns.length;
      const metrics = nodeMetricsById.get(nodeId);
      const roleBias = resolveRoleColumnBias(metrics?.role, average >= resolveFallbackColumn(metrics, anchorColumns));
      nodeColumns.set(nodeId, Math.max(0, Math.round(average + roleBias * 0.4)));
      progress = true;
    }
  }

  for (const nodeId of unresolved) {
    if (!nodeColumns.has(nodeId)) {
      nodeColumns.set(nodeId, resolveFallbackColumn(nodeMetricsById.get(nodeId), anchorColumns));
    }
  }
}

function orderColumnNodes(
  orderedColumns: number[],
  grouped: Map<number, CaseGraphData['nodes']>,
  adjacency: Map<string, EdgeStats>,
  nodeMetricsById: Map<string, CaseGraphNodeMetrics>,
): Map<number, CaseGraphData['nodes']> {
  const ordered = new Map<number, CaseGraphData['nodes']>();
  const rowLookup = new Map<string, number>();

  orderedColumns.forEach((column, columnIndex) => {
    const previousColumn = orderedColumns[columnIndex - 1];
    const nextColumn = orderedColumns[columnIndex + 1];
    const previousNodes = previousColumn == null ? [] : ordered.get(previousColumn) ?? [];
    const nextNodes = nextColumn == null ? [] : grouped.get(nextColumn) ?? [];
    const candidateNodes = [...(grouped.get(column) ?? [])];

    candidateNodes.sort((left, right) => {
      const barycenterDelta = resolveBarycenter(left.id, previousNodes, nextNodes, rowLookup, adjacency)
        - resolveBarycenter(right.id, previousNodes, nextNodes, rowLookup, adjacency);
      if (barycenterDelta !== 0) return barycenterDelta;
      const roleDelta = (nodeMetricsById.get(left.id)?.rolePriority ?? 99) - (nodeMetricsById.get(right.id)?.rolePriority ?? 99);
      if (roleDelta !== 0) return roleDelta;
      const importanceDelta = (nodeMetricsById.get(right.id)?.importanceScore ?? 0) - (nodeMetricsById.get(left.id)?.importanceScore ?? 0);
      if (importanceDelta !== 0) return importanceDelta;
      const degreeDelta = (adjacency.get(right.id)?.totalDegree || 0) - (adjacency.get(left.id)?.totalDegree || 0);
      if (degreeDelta !== 0) return degreeDelta;
      return nodeSortLabel(left).localeCompare(nodeSortLabel(right));
    });

    ordered.set(column, candidateNodes);
    candidateNodes.forEach((node, rowIndex) => {
      rowLookup.set(node.id, rowIndex);
    });
  });

  return ordered;
}

function resolveBarycenter(
  nodeId: string,
  previousNodes: CaseGraphData['nodes'],
  nextNodes: CaseGraphData['nodes'],
  rowLookup: Map<string, number>,
  adjacency: Map<string, EdgeStats>,
): number {
  const stats = adjacency.get(nodeId);
  if (!stats) {
    return Number.MAX_SAFE_INTEGER;
  }
  const neighborRowIndexes = [...new Set([...stats.sources, ...stats.targets])]
    .map((neighborId) => rowLookup.get(neighborId))
    .filter((rowIndex): rowIndex is number => typeof rowIndex === 'number');
  if (neighborRowIndexes.length) {
    return neighborRowIndexes.reduce((sum, value) => sum + value, 0) / neighborRowIndexes.length;
  }
  const fallbackIndex = previousNodes.findIndex((node) => node.id === nodeId);
  if (fallbackIndex >= 0) {
    return fallbackIndex;
  }
  const nextIndex = nextNodes.findIndex((node) => node.id === nodeId);
  if (nextIndex >= 0) {
    return nextIndex;
  }
  return Number.MAX_SAFE_INTEGER;
}

function nodeSortLabel(node: CaseGraphData['nodes'][number]): string {
  return String(node.name || node.label || node.accountName || node.tradeCard || node.accountId || node.id);
}

function relationTotalAmount(relation: AnchorRelation): number {
  return relation.incomingAmount + relation.outgoingAmount;
}

function directionalRelationScore(
  currentId: string,
  candidateId: string,
  edgeAmounts: Map<string, number>,
  nodeMetricsById: Map<string, CaseGraphNodeMetrics>,
): number {
  const forward = edgeAmounts.get(`${currentId}::${candidateId}`) || 0;
  const reverse = edgeAmounts.get(`${candidateId}::${currentId}`) || 0;
  return (
    Math.log10(forward * 1.2 + reverse * 0.7 + 1) * 6 +
    (nodeMetricsById.get(candidateId)?.importanceScore ?? 0) * 0.18
  );
}

function findConnectorBetween(
  leftId: string,
  rightId: string,
  candidateIds: string[],
  used: Set<string>,
  nodeMetricsById: Map<string, CaseGraphNodeMetrics>,
  edgeAmounts: Map<string, number>,
): string | null {
  const ranked = candidateIds
    .filter((candidateId) => !used.has(candidateId))
    .map((candidateId) => {
      const metrics = nodeMetricsById.get(candidateId);
      const forward =
        (edgeAmounts.get(`${leftId}::${candidateId}`) || 0) +
        (edgeAmounts.get(`${candidateId}::${rightId}`) || 0);
      const reverse =
        (edgeAmounts.get(`${candidateId}::${leftId}`) || 0) +
        (edgeAmounts.get(`${rightId}::${candidateId}`) || 0);
      const score =
        Math.log10(forward * 1.25 + reverse * 0.55 + 1) * 6 +
        (metrics?.role === 'bridge' ? 4 : metrics?.role === 'transit' ? 2.5 : metrics?.role === 'core' ? 1.2 : 0) +
        (metrics?.connectedFocusCount ?? 0) * 1.4 +
        (metrics?.importanceScore ?? 0) * 0.18;
      return { candidateId, score };
    })
    .sort((left, right) => right.score - left.score);

  return ranked[0] && ranked[0].score > 0 ? ranked[0].candidateId : null;
}

function resolveRoleColumnBias(
  role: CaseGraphNodeMetrics['role'] | undefined,
  prefersRight: boolean,
): number {
  switch (role) {
    case 'upstream':
      return -1;
    case 'downstream':
      return 1;
    case 'core':
      return 0;
    case 'bridge':
    case 'transit':
      return prefersRight ? 1 : -1;
    default:
      return prefersRight ? 1 : -1;
  }
}

function resolveFallbackColumn(
  metrics: CaseGraphNodeMetrics | undefined,
  anchorColumns: Map<string, number>,
): number {
  const anchorValues = [...anchorColumns.values()];
  const maxAnchorColumn = anchorValues.length ? Math.max(...anchorValues) : 1;
  const midColumn = anchorValues.length ? Math.round(maxAnchorColumn / 2) : 1;
  switch (metrics?.role) {
    case 'upstream':
      return 0;
    case 'downstream':
      return maxAnchorColumn + 1;
    case 'core':
      return midColumn;
    case 'bridge':
    case 'transit':
      return Math.max(1, midColumn);
    default:
      return Math.max(0, midColumn - 1);
  }
}

function coerceNumber(value: unknown): number | null {
  if (value == null || value === '') {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}
