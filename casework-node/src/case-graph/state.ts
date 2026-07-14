export const STATE_SCHEMA_VERSION = 'case-graph.state.v1';
export const STEP_SCHEMA_VERSION = 'case-graph.step.v1';

export type JsonRecord = Record<string, any>;

export function nowIso(): string { return new Date().toISOString(); }
export function text(value: unknown): string { return value == null ? '' : String(value).trim(); }
export function record(value: unknown): JsonRecord { return value && typeof value === 'object' && !Array.isArray(value) ? { ...(value as JsonRecord) } : {}; }
export function list(value: unknown): unknown[] { return Array.isArray(value) ? [...value] : []; }
export function textList(value: unknown): string[] {
  if (typeof value === 'string' || typeof value === 'number') return text(value) ? [text(value)] : [];
  return list(value).map(text).filter(Boolean);
}
export function finiteNumber(value: unknown): number | null {
  if (typeof value === 'boolean' || value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
export function positiveInt(value: unknown, fallback: number): number {
  const number = Math.trunc(Number(value));
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

export function normalizePoint(value: unknown): { x: number; y: number } | null {
  const raw = record(value);
  const x = finiteNumber(raw.x);
  const y = finiteNumber(raw.y);
  return x == null || y == null ? null : { x, y };
}

export function normalizeLayout(value: unknown, nodes: JsonRecord[] = []): JsonRecord {
  const raw = record(value);
  const allowed = new Set(nodes.map((node) => text(node.id)).filter(Boolean));
  const positions: JsonRecord = {};
  for (const [rawId, rawPoint] of Object.entries(record(raw.nodePositions))) {
    const id = text(rawId);
    const point = normalizePoint(rawPoint);
    if (id && point && (!allowed.size || allowed.has(id))) positions[id] = point;
  }
  for (const node of nodes) {
    const id = text(node.id);
    const point = normalizePoint(node);
    if (id && point && !(id in positions)) positions[id] = point;
  }
  const positionMeta: JsonRecord = {};
  for (const [rawId, rawMeta] of Object.entries(record(raw.positionMeta))) {
    const id = text(rawId);
    if (!id || (allowed.size && !allowed.has(id))) continue;
    const meta = record(rawMeta);
    const source = text(meta.source);
    if (!['initial', 'generated', 'manual', 'group', 'restored'].includes(source)) continue;
    const item: JsonRecord = { source };
    if (Boolean(meta.locked)) item.locked = true;
    const anchorNodeIds = textList(meta.anchorNodeIds);
    if (anchorNodeIds.length) item.anchorNodeIds = anchorNodeIds;
    if (text(meta.updatedAt)) item.updatedAt = text(meta.updatedAt);
    positionMeta[id] = item;
  }
  const groupLayout: JsonRecord = {};
  for (const [rawGroupId, rawState] of Object.entries(record(raw.groupLayout))) {
    const groupId = text(rawGroupId);
    const state = record(rawState);
    const collapsedPosition = normalizePoint(state.collapsedPosition);
    if (!groupId || !collapsedPosition) continue;
    const memberPositionsBeforeCollapse: JsonRecord = {};
    for (const [rawId, rawPoint] of Object.entries(record(state.memberPositionsBeforeCollapse))) {
      const id = text(rawId);
      const point = normalizePoint(rawPoint);
      if (id && point && (!allowed.size || allowed.has(id))) memberPositionsBeforeCollapse[id] = point;
    }
    groupLayout[groupId] = {
      groupId: text(state.groupId) || groupId,
      collapsedPosition,
      memberPositionsBeforeCollapse,
      ...(state.locked ? { locked: true } : {}),
    };
  }
  const viewport = record(raw.viewport);
  return {
    version: 2,
    nodePositions: positions,
    positionMeta,
    groupLayout,
    viewport: { x: finiteNumber(viewport.x) ?? 0, y: finiteNumber(viewport.y) ?? 0, zoom: finiteNumber(viewport.zoom) ?? 1 },
  };
}

export function normalizeGraphBody(value: unknown): JsonRecord {
  const raw = record(value);
  const nodes = list(raw.nodes).filter(isRecord).map(record);
  const tradeFacts: JsonRecord = {};
  for (const [key, item] of Object.entries(record(raw.tradeFacts))) if (text(key) && isRecord(item)) tradeFacts[text(key)] = record(item);
  return {
    nodes,
    edges: list(raw.edges).filter(isRecord).map(record),
    tradeFacts,
    factStore: record(raw.factStore),
    tradeCards: list(raw.tradeCards).filter(isRecord).map(record),
    groupMap: record(raw.groupMap),
    investigationGroups: list(raw.investigationGroups).filter(isRecord).map(record),
    sourceSelectId: textList(raw.sourceSelectId),
    summarySelectedAccountId: textList(raw.summarySelectedAccountId),
    summarySelectedAccountName: textList(raw.summarySelectedAccountName),
    excludedTrades: textList(raw.excludedTrades),
    excludedAccountId: textList(raw.excludedAccountId),
    excludedAccountName: textList(raw.excludedAccountName),
    layout: normalizeLayout(raw.layout, nodes),
    filters: { minAmount: record(raw.filters).minAmount, maxAmount: record(raw.filters).maxAmount, startTime: text(record(raw.filters).startTime), endTime: text(record(raw.filters).endTime) },
    drillNums: positiveInt(raw.drillNums, 10),
    drillType: raw.drillType == null || raw.drillType === '' ? 1 : raw.drillType,
    excludedNodes: list(raw.excludedNodes).filter(isRecord).map(record),
    manualEdges: list(raw.manualEdges).filter(isRecord).map(record),
    realityRelations: list(raw.realityRelations).filter(isRecord).map(record),
    annotations: list(raw.annotations).filter(isRecord).map(record),
    graphData: raw.graphData,
  };
}

export function normalizeGraphDocument(payload: JsonRecord): JsonRecord {
  return {
    schemaVersion: STATE_SCHEMA_VERSION,
    caseId: text(payload.caseId), graphId: text(payload.graphId), graphName: text(payload.graphName),
    revision: Math.trunc(Number(payload.revision || 0)), updatedAt: text(payload.updatedAt) || nowIso(),
    lastStepId: text(payload.lastStepId), metadata: record(payload.metadata), graph: normalizeGraphBody(payload.graph),
  };
}

export function legacyGraphToDocument(caseId: string, graphId: string, graph: JsonRecord, graphName = ''): JsonRecord {
  return normalizeGraphDocument({ caseId, graphId, graphName, graph });
}

function isRecord(value: unknown): value is JsonRecord { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
