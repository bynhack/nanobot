"""Filesystem storage for relation graph state and analysis steps."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from .graph_repository import GraphRepository
from .operation_evidence import OperationEvidenceLevel, normalize_operation_evidence
from .relation_types import SCHEMA_VERSION


class RelationGraphStorage:
    def __init__(self, workspace_root: Path) -> None:
        self._repository = GraphRepository(workspace_root)

    def graph_dir(self, case_id: str, graph_id: str) -> Path:
        return self._repository.graph_dir(case_id, graph_id)

    def save_step(
        self,
        *,
        case_id: str,
        graph_id: str,
        step_type: str,
        request: dict[str, Any],
        graph: dict[str, Any],
        delta: dict[str, Any],
        summary: dict[str, Any],
        evidence_level: OperationEvidenceLevel | None = None,
    ) -> dict[str, Any]:
        group_operation = str(request.get("operation") or "").strip() or None
        evidence = normalize_operation_evidence(
            step_type,
            request.get("evidence") if isinstance(request.get("evidence"), dict) else None,
            group_operation=group_operation,
            level_override=evidence_level,
        )
        operation_params = {key: value for key, value in request.items() if key != "evidence"}
        state_result = self._repository.append_step(
            case_id=case_id,
            graph_id=graph_id,
            graph_name=str(request.get("graphName") or ""),
            operation={
                "type": step_type,
                "label": str(summary.get("label") or step_type),
                "params": operation_params,
                "evidence": evidence,
            },
            graph=graph,
            delta=delta,
            summary=summary,
        )
        step = state_result["step"]
        response = {
            "schemaVersion": SCHEMA_VERSION,
            "caseId": case_id,
            "graphId": graph_id,
            "queryMode": step_type,
            "step": {
                "stepId": step["stepId"],
                "type": step_type,
                "createdAt": step["createdAt"],
                "request": request,
                "evidence": evidence,
                "summary": summary,
                "file": step["file"],
            },
            "graph": state_result["graph"]["graph"],
            "graphState": state_result["graph"],
            "delta": delta,
        }
        return response

    def load_graph(self, case_id: str, graph_id: str) -> dict[str, Any]:
        return self._repository.load_graph(case_id, graph_id)

    def list_steps(self, case_id: str, graph_id: str) -> list[dict[str, Any]]:
        return self._repository.list_steps(case_id, graph_id)
