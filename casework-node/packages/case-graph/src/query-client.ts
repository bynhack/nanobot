import type { JsonRecord } from "./state.js";

export type { JsonRecord } from "./state.js";

export interface CaseGraphQueryClient {
  listCases(): Promise<JsonRecord[]>;
  listAccounts(caseId: string, keyword?: string): Promise<JsonRecord[]>;
  caseAuditOverview(caseId: string): Promise<JsonRecord>;
  queryCaseAuditTrades(payload: JsonRecord): Promise<JsonRecord[]>;
  queryGraph(payload: JsonRecord): Promise<JsonRecord>;
  drillDown(payload: JsonRecord): Promise<JsonRecord[]>;
  drillUp(payload: JsonRecord): Promise<JsonRecord[]>;
  drill(payload: JsonRecord): Promise<JsonRecord[]>;
  targetDetail(payload: JsonRecord): Promise<JsonRecord[]>;
  queryRelationOneHop(input: {
    caseId: string;
    seedAccounts: JsonRecord[];
    direction?: string;
    filters?: JsonRecord;
  }): Promise<JsonRecord>;
  queryRelationBetweenAccounts(input: {
    caseId: string;
    accounts: JsonRecord[];
    filters?: JsonRecord;
  }): Promise<JsonRecord>;
  queryRelationGlobalCandidates(input: {
    caseId: string;
    filters?: JsonRecord;
  }): Promise<JsonRecord>;
}

export class QueryClientNotConfiguredError extends Error {
  constructor() {
    super(
      "案件数据库未配置，请先填写 channels.webui_plugin.caseGraphDb* 配置。",
    );
  }
}

export class UnconfiguredCaseGraphQueryClient implements CaseGraphQueryClient {
  private fail(): never {
    throw new QueryClientNotConfiguredError();
  }
  async listCases(): Promise<JsonRecord[]> {
    return this.fail();
  }
  async listAccounts(): Promise<JsonRecord[]> {
    return this.fail();
  }
  async caseAuditOverview(): Promise<JsonRecord> {
    return this.fail();
  }
  async queryCaseAuditTrades(): Promise<JsonRecord[]> {
    return this.fail();
  }
  async queryGraph(): Promise<JsonRecord> {
    return this.fail();
  }
  async drillDown(): Promise<JsonRecord[]> {
    return this.fail();
  }
  async drillUp(): Promise<JsonRecord[]> {
    return this.fail();
  }
  async drill(): Promise<JsonRecord[]> {
    return this.fail();
  }
  async targetDetail(): Promise<JsonRecord[]> {
    return this.fail();
  }
  async queryRelationOneHop(): Promise<JsonRecord> {
    return this.fail();
  }
  async queryRelationBetweenAccounts(): Promise<JsonRecord> {
    return this.fail();
  }
  async queryRelationGlobalCandidates(): Promise<JsonRecord> {
    return this.fail();
  }
}
