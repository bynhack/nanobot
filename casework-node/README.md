# Casework Node

Node.js/TypeScript implementation of the casework WebUI backend and AgentHarness runtime.

The public HTTP, WebSocket, frontend, and persisted graph contracts remain compatible with
`nanobot-channel-webui`. Runtime data is isolated under `~/.casework-node`.

```bash
npm install
npm run build
npm start
```

The default URL is `http://127.0.0.1:8081`.

Configuration is created at `~/.casework-node/config.json`. It keeps the existing
`agents.defaults`, `providers`, and `channels.webui_plugin` shape. Set the selected
provider/model, API key/base URL, and `caseGraphDb*` fields there. Runtime data is new and
isolated under `~/.casework-node/workspace`; no Python/nanobot runtime data is migrated.

The server is one Node process with separate business and agent modules. The existing
frontend is built unchanged and all existing HTTP and WebSocket routes remain available.
