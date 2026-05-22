"""Filesystem persistence for case graph state."""

from __future__ import annotations

import hashlib
import json
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping

from nanobot.config.paths import get_workspace_path

from .types import CaseGraphPatch, CaseGraphState, normalize_case_graph_state


class CaseGraphCorruptError(Exception):
    """Raised when a stored case graph file exists but cannot be parsed safely."""

    kind = "corrupt"

    def __init__(self, graph_id: str) -> None:
        self.graph_id = graph_id
        super().__init__(f"case graph '{graph_id}' is corrupt")


class CaseGraphDataCorruptError(CaseGraphCorruptError):
    kind = "data_corrupt"


class CaseGraphGraphIdMismatchError(CaseGraphCorruptError):
    kind = "graph_id_mismatch"


class CaseGraphStorage:
    """Persist case graph snapshots under the plugin workspace."""

    def __init__(self, *, workspace: Path | None = None) -> None:
        self._workspace = workspace or get_workspace_path()
        self._root = self._workspace / ".nanobot_channel_webui" / "case_graphs"
        self._root.mkdir(parents=True, exist_ok=True)
        self._context_root = self._workspace / ".nanobot_channel_webui" / "case_graph_contexts"

    @staticmethod
    def _file_key(graph_id: str) -> str:
        return hashlib.sha1(graph_id.encode("utf-8")).hexdigest()

    @staticmethod
    def _normalize_graph_id_value(graph_id: str) -> str:
        normalized = graph_id.strip()
        if not normalized:
            raise ValueError("graph_id is required")
        return normalized

    def _path_for_graph(self, graph_id: str) -> Path:
        normalized_graph_id = self._normalize_graph_id_value(graph_id)
        return self._root / f"{self._file_key(normalized_graph_id)}.json"

    @classmethod
    def _safe_path_segment(cls, value: str) -> str:
        normalized = re.sub(r"[^A-Za-z0-9_.-]+", "-", value.strip())
        return normalized.strip(".-") or cls._file_key(value.strip() or "unknown")

    def _context_path_for_graph(self, state: CaseGraphState) -> Path:
        case_segment = self._safe_path_segment(state["caseId"])
        graph_segment = self._safe_path_segment(state["graph_id"])
        return self._context_root / case_segment / graph_segment / "current_context.json"

    def _context_path_for_values(self, *, case_id: str, graph_id: str) -> Path:
        case_segment = self._safe_path_segment(case_id)
        graph_segment = self._safe_path_segment(graph_id)
        return self._context_root / case_segment / graph_segment / "current_context.json"

    def create_graph(self, payload: Mapping[str, Any]) -> CaseGraphState:
        state = normalize_case_graph_state(payload)
        self._write_atomic(self._path_for_graph(state["graph_id"]), state)
        return state

    def get_graph(self, graph_id: str) -> CaseGraphState | None:
        normalized_graph_id = self._normalize_graph_id_value(graph_id)
        path = self._path_for_graph(normalized_graph_id)
        if not path.exists():
            return None
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError, TypeError, ValueError) as exc:
            raise CaseGraphDataCorruptError(normalized_graph_id) from exc
        if not isinstance(payload, dict):
            raise CaseGraphDataCorruptError(normalized_graph_id)
        try:
            state = normalize_case_graph_state(payload)
        except (TypeError, ValueError) as exc:
            raise CaseGraphDataCorruptError(normalized_graph_id) from exc
        if state["graph_id"] != normalized_graph_id:
            raise CaseGraphGraphIdMismatchError(normalized_graph_id)
        return state

    def update_graph(self, graph_id: str, patch: CaseGraphPatch) -> CaseGraphState:
        normalized_graph_id = self._normalize_graph_id_value(graph_id)
        current = self.get_graph(normalized_graph_id)
        if current is None:
            raise KeyError(normalized_graph_id)
        merged: dict[str, Any] = dict(current)
        merged.update(patch)
        merged["graph_id"] = normalized_graph_id
        state = normalize_case_graph_state(merged)
        self._write_atomic(self._path_for_graph(normalized_graph_id), state)
        return state

    def delete_graph(self, graph_id: str) -> bool:
        normalized_graph_id = self._normalize_graph_id_value(graph_id)
        state = self.get_graph(normalized_graph_id)
        if state is None:
            return False
        self._path_for_graph(normalized_graph_id).unlink(missing_ok=True)
        case_segment = self._safe_path_segment(state["caseId"])
        graph_segment = self._safe_path_segment(state["graph_id"])
        shutil.rmtree(self._root / case_segment / graph_segment, ignore_errors=True)
        shutil.rmtree(self._context_root / case_segment / graph_segment, ignore_errors=True)
        return True

    def list_graphs(self, case_id: str | None = None) -> list[dict[str, Any]]:
        normalized_case_id = str(case_id or "").strip()
        items: list[dict[str, Any]] = []
        for path in sorted(self._root.glob("*.json"), key=lambda item: item.stat().st_mtime, reverse=True):
            try:
                payload = json.loads(path.read_text(encoding="utf-8"))
                state = normalize_case_graph_state(payload)
            except (OSError, json.JSONDecodeError, TypeError, ValueError):
                continue
            if normalized_case_id and state["caseId"] != normalized_case_id:
                continue
            items.append(
                {
                    "graphId": state["graph_id"],
                    "caseId": state["caseId"],
                    "graphName": state["graphName"],
                    "tradeCardCount": len(state["tradeCards"]),
                    "updatedAt": int(path.stat().st_mtime),
                    "chatId": state.get("chatId", ""),
                }
            )
        return items

    def write_current_context(self, graph_id: str, focus: Mapping[str, Any] | None = None) -> dict[str, Any]:
        state = self.get_graph(graph_id)
        if state is None:
            raise KeyError(graph_id)
        payload: dict[str, Any] = {
            "updatedAt": datetime.now(timezone.utc).isoformat(),
            "graphId": state["graph_id"],
            "caseId": state["caseId"],
            "graphName": state["graphName"],
            "graphFile": str(self._path_for_graph(state["graph_id"]).resolve()),
            "contextFile": str(self._context_path_for_graph(state).resolve()),
            "chatId": state.get("chatId", ""),
            "focus": dict(focus) if focus is not None else None,
        }
        self._write_atomic(self._context_path_for_graph(state), payload)
        return payload

    def write_current_context_from_metadata(
        self,
        *,
        graph_id: str,
        case_id: str,
        graph_name: str,
        chat_id: str = "",
        focus: Mapping[str, Any] | None = None,
    ) -> dict[str, Any]:
        normalized_graph_id = self._normalize_graph_id_value(graph_id)
        normalized_case_id = str(case_id or "").strip()
        if not normalized_case_id:
            raise ValueError("caseId")
        context_path = self._context_path_for_values(
            case_id=normalized_case_id,
            graph_id=normalized_graph_id,
        )
        payload: dict[str, Any] = {
            "updatedAt": datetime.now(timezone.utc).isoformat(),
            "graphId": normalized_graph_id,
            "caseId": normalized_case_id,
            "graphName": str(graph_name or "").strip(),
            "graphFile": str(self._path_for_graph(normalized_graph_id).resolve()),
            "contextFile": str(context_path.resolve()),
            "chatId": str(chat_id or "").strip(),
            "focus": dict(focus) if focus is not None else None,
        }
        self._write_atomic(context_path, payload)
        return payload

    @staticmethod
    def _write_atomic(path: Path, payload: Mapping[str, Any]) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        temp_path = path.with_suffix(".json.tmp")
        temp_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        temp_path.replace(path)
