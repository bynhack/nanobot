"""Session query helpers for the WebUI channel."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from nanobot.config.paths import get_workspace_path
from nanobot.session.manager import Session, SessionManager

from .config import CHANNEL_NAME

_UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    re.IGNORECASE,
)
_DELETED_FILE = ".nanobot_channel_webui_deleted_sessions.json"


def is_valid_chat_id(chat_id: str) -> bool:
    return bool(_UUID_RE.match(chat_id))


def session_key_for(chat_id: str) -> str:
    return f"{CHANNEL_NAME}:{chat_id}"


def parse_session_ref(value: str) -> tuple[str | None, str]:
    raw = (value or "").strip()
    if not raw:
        return None, ""
    if ":" in raw:
        channel, chat_id = raw.split(":", 1)
        return channel or None, chat_id
    return CHANNEL_NAME, raw


def canonical_session_key(value: str) -> str:
    channel, chat_id = parse_session_ref(value)
    return f"{CHANNEL_NAME}:{chat_id}" if channel == CHANNEL_NAME else value


def _message_text(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        texts: list[str] = []
        for block in content:
            if isinstance(block, dict) and block.get("type") == "text":
                texts.append(str(block.get("text", "")))
        return "\n".join(t for t in texts if t)
    if content is None:
        return ""
    return json.dumps(content, ensure_ascii=False)


def _preview_text(text: str) -> str:
    text = text.strip()
    if not text:
        return "(empty)"
    return text[:60] + ("…" if len(text) > 60 else "")


def _extract_user_attachments(content: str) -> tuple[str, list[str]]:
    attachments: list[str] = []
    clean_lines: list[str] = []
    for line in content.splitlines():
        stripped = line.strip()
        if stripped.startswith("[image:") and stripped.endswith("]"):
            path = stripped[7:-1].strip()
            if path:
                attachments.append(path)
            continue
        if stripped.startswith("[File: source:") and stripped.endswith("]"):
            path = stripped[len("[File: source:"):-1].strip()
            if path:
                attachments.append(path)
            continue
        if stripped.startswith("[file:") and stripped.endswith("]"):
            continue
        clean_lines.append(line)

    text = "\n".join(clean_lines).strip()
    return text, attachments


def parse_ask_user_tool_arguments(value: Any) -> tuple[str, list[list[str]]] | None:
    try:
        parsed = json.loads(value) if isinstance(value, str) else dict(value)
    except Exception:
        return None
    if not isinstance(parsed, dict):
        return None
    question = str(parsed.get("question", "")).strip()
    raw_options = parsed.get("options")
    if not question or not isinstance(raw_options, list):
        return None
    options = [str(option).strip() for option in raw_options if str(option).strip()]
    if not options:
        return None
    return question, [options]


def _tool_call_name(tool_call: dict[str, Any]) -> str:
    function = tool_call.get("function")
    if isinstance(function, dict) and isinstance(function.get("name"), str):
        return function["name"]
    name = tool_call.get("name")
    return name if isinstance(name, str) else ""


def _tool_call_arguments(tool_call: dict[str, Any]) -> Any:
    function = tool_call.get("function")
    if isinstance(function, dict):
        return function.get("arguments", "{}")
    return tool_call.get("arguments", "{}")


class SessionQueryService:
    """Load WebUI session summaries and reconstruct display history."""

    def __init__(self, *, workspace: Path | None = None) -> None:
        self._workspace = workspace or get_workspace_path()
        self._deleted_path = self._workspace / _DELETED_FILE

    @property
    def workspace(self) -> Path:
        return self._workspace

    def _manager(self) -> SessionManager:
        return SessionManager(self._workspace)

    def _load_deleted(self) -> set[str]:
        if not self._deleted_path.exists():
            return set()
        try:
            data = json.loads(self._deleted_path.read_text(encoding="utf-8"))
        except Exception:
            return set()
        if not isinstance(data, list):
            return set()
        return {str(item) for item in data if is_valid_chat_id(str(item))}

    def _save_deleted(self, deleted: set[str]) -> None:
        self._deleted_path.write_text(
            json.dumps(sorted(deleted), ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )

    def _is_deleted(self, chat_id: str) -> bool:
        return chat_id in self._load_deleted()

    def _mark_deleted(self, chat_id: str) -> None:
        deleted = self._load_deleted()
        deleted.add(chat_id)
        self._save_deleted(deleted)

    def _load_session(self, session_ref: str) -> Session | None:
        channel, chat_id = parse_session_ref(session_ref)
        if channel != CHANNEL_NAME:
            return None
        if self._is_deleted(chat_id):
            return None
        manager = self._manager()
        raw_ref = (session_ref or "").strip()
        if raw_ref and ":" in raw_ref:
            candidate_keys = [raw_ref]
        else:
            candidate_keys = [session_key_for(chat_id)]
        for key in candidate_keys:
            path = manager._get_session_path(key)
            if path.exists():
                return manager._load(key)
        return None

    @staticmethod
    def _summary_from_session(session_key: str, session: Session) -> dict[str, Any]:
        channel, chat_id = parse_session_ref(session_key)
        preview = session.metadata.get("preview")
        message_count = session.metadata.get("message_count")
        last_ts = session.metadata.get("last_ts")

        if preview is None or message_count is None or last_ts is None:
            preview_text = ""
            count = 0
            last_seen = None
            for message in session.messages:
                role = message.get("role")
                if role not in ("user", "assistant"):
                    continue
                count += 1
                ts = message.get("timestamp")
                if isinstance(ts, str) and ts:
                    last_seen = ts
                if role == "user" and not preview_text:
                    preview_text = _message_text(message.get("content", ""))
            preview = _preview_text(preview_text)
            message_count = count
            last_ts = last_seen

        return {
            "chat_id": chat_id,
            "session_key": session_key,
            "channel": channel or CHANNEL_NAME,
            "read_only": False,
            "created_at": session.created_at.isoformat(),
            "last_ts": last_ts,
            "preview": preview or "(empty)",
            "message_count": int(message_count or 0),
        }

    def list_sessions(self) -> list[dict[str, Any]]:
        results: list[dict[str, Any]] = []
        manager = self._manager()
        deleted = self._load_deleted()

        for item in manager.list_sessions():
            key = str(item.get("key", ""))
            channel, chat_id = parse_session_ref(key)
            if channel != CHANNEL_NAME:
                continue
            if not is_valid_chat_id(chat_id) or chat_id in deleted:
                continue

            preview = item.get("preview")
            message_count = item.get("message_count")
            last_ts = item.get("last_ts")
            created_at = item.get("created_at")
            if preview is None or message_count is None or last_ts is None:
                session = manager._load(key)
                if session is None:
                    continue
                results.append(self._summary_from_session(key, session))
                continue

            results.append({
                "chat_id": chat_id,
                "session_key": key,
                "channel": channel or CHANNEL_NAME,
                "read_only": False,
                "created_at": created_at,
                "last_ts": last_ts,
                "preview": preview or "(empty)",
                "message_count": int(message_count or 0),
            })

        results.sort(key=lambda entry: entry.get("last_ts") or entry.get("created_at") or "", reverse=True)
        return results

    def load_history(self, session_ref: str, *, media_service: Any) -> list[dict[str, Any]]:
        session = self._load_session(session_ref)
        if session is None:
            return []

        raw = session.messages
        result: list[dict[str, Any]] = []
        index = 0

        while index < len(raw):
            message = raw[index]
            role = message.get("role")

            if role == "user":
                content = _message_text(message.get("content", ""))
                text, attachments = _extract_user_attachments(content)
                if text.strip() or attachments:
                    payload: dict[str, Any] = {"type": "user", "content": text}
                    if attachments:
                        payload["media"] = media_service.build_media_items(attachments)
                    result.append(payload)
                index += 1
                continue

            if role != "assistant":
                index += 1
                continue

            content = _message_text(message.get("content", ""))
            tool_calls = message.get("tool_calls") or []
            if content.strip():
                result.append({"type": "assistant", "content": content})

            if not tool_calls:
                index += 1
                continue

            tool_results: dict[str, str] = {}
            cursor = index + 1
            while cursor < len(raw) and raw[cursor].get("role") == "tool":
                tool_message = raw[cursor]
                tool_results[str(tool_message.get("tool_call_id", ""))] = _message_text(
                    tool_message.get("content", "")
                )
                cursor += 1
            index = cursor

            tool_block: list[dict[str, Any]] = []
            for tool_call in tool_calls:
                if not isinstance(tool_call, dict):
                    continue
                name = _tool_call_name(tool_call)
                raw_args = _tool_call_arguments(tool_call)
                try:
                    args = json.loads(raw_args) if isinstance(raw_args, str) else dict(raw_args)
                except Exception:
                    args = {}
                result_text = tool_results.get(str(tool_call.get("id", "")), "")
                status = "error" if isinstance(result_text, str) and result_text.startswith("Error") else "ok"

                if name == "ask_user":
                    parsed_ask = parse_ask_user_tool_arguments(raw_args)
                    if parsed_ask is not None:
                        question, buttons = parsed_ask
                        result.append({
                            "type": "assistant",
                            "content": question,
                            "buttons": buttons,
                        })
                    continue

                if name == "message":
                    media_value = args.get("media")
                    media_paths = (
                        media_value
                        if isinstance(media_value, list)
                        else [media_value]
                        if isinstance(media_value, str) and media_value
                        else []
                    )
                    result.append({
                        "type": "outbound",
                        "content": str(args.get("content", "")),
                        "media": media_service.build_media_items(media_paths),
                    })
                    continue

                tool_block.append({
                    "name": name,
                    "args": args,
                    "result": result_text,
                    "status": status,
                })

            if tool_block:
                result.append({"type": "tools", "tools": tool_block})

        return result

    def pending_ask_user_prompt(self, session_ref: str) -> tuple[str, list[list[str]]] | None:
        session = self._load_session(session_ref)
        if session is None:
            return None

        pending: dict[str, tuple[str, list[list[str]]]] = {}
        for message in session.messages:
            role = message.get("role")
            if role == "assistant":
                for tool_call in message.get("tool_calls") or []:
                    if not isinstance(tool_call, dict) or _tool_call_name(tool_call) != "ask_user":
                        continue
                    tool_call_id = str(tool_call.get("id", ""))
                    parsed = parse_ask_user_tool_arguments(_tool_call_arguments(tool_call))
                    if tool_call_id and parsed is not None:
                        pending[tool_call_id] = parsed
            elif role == "tool":
                tool_call_id = message.get("tool_call_id")
                if isinstance(tool_call_id, str):
                    pending.pop(tool_call_id, None)

        return next(reversed(pending.values()), None)

    def delete_session(self, chat_id: str) -> bool:
        key = session_key_for(chat_id)
        manager = self._manager()
        path = manager._get_session_path(key)
        existed = path.exists()
        self._mark_deleted(chat_id)
        manager.invalidate(key)
        if existed:
            path.unlink()
        return existed
