"""Shared protocol helpers for the WebUI HTTP and WebSocket surface."""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Literal


ClientCommandType = Literal["message.send", "message.cancel", "session.new", "session.switch"]


@dataclass(slots=True)
class ClientAttachment:
    """Uploaded attachment reference supplied by the browser."""

    path: str
    name: str
    mime: str = ""


@dataclass(slots=True)
class ClientCommand:
    """Validated command received from the browser client."""

    type: ClientCommandType
    chat_id: str | None = None
    content: str = ""
    attachments: list[ClientAttachment] | None = None


def parse_client_command(raw: str) -> ClientCommand | None:
    """Parse and validate a browser command payload."""
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return None
    if not isinstance(data, dict):
        return None

    kind = str(data.get("type", "")).strip()
    if kind == "message.send":
        content = str(data.get("content", "")).strip()
        raw_attachments = data.get("attachments") or []
        attachments: list[ClientAttachment] = []
        if isinstance(raw_attachments, list):
            for item in raw_attachments:
                if not isinstance(item, dict):
                    return None
                path = str(item.get("path", "")).strip()
                if not path:
                    return None
                attachments.append(
                    ClientAttachment(
                        path=path,
                        name=str(item.get("name", "")).strip(),
                        mime=str(item.get("mime", "")).strip(),
                    )
                )
        if not content and not attachments:
            return None
        return ClientCommand(type="message.send", content=content, attachments=attachments or None)
    if kind == "message.cancel":
        return ClientCommand(type="message.cancel")
    if kind == "session.new":
        return ClientCommand(type="session.new")
    if kind == "session.switch":
        chat_id = str(data.get("chatId", "")).strip()
        if not chat_id:
            return None
        return ClientCommand(type="session.switch", chat_id=chat_id)
    return None


def session_init_event(chat_id: str) -> dict[str, Any]:
    return {
        "type": "session.init",
        "chatId": chat_id,
        "sessionId": chat_id[:8],
    }


def session_history_event(chat_id: str, messages: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "type": "session.history",
        "chatId": chat_id,
        "messages": messages,
    }


def session_deleted_event(chat_id: str) -> dict[str, Any]:
    return {
        "type": "session.deleted",
        "chatId": chat_id,
    }


def turn_phase_event(chat_id: str, phase: str, **extra: Any) -> dict[str, Any]:
    payload = {
        "type": "turn.phase",
        "chatId": chat_id,
        "phase": phase,
    }
    payload.update(extra)
    return payload


def turn_delta_event(chat_id: str, delta: str, *, stream_id: str | None = None) -> dict[str, Any]:
    payload = {
        "type": "turn.delta",
        "chatId": chat_id,
        "delta": delta,
    }
    if stream_id:
        payload["streamId"] = stream_id
    return payload


def tools_started_event(chat_id: str, tools: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "type": "tools.started",
        "chatId": chat_id,
        "tools": tools,
    }


def tools_finished_event(
    chat_id: str,
    *,
    duration_ms: int,
    results: list[dict[str, Any]],
) -> dict[str, Any]:
    return {
        "type": "tools.finished",
        "chatId": chat_id,
        "durationMs": duration_ms,
        "results": results,
    }


def turn_completed_event(
    chat_id: str,
    *,
    content: str = "",
    media: list[dict[str, str]] | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "type": "turn.completed",
        "chatId": chat_id,
        "content": content,
    }
    if media:
        payload["media"] = media
    return payload


def error_event(message: str, *, code: str = "bad_request", chat_id: str | None = None) -> dict[str, Any]:
    payload = {
        "type": "error",
        "code": code,
        "message": message,
    }
    if chat_id:
        payload["chatId"] = chat_id
    return payload
