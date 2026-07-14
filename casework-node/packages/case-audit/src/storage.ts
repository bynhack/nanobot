import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

const VERSION = "case-audit-file.v1";
const LIST_KEYS = [
  "victimCards",
  "victimNames",
  "suspectCards",
  "suspectNames",
  "sourceAccountCards",
  "sourceAccountNames",
] as const;
const TEXT_KEYS = [
  "sourceMode",
  "sourceAmount",
  "sourceLabel",
  "sourceFromAuditId",
  "sourceLayerIndex",
] as const;
const FILTER_KEYS = ["startTime", "endTime", "minAmount", "maxAmount"] as const;
type R = Record<string, any>;

export class CaseAuditStorage {
  constructor(private readonly root: string) {}
  async createAudit(input: {
    caseId: string;
    auditName?: string;
    conditions?: R;
    filters?: R;
  }): Promise<R> {
    const caseId = required(input.caseId, "caseId");
    const now = new Date().toISOString();
    const auditId = `audit-${randomUUID().replaceAll("-", "").slice(0, 12)}`;
    const state = {
      schemaVersion: VERSION,
      auditId,
      caseId,
      auditName: text(input.auditName) || "涉诈资金审计",
      createdAt: now,
      updatedAt: now,
      conditions: conditions(input.conditions),
      filters: filters(input.filters),
      lastRun: null,
    };
    await atomic(this.auditPath(caseId, auditId), state);
    return state;
  }
  async getOrCreateDefault(caseId: string): Promise<R> {
    const items = await this.listAudits(caseId);
    return items[0] || this.createAudit({ caseId });
  }
  async listAudits(caseId: string): Promise<R[]> {
    const dir = this.caseRoot(required(caseId, "caseId"));
    let names: string[];
    try {
      names = await readdir(dir);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw e;
    }
    const items = (
      await Promise.all(names.map((n) => this.read(this.auditPath(caseId, n))))
    ).filter(Boolean) as R[];
    return items.sort((a, b) =>
      text(b.updatedAt).localeCompare(text(a.updatedAt)),
    );
  }
  async getAudit(auditId: string, caseId = ""): Promise<R | null> {
    auditId = required(auditId, "auditId");
    if (caseId) return this.read(this.auditPath(caseId, auditId));
    let cases: string[];
    try {
      cases = await readdir(this.root);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
    for (const c of cases) {
      const state = await this.read(this.auditPath(c, auditId));
      if (state?.auditId === auditId) return state;
    }
    return null;
  }
  async updateAudit(auditId: string, patch: R): Promise<R> {
    const current = await this.getAudit(auditId, text(patch.caseId));
    if (!current) throw new AuditNotFoundError();
    const state = { ...current };
    if ("auditName" in patch)
      state.auditName =
        text(patch.auditName) || state.auditName || "涉诈资金审计";
    if (isRecord(patch.conditions))
      state.conditions = conditions(patch.conditions);
    if (isRecord(patch.filters)) state.filters = filters(patch.filters);
    state.updatedAt = new Date().toISOString();
    await atomic(this.auditPath(state.caseId, state.auditId), state);
    return state;
  }
  async saveRunResult(auditId: string, run: R, result: R): Promise<R> {
    let state = await this.updateAudit(auditId, {
      caseId: text(run.caseId),
      conditions: Object.fromEntries(
        [...LIST_KEYS, ...TEXT_KEYS].map((k) => [k, run[k]]),
      ),
      filters: Object.fromEntries(FILTER_KEYS.map((k) => [k, run[k]])),
    });
    const ranAt = new Date().toISOString();
    const resultFile = this.resultPath(state.caseId, state.auditId);
    await atomic(resultFile, result);
    const quality = isRecord(result.quality) ? result.quality : {};
    state = {
      ...state,
      lastRun: {
        ranAt,
        resultFile,
        summary: isRecord(result.summary) ? result.summary : {},
        suspectResults: Array.isArray(result.suspectResults)
          ? result.suspectResults
          : [],
        warningCount: Array.isArray(quality.warnings)
          ? quality.warnings.length
          : 0,
        tradeCount: Array.isArray(result.trades) ? result.trades.length : 0,
      },
      updatedAt: ranAt,
    };
    await atomic(this.auditPath(state.caseId, state.auditId), state);
    return state;
  }
  private async read(path: string): Promise<R | null> {
    try {
      const p = JSON.parse(await readFile(path, "utf8"));
      if (!isRecord(p) || !text(p.caseId) || !text(p.auditId)) return null;
      return {
        schemaVersion: VERSION,
        auditId: text(p.auditId),
        caseId: text(p.caseId),
        auditName: text(p.auditName) || "涉诈资金审计",
        createdAt: text(p.createdAt),
        updatedAt: text(p.updatedAt),
        conditions: conditions(isRecord(p.conditions) ? p.conditions : {}),
        filters: filters(isRecord(p.filters) ? p.filters : {}),
        lastRun: isRecord(p.lastRun) ? p.lastRun : null,
      };
    } catch (e) {
      if (
        (e as NodeJS.ErrnoException).code === "ENOENT" ||
        e instanceof SyntaxError
      )
        return null;
      throw e;
    }
  }
  private caseRoot(caseId: string) {
    return join(this.root, safe(caseId));
  }
  private auditPath(caseId: string, auditId: string) {
    return join(this.caseRoot(caseId), safe(auditId), "audit.json");
  }
  private resultPath(caseId: string, auditId: string) {
    return join(this.caseRoot(caseId), safe(auditId), "last_result.json");
  }
}
export class AuditNotFoundError extends Error {}
function conditions(v: R = {}): R {
  return {
    ...Object.fromEntries(LIST_KEYS.map((k) => [k, textList(v[k])])),
    ...Object.fromEntries(TEXT_KEYS.map((k) => [k, text(v[k])])),
  };
}
function filters(v: R = {}): R {
  return Object.fromEntries(FILTER_KEYS.map((k) => [k, text(v[k])]));
}
function textList(v: unknown): string[] {
  const a =
    typeof v === "string"
      ? v.replaceAll("，", ",").replaceAll("\n", ",").split(",")
      : Array.isArray(v)
        ? v
        : [];
  return [...new Set(a.map(text).filter(Boolean))];
}
function text(v: unknown) {
  return v == null ? "" : String(v).trim();
}
function required(v: unknown, k: string) {
  const s = text(v);
  if (!s) throw new Error(k);
  return s;
}
function safe(v: string) {
  const s = text(v)
    .replace(/[^A-Za-z0-9_.-]+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "");
  return (
    s ||
    createHash("sha1")
      .update(text(v) || "unknown")
      .digest("hex")
  );
}
function isRecord(v: unknown): v is R {
  return !!v && typeof v === "object" && !Array.isArray(v);
}
async function atomic(path: string, v: unknown) {
  await mkdir(join(path, ".."), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify(v, null, 2), "utf8");
  await rename(tmp, path);
}
