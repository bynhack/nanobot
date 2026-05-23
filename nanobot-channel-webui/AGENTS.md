# AGENTS.md

This file supplements the repository-level `../AGENTS.md` for work inside `nanobot-channel-webui/`.

## Scope

- Applies only to `nanobot-channel-webui/`
- Prefer changes inside this plugin subtree unless the user explicitly asks for cross-repo work
- Treat `/Users/brian/Documents/Project/nanobot/nanobot_webui` as the old in-repo implementation and reference surface, not the primary edit target for this package

## Read First

Before changing behavior, read these in order:

1. `README.md`
2. `PRODUCT.md`
3. `DESIGN.md`
4. `docs/README.md`
5. `docs/case-graph/README.md`

For case-graph parity work, also read:

1. `docs/case-graph/current-ga-implementation.md`
2. `docs/case-graph/nanobot-gap-notes.md`
3. `docs/case-graph/pending-fixes.md`
4. `docs/case-graph/real-example/query-payload.json`
5. `docs/case-graph/real-example/query-response.json`

For case-graph layout, drill, relation-extension, persistence, or replay work, also inspect the
current process files under:

1. `~/.nanobot/workspace/.nanobot_channel_webui/case_graphs/**/graph.json`
2. `~/.nanobot/workspace/.nanobot_channel_webui/case_graphs/**/steps/*.json`

These files are the best local evidence for how every analysis step preserves the graph structure
and layout positions over time.

For graph page capabilities, prefer official G6 features first. Before implementing custom graph
canvas behavior, check whether G6 already provides the needed layout, behavior, plugin, event,
interaction, drag, selection, context menu, zoom, or viewport capability. Custom code should mainly
adapt business data, preserve investigation state, or fill gaps that G6 does not cover.

Do not rely on deleted dated plan/design notes. The current docs directory is an index plus durable facts only.

## Project Layout

- `src/nanobot_channel_webui/`
  - Python package entrypoint and backend
- `src/nanobot_channel_webui/channel.py`
  - HTTP routes, WebSocket handling, auth wiring
- `src/nanobot_channel_webui/case_graph/`
  - case-graph backend service, storage, MySQL query client, types
- `frontend/`
  - Vite React frontend source
- `frontend/src/case-graph/`
  - case-graph UI, adapters, types, workbench, graph canvas
- `static/`
  - local built static assets
- `src/nanobot_channel_webui/static/`
  - packaged static assets shipped in the wheel
- `scripts/`
  - local verify, sync, publish helpers
- `tests/`
  - plugin-local Python tests

## Build And Test

Testing is risk-based, not mechanical. Do not run Python or frontend tests after every edit by
default; choose the smallest useful verification based on the change.

Test case coverage should focus on core product invariants, not exhaustive implementation details.
Prefer a few high-signal tests that protect business behavior over many narrow tests that only
lock the current code shape.

Skip tests for simple documentation, copy, comment-only, README, AGENTS, PRODUCT, or docs index
changes that do not affect installed runtime behavior.

Use targeted tests when a change affects a specific Python service, frontend component, adapter,
store, or case-graph workflow. Prefer the narrowest relevant test command over the full suite.

Use broader verification when a change touches cross-cutting contracts, persistence formats,
case-graph layout/state, frontend build output, package data, auth/session behavior, or release
scripts.

When adding or pruning tests, keep these as core coverage:

- case-graph query and relation state contracts
- graph step persistence and `graph.layout.nodePositions`
- the invariant that existing graph node positions do not move during drill/extend/filter/load
- assistant-ui message/runtime conversion at integration boundaries
- workspace/session ownership and stale-request protection
- packaging/static asset behavior needed for local publish

Avoid expanding tests just to cover:

- purely visual copy or button placement that is not a product invariant
- every invalid input permutation when one representative validation path is enough
- internal helper implementation details that are already covered through a workflow test
- duplicate frontend and backend assertions for the same contract unless both sides have distinct risk

From `nanobot-channel-webui/`:

```bash
pytest tests/test_case_graph_service.py -q
pytest tests/test_case_graph_storage.py -q
pytest tests/test_pocketbase_client.py -q
pytest tests/test_runtime_compat.py -q
```

From `nanobot-channel-webui/frontend/`:

```bash
npm test
npm run build
```

Full local verification flow:

```bash
./scripts/verify-local.sh
./scripts/sync-static-assets.sh
./scripts/publish-local.sh
```

When the user asks for a modification or new requirement and the request is clear and complete,
execute it end-to-end instead of stopping at a plan. For any complete feature implementation,
behavior change, frontend change, backend change, packaging change, or static-asset change that is
ready to hand back to the user for review or use, run:

```bash
./scripts/publish-local.sh
```

Treat this as the default final verification and local release step for completed work in this
plugin, not an optional extra. After it succeeds, explicitly tell the user that the local publish
has completed and that they can test it locally.

Do not run extra standalone test passes before `publish-local.sh` unless the risk justifies it;
the publish script already includes local verification. For small documentation-only changes,
state that no runtime tests or local publish were needed.

## Static Asset Rules

- Frontend source of truth lives in `frontend/`
- `static/` and `src/nanobot_channel_webui/static/` are generated outputs
- If frontend behavior changes and the package must ship the new UI, rebuild frontend and sync assets
- Avoid hand-editing generated files unless the user explicitly asks for that

## Case-Graph Ground Truth

The earlier "simplified graph only" understanding is stale. Current code has a much closer parity baseline.

### Case-graph layout invariant

This is a hard product rule: graph node positions are part of the user's saved investigation work,
not disposable render output.

- Every case-graph structure and every relation-analysis step must preserve existing graph layout positions.
- Future code changes must not move, normalize, re-center, reflow, or recompute positions for existing nodes during load, refresh, query, drill, filter, merge, render, publish, or replay.
- Stored positions from `graph.layout.nodePositions`, node-level `x/y`, and legacy `graphContent` coordinates are authoritative for existing nodes.
- Layout logic may only assign coordinates to newly added nodes or nodes with genuinely missing/invalid coordinates.
- Existing nodes may be moved only by an explicit user action whose purpose is to change layout, such as dragging a node or invoking a future manual relayout/reset-layout command.
- If an official G6 layout or graph behavior is introduced, use the official capability in an incremental/fixed-node mode where relevant: existing nodes are fixed anchors, and only new/missing-position nodes are placed around the current graph.
- Drill and relation-completion flows must carry the current rendered `nodePositions` into the request and must merge results without changing any previously positioned node.
- Tests for graph extension or layout changes should assert that pre-existing node `x/y` coordinates remain unchanged after the operation.

### Current verified facts

- `/api/case-graph/query` returns:
  - `nodes`
  - `money`
  - `phone`
  - `excludedTrades`
  - `groups`
  - `sourceSelectId`
- query results are persisted back into graph state as `graphData`, `groupMap`, and `sourceSelectId`
- graph snapshots can store:
  - `graphContent`
  - `groupMap`
  - `graphData`
  - `excludedTrades`
  - `excludedAccountId`
  - `excludedAccountName`
  - `summarySelectedAccountId`
  - `summarySelectedAccountName`
  - `sourceSelectId`
  - `minAmount`
  - `maxAmount`
- drill APIs exist separately:
  - `/api/case-graph/query/drilldown`
  - `/api/case-graph/query/drillup`
  - `/api/case-graph/query/drill`
- target detail now supports `payerCards` and `payeeCards`
- relation graph state uses `case_graphs/{caseId}/{graphId}/graph.json` as the authoritative current projection
- every relation graph operation appends a complete step snapshot under `steps/*.json`
- graph layout positions are stored in `graph.layout.nodePositions`
- `graphStateToCanvasData(...)` applies stored layout positions back onto canvas nodes during load
- `computeCaseGraphLayout(...)` prefers persisted positions when coverage is sufficient, before falling back to structured layout
- normal layout callbacks must not persist a full graph layout operation; explicit drag persists through `/operations/layout`
- after relation operations, the latest step layout can be patched through `/operations/latest-step-layout` so the step snapshot reflects the rendered positions

### Current verified gaps

These are still real unless code and docs are updated together:

1. `phone` is still unimplemented in practice
   - backend currently returns `phone: []`
2. `excludedTrades` is not auto-repaired against the current node set the way the original system does
3. the frontend does not yet provide the original summary-analysis and excluded-account-name interaction loop
4. several context-menu actions are still disabled placeholders
   - cancel uplink
   - cancel group
   - detail analysis
   - summary analysis
   - fund relation graph
5. group support exists for query/render/detail resolution, but not the full original regroup/ungroup interaction model
6. original full canvas serialization is still partial
   - current relation graph state already persists `graph.layout.nodePositions`
   - current canvas load path can restore persisted node coordinates
   - original `graphContent`-based full canvas cell serialization, complex canvas elements, and arbitrary-step replay/reset are not fully replicated yet

### Important implementation details

- For unchanged selection (`isSelectedTradeCardChanged == false`), `sourceSelectId` is restored from stored graph state, not Redis
- `summarySelectedAccountId` is already consumed by the backend query path
- `excludedAccountName` is already consumed by backend filtering, even though frontend entry points are still incomplete
- The frontend workbench already maintains:
  - `queryBaselineTradeCards`
  - `groupMap`
  - `sourceSelectId`
  - `excludedTrades`
  - `excludedAccountId`
- Drill flows are currently:
  1. call drill API
  2. merge returned `tradeCards`
  3. re-run main query
- Relation-analysis flows are currently:
  1. send current `nodePositions` in relation request options
  2. merge returned graph data into the current positioned graph
  3. persist/patch the latest step layout after render
  4. keep existing node coordinates stable while positioning new nodes

## Editing Guidance

- Keep backend contract changes synchronized across:
  - `frontend/src/case-graph/types.ts`
  - `frontend/src/case-graph/adapters.ts`
  - `src/nanobot_channel_webui/case_graph/types.py`
  - `src/nanobot_channel_webui/case_graph/service.py`
  - `src/nanobot_channel_webui/case_graph/mysql_client.py`
- When changing case-graph behavior, verify both:
  - persisted graph snapshot shape
  - query response shape
- When changing case-graph layout, drill, relation-extension, restore, filter, or load behavior, verify:
  - existing node coordinates are preserved across the operation
  - only new or missing-position nodes receive generated coordinates
  - `graph.json` and the latest relevant `steps/*.json` retain the expected `graph.layout.nodePositions`
- When changing graph page behavior, prefer G6 official APIs/plugins/behaviors/layouts before adding custom canvas logic; document any custom fallback reason in code or docs when the choice is not obvious
- Prefer updating durable docs when facts change:
  - facts -> `docs/case-graph/current-ga-implementation.md`
  - remaining differences -> `docs/case-graph/nanobot-gap-notes.md`
  - confirmed pending fixes -> `docs/case-graph/pending-fixes.md`
- Do not add new dated plan or release-note documents under `docs/` unless the user explicitly asks for process documentation

## Release Notes For Agents

- This plugin is packaged as a standalone `nanobot.channels` entry-point plugin
- Local install target is still the same upstream `nanobot-ai` tool environment
- If you change frontend assets or package data, make sure the wheel-shipped static directory is updated before calling the work done
- Before presenting a completed feature implementation or runtime/UI behavior modification to the user, run `./scripts/publish-local.sh`
- After local publish succeeds, say so directly so the user knows they can perform manual acceptance testing
- If the change is documentation-only and does not affect the installed runtime, say that explicitly; otherwise publish locally before handing back
- Do not mechanically run Python/frontend tests for simple changes; use judgment and pick targeted verification only when it provides real confidence
