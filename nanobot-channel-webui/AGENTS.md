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

When a change is complete and ready to hand back to the user for review or use, run:

```bash
./scripts/publish-local.sh
```

Treat this as the default final verification and local release step for completed work in this plugin, not an optional extra.

## Static Asset Rules

- Frontend source of truth lives in `frontend/`
- `static/` and `src/nanobot_channel_webui/static/` are generated outputs
- If frontend behavior changes and the package must ship the new UI, rebuild frontend and sync assets
- Avoid hand-editing generated files unless the user explicitly asks for that

## Case-Graph Ground Truth

The earlier "simplified graph only" understanding is stale. Current code has a much closer parity baseline.

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
6. graph layout persistence is partial
   - `graphContent` is stored
   - current canvas rendering still prefers recomputed layout over persisted positions

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
- Prefer updating durable docs when facts change:
  - facts -> `docs/case-graph/current-ga-implementation.md`
  - remaining differences -> `docs/case-graph/nanobot-gap-notes.md`
  - confirmed pending fixes -> `docs/case-graph/pending-fixes.md`
- Do not add new dated plan or release-note documents under `docs/` unless the user explicitly asks for process documentation

## Release Notes For Agents

- This plugin is packaged as a standalone `nanobot.channels` entry-point plugin
- Local install target is still the same upstream `nanobot-ai` tool environment
- If you change frontend assets or package data, make sure the wheel-shipped static directory is updated before calling the work done
- Before presenting a completed modification to the user, run `./scripts/publish-local.sh`
