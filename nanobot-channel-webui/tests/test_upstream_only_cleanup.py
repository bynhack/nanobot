from __future__ import annotations

from pathlib import Path

from aiohttp import web

from nanobot_channel_webui.channel import WebUIChannel


ROOT = Path(__file__).resolve().parents[1]


def test_control_plane_no_longer_registers_local_conversation_routes() -> None:
    channel = WebUIChannel.__new__(WebUIChannel)

    app = channel._create_app(web)
    registered = {
        (route.method, route.resource.canonical)
        for route in app.router.routes()
    }

    assert ("GET", "/ws") not in registered
    assert ("GET", "/sessions") not in registered
    assert ("DELETE", "/sessions/{chat_id}") not in registered
    assert ("GET", "/api/upstream/bootstrap") in registered
    assert ("GET", "/api/upstream/sessions") in registered
    assert ("GET", "/api/upstream/sessions/{chat_id}/webui-thread") in registered
    assert ("DELETE", "/api/upstream/sessions/{chat_id}") in registered
    assert ("GET", "/api/upstream/ws/{instance_id}") in registered
    assert ("GET", "/health") in registered


def test_frontend_uses_upstream_gateway_without_local_fallback_commands() -> None:
    frontend_sources = [
        ROOT / "frontend/src/ws-client.ts",
        ROOT / "frontend/src/use-websocket-session.ts",
        ROOT / "frontend/src/api.ts",
    ]
    source = "\n".join(path.read_text(encoding="utf-8") for path in frontend_sources)

    for forbidden in (
        "host}/ws",
        '"/ws"',
        "'/ws'",
        "fetch('/sessions'",
        "fetch(`/sessions/",
        "message.send",
        "message.cancel",
        "session.new",
        "session.switch",
        "upstreamEnabled",
        "isUpstreamGatewayEnabled",
    ):
        assert forbidden not in source

    for required in (
        "/api/upstream/bootstrap",
        "/api/upstream/sessions",
        "new URL(rawUrl, window.location.href)",
        "url.protocol = 'wss:'",
        "webui_token",
        "new_chat",
        "message",
        "attach",
        "/stop",
    ):
        assert required in source


def test_deprecated_local_channel_helper_modules_are_removed() -> None:
    for module in (
        ROOT / "src/nanobot_channel_webui/connections.py",
        ROOT / "src/nanobot_channel_webui/protocol.py",
        ROOT / "src/nanobot_channel_webui/sessions.py",
        ROOT / "src/nanobot_channel_webui/turns.py",
    ):
        assert not module.exists()
