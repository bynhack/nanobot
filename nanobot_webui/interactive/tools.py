"""WebUI-only interactive tools."""

from __future__ import annotations

import asyncio
import json
from typing import Any

from nanobot.agent.tools.base import Tool, tool_parameters

from nanobot_webui.interactive.registry import InteractionRegistry
from nanobot_webui.runtime import current_route_context


class _InteractiveTool(Tool):
    read_only = False

    def __init__(self, registry: InteractionRegistry, kind: str) -> None:
        self._registry = registry
        self._kind = kind

    async def _request(self, payload: dict[str, Any]) -> str:
        route = current_route_context()
        if route is None or route.message.channel != "webui":
            return json.dumps(
                {
                    "status": "error",
                    "error": "interactive_not_supported",
                    "message": "interactive tools are only supported in webui",
                    "kind": self._kind,
                    "payload": payload,
                },
                ensure_ascii=False,
            )

        pending = self._registry.create(
            session_key=route.session_key,
            chat_id=route.chat_id,
            kind=self._kind,
            payload=payload,
        )
        await self._registry.emit_request(pending)
        try:
            result = await pending.future
            return json.dumps(
                {
                    "status": "ok",
                    "interaction_id": pending.id,
                    "kind": self._kind,
                    "payload": payload,
                    "result": result,
                },
                ensure_ascii=False,
            )
        except asyncio.CancelledError:
            return json.dumps(
                {
                    "status": "cancelled",
                    "interaction_id": pending.id,
                    "kind": self._kind,
                    "payload": payload,
                },
                ensure_ascii=False,
            )


@tool_parameters(
    {
        "type": "object",
        "properties": {
            "title": {"type": "string", "description": "Dialog title"},
            "message": {"type": "string", "description": "Dialog message"},
            "confirm_text": {"type": "string", "description": "Confirm button text"},
            "cancel_text": {"type": "string", "description": "Cancel button text"},
            "variant": {"type": "string", "description": "Variant: info, warning, danger"},
        },
        "required": ["title", "message"],
    }
)
class InteractiveConfirmTool(_InteractiveTool):
    def __init__(self, registry: InteractionRegistry) -> None:
        super().__init__(registry, "confirm")

    @property
    def name(self) -> str:
        return "interactive_confirm"

    @property
    def description(self) -> str:
        return "Request an inline confirmation interaction from the WebUI user."

    async def execute(self, **kwargs: Any) -> Any:
        return await self._request(kwargs)


@tool_parameters(
    {
        "type": "object",
        "properties": {
            "title": {"type": "string", "description": "Selection title"},
            "description": {"type": "string", "description": "Optional selection description"},
            "options": {
                "type": "array",
                "description": "Selectable options",
                "items": {
                    "type": "object",
                    "properties": {
                        "label": {"type": "string"},
                        "value": {"type": "string"},
                        "description": {"type": "string"},
                        "disabled": {"type": "boolean"},
                    },
                    "required": ["label", "value"],
                },
            },
            "multiple": {"type": "boolean", "description": "Whether multiple selection is allowed"},
            "searchable": {"type": "boolean", "description": "Whether search is enabled"},
            "placeholder": {"type": "string", "description": "Placeholder text"},
        },
        "required": ["title", "options"],
    }
)
class InteractiveSelectTool(_InteractiveTool):
    def __init__(self, registry: InteractionRegistry) -> None:
        super().__init__(registry, "select")

    @property
    def name(self) -> str:
        return "interactive_select"

    @property
    def description(self) -> str:
        return "Request an inline selection interaction from the WebUI user."

    async def execute(self, **kwargs: Any) -> Any:
        return await self._request(kwargs)


@tool_parameters(
    {
        "type": "object",
        "properties": {
            "title": {"type": "string", "description": "Input title"},
            "description": {"type": "string", "description": "Optional input description"},
            "placeholder": {"type": "string", "description": "Input placeholder"},
            "multiline": {"type": "boolean", "description": "Whether the input is multiline"},
            "password": {"type": "boolean", "description": "Whether the input is password style"},
            "required_input": {"type": "boolean", "description": "Whether a value is required"},
        },
        "required": ["title"],
    }
)
class InteractiveInputTool(_InteractiveTool):
    def __init__(self, registry: InteractionRegistry) -> None:
        super().__init__(registry, "input")

    @property
    def name(self) -> str:
        return "interactive_input"

    @property
    def description(self) -> str:
        return "Request an inline text input interaction from the WebUI user."

    async def execute(self, **kwargs: Any) -> Any:
        return await self._request(kwargs)


def interactive_tools(registry: InteractionRegistry) -> list[Tool]:
    return [
        InteractiveConfirmTool(registry),
        InteractiveSelectTool(registry),
        InteractiveInputTool(registry),
    ]
