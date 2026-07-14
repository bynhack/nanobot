import { CaseGraphStorage, type CaseGraphState } from "./case-graph-storage.js";
import type { CaseGraphQueryClient, JsonRecord } from "./query-client.js";

export class CaseGraphService {
  constructor(
    private readonly storage: CaseGraphStorage,
    private readonly query: CaseGraphQueryClient,
  ) {}
  createGraph(caseId: string, graphName: string, tradeCards: JsonRecord[]) {
    return this.storage.create(caseId, graphName, tradeCards);
  }
  listCases() {
    return this.query.listCases();
  }
  listAccounts(caseId: string, keyword = "") {
    return this.query.listAccounts(caseId, keyword);
  }
  listGraphs(caseId = "") {
    return this.storage.listGraphs(caseId);
  }
  updateGraph(graphId: string, patch: JsonRecord) {
    return this.storage.updateGraph(graphId, patch);
  }
  deleteGraph(graphId: string) {
    return this.storage.deleteGraph(graphId);
  }

  async queryGraph(
    graphId: string,
    caseId: string,
    tradeCards: JsonRecord[],
    filters: JsonRecord,
  ): Promise<JsonRecord> {
    const state = await this.requireGraph(graphId);
    const resolved = { ...filters };
    if (
      resolved.isSelectedTradeCardChanged === false &&
      state.sourceSelectId.length
    )
      resolved.sourceSelectId = [...state.sourceSelectId];
    const result = await this.query.queryGraph({
      graphId,
      caseId,
      tradeCards,
      excludedTrades: state.excludedTrades,
      excludedAccountId: state.excludedAccountId,
      ...resolved,
    });
    await this.storage.updateGraph(graphId, {
      caseId,
      tradeCards: objectList(result.tradeCards, tradeCards),
      graphData: result,
      groupMap: isRecord(result.groups) ? result.groups : state.groupMap,
      excludedTrades: stringList(result.excludedTrades, state.excludedTrades),
      excludedAccountId: jsonValue(
        result.excludedAccountId,
        Object.hasOwn(resolved, "excludedAccountId")
          ? resolved.excludedAccountId
          : state.excludedAccountId,
      ),
      sourceSelectId: stringList(result.sourceSelectId, state.sourceSelectId),
    });
    return result;
  }

  drillDown(graphId: string, caseId: string, filters: JsonRecord) {
    return this.drillGraph("drillDown", graphId, caseId, filters);
  }
  drillUp(graphId: string, caseId: string, filters: JsonRecord) {
    return this.drillGraph("drillUp", graphId, caseId, filters);
  }
  drill(graphId: string, caseId: string, filters: JsonRecord) {
    return this.drillGraph("drill", graphId, caseId, filters);
  }

  async targetDetail(input: JsonRecord) {
    await this.requireGraph(String(input.graphId || ""));
    return this.query.targetDetail({
      ...input,
      payerCards: detailCards(input.payerCards, input.payer),
      payeeCards: detailCards(input.payeeCards, input.payee),
    });
  }

  private async drillGraph(
    method: "drillDown" | "drillUp" | "drill",
    graphId: string,
    caseId: string,
    filters: JsonRecord,
  ) {
    const state = await this.requireGraph(graphId);
    const resolved = { ...filters, ...drillMatch(filters) };
    const cards = await this.query[method]({
      graphId,
      caseId,
      tradeCards: state.tradeCards,
      excludedTrades: state.excludedTrades,
      excludedAccountId: state.excludedAccountId,
      ...resolved,
    });
    const merged = mergeCards(state.tradeCards, cards);
    await this.storage.updateGraph(graphId, { tradeCards: merged });
    return { tradeCards: merged };
  }
  private async requireGraph(graphId: string): Promise<CaseGraphState> {
    const state = await this.storage.getGraph(graphId);
    if (!state) throw new GraphNotFoundError(graphId);
    return state;
  }
}

export class GraphNotFoundError extends Error {}
function isRecord(value: unknown): value is JsonRecord {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function objectList(value: unknown, fallback: JsonRecord[]): JsonRecord[] {
  return Array.isArray(value) && value.every(isRecord) ? value : [...fallback];
}
function stringList(value: unknown, fallback: string[]): string[] {
  return Array.isArray(value)
    ? value.map(String).filter(Boolean)
    : [...fallback];
}
function jsonValue(value: unknown, fallback: unknown): unknown {
  if (value === undefined) return fallback;
  return value === null ||
    ["string", "number", "boolean"].includes(typeof value) ||
    Array.isArray(value) ||
    isRecord(value)
    ? value
    : fallback;
}
function mergeCards(current: JsonRecord[], next: JsonRecord[]): JsonRecord[] {
  const out = [...current];
  const ids = new Set(
    current.flatMap((x) => (x.tradeId == null ? [] : [String(x.tradeId)])),
  );
  for (const card of next) {
    const id = card.tradeId == null ? "" : String(card.tradeId);
    if (id && ids.has(id)) continue;
    if (id) ids.add(id);
    out.push(card);
  }
  return out;
}
function detailCards(value: unknown, fallback: unknown): JsonRecord[] {
  if (Array.isArray(value)) return value.filter(isRecord);
  const subject = String(fallback || "").trim();
  return subject ? [{ tradeCard: subject }] : [];
}
function drillMatch(filters: JsonRecord): JsonRecord {
  const cards = Array.isArray(filters.tradeCard) ? filters.tradeCard : [];
  let match = "";
  for (const item of cards)
    if (isRecord(item)) {
      match = String(
        item.accountId || item.tradeCard || item.accountName || "",
      ).trim();
      if (match) break;
    }
  if (!match) return {};
  const direction = String(filters.drill_type || filters.direction || "")
    .trim()
    .toLowerCase();
  if (direction === "in") return filters.payee ? {} : { payee: match };
  if (direction === "out") return filters.payer ? {} : { payer: match };
  return {
    ...(filters.payer ? {} : { payer: match }),
    ...(filters.payee ? {} : { payee: match }),
  };
}
