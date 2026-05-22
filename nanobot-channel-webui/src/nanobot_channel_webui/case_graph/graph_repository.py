"""Filesystem repository for canonical case graph state and steps."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Mapping

from .graph_state_types import STEP_SCHEMA_VERSION, legacy_graph_to_document, normalize_graph_document, now_iso


class GraphRepository:
    def __init__(self, workspace_root: Path) -> None:
        self._workspace_root = workspace_root

    def graph_dir(self, case_id: str, graph_id: str) -> Path:
        return self._workspace_root / ".nanobot_channel_webui" / "case_graphs" / case_id / graph_id

    def load_current(self, case_id: str, graph_id: str) -> dict[str, Any]:
        path = self.graph_dir(case_id, graph_id) / "graph.json"
        payload = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(payload, dict) and payload.get("schemaVersion") == "case-graph.state.v1":
            return normalize_graph_document(payload)
        if isinstance(payload, dict) and isinstance(payload.get("graph"), dict):
            return normalize_graph_document({**payload, "caseId": case_id, "graphId": graph_id})
        if isinstance(payload, dict):
            return legacy_graph_to_document(case_id=case_id, graph_id=graph_id, graph=payload)
        raise ValueError("invalid graph state")

    def load_graph(self, case_id: str, graph_id: str) -> dict[str, Any]:
        return self.load_current(case_id, graph_id)["graph"]

    def append_step(
        self,
        *,
        case_id: str,
        graph_id: str,
        graph_name: str,
        operation: dict[str, Any],
        graph: dict[str, Any],
        delta: dict[str, Any],
        summary: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        graph_dir = self.graph_dir(case_id, graph_id)
        steps_dir = graph_dir / "steps"
        steps_dir.mkdir(parents=True, exist_ok=True)
        existing = sorted(steps_dir.glob("*.json"))
        base_revision = self._base_revision(case_id, graph_id)
        step_id = f"{len(existing) + 1:04d}"
        operation_type = str(operation.get("type") or "operation").strip() or "operation"
        created_at = now_iso()
        current = normalize_graph_document(
            {
                "caseId": case_id,
                "graphId": graph_id,
                "graphName": graph_name,
                "revision": base_revision + 1,
                "updatedAt": created_at,
                "lastStepId": step_id,
                "metadata": {"source": "webui"},
                "graph": graph,
            }
        )
        step_file = steps_dir / f"{step_id}-{operation_type.replace('_', '-')}.json"
        step = {
            "schemaVersion": STEP_SCHEMA_VERSION,
            "caseId": case_id,
            "graphId": graph_id,
            "stepId": step_id,
            "operation": dict(operation),
            "baseRevision": base_revision,
            "revision": current["revision"],
            "actor": "user",
            "source": "webui",
            "createdAt": created_at,
            "graph": current["graph"],
            "delta": dict(delta),
            "summary": dict(summary or {}),
            "file": str(step_file),
        }
        self._write_json(step_file, step)
        self._write_json(graph_dir / "graph.json", current)
        return {"stepId": step_id, "graph": current, "step": step}

    def update_latest_step_layout(
        self,
        *,
        case_id: str,
        graph_id: str,
        node_positions: dict[str, Any],
        viewport: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        graph_dir = self.graph_dir(case_id, graph_id)
        current = self.load_current(case_id, graph_id)
        graph = dict(current["graph"])
        previous_layout = dict(graph.get("layout") or {})
        graph["layout"] = {
            "nodePositions": dict(node_positions),
            "viewport": dict(viewport or previous_layout.get("viewport") or {}),
        }
        next_current = normalize_graph_document({**current, "graph": graph, "updatedAt": now_iso()})
        self._write_json(graph_dir / "graph.json", next_current)

        latest_step_path = self._latest_step_path(graph_dir, str(current.get("lastStepId") or ""))
        if latest_step_path is not None:
            step = json.loads(latest_step_path.read_text(encoding="utf-8"))
            if isinstance(step, dict) and step.get("schemaVersion") == STEP_SCHEMA_VERSION:
                step["graph"] = next_current["graph"]
                summary = dict(step.get("summary") or {})
                summary["layoutNodeCount"] = len(next_current["graph"]["layout"]["nodePositions"])
                step["summary"] = summary
                self._write_json(latest_step_path, step)
        return next_current

    def list_steps(self, case_id: str, graph_id: str) -> list[dict[str, Any]]:
        steps_dir = self.graph_dir(case_id, graph_id) / "steps"
        if not steps_dir.exists():
            return []
        steps: list[dict[str, Any]] = []
        for path in sorted(steps_dir.glob("*.json")):
            payload = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(payload, dict) and payload.get("schemaVersion") == STEP_SCHEMA_VERSION:
                steps.append(payload)
                continue
            if isinstance(payload, dict) and isinstance(payload.get("step"), dict):
                step = dict(payload["step"])
                step.setdefault("graph", payload.get("graph") or {})
                steps.append(step)
        return steps

    def _base_revision(self, case_id: str, graph_id: str) -> int:
        try:
            return int(self.load_current(case_id, graph_id).get("revision") or 0)
        except (FileNotFoundError, KeyError, ValueError, TypeError, json.JSONDecodeError):
            return 0

    @staticmethod
    def _latest_step_path(graph_dir: Path, last_step_id: str) -> Path | None:
        steps_dir = graph_dir / "steps"
        if not steps_dir.exists():
            return None
        candidates = sorted(steps_dir.glob(f"{last_step_id}-*.json")) if last_step_id else []
        if not candidates:
            candidates = sorted(steps_dir.glob("*.json"))
        return candidates[-1] if candidates else None

    @staticmethod
    def _write_json(path: Path, payload: Mapping[str, Any]) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        temp_path = path.with_suffix(".json.tmp")
        temp_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        temp_path.replace(path)
