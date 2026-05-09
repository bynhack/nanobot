from __future__ import annotations

import pytest

from nanobot.bus.events import InboundMessage
from nanobot_channel_webui.compat import runtime
from nanobot_channel_webui.config import CHANNEL_NAME


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
