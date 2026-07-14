import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  CaseGraphService,
  CaseGraphStorage,
  type CaseGraphQueryClient,
} from "@casework/case-graph";

function queryClient(result: Record<string, unknown>) {
  return {
    queryGraph: async () => result,
  } as unknown as CaseGraphQueryClient;
}

test("query graph allows the caller to explicitly clear excludedAccountId", async () => {
  const root = await mkdtemp(join(tmpdir(), "casework-graph-service-"));
  try {
    const storage = new CaseGraphStorage(root, join(root, "contexts"));
    const created = await storage.create("37", "test", []);
    await storage.updateGraph(created.graph_id, { excludedAccountId: "35" });
    const service = new CaseGraphService(storage, queryClient({ nodes: [] }));

    await service.queryGraph(created.graph_id, "37", [], {
      excludedAccountId: null,
    });

    assert.equal((await storage.getGraph(created.graph_id))?.excludedAccountId, null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("query graph preserves stored optional state when upstream omits it", async () => {
  const root = await mkdtemp(join(tmpdir(), "casework-graph-service-"));
  try {
    const storage = new CaseGraphStorage(root, join(root, "contexts"));
    const created = await storage.create("37", "test", [
      { accountId: "35", tradeCard: "P-35" },
    ]);
    await storage.updateGraph(created.graph_id, {
      excludedAccountId: "35",
      excludedTrades: ["trade-1"],
      sourceSelectId: ["35"],
    });
    const service = new CaseGraphService(storage, queryClient({ nodes: [] }));

    await service.queryGraph(created.graph_id, "37", [], {});

    const state = await storage.getGraph(created.graph_id);
    assert.equal(state?.excludedAccountId, "35");
    assert.deepStrictEqual(state?.excludedTrades, ["trade-1"]);
    assert.deepStrictEqual(state?.sourceSelectId, ["35"]);
    assert.deepStrictEqual(state?.tradeCards, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
