"""Session query helpers for the WebUI channel."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from nanobot.config.paths import get_workspace_path
from nanobot.session.manager import Session, SessionManager

_UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    re.IGNORECASE,
)
_DELETED_FILE = ".nanobot_webui_deleted_sessions.json"


def is_valid_chat_id(chat_id: str) -> bool:
    return bool(_UUID_RE.match(chat_id))


def session_key_for(chat_id: str) -> str:
    return f"webui:{chat_id}"


def parse_session_ref(value: str) -> tuple[str | None, str]:
    raw = (value or "").strip()
    if not raw:
        return None, ""
    if ":" in raw:
        channel, chat_id = raw.split(":", 1)
        return channel or None, chat_id
    return "webui", raw


def canonical_session_key(value: str) -> str:
    channel, chat_id = parse_session_ref(value)
    return f"webui:{chat_id}" if channel == "webui" else value


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


def _parse_interactive_tool_result(value: str) -> dict[str, Any] | None:
    try:
        parsed = json.loads(value)
    except Exception:
        return None
    if not isinstance(parsed, dict):
        return None
    if "kind" not in parsed or "status" not in parsed:
        return None
    return parsed


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
        if channel == "webui" and self._is_deleted(chat_id):
            return None
        manager = self._manager()
        key = session_key_for(chat_id) if channel == "webui" else session_ref
        path = manager._get_session_path(key)
        if not path.exists():
            return None
        return manager._load(key)

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
            "chat_id": chat_id if channel == "webui" else session_key,
            "session_key": session_key,
            "channel": channel or "unknown",
            "read_only": channel != "webui",
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
            if channel == "webui" and (not is_valid_chat_id(chat_id) or chat_id in deleted):
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
                "chat_id": chat_id if channel == "webui" else key,
                "session_key": key,
                "channel": channel or "unknown",
                "read_only": channel != "webui",
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
                function = tool_call.get("function", {}) if isinstance(tool_call, dict) else {}
                name = str(function.get("name", ""))
                raw_args = function.get("arguments", "{}")
                try:
                    args = json.loads(raw_args) if isinstance(raw_args, str) else dict(raw_args)
                except Exception:
                    args = {}
                result_text = tool_results.get(str(tool_call.get("id", "")), "")
                status = "error" if isinstance(result_text, str) and result_text.startswith("Error") else "ok"

                if name.startswith("interactive_"):
                    parsed_result = _parse_interactive_tool_result(result_text)
                    kind = name.replace("interactive_", "", 1)
                    payload = args
                    interaction_id = str(tool_call.get("id", ""))
                    interaction_status = status
                    result_payload: dict[str, Any] | None = None
                    if parsed_result:
                        interaction_id = str(parsed_result.get("interaction_id") or interaction_id)
                        kind = str(parsed_result.get("kind") or kind)
                        payload = parsed_result.get("payload") if isinstance(parsed_result.get("payload"), dict) else payload
                        interaction_status = str(parsed_result.get("status") or interaction_status)
                        if isinstance(parsed_result.get("result"), dict):
                            result_payload = parsed_result["result"]
                    result.append({
                        "type": "interactive",
                        "id": interaction_id,
                        "kind": kind,
                        "payload": payload,
                        "status": interaction_status,
                        "result": result_payload,
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
