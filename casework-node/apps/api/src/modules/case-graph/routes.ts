import type { FastifyInstance, FastifyRequest } from "fastify";
import type { AccessControl } from "../auth/access.js";
import {
  CaseGraphService,
  CaseGraphStorage,
  GraphStateService,
  RelationGraphService,
} from "@casework/case-graph";
import {
  type JsonObject,
  isJsonObject,
  jsonObject,
  objectList,
  requiredText,
  sendMappedError,
  text,
} from "../http/route-utils.js";
export function registerCaseGraphRoutes(
  server: FastifyInstance,
  d: {
    access: AccessControl;
    graphs: CaseGraphStorage;
    graphService: CaseGraphService;
    graphState: GraphStateService;
    relations: RelationGraphService;
  },
) {
  const auth = (q: FastifyRequest) => d.access.authorize(q);
  const body = (q: FastifyRequest) => jsonObject(q.body);
  server.post("/api/case-graph/graphs", async (q, r) => {
    await auth(q);
    const p = body(q);
    try {
      const caseId = requiredText(p.caseId, "caseId"),
        name = requiredText(p.graphName, "graphName");
      if (!objectList(p.tradeCards))
        return r.code(400).send({ error: "tradeCards 必须是对象数组" });
      return d.graphService.createGraph(caseId, name, p.tradeCards);
    } catch (e) {
      return sendMappedError(r, e, "建图失败");
    }
  });
  server.get("/api/case-graph/graphs", async (q, r) => {
    await auth(q);
    try {
      return {
        items: await d.graphService.listGraphs(
          text(jsonObject(q.query).caseId),
        ),
      };
    } catch (e) {
      return sendMappedError(r, e, "图列表读取失败", 502);
    }
  });
  server.get("/api/case-graph/cases", async (q, r) => {
    await auth(q);
    try {
      return { items: await d.graphService.listCases() };
    } catch (e) {
      return sendMappedError(r, e, "案件列表读取失败", 502);
    }
  });
  server.get<{ Params: { case_id: string } }>(
    "/api/case-graph/cases/:case_id/accounts",
    async (q, r) => {
      await auth(q);
      try {
        return {
          items: await d.graphService.listAccounts(
            requiredText(q.params.case_id, "case_id"),
            text(jsonObject(q.query).keyword),
          ),
        };
      } catch (e) {
        return sendMappedError(r, e, "主体列表读取失败", 502);
      }
    },
  );
  server.get<{ Params: { graph_id: string } }>(
    "/api/case-graph/graph/:graph_id",
    async (q, r) => {
      await auth(q);
      try {
        const g = await d.graphs.getGraph(
          requiredText(q.params.graph_id, "graph_id"),
        );
        return g || r.code(404).send({ error: "图不存在" });
      } catch (e) {
        return sendMappedError(r, e, "读取图失败");
      }
    },
  );
  server.post<{ Params: { graph_id: string } }>(
    "/api/case-graph/graph/:graph_id",
    async (q, r) => {
      await auth(q);
      try {
        const id = requiredText(q.params.graph_id, "graph_id"),
          p = body(q),
          g = await d.graphService.updateGraph(id, p);
        if (
          text(g.caseId) &&
          (Object.hasOwn(p, "drillNums") || Object.hasOwn(p, "drillType"))
        )
          try {
            await d.graphState.updateGraphSettings(
              g.caseId,
              id,
              Object.fromEntries(
                ["drillNums", "drillType"]
                  .filter((k) => k in p)
                  .map((k) => [k, p[k]]),
              ),
            );
          } catch {}
        return g;
      } catch (e) {
        return sendMappedError(r, e, "更新图失败");
      }
    },
  );
  server.delete<{ Params: { graph_id: string } }>(
    "/api/case-graph/graph/:graph_id",
    async (q, r) => {
      await auth(q);
      try {
        return (await d.graphService.deleteGraph(
          requiredText(q.params.graph_id, "graph_id"),
        ))
          ? { ok: true }
          : r.code(404).send({ error: "图不存在" });
      } catch (e) {
        return sendMappedError(r, e, "删除图失败");
      }
    },
  );
  const relation = (
    path: string,
    method: keyof RelationGraphService,
    label: string,
    validate?: (p: JsonObject) => string | null,
  ) =>
    server.post(path, async (q, r) => {
      await auth(q);
      const p = body(q),
        bad = validate?.(p);
      if (bad) return r.code(400).send({ error: bad });
      try {
        return await (d.relations[method] as any).call(d.relations, p);
      } catch (e) {
        return sendMappedError(r, e, label, 502);
      }
    });
  relation(
    "/api/case-graph/relation/query",
    "querySeedOneHop",
    "关系图查询失败",
    (p) => (!objectList(p.seeds) ? "seeds 必须是对象数组" : null),
  );
  relation(
    "/api/case-graph/relation/complete",
    "completeCurrentGraph",
    "图上节点关系分析失败",
    (p) => (!objectList(p.accounts) ? "accounts 必须是对象数组" : null),
  );
  relation(
    "/api/case-graph/relation/filter",
    "filterCurrentGraph",
    "图筛选失败",
    (p) =>
      "filters" in p && !isJsonObject(p.filters) ? "filters 必须是对象" : null,
  );
  relation(
    "/api/case-graph/relation/exclude-trades",
    "excludeTrades",
    "交易核查失败",
  );
  relation(
    "/api/case-graph/relation/summary-candidates",
    "querySummaryCandidates",
    "线索候选读取失败",
  );
  relation(
    "/api/case-graph/relation/summary-selection",
    "applySummarySelection",
    "线索扩展失败",
  );
  relation(
    "/api/case-graph/relation/exclude-node",
    "excludeNode",
    "排除节点失败",
  );
  relation(
    "/api/case-graph/relation/restore-node",
    "restoreNode",
    "恢复节点失败",
  );
  relation(
    "/api/case-graph/relation/restore-nodes",
    "restoreNodes",
    "恢复节点失败",
  );
  relation(
    "/api/case-graph/relation/investigation-group",
    "applyInvestigationGroup",
    "研判组操作失败",
  );
  relation(
    "/api/case-graph/relation/manual-node",
    "addManualNode",
    "创建交易主体失败",
  );
  relation(
    "/api/case-graph/relation/manual-trade",
    "addManualTrade",
    "补充资金往来失败",
  );
  relation(
    "/api/case-graph/relation/reality-relation",
    "addRealityRelation",
    "标注现实关系失败",
  );
  server.get<{ Params: { case_id: string; graph_id: string } }>(
    "/api/case-graph/relation/state/:case_id/:graph_id",
    async (q, r) => {
      await auth(q);
      try {
        return await d.graphState.loadCurrent(
          requiredText(q.params.case_id, "case_id"),
          requiredText(q.params.graph_id, "graph_id"),
        );
      } catch (e) {
        return sendMappedError(r, e, "图状态读取失败", 404);
      }
    },
  );
  server.get<{ Params: { case_id: string; graph_id: string } }>(
    "/api/case-graph/relation/state/:case_id/:graph_id/steps",
    async (q, r) => {
      await auth(q);
      try {
        return {
          items: await d.graphState.listSteps(
            requiredText(q.params.case_id, "case_id"),
            requiredText(q.params.graph_id, "graph_id"),
          ),
        };
      } catch (e) {
        return sendMappedError(r, e, "图步骤读取失败", 404);
      }
    },
  );
  server.post<{ Params: { case_id: string; graph_id: string } }>(
    "/api/case-graph/relation/state/:case_id/:graph_id/operations/layout",
    async (q, r) => {
      await auth(q);
      try {
        const p = body(q);
        if (!isJsonObject(p.nodePositions))
          return r.code(400).send({ error: "nodePositions 必须是对象" });
        return await d.graphState.updateLayout({
          caseId: requiredText(q.params.case_id, "case_id"),
          graphId: requiredText(q.params.graph_id, "graph_id"),
          graphName: text(p.graphName),
          nodePositions: p.nodePositions,
          positionMeta: jsonObject(p.positionMeta),
          groupLayout: jsonObject(p.groupLayout),
          viewport: jsonObject(p.viewport),
        });
      } catch (e) {
        return sendMappedError(r, e, "图谱布局保存失败");
      }
    },
  );
  server.post<{ Params: { case_id: string; graph_id: string } }>(
    "/api/case-graph/relation/state/:case_id/:graph_id/operations/latest-step-layout",
    async (q, r) => {
      await auth(q);
      try {
        return await d.graphState.updateLatestStepLayout(
          requiredText(q.params.case_id, "case_id"),
          requiredText(q.params.graph_id, "graph_id"),
          body(q),
        );
      } catch (e) {
        return sendMappedError(r, e, "步骤布局保存失败");
      }
    },
  );
  server.post<{ Params: { case_id: string; graph_id: string } }>(
    "/api/case-graph/relation/state/:case_id/:graph_id/operations/node-note",
    async (q, r) => {
      await auth(q);
      try {
        const p = body(q);
        return await d.graphState.updateNodeNote({
          caseId: requiredText(q.params.case_id, "case_id"),
          graphId: requiredText(q.params.graph_id, "graph_id"),
          graphName: text(p.graphName),
          nodeId: requiredText(p.nodeId, "nodeId"),
          note: text(p.note),
          sourceNote: text(p.sourceNote),
        });
      } catch (e) {
        return sendMappedError(r, e, "主体备注保存失败");
      }
    },
  );
  server.post("/api/case-graph/target-detail", async (q, r) => {
    await auth(q);
    try {
      return await d.graphService.targetDetail(body(q));
    } catch (e) {
      return sendMappedError(r, e, "边明细加载失败", 502);
    }
  });
  server.post("/api/case-graph/context", async (q, r) => {
    await auth(q);
    try {
      const p = body(q);
      return await d.graphState.writeCurrentContext({
        caseId: requiredText(p.caseId, "caseId"),
        graphId: requiredText(p.graphId, "graphId"),
        graphName: text(p.graphName),
        chatId: text(p.chatId),
        focus: isJsonObject(p.focus) ? p.focus : null,
        latestStepId: text(p.latestStepId),
        latestOperation: jsonObject(p.latestOperation),
        latestStepSummary: jsonObject(p.latestStepSummary),
        deltaSummary: jsonObject(p.deltaSummary),
      });
    } catch (e) {
      return sendMappedError(r, e, "更新图上下文失败");
    }
  });
}
