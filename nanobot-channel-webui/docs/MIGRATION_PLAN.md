# Migration Plan

## Objective

Turn the current in-repo WebUI implementation into an external `nanobot.channels` plugin package without changing upstream nanobot core code.

## Target runtime model

1. User installs upstream nanobot:
   - `uv tool install nanobot-ai`
2. User installs the plugin into the same tool environment:
   - `uv tool install nanobot-ai --with nanobot-channel-webui --force`
3. User enables `channels.webui_plugin` in config.
4. User starts with:
   - `nanobot gateway`

## Migration principles

- Do not modify upstream nanobot core for plugin support.
- Do not reuse the upstream `webui` channel key in the standalone package because that would require upstream to drop its own registration first.
- Depend on public nanobot channel/plugin contracts first.
- Isolate private runtime coupling into a narrow `compat` layer.
- Keep WebUI-only HTTP, WebSocket, sessions, uploads, and settings inside the plugin package.

## Source-to-target mapping

Current implementation source:

- `/Users/brian/Documents/Project/nanobot/nanobot_webui/channel.py`
- `/Users/brian/Documents/Project/nanobot/nanobot_webui/protocol.py`
- `/Users/brian/Documents/Project/nanobot/nanobot_webui/runtime.py`
- `/Users/brian/Documents/Project/nanobot/nanobot_webui/auth.py`
- `/Users/brian/Documents/Project/nanobot/nanobot_webui/connections.py`
- `/Users/brian/Documents/Project/nanobot/nanobot_webui/sessions.py`
- `/Users/brian/Documents/Project/nanobot/nanobot_webui/media.py`
- `/Users/brian/Documents/Project/nanobot/nanobot_webui/uploads.py`
- `/Users/brian/Documents/Project/nanobot/nanobot_webui/management.py`
- `/Users/brian/Documents/Project/nanobot/nanobot_webui/frontend/`
- `/Users/brian/Documents/Project/nanobot/nanobot_webui/static/`

Target package layout:

```text
src/nanobot_channel_webui/
  __init__.py
  channel.py
  config.py
  protocol.py
  auth.py
  connections.py
  sessions.py
  media.py
  uploads.py
  management.py
  compat/
    __init__.py
    runtime.py
  static/
```

## Phases

### Phase 1: Project scaffold

- Create standalone package metadata.
- Register `nanobot.channels` entry point.
- Add docs and migration map.

Status:
- completed

### Phase 2: Pure module migration

- Move protocol/auth/connections/media/uploads modules first.
- Keep imports package-local.
- Avoid behavior changes.

Status:
- completed for `protocol.py`, `auth.py`, `connections.py`, `media.py`, `uploads.py`
- also completed for `sessions.py` and `management.py`

### Phase 3: Channel entry migration

- Move `WebUIConfig`, `WebUIHook`, and `WebUIChannel`.
- Split config into `config.py`.
- Keep `send()` / `send_delta()` and `_handle_message()` contract intact.

Status:
- completed
- `WebUIConfig`, `WebUIHook`, and `WebUIChannel` moved into the standalone package

### Phase 4: Runtime compatibility layer

- Move `runtime.py` under `compat/`.
- Keep all runtime coupling inside the plugin package.
- Treat hook/loop attachment as an enhancement, not a startup requirement.
- Allow degraded mode if upstream internals drift.

Status:
- initial compat shim migrated under `compat/runtime.py`
- degraded startup behavior is in place when runtime attachment is unavailable
- compat shim is being hardened in-plugin rather than by modifying upstream core

### Phase 5: Frontend and static packaging

- Copy frontend source into `frontend/`.
- Define a build step that emits package-owned static assets.
- Package built artifacts into the wheel.

Status:
- current frontend source copied into `frontend/`
- current built static assets copied into `src/nanobot_channel_webui/static/`
- wheel build verified to contain the static bundle

### Phase 6: Verification

- Install via `uv tool install nanobot-ai --with /path/to/project --force`
- run `nanobot plugins list`
- enable `channels.webui_plugin`
- run `nanobot gateway`

Current verification evidence:

- `python3 -m compileall nanobot-channel-webui/src` passes
- `uv build nanobot-channel-webui` produces sdist and wheel
- built wheel contains `nanobot_channel_webui/static/index.html` and packaged assets
- editable install into the project virtualenv registers the `webui_plugin` entry point
- `nanobot plugins list` shows `Web UI Plugin` as a plugin entry
- `ChannelManager` loads `channels.webui_plugin` into `nanobot_channel_webui.channel.WebUIChannel`
- direct channel smoke test starts the server and serves `GET /` with HTTP 200

## Open decisions

- Whether to keep frontend source in the plugin repo or publish prebuilt static assets only.
- Whether to vendor the current settings APIs unchanged or narrow them before migration.
- Whether to expose a separate dev script for frontend build/watch.
