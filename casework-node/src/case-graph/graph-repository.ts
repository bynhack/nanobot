import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { STATE_SCHEMA_VERSION, STEP_SCHEMA_VERSION, legacyGraphToDocument, normalizeGraphDocument, normalizeLayout, nowIso, record, text, type JsonRecord } from './state.js';

export class GraphRepository {
  constructor(private readonly caseGraphsRoot: string) {}
  graphDir(caseId: string, graphId: string): string { return join(this.caseGraphsRoot, caseId, graphId); }

  async loadCurrent(caseId: string, graphId: string): Promise<JsonRecord> {
    const payload = JSON.parse(await readFile(join(this.graphDir(caseId, graphId), 'graph.json'), 'utf8')) as JsonRecord;
    const state = payload.schemaVersion === STATE_SCHEMA_VERSION ? normalizeGraphDocument(payload)
      : payload.graph && typeof payload.graph === 'object' ? normalizeGraphDocument({ ...payload, caseId, graphId })
        : legacyGraphToDocument(caseId, graphId, payload);
    return this.hydrateFacts(caseId, graphId, state);
  }
  async loadGraph(caseId: string, graphId: string): Promise<JsonRecord> { return record((await this.loadCurrent(caseId, graphId)).graph); }

  async appendStep(input: { caseId: string; graphId: string; graphName: string; operation: JsonRecord; graph: JsonRecord; delta: JsonRecord; summary?: JsonRecord }): Promise<JsonRecord> {
    const dir = this.graphDir(input.caseId, input.graphId);
    const stepsDir = join(dir, 'steps');
    await mkdir(stepsDir, { recursive: true });
    const existing = (await readdir(stepsDir)).filter((name) => name.endsWith('.json')).sort();
    const baseRevision = await this.baseRevision(input.caseId, input.graphId);
    const stepId = String(existing.length + 1).padStart(4, '0');
    const operationType = text(input.operation.type) || 'operation';
    const createdAt = nowIso();
    const storedFacts = await this.mergeFacts(input.caseId, input.graphId, tradeFactsFromGraph(input.graph));
    const current = normalizeGraphDocument({ caseId: input.caseId, graphId: input.graphId, graphName: input.graphName, revision: baseRevision + 1, updatedAt: createdAt, lastStepId: stepId, metadata: { source: 'webui' }, graph: graphForStorage(input.graph, storedFacts) });
    const storedCurrent = stateForStorage(current);
    const stepFile = join(stepsDir, `${stepId}-${operationType.replaceAll('_', '-')}.json`);
    const step = { schemaVersion: STEP_SCHEMA_VERSION, caseId: input.caseId, graphId: input.graphId, stepId, operation: { ...input.operation }, baseRevision, revision: storedCurrent.revision, actor: 'user', source: 'webui', createdAt, graph: storedCurrent.graph, delta: { ...input.delta }, summary: { ...(input.summary ?? {}) }, file: stepFile };
    await atomicJson(stepFile, step);
    await atomicJson(join(dir, 'graph.json'), storedCurrent);
    return { stepId, graph: await this.hydrateFacts(input.caseId, input.graphId, storedCurrent), step };
  }

  async updateGraphSettings(caseId: string, graphId: string, settings: JsonRecord): Promise<JsonRecord> {
    const current = await this.loadCurrent(caseId, graphId);
    const graph = record(current.graph);
    let changed = false;
    for (const key of ['drillNums', 'drillType']) if (key in settings && graph[key] !== settings[key]) { graph[key] = settings[key]; changed = true; }
    if (!changed) return current;
    const facts = await this.loadFacts(caseId, graphId);
    const next = normalizeGraphDocument({ ...current, graph: graphForStorage(graph, facts), updatedAt: nowIso() });
    const stored = stateForStorage(next);
    await atomicJson(join(this.graphDir(caseId, graphId), 'graph.json'), stored);
    return this.hydrateFacts(caseId, graphId, stored);
  }

  async updateLatestStepLayout(caseId: string, graphId: string, options: JsonRecord): Promise<JsonRecord> {
    const current = await this.loadCurrent(caseId, graphId);
    const graph = record(current.graph);
    const previous = record(graph.layout);
    const groupLayout = record(options.groupLayout ?? previous.groupLayout);
    graph.investigationGroups = (Array.isArray(graph.investigationGroups) ? graph.investigationGroups : []).map((raw: unknown) => {
      const group = record(raw); const point = record(record(groupLayout[text(group.id)]).collapsedPosition);
      const x = Number(point.x); const y = Number(point.y);
      return Number.isFinite(x) && Number.isFinite(y) ? { ...group, x, y } : group;
    });
    graph.layout = normalizeLayout({ nodePositions: record(options.nodePositions), positionMeta: record(options.positionMeta ?? previous.positionMeta), groupLayout, viewport: record(options.viewport ?? previous.viewport) }, graph.nodes as JsonRecord[]);
    const facts = await this.mergeFacts(caseId, graphId, tradeFactsFromGraph(graph));
    const next = normalizeGraphDocument({ ...current, graph: graphForStorage(graph, facts), updatedAt: nowIso() });
    const stored = stateForStorage(next);
    const dir = this.graphDir(caseId, graphId);
    await atomicJson(join(dir, 'graph.json'), stored);
    const steps = await this.stepFiles(caseId, graphId);
    const latest = steps.filter((name) => !text(current.lastStepId) || name.startsWith(`${text(current.lastStepId)}-`)).at(-1) ?? steps.at(-1);
    if (latest) {
      const path = join(dir, 'steps', latest); const step = JSON.parse(await readFile(path, 'utf8')) as JsonRecord;
      if (step.schemaVersion === STEP_SCHEMA_VERSION) { step.graph = stored.graph; step.summary = { ...record(step.summary), layoutNodeCount: Object.keys(record(record(stored.graph).layout).nodePositions ?? {}).length }; await atomicJson(path, step); }
    }
    return this.hydrateFacts(caseId, graphId, stored);
  }

  async listSteps(caseId: string, graphId: string): Promise<JsonRecord[]> {
    const dir = join(this.graphDir(caseId, graphId), 'steps');
    const results: JsonRecord[] = [];
    for (const name of await this.stepFiles(caseId, graphId)) {
      const payload = JSON.parse(await readFile(join(dir, name), 'utf8')) as JsonRecord;
      if (payload.schemaVersion === STEP_SCHEMA_VERSION) results.push(payload);
      else if (payload.step && typeof payload.step === 'object') results.push({ ...record(payload.step), graph: record(payload.step).graph ?? payload.graph ?? {} });
    }
    return results;
  }

  private async baseRevision(caseId: string, graphId: string): Promise<number> { try { return Number((await this.loadCurrent(caseId, graphId)).revision || 0); } catch { return 0; } }
  private async stepFiles(caseId: string, graphId: string): Promise<string[]> { try { return (await readdir(join(this.graphDir(caseId, graphId), 'steps'))).filter((name) => name.endsWith('.json')).sort(); } catch { return []; } }
  private factsPath(caseId: string, graphId: string): string { return join(this.graphDir(caseId, graphId), 'facts', 'trades.jsonl'); }
  private async loadFacts(caseId: string, graphId: string): Promise<Record<string, JsonRecord>> {
    try {
      const facts: Record<string, JsonRecord> = {};
      for (const line of (await readFile(this.factsPath(caseId, graphId), 'utf8')).split(/\r?\n/)) {
        if (!line.trim()) continue;
        try { const item = JSON.parse(line) as JsonRecord; const id = text(item.tradeId); if (id) facts[id] = item; } catch { /* ignore corrupt fact line */ }
      }
      return facts;
    } catch { return {}; }
  }
  private async mergeFacts(caseId: string, graphId: string, incoming: Record<string, JsonRecord>): Promise<Record<string, JsonRecord>> {
    const facts = await this.loadFacts(caseId, graphId);
    let changed = false;
    for (const [rawId, fact] of Object.entries(incoming)) { const id = text(fact.tradeId ?? rawId); if (!id) continue; const next = { ...(facts[id] ?? {}), ...fact, tradeId: id }; if (JSON.stringify(facts[id]) !== JSON.stringify(next)) { facts[id] = next; changed = true; } }
    if (changed || Object.keys(incoming).length) {
      const path = this.factsPath(caseId, graphId); await mkdir(join(this.graphDir(caseId, graphId), 'facts'), { recursive: true });
      const lines = Object.entries(facts).sort(([a], [b]) => a.localeCompare(b)).map(([id, fact]) => JSON.stringify({ ...fact, tradeId: id }));
      await atomicText(path, lines.length ? `${lines.join('\n')}\n` : '');
    }
    return facts;
  }
  private async hydrateFacts(caseId: string, graphId: string, state: JsonRecord): Promise<JsonRecord> {
    const graph = record(state.graph); const facts = { ...(await this.loadFacts(caseId, graphId)), ...tradeFactsFromGraph(graph) };
    return { ...state, graph: { ...graph, tradeFacts: facts, factStore: { ...record(graph.factStore), tradeFactsPath: 'facts/trades.jsonl', tradeFactCount: Object.keys(facts).length } } };
  }
}

function tradeFactsFromGraph(graph: JsonRecord): Record<string, JsonRecord> { const result: Record<string, JsonRecord> = {}; for (const [key, raw] of Object.entries(record(graph.tradeFacts))) { const fact = record(raw); const id = text(fact.tradeId ?? key); if (id) result[id] = { ...fact, tradeId: id }; } return result; }
function graphForStorage(graph: JsonRecord, facts: Record<string, JsonRecord>): JsonRecord { const next = { ...graph }; delete next.tradeFacts; next.factStore = { tradeFactsPath: 'facts/trades.jsonl', tradeFactCount: Object.keys(facts).length }; return next; }
function stateForStorage(state: JsonRecord): JsonRecord { const graph = { ...record(state.graph) }; delete graph.tradeFacts; return { ...state, graph }; }
async function atomicJson(path: string, value: unknown): Promise<void> { await atomicText(path, JSON.stringify(value, null, 2)); }
async function atomicText(path: string, value: string): Promise<void> { await mkdir(join(path, '..'), { recursive: true }); const temp = `${path}.${process.pid}.tmp`; await writeFile(temp, value, 'utf8'); await rename(temp, path); }
