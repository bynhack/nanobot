import type { FastifyInstance, FastifyRequest } from "fastify";
import type { AccessControl } from "../auth/access.js";
import { CaseAuditService, CaseAuditStorage } from "@casework/case-audit";
import {
  jsonObject,
  requiredText,
  sendMappedError,
  text,
} from "../http/route-utils.js";

export interface CaseAuditRouteDependencies {
  access: AccessControl;
  audits: CaseAuditStorage;
  auditService: CaseAuditService;
}

export function registerCaseAuditRoutes(
  server: FastifyInstance,
  dependencies: CaseAuditRouteDependencies,
) {
  const authorize = (request: FastifyRequest) =>
    dependencies.access.authorize(request);

  server.get("/api/case-audit/cases", async (request, reply) => {
    await authorize(request);
    try {
      return { items: await dependencies.auditService.listCases() };
    } catch (error) {
      return sendMappedError(reply, error, "案件列表读取失败", 502);
    }
  });

  server.get<{ Params: { case_id: string } }>(
    "/api/case-audit/cases/:case_id/overview",
    async (request, reply) => {
      await authorize(request);
      try {
        return await dependencies.auditService.overview(
          requiredText(request.params.case_id, "case_id"),
        );
      } catch (error) {
        return sendMappedError(reply, error, "案件审计概览读取失败", 502);
      }
    },
  );

  server.get<{ Params: { case_id: string } }>(
    "/api/case-audit/cases/:case_id/audits",
    async (request, reply) => {
      await authorize(request);
      try {
        const caseId = requiredText(request.params.case_id, "case_id");
        const ensure = ["1", "true", "yes"].includes(
          text(jsonObject(request.query).ensure),
        );
        const active = ensure
          ? await dependencies.audits.getOrCreateDefault(caseId)
          : null;
        const items = await dependencies.audits.listAudits(caseId);
        return {
          items,
          activeAuditId: text(active?.auditId || items[0]?.auditId),
        };
      } catch (error) {
        return sendMappedError(reply, error, "审计档案读取失败");
      }
    },
  );

  server.post("/api/case-audit/audits", async (request, reply) => {
    await authorize(request);
    const body = jsonObject(request.body);
    try {
      return await dependencies.audits.createAudit({
        caseId: requiredText(body.caseId, "caseId"),
        auditName: text(body.auditName),
        conditions: jsonObject(body.conditions),
        filters: jsonObject(body.filters),
      });
    } catch (error) {
      return sendMappedError(reply, error, "审计档案创建失败");
    }
  });

  server.post<{ Params: { audit_id: string } }>(
    "/api/case-audit/audits/:audit_id",
    async (request, reply) => {
      await authorize(request);
      try {
        return await dependencies.audits.updateAudit(
          requiredText(request.params.audit_id, "audit_id"),
          jsonObject(request.body),
        );
      } catch (error) {
        return sendMappedError(reply, error, "审计档案保存失败");
      }
    },
  );

  server.post("/api/case-audit/run", async (request, reply) => {
    await authorize(request);
    const body = jsonObject(request.body);
    try {
      requiredText(body.caseId, "caseId");
      const result = await dependencies.auditService.runCaseAudit(body);
      if (text(body.auditId))
        await dependencies.audits.saveRunResult(
          text(body.auditId),
          body,
          result,
        );
      return result;
    } catch (error) {
      return sendMappedError(reply, error, "涉诈资金审计失败", 502);
    }
  });
}
