# nanobot-channel-webui

`nanobot-channel-webui` is a standalone channel plugin project for `nanobot-ai`.

## Goal

Keep the upstream `nanobot-ai` installation and startup flow unchanged:

- install nanobot with `uv tool install nanobot-ai`
- install this plugin into the same tool environment
- enable `channels.webui_plugin` in `~/.nanobot/config.json`
- start everything with `nanobot gateway`

## Install

From a local checkout during development:

```bash
uv tool install nanobot-ai --with /absolute/path/to/nanobot-channel-webui --force
```

After publishing:

```bash
uv tool install nanobot-ai --with nanobot-channel-webui --force
```

## Local release scripts

Build the frontend, sync packaged static assets, build the wheel, and install it into the
global `nanobot-ai` tool environment:

```bash
./scripts/publish-local.sh
```

If you already built a wheel and only want to reinstall the latest one:

```bash
./scripts/install-last-wheel.sh
```

Minimal config:

```json
{
  "channels": {
    "webui_plugin": {
      "enabled": true,
      "host": "127.0.0.1",
      "port": 8080,
      "mediaSigningSecret": "replace-with-a-stable-random-secret",
      "streaming": true
    }
  }
}
```

## Status

The standalone package now contains the migrated backend plus the current frontend source and built static assets. The original in-repo implementation still exists at:

- `/Users/brian/Documents/Project/nanobot/nanobot_webui`

Already migrated into the standalone package:

- config model
- channel entry and HTTP/WebSocket backend
- protocol helpers
- auth/origin checks
- websocket connection registry
- media URL signing
- upload helpers
- session query/reconstruction helpers
- settings/runtime management helpers
- compatibility runtime shim
- frontend source workspace
- built static assets packaged under `src/nanobot_channel_webui/static`

Not migrated yet:

- dedicated tests for the standalone project
- hardening around upstream runtime drift beyond the current compat shim

The migration plan is documented in:

- [docs/MIGRATION_PLAN.md](/Users/brian/Documents/Project/nanobot/nanobot-channel-webui/docs/MIGRATION_PLAN.md)

## Planned package layout

```text
nanobot-channel-webui/
  pyproject.toml
  README.md
  docs/
  frontend/
  src/nanobot_channel_webui/
```
