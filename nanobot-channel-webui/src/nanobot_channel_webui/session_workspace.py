"""Filesystem-backed delivered-files workspace index."""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _sort_timestamp(value: Any) -> float:
    if not isinstance(value, str) or not value:
        return float("-inf")
    normalized = value.replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(normalized).astimezone(timezone.utc).timestamp()
    except ValueError:
        return float("-inf")


def _empty_workspace(chat_id: str) -> dict[str, Any]:
    return {
        "chat_id": chat_id,
        "updated_at": None,
        "files": [],
    }


class SessionWorkspaceService:
    """Maintain delivered files for each chat in plugin-owned storage."""

    def __init__(self, workspace: Path) -> None:
        self._root = workspace / ".nanobot_channel_webui" / "workspaces"
        self._root.mkdir(parents=True, exist_ok=True)

    @staticmethod
    def _file_key(chat_id: str) -> str:
        return hashlib.sha1(chat_id.encode("utf-8")).hexdigest()

    def _path_for_chat(self, chat_id: str) -> Path:
        return self._root / f"{self._file_key(chat_id)}.json"

    def load_workspace(self, chat_id: str) -> dict[str, Any]:
        path = self._path_for_chat(chat_id)
        if not path.exists():
            return _empty_workspace(chat_id)
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError, TypeError, ValueError):
            return _empty_workspace(chat_id)
        if not isinstance(payload, dict):
            return _empty_workspace(chat_id)
        files = payload.get("files")
        if not isinstance(files, list):
            files = []
        return {
            "chat_id": str(payload.get("chat_id") or chat_id),
            "updated_at": payload.get("updated_at"),
            "files": files,
        }

    def record_deliveries(self, chat_id: str, media: list[dict[str, Any]]) -> dict[str, Any]:
        workspace = self.load_workspace(chat_id)
        files_by_key: dict[tuple[str, str], dict[str, Any]] = {}
        for item in workspace["files"]:
            if not isinstance(item, dict):
                continue
            url = str(item.get("url") or "").strip()
            name = str(item.get("name") or "").strip()
            if not url or not name:
                continue
            files_by_key[(url, name)] = item

        updated_at = _utc_now_iso()
        for item in media:
            url = str(item.get("url") or "").strip()
            name = str(item.get("name") or "").strip()
            if not url or not name:
                continue
            delivered_at = str(item.get("delivered_at") or updated_at)
            mime = str(item.get("mime") or "").strip()
            digest = hashlib.sha1(f"{url}\0{name}".encode("utf-8")).hexdigest()[:16]
            files_by_key[(url, name)] = {
                "id": f"file_{digest}",
                "name": name,
                "url": url,
                "mime": mime,
                "delivered_at": delivered_at,
            }

        payload = {
            "chat_id": chat_id,
            "updated_at": updated_at,
            "files": sorted(
                files_by_key.values(),
                key=lambda item: _sort_timestamp(item.get("delivered_at")),
                reverse=True,
            ),
        }
        self._write_atomic(self._path_for_chat(chat_id), payload)
        return payload

    @staticmethod
    def _write_atomic(path: Path, payload: dict[str, Any]) -> None:
        temp_path = path.with_suffix(".json.tmp")
        temp_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        temp_path.replace(path)
