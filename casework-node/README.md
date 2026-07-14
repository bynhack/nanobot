# Casework Node

Node.js/TypeScript implementation of the casework WebUI backend and AgentHarness runtime.
It is organized as an npm-workspaces monorepo; the browser application is the unchanged
Python-version frontend, moved from `frontend/` to `apps/web/`.

The public HTTP, WebSocket, frontend, and persisted graph contracts remain compatible with
`nanobot-channel-webui`. Runtime data is isolated under `~/.casework-node`.

```bash
npm install
npm run verify
npm start
```

The default URL is `http://127.0.0.1:8081`.

Configuration is created at `~/.casework-node/config.json`. It keeps the existing
`agents.defaults`, `providers`, and `channels.webui_plugin` shape. Set the selected
provider/model, API key/base URL, and `caseGraphDb*` fields there. Runtime data is new and
isolated under `~/.casework-node/workspace`; no Python/nanobot runtime data is migrated.
PocketBase is intentionally not connected. Leaving the PocketBase compatibility fields in the
configuration does not enable external account or session persistence; local token authentication
is still available through `authToken`.

## Structure

```text
apps/
  api/                    Fastify composition and feature routes, run by tsx
  web/                    React frontend; Vite outputs to apps/web/dist
packages/
  agent-runtime/          AgentHarness integration and product tools
  case-audit/             audit domain and filesystem storage
  case-graph/             graph domain, state, relations and MySQL queries
  contracts/              HTTP/WebSocket and configuration contracts
  persistence/            sessions, runtime paths and delivered-file workspaces
scripts/
  compare-live-apis.mjs   Python/Node dual-service contract comparison
  smoke-all-apis.mjs      exhaustive Node API acceptance flow
tests/                    backend unit and protocol tests
```

Internal packages export their `src/index.ts` directly. The API runs through `tsx`, while
`tsc --noEmit` is used only for type checking; no package-level `dist` directories are generated.

`npm run verify` runs backend tests, frontend tests, no-emit TypeScript checking and the production
frontend build. With both implementations and the case database running, use
`npm run test:contract`; use `npm run test:api` for the complete mutating Node API acceptance flow.
