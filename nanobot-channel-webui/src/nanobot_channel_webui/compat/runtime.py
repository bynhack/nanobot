"""Runtime attachment helpers for the WebUI channel."""

from __future__ import annotations

import gc
from contextvars import ContextVar, Token
from dataclasses import dataclass
from types import MethodType
from typing import TYPE_CHECKING, Any

from loguru import logger

from ..config import CHANNEL_NAME

if TYPE_CHECKING:
    from nanobot.agent.loop import AgentLoop
    from nanobot.bus.events import InboundMessage
    from nanobot.bus.queue import MessageBus

_ROUTE_CONTEXT: ContextVar["WebUIRouteContext | None"] = ContextVar("webui_route_context", default=None)
_WRAPPER_MARKER = "_nanobot_webui_runtime_wrapper"


@dataclass(frozen=True, slots=True)
class WebUIRouteContext:
    """Per-request routing state needed by WebUI-only hooks."""

    message: InboundMessage
    wants_streaming: bool

    @property
    def chat_id(self) -> str:
        return self.message.chat_id

    @property
    def session_key(self) -> str:
        return self.message.session_key


def current_route_context() -> WebUIRouteContext | None:
    """Return the current WebUI route context, if any."""
    return _ROUTE_CONTEXT.get()


def push_route_context(message: InboundMessage, *, wants_streaming: bool) -> Token[WebUIRouteContext | None]:
    """Set the current WebUI route context."""
    return _ROUTE_CONTEXT.set(WebUIRouteContext(message=message, wants_streaming=wants_streaming))


def pop_route_context(token: Token[WebUIRouteContext | None]) -> None:
    """Reset the current WebUI route context."""
    _ROUTE_CONTEXT.reset(token)


def attach_webui_runtime(bus: MessageBus, hook: Any) -> bool:
    """Attach the WebUI hook to the live AgentLoop for the same bus."""
    loop = _find_agent_loop(bus)
    if loop is None:
        return False

    _register_hook(loop, hook)

    original = loop._process_message
    original_func = getattr(original, "__func__", None)
    if original_func is None:
        return False

    if getattr(original_func, _WRAPPER_MARKER, False):
        return True

    async def _wrapped_process_message(self: AgentLoop, msg: InboundMessage, *args: Any, **kwargs: Any):
        token: Token[WebUIRouteContext | None] | None = None
        if msg.channel == CHANNEL_NAME:
            token = push_route_context(msg, wants_streaming=kwargs.get("on_stream") is not None)
        try:
            return await original_func(self, msg, *args, **kwargs)
        finally:
            if token is not None:
                pop_route_context(token)

    setattr(_wrapped_process_message, _WRAPPER_MARKER, True)
    loop._process_message = MethodType(_wrapped_process_message, loop)
    logger.info("WebUI runtime attached to AgentLoop")
    return True


def _register_hook(loop: Any, hook: Any) -> None:
    extra_hooks = getattr(loop, "_extra_hooks", None)
    if isinstance(extra_hooks, list) and hook not in extra_hooks:
        extra_hooks.append(hook)


def _find_agent_loop(bus: MessageBus) -> AgentLoop | None:
    from nanobot.agent.loop import AgentLoop

    for obj in gc.get_objects():
        if isinstance(obj, AgentLoop) and getattr(obj, "bus", None) is bus:
            return obj
    return None
