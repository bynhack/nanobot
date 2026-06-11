"""Application service for canonical case graph state operations."""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

from ..storage_paths import case_graph_contexts_root
from .graph_repository import GraphRepository
from .graph_state_types import normalize_layout
from .graph_state_types import now_iso


class GraphStateService:
    def __init__(self, workspace_root: Path) -> None:
        self._repository = GraphRepository(workspace_root)

    def load_current(self, case_id: str, graph_id: str) -> dict[str, Any]:
        return self._repository.load_current(case_id, graph_id)

    def list_steps(self, case_id: str, graph_id: str) -> list[dict[str, Any]]:
        return self._repository.list_steps(case_id, graph_id)

    def update_graph_settings(
        self,
        *,
        case_id: str,
        graph_id: str,
        settings: dict[str, Any],
    ) -> dict[str, Any]:
        return self._repository.update_graph_settings(
            case_id=case_id,
            graph_id=graph_id,
            settings=settings,
        )

    def update_layout(
        self,
        *,
        case_id: str,
        graph_id: str,
        graph_name: str = "",
        node_positions: dict[str, Any],
        position_meta: dict[str, Any] | None = None,
        group_layout: dict[str, Any] | None = None,
        viewport: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        current = self._repository.load_current(case_id, graph_id)
        graph = dict(current["graph"])
        graph_node_ids = {
            str(node.get("id") or "").strip()
            for node in graph.get("nodes") or []
            if isinstance(node, dict) and str(node.get("id") or "").strip()
        }
        group_ids = {
            str(group.get("id") or "").strip()
            for group in graph.get("investigationGroups") or []
            if isinstance(group, dict) and str(group.get("id") or "").strip()
        }
        graph_node_positions: dict[str, dict[str, float]] = {}
        group_positions: dict[str, dict[str, float]] = {}
        for raw_node_id, raw_point in node_positions.items():
            node_id = str(raw_node_id or "").strip()
            if not node_id or not isinstance(raw_point, dict):
                continue
            try:
                x = float(raw_point.get("x"))
                y = float(raw_point.get("y"))
            except (TypeError, ValueError):
                continue
            if not math.isfinite(x) or not math.isfinite(y):
                continue
            if node_id in graph_node_ids:
                graph_node_positions[node_id] = {"x": x, "y": y}
            elif node_id in group_ids:
                group_positions[node_id] = {"x": x, "y": y}

        next_groups = []
        for group in graph.get("investigationGroups") or []:
            if not isinstance(group, dict):
                continue
            group_id = str(group.get("id") or "").strip()
            position = group_positions.get(group_id)
            next_groups.append({**group, **position} if position else group)

        previous_layout = dict(graph.get("layout") or {})
        next_layout = normalize_layout({
            "nodePositions": graph_node_positions,
            "positionMeta": dict(position_meta or previous_layout.get("positionMeta") or {}),
            "groupLayout": dict(group_layout or previous_layout.get("groupLayout") or {}),
            "viewport": dict(viewport or previous_layout.get("viewport") or {}),
        }, graph.get("nodes") or [])
        if previous_layout == next_layout and next_groups == list(graph.get("investigationGroups") or []):
            return current
        graph["layout"] = next_layout
        graph["investigationGroups"] = next_groups
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

    def update_node_note(
        self,
        *,
        case_id: str,
        graph_id: str,
        graph_name: str = "",
        node_id: str,
        note: str = "",
        source_note: str = "",
    ) -> dict[str, Any]:
        normalized_node_id = str(node_id or "").strip()
        if not normalized_node_id:
            raise ValueError("missing node_id")
        current = self._repository.load_current(case_id, graph_id)
        graph = dict(current["graph"])
        nodes = []
        changed = False
        for node in graph.get("nodes") or []:
            if not isinstance(node, dict):
                continue
            next_node = dict(node)
            if str(next_node.get("id") or "").strip() == normalized_node_id:
                next_node["note"] = str(note or "").strip()
                next_node["sourceNote"] = str(source_note or "").strip()
                changed = next_node != node
            nodes.append(next_node)
        if not any(str(node.get("id") or "").strip() == normalized_node_id for node in nodes):
            raise KeyError(normalized_node_id)
        if not changed:
            return current
        graph["nodes"] = nodes
        state_result = self._repository.append_step(
            case_id=case_id,
            graph_id=graph_id,
            graph_name=graph_name or str(current.get("graphName") or ""),
            operation={
                "type": "node_note_update",
                "label": "标注主体备注",
                "params": {"nodeId": normalized_node_id},
            },
            graph=graph,
            delta={
                "addedNodes": [],
                "addedEdges": [],
                "updatedNodes": [{"id": normalized_node_id}],
                "updatedEdges": [],
                "removedNodes": [],
                "removedEdges": [],
            },
            summary={"updatedNodeCount": 1},
        )
        return state_result["graph"]

    def update_latest_step_layout(
        self,
        *,
        case_id: str,
        graph_id: str,
        node_positions: dict[str, Any],
        position_meta: dict[str, Any] | None = None,
        group_layout: dict[str, Any] | None = None,
        viewport: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        return self._repository.update_latest_step_layout(
            case_id=case_id,
            graph_id=graph_id,
            node_positions=node_positions,
            position_meta=position_meta,
            group_layout=group_layout,
            viewport=viewport,
        )

    def write_current_context(
        self,
        *,
        case_id: str,
        graph_id: str,
        graph_name: str = "",
        chat_id: str = "",
        focus: dict[str, Any] | None = None,
        latest_step_id: str = "",
        latest_operation: dict[str, Any] | None = None,
        latest_step_summary: dict[str, Any] | None = None,
        delta_summary: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        current = self._repository.load_current(case_id, graph_id)
        graph = dict(current.get("graph") or {})
        steps = self._repository.list_steps(case_id, graph_id)
        latest_step = self._resolve_latest_step(steps, latest_step_id or str(current.get("lastStepId") or ""))
        graph_dir = self._repository.graph_dir(case_id, graph_id)
        context_path = (
            case_graph_contexts_root(self._repository._workspace_root)
            / self._safe_path_segment(case_id)
            / self._safe_path_segment(graph_id)
            / "current_context.json"
        )
        operation = latest_operation or (dict(latest_step.get("operation") or {}) if latest_step else {})
        summary = latest_step_summary or (dict(latest_step.get("summary") or {}) if latest_step else {})
        delta = dict(latest_step.get("delta") or {}) if latest_step else {}
        payload: dict[str, Any] = {
            "updatedAt": now_iso(),
            "graphId": graph_id,
            "caseId": case_id,
            "graphName": str(current.get("graphName") or graph_name or "").strip(),
            "graphFile": str((graph_dir / "graph.json").resolve()),
            "stepsDir": str((graph_dir / "steps").resolve()),
            "tradeFactsFile": str((graph_dir / "facts" / "trades.jsonl").resolve()),
            "contextFile": str(context_path.resolve()),
            "chatId": str(chat_id or "").strip(),
            "focus": dict(focus) if focus is not None else None,
            "latestStepId": str((latest_step or {}).get("stepId") or latest_step_id or current.get("lastStepId") or ""),
            "latestStepFile": str((latest_step or {}).get("file") or ""),
            "latestOperation": operation,
            "latestStepSummary": summary,
            "deltaSummary": delta_summary or self._delta_summary(delta),
            "graphStats": {
                "nodeCount": len(graph.get("nodes") or []),
                "edgeCount": len(graph.get("edges") or []),
                "tradeFactCount": len(graph.get("tradeFacts") or {}),
                "manualTradeCount": len(graph.get("manualEdges") or []),
                "realityRelationCount": len(graph.get("realityRelations") or []),
                "excludedNodeCount": len(graph.get("excludedNodes") or []),
                "excludedTradeCount": len(graph.get("excludedTrades") or []),
            },
            "availableActions": self._available_actions(graph),
        }
        self._write_json(context_path, payload)
        return payload

    @staticmethod
    def _resolve_latest_step(steps: list[dict[str, Any]], step_id: str) -> dict[str, Any] | None:
        if not steps:
            return None
        normalized_step_id = str(step_id or "").strip()
        if normalized_step_id:
            for step in steps:
                if str(step.get("stepId") or "").strip() == normalized_step_id:
                    return step
        return sorted(
            steps,
            key=lambda item: (
                int(item.get("revision") or 0),
                str(item.get("stepId") or ""),
            ),
        )[-1]

    @staticmethod
    def _delta_summary(delta: dict[str, Any]) -> dict[str, int]:
        return {
            "addedNodeCount": len(delta.get("addedNodes") or []),
            "addedEdgeCount": len(delta.get("addedEdges") or []),
            "updatedNodeCount": len(delta.get("updatedNodes") or []),
            "updatedEdgeCount": len(delta.get("updatedEdges") or []),
            "removedNodeCount": len(delta.get("removedNodes") or []),
            "removedEdgeCount": len(delta.get("removedEdges") or []),
        }

    @staticmethod
    def _available_actions(graph: dict[str, Any]) -> list[str]:
        actions = ["总结整图"]
        if graph.get("nodes"):
            actions.extend(["上钻", "下钻", "双向钻取", "全图筛选", "取消上图", "线索扩展"])
        if graph.get("edges"):
            actions.extend(["查看交易明细", "补全图上关系"])
        if graph.get("excludedNodes"):
            actions.append("恢复排除节点")
        return actions

    @staticmethod
    def _safe_path_segment(value: str) -> str:
        normalized = "".join(ch if ch.isalnum() or ch in "._-" else "-" for ch in value.strip())
        normalized = normalized.strip(".-")
        return normalized or "unknown"

    @staticmethod
    def _write_json(path: Path, payload: dict[str, Any]) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        temp_path = path.with_suffix(".json.tmp")
        temp_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        temp_path.replace(path)
