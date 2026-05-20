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

### Quick verification

Run the plugin-local verification flow before publishing:

```bash
./scripts/verify-local.sh
```

This runs:

- Python tests
- frontend tests
- frontend build
- Python source compile check

### Static asset sync

If you only rebuilt the frontend and want to refresh the packaged static assets:

```bash
./scripts/sync-static-assets.sh
```

This copies:

- `static/`
- into `src/nanobot_channel_webui/static/`

### Local publish

Run the full local publish flow:

```bash
./scripts/publish-local.sh
```

This flow now does 3 things in order:

1. verify the plugin locally
2. sync static assets into the Python package
3. build and install the latest wheel into the `nanobot-ai` tool environment

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

### PocketBase auth (minimal)

If you want to enable the new account system, run PocketBase separately and add these fields:

```json
{
  "channels": {
    "webui_plugin": {
      "enabled": true,
      "host": "127.0.0.1",
      "port": 8080,
      "mediaSigningSecret": "replace-with-a-stable-random-secret",
      "streaming": true,
      "pocketbaseUrl": "http://127.0.0.1:8090",
      "pocketbaseUsersCollection": "users",
      "pocketbaseSessionsCollection": "chat_sessions"
    }
  }
}
```

Minimal PocketBase requirements:

- use PocketBase built-in auth collection `users`
- create users from the PocketBase admin UI
- add a `role` text field on `users`, value is `admin` or `user`
- create a `chat_sessions` collection for the WebUI plugin

Recommended `chat_sessions` fields:

- `owner` -> relation to `users`
- `chat_id` -> text
- `session_key` -> text
- `title` -> text
- `preview` -> text
- `last_activity_at` -> date

Behavior after enabling PocketBase auth:

- login uses PocketBase built-in auth
- old local sessions are not migrated into the new account system
- the session list is driven by `chat_sessions`
- regular users can only see their own new sessions, uploads and runtime data
- admins can see the full plugin data surface

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

## Release checklist

Recommended order before you test a local release:

```bash
./scripts/verify-local.sh
./scripts/sync-static-assets.sh
./scripts/publish-local.sh
```

If you use `publish-local.sh`, the verify and sync steps are already included.

Not migrated yet:

- dedicated tests for the standalone project
- hardening around upstream runtime drift beyond the current compat shim

Current documentation entry points:

- [docs/README.md](/Users/brian/Documents/Project/nanobot/nanobot-channel-webui/docs/README.md)
- [PRODUCT.md](/Users/brian/Documents/Project/nanobot/nanobot-channel-webui/PRODUCT.md)
- [DESIGN.md](/Users/brian/Documents/Project/nanobot/nanobot-channel-webui/DESIGN.md)

## Planned package layout

```text
nanobot-channel-webui/
  pyproject.toml
  README.md
  docs/
  frontend/
  src/nanobot_channel_webui/
```
