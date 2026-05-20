import type {
  CaseGraphCaseOption,
  CaseGraphQueryResult,
  CaseGraphSavedGraph,
  CaseGraphSelectableAccount,
  CaseGraphSnapshot,
  CaseGraphConversationFocus,
  CaseGraphTargetDetailPayload,
  CaseGraphTargetDetailResult,
  CreateCaseGraphPayload,
  DrillDownCaseGraphPayload,
  QueryCaseGraphPayload,
  UpdateCaseGraphConfigPayload,
} from './types';

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

export function updateCaseGraphConfig(
  graphId: string,
  payload: UpdateCaseGraphConfigPayload,
  token: string,
): Promise<CaseGraphSnapshot> {
  return postJson(`/api/case-graph/graph/${encodeURIComponent(graphId)}`, payload, token, '更新分析配置失败');
}

export function queryCaseGraph(payload: QueryCaseGraphPayload, token: string): Promise<CaseGraphQueryResult> {
  return postJson('/api/case-graph/query', payload, token, '查询分析图失败');
}

export function drillDownCaseGraph(
  payload: DrillDownCaseGraphPayload,
  token: string,
): Promise<{ tradeCards: CaseGraphSnapshot['tradeCards'] }> {
  return postJson('/api/case-graph/query/drilldown', payload, token, '节点下钻失败');
}

export function drillUpCaseGraph(
  payload: DrillDownCaseGraphPayload,
  token: string,
): Promise<{ tradeCards: CaseGraphSnapshot['tradeCards'] }> {
  return postJson('/api/case-graph/query/drillup', payload, token, '节点上钻失败');
}

export function drillCaseGraph(
  payload: DrillDownCaseGraphPayload,
  token: string,
): Promise<{ tradeCards: CaseGraphSnapshot['tradeCards'] }> {
  return postJson('/api/case-graph/query/drill', payload, token, '节点双向钻取失败');
}

export function loadCaseGraphTargetDetail(
  payload: CaseGraphTargetDetailPayload,
  token: string,
): Promise<CaseGraphTargetDetailResult> {
  return postJson('/api/case-graph/target-detail', payload, token, '边明细加载失败');
}

export function updateCaseGraphContext(
  graphId: string,
  focus: Omit<CaseGraphConversationFocus, 'graphId' | 'caseId' | 'graphName'> | null,
  token: string,
): Promise<{
  updatedAt: string;
  graphId: string;
  caseId: string;
  graphName: string;
  graphFile: string;
  focus: Record<string, unknown> | null;
}> {
  return postJson('/api/case-graph/context', { graphId, focus }, token, '更新图上下文失败');
}
