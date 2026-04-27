from __future__ import annotations

import asyncio
from datetime import datetime
from unittest.mock import AsyncMock, patch

import pytest
import pytest_asyncio

from nanobot.agent.hook import AgentHookContext
from nanobot.bus.events import InboundMessage
from nanobot.bus.queue import MessageBus
from nanobot.session.manager import SessionManager
from nanobot_webui.channel import WebUIChannel, WebUIHook
from nanobot_webui.connections import ConnectionRegistry
from nanobot_webui.protocol import parse_client_command
from nanobot_webui.runtime import pop_route_context, push_route_context
from nanobot_webui.sessions import SessionQueryService, session_key_for

try:
    from aiohttp import web
    from aiohttp.client_exceptions import WSServerHandshakeError
    from aiohttp.test_utils import TestClient, TestServer

    HAS_AIOHTTP = True
except ImportError:
    HAS_AIOHTTP = False

pytest_plugins = ("pytest_asyncio",)


@pytest_asyncio.fixture
async def aiohttp_client():
    clients: list[TestClient] = []

    async def _make_client(app):
        client = TestClient(TestServer(app))
        await client.start_server()
        clients.append(client)
        return client

    try:
        yield _make_client
    finally:
        for client in clients:
            await client.close()


@pytest.fixture
def workspace(tmp_path):
    return tmp_path


@pytest.fixture
def channel(workspace):
    ch = WebUIChannel(
        {
            "enabled": True,
            "title": "Test WebUI",
            "authToken": "secret-token",
            "allowedOrigins": ["http://allowed.test"],
        },
        MessageBus(),
    )
    ch._sessions = SessionQueryService(workspace=workspace)
    return ch


def _save_session(workspace, chat_id: str, *, user_text: str = "hello") -> None:
    manager = SessionManager(workspace)
    session = manager.get_or_create(session_key_for(chat_id))
    session.messages = [
        {
            "role": "user",
            "content": user_text,
            "timestamp": datetime(2026, 4, 2, 12, 0, 0).isoformat(),
        },
        {
            "role": "assistant",
            "content": "hi there",
            "timestamp": datetime(2026, 4, 2, 12, 0, 1).isoformat(),
        },
    ]
    session.created_at = datetime(2026, 4, 2, 12, 0, 0)
    manager.save(session)


def _save_session_with_user_attachment(workspace, chat_id: str) -> None:
    manager = SessionManager(workspace)
    session = manager.get_or_create(session_key_for(chat_id))
    session.messages = [
        {
            "role": "user",
            "content": "please review\n\n[file: demo.pdf]\n[File: source: /tmp/demo.pdf]",
            "timestamp": datetime(2026, 4, 2, 12, 0, 0).isoformat(),
        },
        {
            "role": "assistant",
            "content": "ok",
            "timestamp": datetime(2026, 4, 2, 12, 0, 1).isoformat(),
        },
    ]
    session.created_at = datetime(2026, 4, 2, 12, 0, 0)
    manager.save(session)


@pytest.mark.skipif(not HAS_AIOHTTP, reason="aiohttp not installed")
@pytest.mark.asyncio
async def test_sessions_endpoint_uses_saved_metadata(aiohttp_client, channel, workspace) -> None:
    chat_id = "11111111-1111-1111-1111-111111111111"
    _save_session(workspace, chat_id, user_text="metadata preview text")

    client = await aiohttp_client(channel._create_app(web))
    resp = await client.get(
        "/sessions",
        headers={"Authorization": "Bearer secret-token", "Origin": "http://allowed.test"},
    )

    assert resp.status == 200
    body = await resp.json()
    assert body == [
        {
            "chat_id": chat_id,
            "session_key": f"webui:{chat_id}",
            "channel": "webui",
            "read_only": False,
            "created_at": "2026-04-02T12:00:00",
            "last_ts": "2026-04-02T12:00:01",
            "preview": "metadata preview text",
            "message_count": 2,
        }
    ]


@pytest.mark.skipif(not HAS_AIOHTTP, reason="aiohttp not installed")
@pytest.mark.asyncio
async def test_sessions_endpoint_requires_token_and_allowed_origin(aiohttp_client, channel) -> None:
    client = await aiohttp_client(channel._create_app(web))

    missing = await client.get("/sessions")
    assert missing.status == 401

    forbidden = await client.get(
        "/sessions",
        headers={"Authorization": "Bearer secret-token", "Origin": "http://denied.test"},
    )
    assert forbidden.status == 403


@pytest.mark.skipif(not HAS_AIOHTTP, reason="aiohttp not installed")
@pytest.mark.asyncio
async def test_websocket_resume_switch_and_delete_flow(aiohttp_client, channel, workspace) -> None:
    first = "11111111-1111-1111-1111-111111111111"
    second = "22222222-2222-2222-2222-222222222222"
    _save_session(workspace, first, user_text="first chat")
    _save_session(workspace, second, user_text="second chat")

    client = await aiohttp_client(channel._create_app(web))
    ws = await client.ws_connect(
        f"/ws?chat_id={first}&auth_token=secret-token",
        headers={"Origin": "http://allowed.test"},
    )

    init_msg = await ws.receive_json()
    assert init_msg["type"] == "session.init"
    assert init_msg["chatId"] == first

    history_msg = await ws.receive_json()
    assert history_msg["type"] == "session.history"
    assert history_msg["chatId"] == first
    assert history_msg["messages"][0]["content"] == "first chat"

    await ws.send_json({"type": "session.switch", "chatId": second})
    switch_init = await ws.receive_json()
    switch_history = await ws.receive_json()
    assert switch_init["chatId"] == second
    assert switch_history["chatId"] == second
    assert switch_history["messages"][0]["content"] == "second chat"

    delete_resp = await client.delete(
        f"/sessions/{second}",
        headers={"Authorization": "Bearer secret-token", "Origin": "http://allowed.test"},
    )
    assert delete_resp.status == 200
    deleted_event = await ws.receive_json()
    assert deleted_event == {"type": "session.deleted", "chatId": second}
    await ws.close()


@pytest.mark.skipif(not HAS_AIOHTTP, reason="aiohttp not installed")
@pytest.mark.asyncio
async def test_websocket_cancel_maps_to_stop_command(aiohttp_client, channel) -> None:
    client = await aiohttp_client(channel._create_app(web))
    ws = await client.ws_connect(
        "/ws?auth_token=secret-token",
        headers={"Origin": "http://allowed.test"},
    )

    init_msg = await ws.receive_json()

    with patch.object(channel, "_handle_message", new=AsyncMock()) as handle_message:
        await ws.send_json({"type": "message.cancel"})
        await asyncio.sleep(0.05)

    handle_message.assert_awaited_once_with(
        sender_id="webui_browser",
        chat_id=init_msg["chatId"],
        content="/stop",
    )
    await ws.close()


@pytest.mark.skipif(not HAS_AIOHTTP, reason="aiohttp not installed")
@pytest.mark.asyncio
async def test_deleted_session_stays_hidden_after_core_recreates_file(aiohttp_client, channel, workspace) -> None:
    chat_id = "33333333-3333-3333-3333-333333333333"
    _save_session(workspace, chat_id, user_text="delete me")

    client = await aiohttp_client(channel._create_app(web))
    resp = await client.delete(
        f"/sessions/{chat_id}",
        headers={"Authorization": "Bearer secret-token", "Origin": "http://allowed.test"},
    )
    assert resp.status == 200

    manager = SessionManager(workspace)
    session = manager.get_or_create(session_key_for(chat_id))
    session.messages.append({"role": "assistant", "content": "should not persist", "timestamp": "2026-04-02T12:00:02"})
    manager.save(session)

    assert manager._get_session_path(session.key).exists()
    assert channel._sessions.list_sessions() == []
    assert channel._sessions.load_history(chat_id, media_service=channel._media) == []


@pytest.mark.skipif(not HAS_AIOHTTP, reason="aiohttp not installed")
@pytest.mark.asyncio
async def test_media_token_expiry_returns_not_found(aiohttp_client, channel, tmp_path) -> None:
    media_file = tmp_path / "artifact.txt"
    media_file.write_text("artifact", encoding="utf-8")
    token = channel._media.issue_token(media_file)

    client = await aiohttp_client(channel._create_app(web))
    with patch("nanobot_webui.media.time.time", return_value=10**12):
        resp = await client.get(
            f"/media/{token}",
            headers={"Authorization": "Bearer secret-token", "Origin": "http://allowed.test"},
        )

    assert resp.status == 404


def test_message_send_command_accepts_uploaded_attachments() -> None:
    command = parse_client_command(
        '{"type":"message.send","content":"","attachments":[{"path":"/tmp/demo.pdf","name":"demo.pdf","mime":"application/pdf"}]}'
    )

    assert command is not None
    assert command.type == "message.send"
    assert command.content == ""
    assert command.attachments is not None
    assert command.attachments[0].path == "/tmp/demo.pdf"


def test_session_history_restores_user_attachments(workspace) -> None:
    chat_id = "44444444-4444-4444-4444-444444444444"
    _save_session_with_user_attachment(workspace, chat_id)
    service = SessionQueryService(workspace=workspace)

    class StubMediaService:
        def build_media_items(self, paths):
            return [{"url": f"/media/{index}", "name": path.rsplit("/", 1)[-1], "mime": "application/pdf"} for index, path in enumerate(paths)]

    history = service.load_history(chat_id, media_service=StubMediaService())

    assert history[0]["type"] == "user"
    assert history[0]["content"] == "please review"
    assert history[0]["media"][0]["name"] == "demo.pdf"


@pytest.mark.asyncio
async def test_webui_hook_tracks_tool_durations_per_session() -> None:
    class ToolCall:
        def __init__(self, name: str, arguments: dict[str, str]) -> None:
            self.name = name
            self.arguments = arguments

    registry = ConnectionRegistry()
    hook = WebUIHook(registry, channel_turns := channel_turn_tracker())
    captured: list[tuple[str, dict]] = []

    async def _capture(chat_id: str, payload: dict) -> None:
        captured.append((chat_id, payload))

    registry.emit_to_chat = _capture  # type: ignore[method-assign]

    ctx1 = AgentHookContext(
        iteration=0,
        messages=[],
        tool_calls=[ToolCall("read_file", {"path": "a.txt"})],
        tool_results=["ok-a"],
        tool_events=[{"name": "read_file", "status": "ok"}],
    )
    ctx2 = AgentHookContext(
        iteration=0,
        messages=[],
        tool_calls=[ToolCall("read_file", {"path": "b.txt"})],
        tool_results=["ok-b"],
        tool_events=[{"name": "read_file", "status": "ok"}],
    )

    with patch("nanobot_webui.channel.time.monotonic", side_effect=[1.0, 2.0, 5.0, 8.0]):
        token1 = push_route_context(
            InboundMessage(channel="webui", sender_id="browser", chat_id="chat-a", content="a"),
            wants_streaming=True,
        )
        await hook.before_execute_tools(ctx1)
        pop_route_context(token1)

        token2 = push_route_context(
            InboundMessage(channel="webui", sender_id="browser", chat_id="chat-b", content="b"),
            wants_streaming=True,
        )
        await hook.before_execute_tools(ctx2)
        pop_route_context(token2)

        token1 = push_route_context(
            InboundMessage(channel="webui", sender_id="browser", chat_id="chat-a", content="a"),
            wants_streaming=True,
        )
        await hook.after_iteration(ctx1)
        pop_route_context(token1)

        token2 = push_route_context(
            InboundMessage(channel="webui", sender_id="browser", chat_id="chat-b", content="b"),
            wants_streaming=True,
        )
        await hook.after_iteration(ctx2)
        pop_route_context(token2)

    durations = [payload["durationMs"] for _, payload in captured if payload["type"] == "tools.finished"]
    assert durations == [4000, 6000]
    assert channel_turns.had_stream_output("chat-a") is False


def channel_turn_tracker():
    from nanobot_webui.channel import _TurnTracker

    return _TurnTracker()


@pytest.mark.skipif(not HAS_AIOHTTP, reason="aiohttp not installed")
@pytest.mark.asyncio
async def test_websocket_requires_valid_auth_token(aiohttp_client, channel) -> None:
    client = await aiohttp_client(channel._create_app(web))

    with pytest.raises(WSServerHandshakeError) as exc:
        await client.ws_connect("/ws?auth_token=bad-token", headers={"Origin": "http://allowed.test"})

    assert exc.value.status == 401
