# AGENTS.md

Project instructions for the standalone `nanobot-channel-webui` plugin. Treat this file as the
primary agent guide for work in this package.

## Project Identity

- This package is a standalone `nanobot.channels` entry-point plugin.
- Scope is this plugin directory: `nanobot-channel-webui/`.
- Prefer changes inside this plugin subtree unless the user explicitly asks for cross-repo work.
- Frontend source lives in `frontend/`; Python/backend source lives in `src/nanobot_channel_webui/`.
- Built UI assets are generated into `static/` and then synced into
  `src/nanobot_channel_webui/static/` for the wheel.

## Never Rules

- Treat this file as the plugin project's primary instruction file.
- Never use older implementations such as `/Users/brian/Documents/Projects/nanobot/webui` or
  `/Users/brian/Documents/Projects/skyable` as default reference baselines. Inspect them only when
  the user explicitly asks for historical comparison or migration archaeology.
- Never run browser testing just because a browser is open, a localhost URL exists, or frontend code
  changed. Follow the Browser Verification rules below.
- Never add tests, use test-driven workflow, or run broad test suites mechanically for simple
  localized changes.
- Never hand-edit generated static assets unless the user explicitly asks for that.
- Never rely on a bare `nanobot` command for gateway startup without checking `which nanobot`; this
  machine can have an older Anaconda executable on PATH.
- Never add or revive original-implementation parity trackers unless the user explicitly asks for
  historical comparison.
- Never add dated plan or release-note documents under `docs/` unless the user explicitly asks for
  process documentation.

## Read First

Before changing behavior, read these in order:

1. `README.md`
2. `PRODUCT.md`
3. `DESIGN.md`
4. `docs/README.md`
5. `docs/case-graph/README.md`
6. `docs/case-audit/README.md`

For case-graph work, also read:

1. `docs/case-graph/feature-tracker.md`
2. `docs/case-graph/pending-fixes.md`

For case-audit work, also read:

1. `docs/case-audit/feature-tracker.md`
2. `docs/case-audit/pending-fixes.md`
3. `docs/case-audit-amount-recognition.md`

Do not use the old Ga-web / skyable-cloud implementation as a parity target unless the user explicitly
asks for historical comparison. Some original behavior is known to be flawed; current planning should be
based on this package's product goals, current code, process files, and user workflow.

For case-graph layout, drill, relation-extension, persistence, or replay work, also inspect the
current process files under:

1. `~/.nanobot/workspace/.nanobot_channel_webui/case_graphs/**/graph.json`
2. `~/.nanobot/workspace/.nanobot_channel_webui/case_graphs/**/steps/*.json`
3. `~/.nanobot/workspace/.nanobot_channel_webui/case_graphs/**/facts/trades.jsonl`

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
- `src/nanobot_channel_webui/case_audit/`
  - 涉诈资金审计 backend service and file-based audit storage
- `frontend/`
  - Vite React frontend source
- `frontend/src/case-graph/`
  - case-graph UI, adapters, types, workbench, graph canvas
- `frontend/src/case-audit/`
  - 涉诈资金审计 UI, adapters, types, and amount-recognition graph
- `frontend/src/components/ui/`
  - reusable UI foundations such as modal and select controls
- `static/`
  - local built static assets
- `src/nanobot_channel_webui/static/`
  - packaged static assets shipped in the wheel
- `scripts/`
  - local verify, sync, publish helpers
- `tests/`
  - plugin-local Python tests

## Verification Policy

Testing is risk-based, not mechanical. Do not run Python or frontend tests after every edit by
default; choose the smallest useful verification based on the change.

Test case coverage should focus on core product invariants, not exhaustive implementation details.
Prefer a few high-signal tests that protect business behavior over many narrow tests that only
lock the current code shape.

Before adding or running tests, make an explicit risk judgment. Simple, localized changes should
usually be verified by code inspection, type/build feedback already produced by the touched tool,
or a focused manual check instead of adding new test cases. Browser checks must follow the Browser
Verification rules below. Do not use test-driven workflow or create new test cases for small
implementation fixes, visual tweaks, interaction configuration changes, copy updates, or
straightforward bug fixes unless the change protects a durable product invariant or prevents a
regression that is hard to verify manually.

Avoid redundant verification. If `./scripts/publish-local.sh` will be run for a completed runtime
change, do not also run standalone `npm test`, `npm run build`, or Python test commands first unless
there is a specific risk that the publish script will not isolate well enough. When standalone
verification is justified, run the narrowest relevant command and do not stack multiple overlapping
test/build commands by default.

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
- official library behavior or configuration wiring that can be confirmed by documentation and a
  focused manual check
- every invalid input permutation when one representative validation path is enough
- internal helper implementation details that are already covered through a workflow test
- duplicate frontend and backend assertions for the same contract unless both sides have distinct risk

## Browser Verification

Browser testing is opt-in by default. Do not use the in-app browser merely because a browser tab is
open, a localhost URL is available, or a frontend file changed. Use browser testing only when the
user explicitly asks for browser verification, asks to inspect what is currently visible, reports a
browser-only issue that cannot be diagnosed from code/logs, or when a significant visual/interactive
change truly needs live confirmation before handoff. In the last case, say why browser verification
is needed before doing it, keep the check narrowly scoped, and do not turn it into broad acceptance
testing.

For simple frontend fixes, configuration changes, copy changes, documentation changes, and small
interaction wiring changes, prefer code inspection plus the required build/publish outcome, then let
the user perform manual acceptance in their browser. Do not use browser testing as a substitute for
risk judgment, and do not add automated tests just because browser testing was skipped.

## Commands

Use these from `nanobot-channel-webui/` only when the verification policy above says they are
justified.

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

## Local Publish

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

If a runtime change touches Python backend code, routes, service logic, entry points, packaged
backend data, or anything the running `nanobot gateway` process loads at startup, restart the local
service after `./scripts/publish-local.sh` before saying the work is ready. If the change is
frontend-only, publishing the rebuilt static assets is enough; do not use browser testing unless the
Browser Verification rules allow it.

When starting or restarting the backend gateway, run it in `tmux`, not as a foreground tool session,
`nohup` background job, or shell job that Codex cannot later inspect. Prefer a stable session name,
for example `nanobot-gateway`, so later turns can check logs, stop, or restart the service without
leaving orphaned processes.

On this machine, prefer this executable when starting the gateway:

```bash
/Users/brian/.local/bin/nanobot gateway --config ~/.nanobot/config.json
```

Do not rely on a bare `nanobot` command without checking `which nanobot`; Anaconda may provide an
older executable that starts the gateway without loading this WebUI plugin.

Do not run extra standalone test passes before `publish-local.sh` unless the risk justifies it;
the publish script already includes local verification. For small documentation-only changes,
state that no runtime tests or local publish were needed.

## Static Asset Rules

- Frontend source of truth lives in `frontend/`
- `static/` and `src/nanobot_channel_webui/static/` are generated outputs
- If frontend behavior changes and the package must ship the new UI, rebuild frontend and sync assets
- Avoid hand-editing generated files unless the user explicitly asks for that

## Case-Graph Ground Truth

The earlier "simplified graph only" understanding is stale. Current code has a richer product baseline.

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
- every relation graph operation appends a step snapshot under `steps/*.json`
- graph conversation context uses the same relation graph state as ground truth: it should point to the canonical `graph.json`, `steps` directory, latest step metadata, graph stats, focus, and chat id
- after relation graph operations, the frontend can invoke the right-side "图谱研判副驾" conversation through the "图谱研判助手" skill to explain the latest step in Chinese investigation language
- "图谱研判助手" and "资金流水查询助手" are complementary but separate: the graph skill reads saved graph facts and explains graph steps; the database skill queries and verifies database facts from explicit case/subject/account/trade identifiers, and must not directly read graph state or mutate database state
- imported bank/payment transaction rows are account-first evidence: transaction records may lack payer/payee names, and investigator-entered suspect names are linked through case account records; database skill/query logic should resolve suspect names to account ids/pay accounts first, query transactions by those account identifiers, and only use account-table names to enrich display output
- transaction direction for investigation should be derived from payer/payee endpoints; `jd_flag` is an imported raw-flow field and must not be treated as the primary subject inflow/outflow direction
- relation edges carry `tradeIds`, and relation query/detail-analysis flows persist transaction facts in `facts/trades.jsonl`; runtime graph loading hydrates these facts back into `graph.tradeFacts` for existing filtering and detail logic
- `/api/case-graph/relation/filter` is full-graph filtering over the current graph projection; it must use persisted fact-file transactions and `edge.tradeIds` to recalculate edges, not query the database again
- `/api/case-graph/relation/exclude-trades` applies detail-analysis trade exclusions from persisted facts and appends a `detail_trade_filter` step without re-querying graph relations
- graph steps can be replayed in the frontend through the custom replay panel; historical preview is read-only, and selecting the latest step returns to the current graph state
- graph step transitions use G6 animation/reveal state, and stale hover/click/reveal states must be cleared at render-cycle boundaries
- node cancellation is implemented for single and multi-node selections, with excluded-node state persisted in relation graph snapshots and steps
- graph layout positions are stored in `graph.layout.nodePositions`
- `graphStateToCanvasData(...)` applies stored layout positions back onto canvas nodes during load
- `computeCaseGraphLayout(...)` prefers persisted positions when coverage is sufficient, before falling back to structured layout
- normal layout callbacks must not persist a full graph layout operation; explicit drag persists through `/operations/layout`
- after relation operations, the latest step layout can be patched through `/operations/latest-step-layout` so the step snapshot reflects the rendered positions

### Current verified gaps

These are still real unless code and docs are updated together:

1. `phone` is still unimplemented in practice
   - backend currently returns `phone: []`
2. `excludedTrades` is not auto-repaired or pruned when the current graph node set changes
3. `summarySelected*` and `excludedAccountName` are legacy fields without a current product decision or full frontend loop
4. several graph actions are still missing as usable entry points
   - cancel group
   - summary analysis
   - fund relation graph
5. detail analysis is usable, but evidence export and restore for fully removed detail-filter edges are not implemented yet
6. group support exists for query/render/detail resolution, but not the full current product regroup/ungroup interaction model
7. full canvas persistence is still partial
   - current relation graph state already persists `graph.layout.nodePositions`
   - current canvas load path can restore persisted node coordinates
   - custom historical step preview exists, but restoring/resetting the current graph to an arbitrary historical step is not implemented
   - non-relation canvas elements and complete reset/restore are not implemented yet
8. conversation-to-graph operation is not implemented yet
   - current "图谱研判副驾" reads graph facts and explains/suggests
   - direct chat commands that execute filter, drill, exclude, restore, or other graph operations still need a structured action protocol

### Important implementation details

- For unchanged selection (`isSelectedTradeCardChanged == false`), `sourceSelectId` is restored from stored graph state, not Redis
- `summarySelectedAccountId` is already consumed by the backend query path, but the current product has not decided whether to keep that legacy-style flow
- `excludedAccountName` is already consumed by backend filtering, but the current product has node-level exclude/restore through `excludedNodes`
- The frontend workbench already maintains:
  - `queryBaselineTradeCards`
  - `groupMap`
  - `sourceSelectId`
  - `excludedTrades`
  - `excludedAccountId`
  - `excludedNodes`
  - loaded graph step snapshots for read-only replay
- Drill flows are currently:
  1. call drill API
  2. merge returned `tradeCards`
  3. re-run main query
- Relation-analysis flows are currently:
  1. send current `nodePositions` in relation request options
  2. merge returned graph data into the current positioned graph
  3. persist/patch the latest step layout after render
  4. keep existing node coordinates stable while positioning new nodes

### G6 graph interaction details

- Prefer official G6 behaviors/plugins for graph interactions, but treat hover/click states as transient lifecycle state that must end at the source. Context menus, drill actions, data replacement, graph replay, and render transitions should explicitly terminate or suppress active `hover-activate` / `click-select` state before changing graph data.
- Do not rely on delayed DOM cleanup loops to fix stale interaction visuals. If cleanup is needed, it should be tied to the interaction boundary (`contextmenu`, canvas click, drill start, `setData` / `render`) and should clear G6 element states before the next graph data render whenever possible.
- G6 `html` nodes render user markup inside a G6-owned wrapper element. Official state styles such as `opacity` and `zIndex` may be written to that wrapper, not to `.case-graph-g6-node`; verification and cleanup must inspect the wrapper computed/inline style as well as the inner node classes.
- Keep official transient interaction states separate from business focus state. Clearing hover/click should affect G6 states like `highlight`, `dim`, `click-highlight`, and `click-dim`; clearing user focus/selection should be handled through the canvas focus state (`activeNodeId`, `activeEdgeId`, `selectedNodeIds`, role filters) and the corresponding node render data.
- When browser verification is explicitly requested or justified under the Browser Verification rules,
  graph interaction checks should cover the real flow that can strand state: hover a node, open the
  G6 context menu, run drill/extension, and assert both inner classes and wrapper opacity/z-index
  return to the expected state after render. Checking only `.case-graph-g6-node` classes is not
  sufficient for HTML-node visual bugs.

### Case-graph interaction design principles

Case-graph interactions should be designed for police investigators who can use the system without training. The graph should make the next available action visible in the current context instead of requiring users to memorize hidden entry points.

- Prefer visible contextual actions over hidden-only interactions. Right-click menus may remain as expert shortcuts, but important graph actions should also have a visible entry point near the selected node, edge, canvas selection, or current work area.
- Selection should explain what can be done next. Clicking a node, clicking an edge, or selecting multiple nodes should reveal a compact contextual action bar or equivalent UI that names the selected object count and the most relevant actions.
- Contextual actions must match object state. Normal nodes, excluded nodes, edges, excluded trades, empty canvas, and multi-selection should expose different action sets. For example, an excluded node should only offer recovery-oriented actions, not relation creation or drill actions.
- Destructive or graph-changing operations should preview their impact before execution when the effect is not obvious. Copy should describe how many subjects, money lines, or transaction facts will be affected and whether the action can be restored.
- Recovery should be available where the excluded item is encountered. If the graph can show excluded nodes, those nodes should provide a restore action there; if transaction details show excluded trades, those rows should support restoring them there. A global exclusion manager can exist as an overview, not the only recovery path.
- Keep right-click menus and visible action bars behaviorally aligned. A core action should not exist only in one place unless there is a clear product reason.
- Empty, loading, selected, filtered, excluded, and replay states should include concise Chinese guidance that tells investigators what the current state means and what they can do next.
- Avoid turning the graph into a dense toolbar surface. Show only the actions that are relevant to the current selection and investigation state; put secondary actions behind a "more" entry only when needed.

### User-facing language

- This product is ultimately for police investigators handling cases. User-facing page copy should be Chinese and should use investigation-oriented wording that helps officers understand the task, evidence, subject, account, transaction, and clue being handled.
- Do not expose internal identifiers, API names, step types, implementation names, or English fallback labels in the interface. Examples such as `detail_trade_filter`, `seed_one_hop`, or raw provider/runtime terms should be mapped to clear Chinese labels at the UI boundary.
- Technical identifiers may remain in code, tests, logs, JSON keys, filesystem paths, and machine-value examples when they are actual values the system must store or accept. Avoid adding English to visible labels, buttons, status text, empty states, tooltips, and modal copy unless the string is an unavoidable product or protocol name.

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
  - feature status and planning view -> `docs/case-graph/feature-tracker.md`
  - confirmed pending fixes and open decisions -> `docs/case-graph/pending-fixes.md`
- When an implementation completes, removes, renames, defers, or materially changes a feature, update the relevant fact files in the same turn. Do not leave older design, gap, pending-fix, or feature-tracker entries describing the previous state.
- If a change invalidates an earlier design or planning assumption, rewrite the durable fact/tracker entry instead of adding a dated note that competes with it.
- Do not add or revive original-implementation parity trackers unless the user explicitly asks for historical comparison.
- Do not add new dated plan or release-note documents under `docs/` unless the user explicitly asks for process documentation.
