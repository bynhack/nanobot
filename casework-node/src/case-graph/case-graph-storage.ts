import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { record, text, type JsonRecord } from './state.js';

export interface CaseGraphState extends JsonRecord {
  graph_id: string; caseId: string; graphName: string; graphContent: string; tradeCards: JsonRecord[];
  groupMap: JsonRecord; graphData: unknown; excludedTrades: string[]; excludedAccountId: unknown;
  excludedAccountName: string[]; summarySelectedAccountId: string[]; summarySelectedAccountName: string[];
  sourceSelectId: string[]; drillNums: number; drillType: unknown; minAmount: unknown; maxAmount: unknown; chatId: string;
}

export class CaseGraphStorage {
  constructor(private readonly root: string, private readonly contextRoot: string) {}

  async createGraph(payload: JsonRecord): Promise<CaseGraphState> { const state = normalizeCaseGraphState(payload); await atomicJson(this.path(state.graph_id), state); return state; }
  async create(caseId: string, graphName: string, tradeCards: JsonRecord[]): Promise<CaseGraphState> {
    return this.createGraph({ graph_id: randomUUID().replaceAll('-', ''), caseId, graphName, graphContent: '', tradeCards, groupMap: {}, graphData: null, excludedTrades: [], excludedAccountId: '', excludedAccountName: [], summarySelectedAccountId: [], summarySelectedAccountName: [], sourceSelectId: [], drillNums: 10, drillType: 1, minAmount: null, maxAmount: null, chatId: '' });
  }
  async getGraph(graphId: string): Promise<CaseGraphState | null> {
    const id = requireId(graphId);
    try { const state = normalizeCaseGraphState(JSON.parse(await readFile(this.path(id), 'utf8'))); if (state.graph_id !== id) throw new Error(`case graph '${id}' id mismatch`); return state; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
  }
  async updateGraph(graphId: string, patch: JsonRecord): Promise<CaseGraphState> { const id = requireId(graphId); const current = await this.getGraph(id); if (!current) throw new Error(`case graph '${id}' not found`); const state = normalizeCaseGraphState({ ...current, ...patch, graph_id: id }); await atomicJson(this.path(id), state); return state; }
  async deleteGraph(graphId: string): Promise<boolean> { const state = await this.getGraph(graphId); if (!state) return false; await rm(this.path(state.graph_id), { force: true }); await rm(join(this.root, safeSegment(state.caseId), safeSegment(state.graph_id)), { recursive: true, force: true }); await rm(join(this.contextRoot, safeSegment(state.caseId), safeSegment(state.graph_id)), { recursive: true, force: true }); return true; }
  async listGraphs(caseId = ''): Promise<JsonRecord[]> {
    await mkdir(this.root, { recursive: true }); const items: JsonRecord[] = [];
    const names = (await readdir(this.root)).filter((name) => name.endsWith('.json'));
    const files = await Promise.all(names.map(async (name) => ({ name, info: await stat(join(this.root, name)) })));
    for (const { name, info } of files.sort((a, b) => b.info.mtimeMs - a.info.mtimeMs)) {
      try { const state = normalizeCaseGraphState(JSON.parse(await readFile(join(this.root, name), 'utf8'))); if (caseId.trim() && state.caseId !== caseId.trim()) continue; items.push({ graphId: state.graph_id, caseId: state.caseId, graphName: state.graphName, tradeCardCount: state.tradeCards.length, updatedAt: Math.trunc(info.mtimeMs / 1000), chatId: state.chatId }); } catch { /* skip corrupt list item */ }
    }
    return items;
  }
  async writeCurrentContext(graphId: string, focus?: JsonRecord | null): Promise<JsonRecord> { const state = await this.getGraph(graphId); if (!state) throw new Error(`case graph '${graphId}' not found`); return this.writeCurrentContextFromMetadata({ graphId: state.graph_id, caseId: state.caseId, graphName: state.graphName, chatId: state.chatId, ...(focus !== undefined ? { focus } : {}) }); }
  async writeCurrentContextFromMetadata(input: { graphId: string; caseId: string; graphName: string; chatId?: string; focus?: JsonRecord | null }): Promise<JsonRecord> {
    const graphId = requireId(input.graphId); const caseId = text(input.caseId); if (!caseId) throw new Error('caseId');
    const contextFile = join(this.contextRoot, safeSegment(caseId), safeSegment(graphId), 'current_context.json');
    const payload = { updatedAt: new Date().toISOString(), graphId, caseId, graphName: text(input.graphName), graphFile: resolve(this.path(graphId)), contextFile: resolve(contextFile), chatId: text(input.chatId), focus: input.focus ? record(input.focus) : null };
    await atomicJson(contextFile, payload); return payload;
  }
  private path(graphId: string): string { return join(this.root, `${createHash('sha1').update(requireId(graphId)).digest('hex')}.json`); }
}

export function normalizeCaseGraphState(payload: JsonRecord): CaseGraphState {
  const graphId = requireId(text(payload.graph_id));
  if (!Array.isArray(payload.tradeCards) || !payload.tradeCards.every((item) => item && typeof item === 'object' && !Array.isArray(item))) throw new Error('tradeCards must contain objects');
  if (!Array.isArray(payload.excludedTrades)) throw new Error('excludedTrades must be a list');
  const strings = (key: string) => payload[key] == null ? [] : Array.isArray(payload[key]) ? (payload[key] as unknown[]).map(text).filter(Boolean) : (() => { throw new Error(`${key} must be a list`); })();
  const drillNums = Number.isFinite(Number(payload.drillNums)) ? Math.trunc(Number(payload.drillNums)) : 0;
  return { graph_id: graphId, caseId: text(payload.caseId), graphName: text(payload.graphName), graphContent: text(payload.graphContent), tradeCards: (payload.tradeCards as JsonRecord[]).map(record), groupMap: record(payload.groupMap), graphData: jsonValue(payload.graphData), excludedTrades: (payload.excludedTrades as unknown[]).map(text).filter(Boolean), excludedAccountId: jsonValue(payload.excludedAccountId), excludedAccountName: strings('excludedAccountName'), summarySelectedAccountId: strings('summarySelectedAccountId'), summarySelectedAccountName: strings('summarySelectedAccountName'), sourceSelectId: strings('sourceSelectId'), drillNums, drillType: jsonValue(payload.drillType), minAmount: jsonValue(payload.minAmount), maxAmount: jsonValue(payload.maxAmount), chatId: text(payload.chatId) };
}
function jsonValue(value: unknown): any { if (value == null || ['string', 'number', 'boolean'].includes(typeof value)) return value; if (Array.isArray(value)) return value.map(jsonValue); if (typeof value === 'object') return Object.fromEntries(Object.entries(value as JsonRecord).map(([key, item]) => [key, jsonValue(item)])); throw new Error('unsupported json value'); }
function requireId(value: string): string { const id = value.trim(); if (!id) throw new Error('graph_id is required'); return id; }
export function safeSegment(value: string): string { return value.trim().replace(/[^A-Za-z0-9_.-]+/g, '-').replace(/^[.-]+|[.-]+$/g, '') || createHash('sha1').update(value.trim() || 'unknown').digest('hex'); }
async function atomicJson(path: string, value: unknown): Promise<void> { await mkdir(join(path, '..'), { recursive: true }); const temp = `${path}.tmp`; await writeFile(temp, JSON.stringify(value, null, 2), 'utf8'); await rename(temp, path); }
