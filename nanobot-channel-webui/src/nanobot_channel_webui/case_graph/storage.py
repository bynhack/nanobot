"""Filesystem persistence for case graph state."""

from __future__ import annotations

import hashlib
import json
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
                }
            )
        return items

    @staticmethod
    def _write_atomic(path: Path, payload: CaseGraphState) -> None:
        temp_path = path.with_suffix(".json.tmp")
        temp_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        temp_path.replace(path)
