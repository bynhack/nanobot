import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CaseGraphStorage, GraphRepository } from "@casework/case-graph";

test("case graph snapshots preserve the public state shape", async () => {
  const root = await mkdtemp(join(tmpdir(), "casework-node-"));
  const storage = new CaseGraphStorage(
    join(root, "graphs"),
    join(root, "contexts"),
  );
  const created = await storage.create("37", "测试图", [{ tradeId: "t1" }]);
  assert.equal(created.drillNums, 10);
  assert.deepEqual(created.sourceSelectId, []);
  const loaded = await storage.getGraph(created.graph_id);
  assert.deepEqual(loaded, created);
  assert.equal((await storage.listGraphs("37"))[0]?.graphId, created.graph_id);
});

test("relation step storage externalizes trade facts and preserves existing positions", async () => {
  const root = await mkdtemp(join(tmpdir(), "casework-node-"));
  const repository = new GraphRepository(join(root, "graphs"));
  const graph = {
    nodes: [
      { id: "a", x: 10, y: 20 },
      { id: "b", x: 30, y: 40 },
    ],
    edges: [{ id: "a-b", source: "a", target: "b", tradeIds: ["t1"] }],
    tradeFacts: { t1: { tradeId: "t1", tradeAmount: "100.00" } },
    layout: { nodePositions: { a: { x: 10, y: 20 }, b: { x: 30, y: 40 } } },
  };
  const result = await repository.appendStep({
    caseId: "37",
    graphId: "g1",
    graphName: "图一",
    operation: { type: "seed_one_hop" },
    graph,
    delta: { addedNodes: graph.nodes, addedEdges: graph.edges },
    summary: {},
  });
  assert.deepEqual(result.graph.graph.layout.nodePositions.a, { x: 10, y: 20 });
  assert.equal(result.graph.graph.tradeFacts.t1.tradeAmount, "100.00");
  const stored = JSON.parse(
    await readFile(join(root, "graphs", "37", "g1", "graph.json"), "utf8"),
  );
  assert.equal(stored.graph.tradeFacts, undefined);
  assert.equal(stored.graph.factStore.tradeFactsPath, "facts/trades.jsonl");
  assert.match(
    await readFile(
      join(root, "graphs", "37", "g1", "facts", "trades.jsonl"),
      "utf8",
    ),
    /"tradeId":"t1"/,
  );
});
