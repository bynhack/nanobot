from __future__ import annotations

import pytest

from nanobot.bus.events import InboundMessage
from nanobot_channel_webui.compat import runtime
from nanobot_channel_webui.compat.runtime_state import RuntimeAttachState
from nanobot_channel_webui.connections import ConnectionRegistry
from nanobot_channel_webui.config import CHANNEL_NAME
from nanobot_channel_webui.turns import TurnAccumulator


class _FakeLoop:
    def __init__(self) -> None:
        self._extra_hooks: list[object] = []
        self.seen_routes: list[object | None] = []

    async def _process_message(self, msg: InboundMessage, *args, **kwargs):
        self.seen_routes.append(runtime.current_route_context())
        return {"chat_id": msg.chat_id, "streaming": kwargs.get("on_stream") is not None}


@pytest.mark.asyncio
async def test_attach_webui_runtime_wraps_process_message_once(monkeypatch) -> None:
    loop = _FakeLoop()
    hook = object()

    monkeypatch.setattr(runtime, "_find_agent_loop", lambda bus: loop)

    attached_first = runtime.attach_webui_runtime(object(), hook)
    wrapped_once = loop._process_message.__func__
    attached_second = runtime.attach_webui_runtime(object(), hook)

    assert attached_first is True
    assert attached_second is True
    assert loop._extra_hooks == [hook]
    assert loop._process_message.__func__ is wrapped_once

    msg = InboundMessage(channel=CHANNEL_NAME, sender_id="u1", chat_id="chat1", content="hello")
    result = await loop._process_message(msg, on_stream=object())

    assert result == {"chat_id": "chat1", "streaming": True}
    assert loop.seen_routes[0] is not None
    assert loop.seen_routes[0].chat_id == "chat1"
    assert loop.seen_routes[0].wants_streaming is True
    assert runtime.current_route_context() is None


@pytest.mark.asyncio
async def test_attach_webui_runtime_keeps_non_webui_messages_unscoped(monkeypatch) -> None:
    loop = _FakeLoop()
    hook = object()

    monkeypatch.setattr(runtime, "_find_agent_loop", lambda bus: loop)
    runtime.attach_webui_runtime(object(), hook)

    msg = InboundMessage(channel="telegram", sender_id="u1", chat_id="chat1", content="hello")
    result = await loop._process_message(msg)

    assert result == {"chat_id": "chat1", "streaming": False}
    assert loop.seen_routes[0] is None
    assert runtime.current_route_context() is None


def test_attach_webui_runtime_registers_new_hook_without_rewrapping(monkeypatch) -> None:
    loop = _FakeLoop()
    hook_a = object()
    hook_b = object()

    monkeypatch.setattr(runtime, "_find_agent_loop", lambda bus: loop)

    runtime.attach_webui_runtime(object(), hook_a)
    wrapped_once = loop._process_message.__func__
    runtime.attach_webui_runtime(object(), hook_b)

    assert loop._extra_hooks == [hook_a, hook_b]
    assert loop._process_message.__func__ is wrapped_once


def test_attach_webui_runtime_returns_false_when_no_loop(monkeypatch) -> None:
    monkeypatch.setattr(runtime, "_find_agent_loop", lambda bus: None)

    assert runtime.attach_webui_runtime(object(), object()) is False


def test_runtime_attach_state_tracks_wrapped_process_once() -> None:
    state = RuntimeAttachState()

    assert state.is_wrapped is False

    state.mark_wrapped("process-message-wrapper")
    state.mark_wrapped("process-message-wrapper")

    assert state.is_wrapped is True
    assert state.wrapper_name == "process-message-wrapper"
    assert state.wrap_count == 1


def test_runtime_attach_state_distinguishes_hook_registration() -> None:
    state = RuntimeAttachState()

    assert state.hook_registered is False

    state.mark_hook_registered()

    assert state.hook_registered is True


def test_turn_accumulator_commits_stream_once_before_completion() -> None:
    acc = TurnAccumulator()

    assert acc.begin_stream("c1", "s1") is True

    acc.note_stream_output("c1")
    snapshot = acc.finish("c1")

    assert snapshot.had_stream_output is True
    assert snapshot.finished is True
    assert snapshot.should_emit_completion is True


def test_turn_accumulator_ignores_late_finish_after_completion() -> None:
    acc = TurnAccumulator()

    acc.begin_stream("c1", "s1")
    first = acc.finish("c1")
    second = acc.finish("c1")

    assert first.should_emit_completion is True
    assert second.should_emit_completion is False


def test_runtime_snapshot_reports_missing_loop(monkeypatch) -> None:
    monkeypatch.setattr(runtime, "_find_agent_loop", lambda bus: None)

    snapshot = runtime.runtime_snapshot(object())

    assert snapshot["loop_found"] is False
    assert snapshot["runtime_attached"] is False
    assert snapshot["hook_count"] == 0


def test_connection_registry_snapshot_counts_active_and_blocked() -> None:
    registry = ConnectionRegistry()
    ws1 = object()
    ws2 = object()

    registry.subscribe(ws1, "chat-a")
    registry.subscribe(ws2, "chat-a")
    registry.mark_active("chat-a")
    registry._blocked_chats.add("chat-b")

    snapshot = registry.snapshot()

    assert snapshot["active_chat_count"] == 1
    assert snapshot["active_connection_count"] == 2
    assert snapshot["blocked_chat_count"] == 1
    assert snapshot["chat_connections"] == {"chat-a": 2}


def test_turn_accumulator_snapshot_exposes_turn_state() -> None:
    acc = TurnAccumulator()
    acc.begin_stream("chat-a", "stream-1")
    acc.note_stream_output("chat-a", "hello")

    snapshot = acc.snapshot()

    assert snapshot["active_turn_count"] == 1
    assert snapshot["turns"]["chat-a"]["stream_id"] == "stream-1"
    assert snapshot["turns"]["chat-a"]["had_stream_output"] is True
    assert snapshot["turns"]["chat-a"]["stream_buffer_length"] == 5
    assert snapshot["turns"]["chat-a"]["finished"] is False


def test_turn_accumulator_buffers_active_stream_for_replay() -> None:
    acc = TurnAccumulator()
    acc.begin_stream("chat-a", "stream-1")

    acc.note_stream_output("chat-a", "hel")
    acc.note_stream_output("chat-a", "lo")

    assert acc.active_stream_buffer("chat-a") == "hello"
    assert acc.active_stream_id("chat-a") == "stream-1"


def test_turn_accumulator_hides_replay_buffer_after_finish() -> None:
    acc = TurnAccumulator()
    acc.begin_stream("chat-a", "stream-1")
    acc.note_stream_output("chat-a", "hello")

    acc.finish("chat-a")

    assert acc.active_stream_buffer("chat-a") == ""
