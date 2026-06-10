import type { CaseGraphData, CaseGraphMoneyEdge, CaseGraphNode } from '../types';
import type {
  GroupLayoutState,
  LayoutDiagnostic,
  LayoutEvent,
  LayoutPlan,
  LayoutPlanInput,
  Point,
  PositionMeta,
} from './types';

export type {
  CaseGraphLayoutStateV2,
  GroupLayoutState,
  LayoutDiagnostic,
  LayoutEvent,
  LayoutPlan,
  LayoutPlanInput,
  Point,
  PositionMeta,
  PositionSource,
} from './types';

type LayoutRole = 'primary' | 'secondary' | 'incoming' | 'outgoing' | 'bridge' | 'peripheral';

interface NodeStats {
  incoming: Set<string>;
  outgoing: Set<string>;
  incomingAmount: number;
  outgoingAmount: number;
  degree: number;
}

interface CandidateSlot {
  point: Point;
  reason: string;
  alignMode?: 'grid';
}

interface PlacementRequest {
  nodeId: string;
  mode: 'growth' | 'preferred';
  preferredPoint?: Point;
  source: PositionMeta['source'];
}

const GRID_SIZE = 24;
const SEARCH_RINGS = 12;
const EPSILON = 0.01;

export async function computeInitialG6LayoutPlan(input: LayoutPlanInput): Promise<LayoutPlan> {
  const graphData = input.graphData;
  const nodes = graphData?.nodes ?? [];
  if (!nodes.length) {
    return emptyPlan(input);
  }

  try {
    const positions = await runG6InitialLayout(input);
    if (!Object.keys(positions).length) {
      return computeCaseGraphLayoutPlan(input);
    }
    const nodeIds = new Set(nodes.map((node) => node.id));
    const positionMeta = normalizePositionMeta(input, nodeIds);
    const groupLayout = { ...(input.previousLayout?.groupLayout ?? {}), ...(input.groupLayout ?? {}) };
    const lockedNodeIds = new Set(
      Object.entries(positionMeta)
        .filter(([, meta]) => meta.locked)
        .map(([nodeId]) => nodeId),
    );
    const patch: Record<string, Point> = {};
    const generatedNodeIds: string[] = [];
    for (const node of nodes) {
      const point = positions[node.id];
      if (!point) continue;
      patch[node.id] = point;
      generatedNodeIds.push(node.id);
      positionMeta[node.id] = { source: 'initial', locked: Boolean(positionMeta[node.id]?.locked) };
    }
    return buildPlan({
      positions,
      patch,
      positionMeta,
      groupLayout,
      generatedNodeIds,
      lockedNodeIds,
      diagnostics: [{ code: 'g6-initial-layout', message: '首图使用 G6 内置布局生成全局初始位置' }],
    });
  } catch (error) {
    const fallback = computeCaseGraphLayoutPlan(input);
    return {
      ...fallback,
      diagnostics: [
        ...fallback.diagnostics,
        {
          code: 'g6-initial-layout-fallback',
          message: error instanceof Error ? error.message : 'G6 初始布局失败，已回退到自研初始布局',
        },
      ],
    };
  }
}

export function computeCaseGraphLayoutPlan(input: LayoutPlanInput): LayoutPlan {
  const graphData = input.graphData;
  const nodes = graphData?.nodes ?? [];
  if (!nodes.length) {
    return emptyPlan(input);
  }

  const diagnostics: LayoutDiagnostic[] = [];
  const nodeIds = new Set(nodes.map((node) => node.id));
  const event = input.event ?? { type: 'layout_refresh' };
  const previousPositions = normalizePreviousPositions(input, nodeIds, resolveAddedPlacementNodeIds(event));
  const groupLayout = { ...(input.previousLayout?.groupLayout ?? {}), ...(input.groupLayout ?? {}) };
  const positionMeta = normalizePositionMeta(input, nodeIds);
  const lockedNodeIds = new Set(
    Object.entries(positionMeta)
      .filter(([, meta]) => meta.locked)
      .map(([nodeId]) => nodeId),
  );

  const positions = { ...previousPositions };
  const patch: Record<string, Point> = {};
  const generatedNodeIds: string[] = [];
  if (event.type === 'manual_move') {
    for (const [nodeId, point] of Object.entries(event.movedPositions)) {
      if (!isFinitePoint(point)) continue;
      const snapped = snapPoint(point);
      if (nodeIds.has(nodeId)) {
        positions[nodeId] = snapped;
        patch[nodeId] = snapped;
        positionMeta[nodeId] = { source: 'manual', locked: true };
        lockedNodeIds.add(nodeId);
        continue;
      }
      const groupState = groupLayout[nodeId];
      if (groupState?.collapsedPosition) {
        groupLayout[nodeId] = {
          ...groupState,
          collapsedPosition: snapped,
          locked: true,
        };
      }
    }
    return buildPlan({ positions, patch, positionMeta, groupLayout, generatedNodeIds, lockedNodeIds, diagnostics });
  }

  if (event.type === 'group_collapse') {
    const memberPositions = collectMemberPositions(event.memberNodeIds, positions, nodes);
    const collapsedPosition = resolveGroupCollapsePosition(memberPositions, input);
    groupLayout[event.groupId] = {
      groupId: event.groupId,
      collapsedPosition,
      memberPositionsBeforeCollapse: memberPositions,
      locked: groupLayout[event.groupId]?.locked,
    };
    return buildPlan({ positions, patch, positionMeta, groupLayout, generatedNodeIds, lockedNodeIds, diagnostics });
  }

  if (event.type === 'group_expand' || event.type === 'group_split') {
    const groupState = groupLayout[event.groupId];
    const occupied = buildOccupiedMap(positions, input, new Set(event.memberNodeIds));
    for (const nodeId of event.memberNodeIds) {
      if (!nodeIds.has(nodeId)) continue;
      const restored = groupState?.memberPositionsBeforeCollapse?.[nodeId] ?? positions[nodeId];
      if (!restored) continue;
      const point = hasCollision(restored, occupied, input)
        ? findBestSlot({
            nodeId,
            candidates: generateRadialSlots(groupState?.collapsedPosition ?? restored, input),
            occupied,
            input,
            diagnostics,
          })
        : snapPoint(restored);
      positions[nodeId] = point;
      patch[nodeId] = point;
      positionMeta[nodeId] = { source: 'restored', anchorNodeIds: [event.groupId] };
      occupied.set(nodeId, point);
      generatedNodeIds.push(nodeId);
    }
    if (event.type === 'group_split') {
      delete groupLayout[event.groupId];
    }
    return buildPlan({ positions, patch, positionMeta, groupLayout, generatedNodeIds, lockedNodeIds, diagnostics });
  }

  const stats = buildNodeStats(nodes, graphData?.edges ?? []);
  const primaryAnchorIds = resolvePrimaryAnchors(nodes, stats, input);
  const mustBuildInitial = event.type === 'initial_graph' || !Object.keys(positions).length;
  if (mustBuildInitial) {
    const initial = buildInitialSkeleton({ nodes, edges: graphData?.edges ?? [], stats, input, primaryAnchorIds });
    for (const [nodeId, point] of Object.entries(initial)) {
      positions[nodeId] = point;
      patch[nodeId] = point;
      positionMeta[nodeId] = { source: 'initial', locked: Boolean(positionMeta[nodeId]?.locked) };
      generatedNodeIds.push(nodeId);
    }
    return buildPlan({ positions, patch, positionMeta, groupLayout, generatedNodeIds, lockedNodeIds, diagnostics });
  }

  const placementRequests = resolvePlacementRequests(event, nodes, positions);
  const placementNodeIds = new Set(placementRequests.map((request) => request.nodeId));
  const occupied = buildOccupiedMap(positions, input, placementNodeIds);
  for (const request of placementRequests) {
    const nodeId = request.nodeId;
    const node = nodes.find((item) => item.id === nodeId);
    if (!node) continue;
    const anchors = resolveAnchorsForNode(nodeId, event, graphData?.edges ?? [], positions);
    const role = classifyNodeLayoutRole(node, stats.get(nodeId), anchors, primaryAnchorIds);
    const candidates = request.mode === 'preferred' && request.preferredPoint
      ? generatePreferredSlots(request.preferredPoint, input, positions)
      : generateGrowthSlots({
          nodeId,
          role,
          anchors,
          stats,
          edges: graphData?.edges ?? [],
          positions,
          input,
        });
    const point = findBestSlot({ nodeId, candidates, occupied, input, diagnostics });
    positions[nodeId] = point;
    const previousPoint = request.preferredPoint;
    const previousMeta = positionMeta[nodeId];
    if (!previousPoint || previousPoint.x !== point.x || previousPoint.y !== point.y || !previousMeta) {
      patch[nodeId] = point;
    }
    positionMeta[nodeId] = previousMeta && previousPoint?.x === point.x && previousPoint?.y === point.y
      ? previousMeta
      : { source: request.source, anchorNodeIds: anchors.map((anchor) => anchor.nodeId) };
    occupied.set(nodeId, point);
    generatedNodeIds.push(nodeId);
  }

  return buildPlan({ positions, patch, positionMeta, groupLayout, generatedNodeIds, lockedNodeIds, diagnostics });
}

async function runG6InitialLayout(input: LayoutPlanInput): Promise<Record<string, Point>> {
  const { AntVDagreLayout, GridLayout } = await import('@antv/layout');
  const graphData = input.graphData;
  const nodes = graphData?.nodes ?? [];
  const edges = graphData?.edges ?? [];
  const layoutData = {
    nodes: nodes.map((node) => ({ id: node.id })),
    edges: edges
      .map((edge) => ({
        id: resolveEdgeIdentity(edge),
        source: String(edge.source || edge.from || '').trim(),
        target: String(edge.target || edge.to || '').trim(),
      }))
      .filter((edge) => edge.source && edge.target && edge.source !== edge.target),
  };
  const layoutOptions = {
    width: input.graphWidth,
    height: input.graphHeight,
    center: [input.graphWidth / 2, input.graphHeight / 2] as [number, number],
    nodeSize: [input.nodeWidth, input.nodeHeight] as [number, number],
    nodeSpacing: Math.max(Math.min(input.rowGap, 8), 4),
    preventOverlap: true,
  };
  const layout = layoutData.edges.length
    ? new AntVDagreLayout({
        ...layoutOptions,
        rankdir: 'LR',
        nodesep: Math.max(Math.min(input.rowGap, 4), 0),
        ranksep: Math.max(Math.min(input.columnGap, 96), 72),
      })
    : new GridLayout({
        ...layoutOptions,
        cols: Math.max(1, Math.ceil(Math.sqrt(nodes.length))),
        condense: false,
      });
  await layout.execute(layoutData);
  const rawPositions: Record<string, Point> = {};
  layout.forEachNode((node) => {
    if (typeof node.id !== 'string' || !Number.isFinite(node.x) || !Number.isFinite(node.y)) return;
    rawPositions[node.id] = { x: node.x, y: node.y };
  });
  return centerG6InitialPositions(rawPositions, input);
}

function emptyPlan(input: LayoutPlanInput): LayoutPlan {
  return {
    nodePositions: {},
    positionPatch: {},
    positionMeta: { ...(input.previousLayout?.positionMeta ?? {}), ...(input.positionMeta ?? {}) },
    groupLayout: { ...(input.previousLayout?.groupLayout ?? {}), ...(input.groupLayout ?? {}) },
    generatedNodeIds: [],
    lockedNodeIds: [],
    diagnostics: [],
  };
}

function normalizePreviousPositions(input: LayoutPlanInput, nodeIds: Set<string>, ignoredGraphDataNodeIds: Set<string> = new Set()): Record<string, Point> {
  const positions: Record<string, Point> = {};
  for (const [nodeId, point] of Object.entries(input.previousLayout?.nodePositions ?? {})) {
    if (nodeIds.has(nodeId) && isFinitePoint(point)) {
      positions[nodeId] = { x: point.x, y: point.y };
    }
  }
  for (const node of input.graphData?.nodes ?? []) {
    if (ignoredGraphDataNodeIds.has(node.id)) continue;
    if (positions[node.id]) continue;
    const x = finiteNumber(node.x);
    const y = finiteNumber(node.y);
    if (x != null && y != null) {
      positions[node.id] = { x, y };
    }
  }
  return positions;
}

function resolveAddedPlacementNodeIds(event: LayoutEvent): Set<string> {
  if (!('addedNodeIds' in event)) {
    return new Set();
  }
  return new Set((event.addedNodeIds ?? []).map((nodeId) => String(nodeId || '').trim()).filter(Boolean));
}

function normalizePositionMeta(input: LayoutPlanInput, nodeIds: Set<string>): Record<string, PositionMeta> {
  const meta: Record<string, PositionMeta> = {};
  for (const [nodeId, value] of Object.entries({ ...(input.previousLayout?.positionMeta ?? {}), ...(input.positionMeta ?? {}) })) {
    if (nodeIds.has(nodeId) && value && typeof value === 'object') {
      meta[nodeId] = { ...value };
    }
  }
  return meta;
}

function buildNodeStats(nodes: CaseGraphNode[], edges: CaseGraphMoneyEdge[]): Map<string, NodeStats> {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const stats = new Map<string, NodeStats>();
  for (const node of nodes) {
    stats.set(node.id, { incoming: new Set(), outgoing: new Set(), incomingAmount: 0, outgoingAmount: 0, degree: 0 });
  }
  for (const edge of edges) {
    const source = String(edge.source || edge.from || '').trim();
    const target = String(edge.target || edge.to || '').trim();
    if (!nodeIds.has(source) || !nodeIds.has(target) || source === target) continue;
    const amount = Number(edge.tradeAmount || edge.amount || 0);
    const count = Math.max(1, Number(edge.tradeCount || edge.count || 1));
    const weight = amount + count;
    stats.get(source)!.outgoing.add(target);
    stats.get(source)!.outgoingAmount += weight;
    stats.get(source)!.degree += 1;
    stats.get(target)!.incoming.add(source);
    stats.get(target)!.incomingAmount += weight;
    stats.get(target)!.degree += 1;
  }
  return stats;
}

function resolvePrimaryAnchors(nodes: CaseGraphNode[], stats: Map<string, NodeStats>, input: LayoutPlanInput): string[] {
  const explicit = input.event?.type === 'initial_graph' ? input.event.primaryAnchorIds ?? [] : [];
  const focusNodeIds = new Set([...(input.focusNodeIds ?? []), ...resolveFocusNodeIds(nodes, input)]);
  const available = new Set(nodes.map((node) => node.id));
  const preferred = [...explicit, ...focusNodeIds].filter((nodeId) => available.has(nodeId));
  if (preferred.length) return [...new Set(preferred)].slice(0, 3);
  if (input.event?.type !== 'initial_graph' && Object.keys(input.previousLayout?.nodePositions ?? {}).length) {
    return [];
  }
  return [...nodes]
    .sort((left, right) => nodeImportance(right, stats) - nodeImportance(left, stats) || nodeLabel(left).localeCompare(nodeLabel(right), 'zh-Hans-CN'))
    .slice(0, 1)
    .map((node) => node.id);
}

function resolveFocusNodeIds(nodes: CaseGraphNode[], input: LayoutPlanInput): string[] {
  const accountIds = new Set((input.focusAccountIds ?? []).map((item) => String(item || '').trim()).filter(Boolean));
  const labels = new Set((input.focusLabels ?? []).map((item) => String(item || '').trim()).filter(Boolean));
  return nodes
    .filter((node) => {
      const nodeAccountIds = [
        node.accountId,
        node.tradeCard,
        ...(node.accounts ?? []).flatMap((account) => [account.accountId, account.tradeCard]),
      ].map((item) => String(item || '').trim());
      const nodeLabels = [node.label, node.name, node.accountName, node.tradeCard, node.id].map((item) => String(item || '').trim());
      return nodeAccountIds.some((value) => accountIds.has(value)) || nodeLabels.some((value) => labels.has(value));
    })
    .map((node) => node.id);
}

function buildInitialSkeleton(input: {
  nodes: CaseGraphNode[];
  edges: CaseGraphMoneyEdge[];
  stats: Map<string, NodeStats>;
  input: LayoutPlanInput;
  primaryAnchorIds: string[];
}): Record<string, Point> {
  const { nodes, stats } = input;
  const centerX = input.input.graphWidth / 2;
  const centerY = input.input.graphHeight / 2;
  const columnStep = input.input.nodeWidth + Math.max(input.input.columnGap, 120);
  const rowStep = input.input.nodeHeight + Math.max(input.input.rowGap, 48);
  const primary = input.primaryAnchorIds[0] ?? nodes[0]?.id;
  const positions: Record<string, Point> = {};
  if (!primary) return positions;

  positions[primary] = snapPoint({ x: centerX, y: centerY });
  const classified = nodes
    .filter((node) => node.id !== primary)
    .map((node) => ({ node, role: classifyNodeLayoutRole(node, stats.get(node.id), [], [primary]) }));
  const buckets: Record<LayoutRole, CaseGraphNode[]> = {
    primary: [],
    secondary: [],
    incoming: [],
    outgoing: [],
    bridge: [],
    peripheral: [],
  };
  for (const item of classified) {
    buckets[item.role].push(item.node);
  }
  for (const bucket of Object.values(buckets)) {
    bucket.sort((left, right) => nodeImportance(right, stats) - nodeImportance(left, stats) || nodeLabel(left).localeCompare(nodeLabel(right), 'zh-Hans-CN'));
  }

  placeColumn(buckets.incoming, centerX - columnStep, centerY, rowStep, positions);
  placeColumn([...buckets.bridge, ...buckets.secondary], centerX + columnStep * 0.5, centerY, rowStep, positions);
  placeColumn(buckets.outgoing, centerX + columnStep, centerY, rowStep, positions);
  placeColumn(buckets.peripheral, centerX, centerY + rowStep * 2, rowStep, positions, input.input.nodeWidth);
  return positions;
}

function placeColumn(nodes: CaseGraphNode[], x: number, centerY: number, rowStep: number, positions: Record<string, Point>, horizontalStep = 0): void {
  const top = centerY - ((nodes.length - 1) * rowStep) / 2;
  nodes.forEach((node, index) => {
    positions[node.id] = snapPoint({ x: x + horizontalStep * index, y: top + index * rowStep });
  });
}

function resolvePlacementRequests(event: LayoutEvent, nodes: CaseGraphNode[], positions: Record<string, Point>): PlacementRequest[] {
  const nodeIds = new Set(nodes.map((node) => node.id));
  if (event.type === 'restore_node') {
    return (event.restoredNodeIds ?? [])
      .filter((nodeId) => nodeIds.has(nodeId))
      .map((nodeId) => ({
        nodeId,
        mode: positions[nodeId] ? 'preferred' : 'growth',
        preferredPoint: positions[nodeId],
        source: 'restored',
      }));
  }
  if ('addedNodeIds' in event && event.addedNodeIds?.length) {
    return event.addedNodeIds
      .filter((nodeId) => nodeIds.has(nodeId))
      .map((nodeId) => ({ nodeId, mode: 'growth', source: 'generated' }));
  }
  return nodes
    .filter((node) => !positions[node.id])
    .map((node) => ({ nodeId: node.id, mode: 'growth', source: 'generated' }));
}

function resolveAnchorsForNode(
  nodeId: string,
  event: LayoutEvent,
  edges: CaseGraphMoneyEdge[],
  positions: Record<string, Point>,
): Array<{ nodeId: string; point: Point }> {
  const explicit = 'anchorNodeIds' in event ? event.anchorNodeIds ?? [] : [];
  const related = edges.flatMap((edge) => {
    const source = String(edge.source || edge.from || '').trim();
    const target = String(edge.target || edge.to || '').trim();
    if (source === nodeId && positions[target]) return [target];
    if (target === nodeId && positions[source]) return [source];
    return [];
  });
  return [...new Set([...explicit, ...related])]
    .filter((id) => positions[id])
    .map((id) => ({ nodeId: id, point: positions[id]! }));
}

function classifyNodeLayoutRole(
  node: CaseGraphNode,
  stats: NodeStats | undefined,
  anchors: Array<{ nodeId: string; point: Point }>,
  primaryAnchorIds: string[],
): LayoutRole {
  if (primaryAnchorIds.includes(node.id)) return 'primary';
  if (node.isCash || node.type === 'cash') return 'peripheral';
  const incoming = stats?.incoming.size ?? 0;
  const outgoing = stats?.outgoing.size ?? 0;
  if (anchors.length >= 2 && incoming > 0 && outgoing > 0) return 'bridge';
  if (incoming > 1 && outgoing > 1) return 'bridge';
  if ((stats?.degree ?? 0) >= 4) return 'secondary';
  if (incoming > 0 && outgoing === 0) return 'outgoing';
  if (outgoing > 0 && incoming === 0) return 'incoming';
  return 'peripheral';
}

function generateGrowthSlots(input: {
  nodeId: string;
  role: LayoutRole;
  anchors: Array<{ nodeId: string; point: Point }>;
  stats: Map<string, NodeStats>;
  edges: CaseGraphMoneyEdge[];
  positions: Record<string, Point>;
  input: LayoutPlanInput;
}): CandidateSlot[] {
  if (input.role === 'bridge' && input.anchors.length >= 2) {
    const center = averagePoint(input.anchors.map((anchor) => anchor.point));
    return generateRadialSlots(center, input.input, 'bridge');
  }
  const anchor = input.anchors[0]?.point ?? { x: input.input.graphWidth / 2, y: input.input.graphHeight / 2 };
  const direction = resolveGrowthDirection(input.nodeId, input.edges, input.anchors[0]?.nodeId);
  const columnStep = resolveColumnStep(input.positions, input.input);
  const rowStep = resolveRowStep(input.input);
  const primaryOffset = direction === 'left' ? -columnStep : direction === 'right' ? columnStep : 0;
  const targetX = resolveAlignedColumnX(anchor.x + primaryOffset, anchor.x, input.positions, columnStep, direction);
  const targetColumnRows = resolveAlignedColumnRows(targetX, anchor.y, input.positions, rowStep);
  const candidates: CandidateSlot[] = [];
  for (const y of targetColumnRows) {
    candidates.push({ point: snapPoint({ x: targetX, y }), reason: `${direction}-aligned-branch`, alignMode: 'grid' });
  }
  return [...candidates, ...generateRadialSlots(anchor, input.input, 'aligned-radial', input.positions)];
}

function generatePreferredSlots(preferredPoint: Point, input: LayoutPlanInput, positions: Record<string, Point>): CandidateSlot[] {
  return generateRadialSlots(snapPoint(preferredPoint), input, 'preferred-position', positions);
}

function generateRadialSlots(
  center: Point,
  input: LayoutPlanInput,
  reason = 'radial',
  positions: Record<string, Point> = {},
): CandidateSlot[] {
  const columnStep = resolveColumnStep(positions, input);
  const rowStep = resolveRowStep(input);
  const offsets: Point[] = [
    { x: columnStep, y: 0 },
    { x: -columnStep, y: 0 },
    { x: 0, y: rowStep },
    { x: 0, y: -rowStep },
    { x: columnStep, y: rowStep },
    { x: columnStep, y: -rowStep },
    { x: -columnStep, y: rowStep },
    { x: -columnStep, y: -rowStep },
  ];
  const candidates: CandidateSlot[] = [];
  for (let ring = 1; ring <= SEARCH_RINGS; ring += 1) {
    for (const offset of offsets) {
      candidates.push({ point: snapPoint({ x: center.x + offset.x * ring, y: center.y + offset.y * ring }), reason });
    }
  }
  candidates.unshift({ point: snapPoint(center), reason });
  return candidates;
}

function resolveGrowthDirection(nodeId: string, edges: CaseGraphMoneyEdge[], anchorId?: string): 'left' | 'right' | 'neutral' {
  if (!anchorId) return 'neutral';
  for (const edge of edges) {
    const source = String(edge.source || edge.from || '').trim();
    const target = String(edge.target || edge.to || '').trim();
    if (source === anchorId && target === nodeId) return 'right';
    if (target === anchorId && source === nodeId) return 'left';
  }
  return 'neutral';
}

function resolveColumnStep(positions: Record<string, Point>, input: LayoutPlanInput): number {
  const columns = [...new Set(Object.values(positions).map((point) => snapPoint(point).x))].sort((left, right) => left - right);
  const gaps = columns
    .slice(1)
    .map((column, index) => column - columns[index])
    .filter((gap) => gap >= input.nodeWidth * 0.8);
  if (gaps.length) {
    return snapDistance(gaps.sort((left, right) => left - right)[Math.floor(gaps.length / 2)]);
  }
  return snapDistance(input.nodeWidth + Math.max(Math.min(input.columnGap, 96), 72));
}

function resolveRowStep(input: LayoutPlanInput): number {
  return snapDistance(input.nodeHeight + Math.max(Math.min(input.rowGap, 18), 12));
}

function resolveAlignedColumnX(
  preferredX: number,
  anchorX: number,
  positions: Record<string, Point>,
  columnStep: number,
  direction: 'left' | 'right' | 'neutral',
): number {
  const columns = [...new Set(Object.values(positions).map((point) => snapPoint(point).x))].sort((left, right) => left - right);
  const snappedPreferred = snapPoint({ x: preferredX, y: 0 }).x;
  const directionalColumns = columns.filter((column) => {
    if (direction === 'right') return column > anchorX + EPSILON;
    if (direction === 'left') return column < anchorX - EPSILON;
    return Math.abs(column - anchorX) > EPSILON;
  });
  if (directionalColumns.length) {
    return directionalColumns.reduce((best, column) => {
      const bestDistance = Math.abs(best - snappedPreferred);
      const distance = Math.abs(column - snappedPreferred);
      return distance < bestDistance ? column : best;
    }, directionalColumns[0]!);
  }
  const nearby = columns.find((column) => Math.abs(column - snappedPreferred) <= columnStep * 0.35);
  return nearby ?? snappedPreferred;
}

function resolveAlignedColumnRows(
  x: number,
  preferredY: number,
  positions: Record<string, Point>,
  rowStep: number,
): number[] {
  const columnRows = Object.values(positions)
    .filter((point) => snapPoint(point).x === x)
    .map((point) => snapPoint(point).y)
    .sort((left, right) => left - right);
  const originY = columnRows[0] ?? preferredY;
  const preferredIndex = Math.round((preferredY - originY) / rowStep);
  const offsets = [
    ...Array.from({ length: SEARCH_RINGS }, (_, index) => index),
    ...Array.from({ length: SEARCH_RINGS }, (_, index) => -index - 1),
  ];
  const rows: number[] = [];
  for (const offset of offsets) {
    rows.push(originY + (preferredIndex + offset) * rowStep);
  }
  return rows.map((y) => snapPoint({ x, y }).y);
}

function findBestSlot(input: {
  nodeId: string;
  candidates: CandidateSlot[];
  occupied: Map<string, Point>;
  input: LayoutPlanInput;
  diagnostics: LayoutDiagnostic[];
}): Point {
  for (const candidate of input.candidates) {
    const collides = candidate.alignMode === 'grid'
      ? hasGridCollision(candidate.point, input.occupied)
      : hasCollision(candidate.point, input.occupied, input.input);
    if (!collides) {
      return candidate.point;
    }
  }
  input.diagnostics.push({ nodeId: input.nodeId, code: 'layout.dense', message: 'Preferred slots were occupied; used far fallback slot.' });
  const fallbackCenter = input.candidates.at(-1)?.point ?? { x: input.input.graphWidth / 2, y: input.input.graphHeight / 2 };
  for (let ring = SEARCH_RINGS + 1; ring <= SEARCH_RINGS * 3; ring += 1) {
    const point = snapPoint({
      x: fallbackCenter.x + ring * (input.input.nodeWidth + input.input.columnGap),
      y: fallbackCenter.y + (ring % 2 === 0 ? 1 : -1) * input.input.rowGap,
    });
    if (!hasCollision(point, input.occupied, input.input)) return point;
  }
  return snapPoint(fallbackCenter);
}

function buildOccupiedMap(positions: Record<string, Point>, input: LayoutPlanInput, ignoredNodeIds: Set<string> = new Set()): Map<string, Point> {
  const occupied = new Map<string, Point>();
  for (const [nodeId, point] of Object.entries(positions)) {
    if (ignoredNodeIds.has(nodeId)) continue;
    occupied.set(nodeId, point);
  }
  return occupied;
}

function hasCollision(point: Point, occupied: Map<string, Point>, input: LayoutPlanInput): boolean {
  const minDx = input.nodeWidth + 24;
  const minDy = input.nodeHeight + 8;
  for (const existing of occupied.values()) {
    if (Math.abs(existing.x - point.x) < minDx && Math.abs(existing.y - point.y) < minDy) {
      return true;
    }
  }
  return false;
}

function hasGridCollision(point: Point, occupied: Map<string, Point>): boolean {
  const snapped = snapPoint(point);
  for (const existing of occupied.values()) {
    const existingPoint = snapPoint(existing);
    if (existingPoint.x === snapped.x && existingPoint.y === snapped.y) {
      return true;
    }
  }
  return false;
}

function collectMemberPositions(memberNodeIds: string[], positions: Record<string, Point>, nodes: CaseGraphNode[]): Record<string, Point> {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const result: Record<string, Point> = {};
  for (const nodeId of memberNodeIds) {
    if (nodeIds.has(nodeId) && positions[nodeId]) {
      result[nodeId] = positions[nodeId]!;
    }
  }
  return result;
}

function resolveGroupCollapsePosition(memberPositions: Record<string, Point>, input: LayoutPlanInput): Point {
  const points = Object.values(memberPositions);
  if (!points.length) {
    return snapPoint({ x: input.graphWidth / 2, y: input.graphHeight / 2 });
  }
  const minX = Math.min(...points.map((point) => point.x));
  const maxX = Math.max(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxY = Math.max(...points.map((point) => point.y));
  return snapPoint({ x: (minX + maxX) / 2, y: (minY + maxY) / 2 });
}

function buildPlan(input: {
  positions: Record<string, Point>;
  patch: Record<string, Point>;
  positionMeta: Record<string, PositionMeta>;
  groupLayout: Record<string, GroupLayoutState>;
  generatedNodeIds: string[];
  lockedNodeIds: Set<string>;
  diagnostics: LayoutDiagnostic[];
}): LayoutPlan {
  return {
    nodePositions: input.positions,
    positionPatch: input.patch,
    positionMeta: input.positionMeta,
    groupLayout: input.groupLayout,
    generatedNodeIds: [...new Set(input.generatedNodeIds)],
    lockedNodeIds: [...input.lockedNodeIds].sort(),
    diagnostics: input.diagnostics,
  };
}

function nodeImportance(node: CaseGraphNode, stats: Map<string, NodeStats>): number {
  const nodeStats = stats.get(node.id);
  if (!nodeStats) return 0;
  return nodeStats.degree * 100 + nodeStats.incomingAmount + nodeStats.outgoingAmount;
}

function nodeLabel(node: CaseGraphNode): string {
  return String(node.name || node.label || node.accountName || node.tradeCard || node.accountId || node.id);
}

function averagePoint(points: Point[]): Point {
  if (!points.length) return { x: 0, y: 0 };
  return {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
  };
}

function centerG6InitialPositions(
  positions: Record<string, Point>,
  input: LayoutPlanInput,
): Record<string, Point> {
  const points = Object.values(positions).filter(isFinitePoint);
  if (!points.length) return {};
  const minX = Math.min(...points.map((point) => point.x));
  const maxX = Math.max(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxY = Math.max(...points.map((point) => point.y));
  const dx = input.graphWidth / 2 - (minX + maxX) / 2;
  const dy = input.graphHeight / 2 - (minY + maxY) / 2;
  const centered = Object.fromEntries(
    Object.entries(positions)
      .filter(([, point]) => isFinitePoint(point))
      .map(([nodeId, point]) => [nodeId, snapPoint({ x: point.x + dx, y: point.y + dy })]),
  );
  return normalizeG6ColumnRowSpacing(centered, input);
}

function normalizeG6ColumnRowSpacing(
  positions: Record<string, Point>,
  input: LayoutPlanInput,
): Record<string, Point> {
  const columns = new Map<number, Array<{ nodeId: string; point: Point }>>();
  for (const [nodeId, point] of Object.entries(positions)) {
    const x = snapPoint(point).x;
    columns.set(x, [...(columns.get(x) ?? []), { nodeId, point }]);
  }
  const rowStep = snapDistance(input.nodeHeight + Math.max(Math.min(input.rowGap, 18), 12));
  const next = { ...positions };
  for (const [x, column] of columns) {
    if (column.length < 2) continue;
    const sorted = [...column].sort((left, right) => left.point.y - right.point.y || left.nodeId.localeCompare(right.nodeId));
    const minY = Math.min(...sorted.map((item) => item.point.y));
    const maxY = Math.max(...sorted.map((item) => item.point.y));
    const centerY = (minY + maxY) / 2;
    const top = centerY - ((sorted.length - 1) * rowStep) / 2;
    sorted.forEach((item, index) => {
      next[item.nodeId] = snapPoint({ x, y: top + index * rowStep });
    });
  }
  return next;
}

function resolveEdgeIdentity(edge: CaseGraphMoneyEdge): string {
  return String(edge.id || `${edge.source || edge.from || ''}->${edge.target || edge.to || ''}`).trim();
}

function snapPoint(point: Point): Point {
  return {
    x: Math.round(point.x / GRID_SIZE) * GRID_SIZE,
    y: Math.round(point.y / GRID_SIZE) * GRID_SIZE,
  };
}

function snapDistance(value: number): number {
  return Math.max(GRID_SIZE, Math.round(value / GRID_SIZE) * GRID_SIZE);
}

function isFinitePoint(point: unknown): point is Point {
  if (!point || typeof point !== 'object') return false;
  const candidate = point as Point;
  return finiteNumber(candidate.x) != null && finiteNumber(candidate.y) != null;
}

function finiteNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export const layoutEngineInternalsForTest = {
  classifyNodeLayoutRole,
  generateRadialSlots,
  resolveGrowthDirection,
  snapPoint,
};
