import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CaseGraphStorage,
  RelationGraphService,
  RelationGraphStorage,
} from "@casework/case-graph";

async function serviceWithGraph(graph: Record<string, unknown>) {
  const root = await mkdtemp(join(tmpdir(), "casework-node-group-"));
  const snapshots = new CaseGraphStorage(
    join(root, "snapshots"),
    join(root, "contexts"),
  );
  const snapshot = await snapshots.create("37", "测试图", []);
  const graphId = String(snapshot.graph_id);
  const storage = new RelationGraphStorage(join(root, "relations"));
  await storage.saveStep({
    caseId: "37",
    graphId,
    stepType: "seed_one_hop",
    request: { caseId: "37", graphId, evidence: { source: "test" } },
    graph,
    delta: { addedNodes: [], addedEdges: [], updatedNodes: [], updatedEdges: [] },
    summary: {},
  });
  const query = {} as ConstructorParameters<typeof RelationGraphService>[0];
  return { graphId, service: new RelationGraphService(query, storage, snapshots) };
}

test("adding members detaches them from the previous investigation group", async () => {
  const { graphId, service } = await serviceWithGraph({
    nodes: ["a", "b", "c", "d", "e"].map((id) => ({ id })),
    edges: [],
    investigationGroups: [
      { id: "group-1", memberNodeIds: ["a", "b"], collapsed: true },
      { id: "group-2", memberNodeIds: ["c", "d", "e"], collapsed: true },
    ],
  });
  const result = await service.applyInvestigationGroup({
    caseId: "37",
    graphId,
    operation: "add_members",
    groupId: "group-1",
    memberNodeIds: ["c"],
  });
  const groups = Object.fromEntries(
    (result.graph.investigationGroups as Array<Record<string, unknown>>).map(
      (group) => [group.id, group],
    ),
  );
  assert.deepEqual(groups["group-1"]?.memberNodeIds, ["a", "b", "c"]);
  assert.deepEqual(groups["group-2"]?.memberNodeIds, ["d", "e"]);
  assert.equal((result.delta.updatedGroups as Array<Record<string, unknown>>)[0]?.id, "group-1");
});

test("ungrouping a collapsed group preserves member positions", async () => {
  const { graphId, service } = await serviceWithGraph({
    nodes: [
      { id: "a", x: 500, y: 100 },
      { id: "b", x: 500, y: 220 },
      { id: "c", x: 500, y: 340 },
    ],
    edges: [],
    layout: {
      nodePositions: {
        a: { x: 500, y: 100 },
        b: { x: 500, y: 220 },
        c: { x: 500, y: 340 },
      },
    },
    investigationGroups: [
      {
        id: "group-1",
        memberNodeIds: ["a", "b", "c"],
        collapsed: true,
        x: 500,
        y: 100,
      },
    ],
  });
  const result = await service.applyInvestigationGroup({
    caseId: "37",
    graphId,
    operation: "ungroup",
    groupId: "group-1",
    options: {
      nodePositions: {
        a: { x: 500, y: 100 },
        b: { x: 500, y: 100 },
        c: { x: 500, y: 340 },
      },
    },
  });
  assert.deepEqual(result.graph.layout.nodePositions, {
    a: { x: 500, y: 100 },
    b: { x: 500, y: 220 },
    c: { x: 500, y: 340 },
  });
  assert.deepEqual(result.graph.investigationGroups, []);
  assert.deepEqual(result.delta.removedGroupIds, ["group-1"]);
});

test("excluded nodes cannot be added to investigation groups", async () => {
  const { graphId, service } = await serviceWithGraph({
    nodes: ["a", "b", "c"].map((id) => ({ id })),
    edges: [],
    excludedNodes: [{ nodeId: "c" }],
  });
  const result = await service.applyInvestigationGroup({
    caseId: "37",
    graphId,
    operation: "create",
    nodeIds: ["a", "b", "c"],
  });
  assert.deepEqual(result.graph.investigationGroups[0]?.memberNodeIds, ["a", "b"]);
});
