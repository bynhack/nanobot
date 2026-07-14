import type {
  CaseAuditCaseOption,
  CaseAuditConditions,
  CaseAuditFile,
  CaseAuditFileListResponse,
  CaseAuditFilters,
  CaseAuditOverview,
  CaseAuditResult,
  CaseAuditRunPayload,
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

async function getJson<T>(url: string, token: string, fallback: string): Promise<T> {
  const response = await fetch(url, {
    headers: authHeaders(token),
  });
  if (!response.ok) {
    throw new Error(await readError(response, `${fallback}（${response.status}）`));
  }
  return response.json() as Promise<T>;
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

export async function loadCaseAuditCases(token: string): Promise<CaseAuditCaseOption[]> {
  const payload = await getJson<{ items?: CaseAuditCaseOption[] }>('/api/case-audit/cases', token, '加载审计案件失败');
  return Array.isArray(payload.items) ? payload.items : [];
}

export function loadCaseAuditOverview(caseId: string, token: string): Promise<CaseAuditOverview> {
  return getJson(
    `/api/case-audit/cases/${encodeURIComponent(caseId)}/overview`,
    token,
    '加载案件审计概览失败',
  );
}

export function loadCaseAuditFiles(caseId: string, token: string): Promise<CaseAuditFileListResponse> {
  return getJson(
    `/api/case-audit/cases/${encodeURIComponent(caseId)}/audits?ensure=1`,
    token,
    '加载审计档案失败',
  );
}

export function createCaseAuditFile(
  payload: {
    caseId: string;
    auditName?: string;
    conditions?: CaseAuditConditions;
    filters?: CaseAuditFilters;
  },
  token: string,
): Promise<CaseAuditFile> {
  return postJson('/api/case-audit/audits', payload, token, '创建审计档案失败');
}

export function saveCaseAuditFile(
  auditId: string,
  payload: {
    caseId: string;
    auditName?: string;
    conditions: CaseAuditConditions;
    filters: CaseAuditFilters;
  },
  token: string,
): Promise<CaseAuditFile> {
  return postJson(`/api/case-audit/audits/${encodeURIComponent(auditId)}`, payload, token, '保存审计档案失败');
}

export function runCaseAudit(payload: CaseAuditRunPayload, token: string): Promise<CaseAuditResult> {
  return postJson('/api/case-audit/run', payload, token, '执行涉诈资金审计失败');
}
