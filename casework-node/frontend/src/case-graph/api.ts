import type {
  CaseGraphCaseOption,
  CaseGraphSavedGraph,
  CaseGraphSelectableAccount,
  CaseGraphSnapshot,
  CaseGraphStateSnapshot,
  CaseGraphStepSnapshot,
  CaseGraphConversationFocus,
  CaseGraphRelationResponse,
  CaseGraphTargetDetailPayload,
  CaseGraphTargetDetailResult,
  AddCaseGraphManualNodePayload,
  AddCaseGraphManualTradePayload,
  AddCaseGraphRealityRelationPayload,
  ApplyCaseGraphInvestigationGroupPayload,
  ApplyCaseGraphSummarySelectionPayload,
  CompleteCaseGraphRelationPayload,
  CreateCaseGraphPayload,
  ExcludeCaseGraphNodePayload,
  ExcludeCaseGraphTradesPayload,
  FilterCaseGraphRelationPayload,
  QueryCaseGraphRelationPayload,
  QueryCaseGraphSummaryCandidatesPayload,
  RestoreCaseGraphNodePayload,
  RestoreCaseGraphNodesPayload,
  UpdateCaseGraphConfigPayload,
  UpdateCaseGraphNodeNotePayload,
} from './types';
import type { SummaryAnalysisItem } from './summary-analysis-drawer';

function authHeaders(token: string): HeadersInit {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function readError(response: Response, fallback: string): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: string };
    if (payload.error) {
      return payload.error;
    }
  } catch {
    // ignore
  }
  return fallback;
}

async function postJson<T>(url: string, payload: unknown, token: string, fallback: string): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(token),
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(await readError(response, `${fallback}（${response.status}）`));
  }
  return response.json() as Promise<T>;
}

async function getJson<T>(url: string, token: string, fallback: string): Promise<T> {
  const response = await fetch(url, {
    headers: authHeaders(token),
  });
  if (!response.ok) {
    throw new Error(await readError(response, `${fallback}（${response.status}）`));
  }
  return response.json() as Promise<T>;
}

async function deleteJson<T>(url: string, token: string, fallback: string): Promise<T> {
  const response = await fetch(url, {
    method: 'DELETE',
    headers: authHeaders(token),
  });
  if (!response.ok) {
    throw new Error(await readError(response, `${fallback}（${response.status}）`));
  }
  return response.json() as Promise<T>;
}

export function createCaseGraph(payload: CreateCaseGraphPayload, token: string): Promise<CaseGraphSnapshot> {
  return postJson('/api/case-graph/graphs', payload, token, '创建分析图失败');
}

export async function loadCaseGraphCases(token: string): Promise<CaseGraphCaseOption[]> {
  const payload = await getJson<{ items?: CaseGraphCaseOption[] }>('/api/case-graph/cases', token, '加载案件列表失败');
  return Array.isArray(payload.items) ? payload.items : [];
}

export async function loadCaseGraphAccounts(
  caseId: string,
  token: string,
  keyword = '',
): Promise<CaseGraphSelectableAccount[]> {
  const search = new URLSearchParams();
  if (keyword.trim()) {
    search.set('keyword', keyword.trim());
  }
  const suffix = search.size > 0 ? `?${search.toString()}` : '';
  const payload = await getJson<{ items?: CaseGraphSelectableAccount[] }>(
    `/api/case-graph/cases/${encodeURIComponent(caseId)}/accounts${suffix}`,
    token,
    '加载主体列表失败',
  );
  return Array.isArray(payload.items) ? payload.items : [];
}

export async function loadSavedCaseGraphs(caseId: string, token: string): Promise<CaseGraphSavedGraph[]> {
  const suffix = caseId.trim() ? `?caseId=${encodeURIComponent(caseId.trim())}` : '';
  const payload = await getJson<{ items?: CaseGraphSavedGraph[] }>(
    `/api/case-graph/graphs${suffix}`,
    token,
    '加载已有图失败',
  );
  return Array.isArray(payload.items) ? payload.items : [];
}

export function loadCaseGraph(graphId: string, token: string): Promise<CaseGraphSnapshot> {
  return getJson(`/api/case-graph/graph/${encodeURIComponent(graphId)}`, token, '加载分析图失败');
}

export function deleteCaseGraph(graphId: string, token: string): Promise<{ ok: boolean }> {
  return deleteJson(`/api/case-graph/graph/${encodeURIComponent(graphId)}`, token, '删除分析图失败');
}

export function updateCaseGraphConfig(
  graphId: string,
  payload: UpdateCaseGraphConfigPayload,
  token: string,
): Promise<CaseGraphSnapshot> {
  return postJson(`/api/case-graph/graph/${encodeURIComponent(graphId)}`, payload, token, '更新分析配置失败');
}

export function loadCaseGraphState(caseId: string, graphId: string, token: string): Promise<CaseGraphStateSnapshot> {
  return getJson(
    `/api/case-graph/relation/state/${encodeURIComponent(caseId)}/${encodeURIComponent(graphId)}`,
    token,
    '加载图状态失败',
  );
}

export async function loadCaseGraphSteps(caseId: string, graphId: string, token: string): Promise<CaseGraphStepSnapshot[]> {
  const payload = await getJson<{ items?: CaseGraphStepSnapshot[] }>(
    `/api/case-graph/relation/state/${encodeURIComponent(caseId)}/${encodeURIComponent(graphId)}/steps`,
    token,
    '加载图谱步骤失败',
  );
  return Array.isArray(payload.items) ? payload.items : [];
}

export function saveCaseGraphLayoutOperation(
  caseId: string,
  graphId: string,
  payload: {
    graphName?: string;
    nodePositions: Record<string, { x: number; y: number }>;
    positionMeta?: Record<string, unknown>;
    groupLayout?: Record<string, unknown>;
    viewport?: { x: number; y: number; zoom: number };
  },
  token: string,
): Promise<CaseGraphStateSnapshot> {
  return postJson(
    `/api/case-graph/relation/state/${encodeURIComponent(caseId)}/${encodeURIComponent(graphId)}/operations/layout`,
    payload,
    token,
    '保存图谱布局失败',
  );
}

export function saveCaseGraphLatestStepLayout(
  caseId: string,
  graphId: string,
  payload: {
    nodePositions: Record<string, { x: number; y: number }>;
    positionMeta?: Record<string, unknown>;
    groupLayout?: Record<string, unknown>;
    viewport?: { x: number; y: number; zoom: number };
  },
  token: string,
): Promise<CaseGraphStateSnapshot> {
  return postJson(
    `/api/case-graph/relation/state/${encodeURIComponent(caseId)}/${encodeURIComponent(graphId)}/operations/latest-step-layout`,
    payload,
    token,
    '保存步骤布局失败',
  );
}

export function queryCaseGraphRelation(
  payload: QueryCaseGraphRelationPayload,
  token: string,
): Promise<CaseGraphRelationResponse> {
  return postJson('/api/case-graph/relation/query', payload, token, '查询关系图失败');
}

export function completeCaseGraphRelation(
  payload: CompleteCaseGraphRelationPayload,
  token: string,
): Promise<CaseGraphRelationResponse> {
  return postJson('/api/case-graph/relation/complete', payload, token, '分析图上节点关系失败');
}

export function filterCaseGraphRelation(
  payload: FilterCaseGraphRelationPayload,
  token: string,
): Promise<CaseGraphRelationResponse> {
  return postJson('/api/case-graph/relation/filter', payload, token, '筛选关系图失败');
}

export function excludeCaseGraphTrades(
  payload: ExcludeCaseGraphTradesPayload,
  token: string,
): Promise<CaseGraphRelationResponse> {
  return postJson('/api/case-graph/relation/exclude-trades', payload, token, '交易核查失败');
}

export function applyCaseGraphSummarySelection(
  payload: ApplyCaseGraphSummarySelectionPayload,
  token: string,
): Promise<CaseGraphRelationResponse> {
  return postJson('/api/case-graph/relation/summary-selection', payload, token, '综合筛选操作失败');
}

export function loadCaseGraphSummaryCandidates(
  payload: QueryCaseGraphSummaryCandidatesPayload,
  token: string,
): Promise<{ items: SummaryAnalysisItem[] }> {
  return postJson('/api/case-graph/relation/summary-candidates', payload, token, '综合筛选读取失败');
}

export function excludeCaseGraphNode(
  payload: ExcludeCaseGraphNodePayload,
  token: string,
): Promise<CaseGraphRelationResponse> {
  return postJson('/api/case-graph/relation/exclude-node', payload, token, '排除节点失败');
}

export function restoreCaseGraphNode(
  payload: RestoreCaseGraphNodePayload,
  token: string,
): Promise<CaseGraphRelationResponse> {
  return postJson('/api/case-graph/relation/restore-node', payload, token, '恢复节点失败');
}

export function restoreCaseGraphNodes(
  payload: RestoreCaseGraphNodesPayload,
  token: string,
): Promise<CaseGraphRelationResponse> {
  return postJson('/api/case-graph/relation/restore-nodes', payload, token, '恢复节点失败');
}

export function applyCaseGraphInvestigationGroup(
  payload: ApplyCaseGraphInvestigationGroupPayload,
  token: string,
): Promise<CaseGraphRelationResponse> {
  return postJson('/api/case-graph/relation/investigation-group', payload, token, '研判组操作失败');
}

export function addCaseGraphManualTrade(
  payload: AddCaseGraphManualTradePayload,
  token: string,
): Promise<CaseGraphRelationResponse> {
  return postJson('/api/case-graph/relation/manual-trade', payload, token, '补充资金往来失败');
}

export function addCaseGraphManualNode(
  payload: AddCaseGraphManualNodePayload,
  token: string,
): Promise<CaseGraphRelationResponse> {
  return postJson('/api/case-graph/relation/manual-node', payload, token, '创建交易主体失败');
}

export function addCaseGraphRealityRelation(
  payload: AddCaseGraphRealityRelationPayload,
  token: string,
): Promise<CaseGraphRelationResponse> {
  return postJson('/api/case-graph/relation/reality-relation', payload, token, '标注现实关系失败');
}

export function saveCaseGraphNodeNote(
  caseId: string,
  graphId: string,
  payload: UpdateCaseGraphNodeNotePayload,
  token: string,
): Promise<CaseGraphStateSnapshot> {
  return postJson(
    `/api/case-graph/relation/state/${encodeURIComponent(caseId)}/${encodeURIComponent(graphId)}/operations/node-note`,
    payload,
    token,
    '保存主体备注失败',
  );
}

export function loadCaseGraphTargetDetail(
  payload: CaseGraphTargetDetailPayload,
  token: string,
): Promise<CaseGraphTargetDetailResult> {
  return postJson('/api/case-graph/target-detail', payload, token, '边明细加载失败');
}

export function updateCaseGraphContext(
  graphId: string,
  graphMeta: {
    caseId: string;
    graphName: string;
    chatId?: string;
    latestStepId?: string;
    latestOperation?: Record<string, unknown>;
    latestStepSummary?: Record<string, unknown>;
    deltaSummary?: Record<string, unknown>;
  },
  focus: Omit<CaseGraphConversationFocus, 'graphId' | 'caseId' | 'graphName'> | null,
  token: string,
): Promise<{
  updatedAt: string;
  graphId: string;
  caseId: string;
  graphName: string;
  graphFile: string;
  contextFile?: string;
  chatId?: string;
  latestStepId?: string;
  latestOperation?: Record<string, unknown>;
  latestStepSummary?: Record<string, unknown>;
  deltaSummary?: Record<string, unknown>;
  graphStats?: Record<string, unknown>;
  focus: Record<string, unknown> | null;
}> {
  return postJson('/api/case-graph/context', { graphId, ...graphMeta, focus }, token, '更新图上下文失败');
}
