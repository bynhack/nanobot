import { mkdir, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { GraphRepository } from "./graph-repository.js";
import { normalizeLayout, record, text, type JsonRecord } from "./state.js";
import { safeSegment } from "./case-graph-storage.js";

export class GraphStateService {
  readonly repository: GraphRepository;
  constructor(
    caseGraphsRoot: string,
    private readonly contextRoot: string,
  ) {
    this.repository = new GraphRepository(caseGraphsRoot);
  }
  loadCurrent(caseId: string, graphId: string) {
    return this.repository.loadCurrent(caseId, graphId);
  }
  listSteps(caseId: string, graphId: string) {
    return this.repository.listSteps(caseId, graphId);
  }
  updateGraphSettings(caseId: string, graphId: string, settings: JsonRecord) {
    return this.repository.updateGraphSettings(caseId, graphId, settings);
  }
  updateLatestStepLayout(caseId: string, graphId: string, options: JsonRecord) {
    return this.repository.updateLatestStepLayout(caseId, graphId, options);
  }

  async updateLayout(input: {
    caseId: string;
    graphId: string;
    graphName?: string;
    nodePositions: JsonRecord;
    positionMeta?: JsonRecord;
    groupLayout?: JsonRecord;
    viewport?: JsonRecord;
  }): Promise<JsonRecord> {
    const current = await this.repository.loadCurrent(
      input.caseId,
      input.graphId,
    );
    const graph = record(current.graph);
    const nodeIds = new Set(
      (Array.isArray(graph.nodes) ? graph.nodes : [])
        .map((item: unknown) => text(record(item).id))
        .filter(Boolean),
    );
    const groupIds = new Set(
      (Array.isArray(graph.investigationGroups)
        ? graph.investigationGroups
        : []
      )
        .map((item: unknown) => text(record(item).id))
        .filter(Boolean),
    );
    const nodePositions: JsonRecord = {};
    const groupPositions: JsonRecord = {};
    for (const [id, rawPoint] of Object.entries(input.nodePositions)) {
      const point = record(rawPoint);
      const x = Number(point.x);
      const y = Number(point.y);
      if (!id || !Number.isFinite(x) || !Number.isFinite(y)) continue;
      if (nodeIds.has(id)) nodePositions[id] = { x, y };
      else if (groupIds.has(id)) groupPositions[id] = { x, y };
    }
    const previousGroups = Array.isArray(graph.investigationGroups)
      ? graph.investigationGroups
      : [];
    const nextGroups = previousGroups.map((raw: unknown) => {
      const group = record(raw);
      return groupPositions[text(group.id)]
        ? { ...group, ...record(groupPositions[text(group.id)]) }
        : group;
    });
    const previousLayout = record(graph.layout);
    const nextLayout = normalizeLayout(
      {
        nodePositions,
        positionMeta: input.positionMeta ?? previousLayout.positionMeta ?? {},
        groupLayout: input.groupLayout ?? previousLayout.groupLayout ?? {},
        viewport: input.viewport ?? previousLayout.viewport ?? {},
      },
      graph.nodes as JsonRecord[],
    );
    if (
      JSON.stringify(previousLayout) === JSON.stringify(nextLayout) &&
      JSON.stringify(previousGroups) === JSON.stringify(nextGroups)
    )
      return current;
    graph.layout = nextLayout;
    graph.investigationGroups = nextGroups;
    const result = await this.repository.appendStep({
      caseId: input.caseId,
      graphId: input.graphId,
      graphName: input.graphName || text(current.graphName),
      operation: {
        type: "update_layout",
        label: "更新布局",
        params: { changedNodeCount: Object.keys(input.nodePositions).length },
      },
      graph,
      delta: {
        addedNodes: [],
        addedEdges: [],
        updatedNodes: Object.keys(input.nodePositions).map((id) => ({ id })),
        updatedEdges: [],
        removedNodes: [],
        removedEdges: [],
      },
      summary: { changedNodeCount: Object.keys(input.nodePositions).length },
    });
    return record(result.graph);
  }

  async updateNodeNote(input: {
    caseId: string;
    graphId: string;
    graphName?: string;
    nodeId: string;
    note?: string;
    sourceNote?: string;
  }): Promise<JsonRecord> {
    const nodeId = text(input.nodeId);
    if (!nodeId) throw new Error("missing node_id");
    const current = await this.repository.loadCurrent(
      input.caseId,
      input.graphId,
    );
    const graph = record(current.graph);
    let found = false;
    let changed = false;
    graph.nodes = (Array.isArray(graph.nodes) ? graph.nodes : []).map(
      (raw: unknown) => {
        const node = record(raw);
        if (text(node.id) !== nodeId) return node;
        found = true;
        const next = {
          ...node,
          note: text(input.note),
          sourceNote: text(input.sourceNote),
        };
        changed = JSON.stringify(next) !== JSON.stringify(node);
        return next;
      },
    );
    if (!found) throw new Error(`node '${nodeId}' not found`);
    if (!changed) return current;
    const result = await this.repository.appendStep({
      caseId: input.caseId,
      graphId: input.graphId,
      graphName: input.graphName || text(current.graphName),
      operation: {
        type: "node_note_update",
        label: "标注主体备注",
        params: { nodeId },
      },
      graph,
      delta: {
        addedNodes: [],
        addedEdges: [],
        updatedNodes: [{ id: nodeId }],
        updatedEdges: [],
        removedNodes: [],
        removedEdges: [],
      },
      summary: { updatedNodeCount: 1 },
    });
    return record(result.graph);
  }

  async writeCurrentContext(input: {
    caseId: string;
    graphId: string;
    graphName?: string;
    chatId?: string;
    focus?: JsonRecord | null;
    latestStepId?: string;
    latestOperation?: JsonRecord;
    latestStepSummary?: JsonRecord;
    deltaSummary?: JsonRecord;
  }): Promise<JsonRecord> {
    const current = await this.repository.loadCurrent(
      input.caseId,
      input.graphId,
    );
    const graph = record(current.graph);
    const steps = await this.repository.listSteps(input.caseId, input.graphId);
    const wanted = text(input.latestStepId || current.lastStepId);
    const latest =
      steps.find((step) => text(step.stepId) === wanted) ??
      [...steps]
        .sort(
          (a, b) =>
            Number(a.revision || 0) - Number(b.revision || 0) ||
            text(a.stepId).localeCompare(text(b.stepId)),
        )
        .at(-1);
    const graphDir = this.repository.graphDir(input.caseId, input.graphId);
    const contextFile = join(
      this.contextRoot,
      safeSegment(input.caseId),
      safeSegment(input.graphId),
      "current_context.json",
    );
    const delta = record(latest?.delta);
    const payload = {
      updatedAt: new Date().toISOString(),
      graphId: input.graphId,
      caseId: input.caseId,
      graphName: text(current.graphName || input.graphName),
      graphFile: resolve(join(graphDir, "graph.json")),
      stepsDir: resolve(join(graphDir, "steps")),
      tradeFactsFile: resolve(join(graphDir, "facts", "trades.jsonl")),
      contextFile: resolve(contextFile),
      chatId: text(input.chatId),
      focus: input.focus ? record(input.focus) : null,
      latestStepId: text(
        latest?.stepId || input.latestStepId || current.lastStepId,
      ),
      latestStepFile: text(latest?.file),
      latestOperation: input.latestOperation ?? record(latest?.operation),
      latestStepSummary: input.latestStepSummary ?? record(latest?.summary),
      deltaSummary: input.deltaSummary ?? deltaSummary(delta),
      graphStats: {
        nodeCount: arrayLength(graph.nodes),
        edgeCount: arrayLength(graph.edges),
        tradeFactCount: Object.keys(record(graph.tradeFacts)).length,
        manualTradeCount: arrayLength(graph.manualEdges),
        realityRelationCount: arrayLength(graph.realityRelations),
        excludedNodeCount: arrayLength(graph.excludedNodes),
        excludedTradeCount: arrayLength(graph.excludedTrades),
      },
      availableActions: availableActions(graph),
    };
    await atomicJson(contextFile, payload);
    return payload;
  }
}

function arrayLength(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}
function deltaSummary(delta: JsonRecord) {
  return {
    addedNodeCount: arrayLength(delta.addedNodes),
    addedEdgeCount: arrayLength(delta.addedEdges),
    updatedNodeCount: arrayLength(delta.updatedNodes),
    updatedEdgeCount: arrayLength(delta.updatedEdges),
    removedNodeCount: arrayLength(delta.removedNodes),
    removedEdgeCount: arrayLength(delta.removedEdges),
  };
}
function availableActions(graph: JsonRecord): string[] {
  const result = ["总结整图"];
  if (arrayLength(graph.nodes))
    result.push("上钻", "下钻", "双向钻取", "全图筛选", "取消上图", "线索扩展");
  if (arrayLength(graph.edges)) result.push("查看交易明细", "补全图上关系");
  if (arrayLength(graph.excludedNodes)) result.push("恢复排除节点");
  return result;
}
async function atomicJson(path: string, value: unknown): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  const temp = `${path}.tmp`;
  await writeFile(temp, JSON.stringify(value, null, 2), "utf8");
  await rename(temp, path);
}
