"""Application service for canonical case graph state operations."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from .graph_repository import GraphRepository


class GraphStateService:
    def __init__(self, workspace_root: Path) -> None:
        self._repository = GraphRepository(workspace_root)

    def load_current(self, case_id: str, graph_id: str) -> dict[str, Any]:
        return self._repository.load_current(case_id, graph_id)

    def list_steps(self, case_id: str, graph_id: str) -> list[dict[str, Any]]:
        return self._repository.list_steps(case_id, graph_id)

    def update_layout(
        self,
        *,
        case_id: str,
        graph_id: str,
        graph_name: str = "",
        node_positions: dict[str, Any],
        viewport: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        current = self._repository.load_current(case_id, graph_id)
        graph = dict(current["graph"])
        previous_layout = dict(graph.get("layout") or {})
        next_layout = {
            "nodePositions": dict(node_positions),
            "viewport": dict(viewport or previous_layout.get("viewport") or {}),
        }
        if previous_layout == next_layout:
            return current
        graph["layout"] = next_layout
        state_result = self._repository.append_step(
            case_id=case_id,
            graph_id=graph_id,
            graph_name=graph_name or str(current.get("graphName") or ""),
            operation={
                "type": "update_layout",
                "label": "更新布局",
                "params": {"changedNodeCount": len(node_positions)},
            },
            graph=graph,
            delta={
                "addedNodes": [],
                "addedEdges": [],
                "updatedNodes": [{"id": node_id} for node_id in node_positions],
                "updatedEdges": [],
                "removedNodes": [],
                "removedEdges": [],
            },
            summary={"changedNodeCount": len(node_positions)},
        )
        return state_result["graph"]

    def update_latest_step_layout(
        self,
        *,
        case_id: str,
        graph_id: str,
        node_positions: dict[str, Any],
        viewport: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        return self._repository.update_latest_step_layout(
            case_id=case_id,
            graph_id=graph_id,
            node_positions=node_positions,
            viewport=viewport,
        )
