"""Canonical graph state document helpers for case graph investigation."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

STATE_SCHEMA_VERSION = "case-graph.state.v1"
STEP_SCHEMA_VERSION = "case-graph.step.v1"


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def text(value: Any) -> str:
    return str(value or "").strip()


def dict_value(value: Any) -> dict[str, Any]:
    return dict(value) if isinstance(value, dict) else {}


def list_value(value: Any) -> list[Any]:
    return list(value) if isinstance(value, list) else []


def text_list(value: Any) -> list[str]:
    if isinstance(value, (str, int, float)):
        item = text(value)
        return [item] if item else []
    return [item for item in (text(raw) for raw in list_value(value)) if item]


def finite_number(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if number != number or number in (float("inf"), float("-inf")):
        return None
    return number


def positive_int(value: Any, *, default: int) -> int:
    try:
        number = int(value)
    except (TypeError, ValueError):
        return default
    return number if number > 0 else default


def normalize_layout(value: Any, nodes: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    raw = dict_value(value)
    raw_positions = dict_value(raw.get("nodePositions"))
    positions: dict[str, dict[str, float]] = {}
    allowed_node_ids = {
        node_id for node_id in (text(node.get("id")) for node in nodes or []) if node_id
    }
    for node_id, point in raw_positions.items():
        raw_point = dict_value(point)
        x = finite_number(raw_point.get("x"))
        y = finite_number(raw_point.get("y"))
        normalized_node_id = text(node_id)
        if allowed_node_ids and normalized_node_id not in allowed_node_ids:
            continue
        if normalized_node_id and x is not None and y is not None:
            positions[normalized_node_id] = {"x": x, "y": y}
    for node in nodes or []:
        node_id = text(node.get("id"))
        x = finite_number(node.get("x"))
        y = finite_number(node.get("y"))
        if node_id and x is not None and y is not None:
            positions.setdefault(node_id, {"x": x, "y": y})
    viewport = dict_value(raw.get("viewport"))
    return {
        "nodePositions": positions,
        "viewport": {
            "x": finite_number(viewport.get("x")) or 0.0,
            "y": finite_number(viewport.get("y")) or 0.0,
            "zoom": finite_number(viewport.get("zoom")) or 1.0,
        },
    }


def normalize_filters(value: Any) -> dict[str, Any]:
    raw = dict_value(value)
    return {
        "minAmount": raw.get("minAmount"),
        "maxAmount": raw.get("maxAmount"),
        "startTime": text(raw.get("startTime")),
        "endTime": text(raw.get("endTime")),
    }


def normalize_graph_body(value: Any) -> dict[str, Any]:
    raw = dict_value(value)
    nodes = [dict(item) for item in list_value(raw.get("nodes")) if isinstance(item, dict)]
    return {
        "nodes": nodes,
        "edges": [dict(item) for item in list_value(raw.get("edges")) if isinstance(item, dict)],
        "tradeFacts": {
            text(key): dict(item)
            for key, item in dict_value(raw.get("tradeFacts")).items()
            if text(key) and isinstance(item, dict)
        },
        "factStore": dict_value(raw.get("factStore")),
        "tradeCards": [dict(item) for item in list_value(raw.get("tradeCards")) if isinstance(item, dict)],
        "groupMap": dict_value(raw.get("groupMap")),
        "investigationGroups": [dict(item) for item in list_value(raw.get("investigationGroups")) if isinstance(item, dict)],
        "sourceSelectId": text_list(raw.get("sourceSelectId")),
        "summarySelectedAccountId": text_list(raw.get("summarySelectedAccountId")),
        "summarySelectedAccountName": text_list(raw.get("summarySelectedAccountName")),
        "excludedTrades": text_list(raw.get("excludedTrades")),
        "excludedAccountId": text_list(raw.get("excludedAccountId")),
        "excludedAccountName": text_list(raw.get("excludedAccountName")),
        "layout": normalize_layout(raw.get("layout"), nodes),
        "filters": normalize_filters(raw.get("filters")),
        "drillNums": positive_int(raw.get("drillNums"), default=10),
        "drillType": raw.get("drillType") if raw.get("drillType") not in (None, "") else 1,
        "excludedNodes": [dict(item) for item in list_value(raw.get("excludedNodes")) if isinstance(item, dict)],
        "manualEdges": [dict(item) for item in list_value(raw.get("manualEdges")) if isinstance(item, dict)],
        "realityRelations": [dict(item) for item in list_value(raw.get("realityRelations")) if isinstance(item, dict)],
        "annotations": [dict(item) for item in list_value(raw.get("annotations")) if isinstance(item, dict)],
        "graphData": raw.get("graphData"),
    }


def normalize_graph_document(payload: dict[str, Any]) -> dict[str, Any]:
    return {
        "schemaVersion": STATE_SCHEMA_VERSION,
        "caseId": text(payload.get("caseId")),
        "graphId": text(payload.get("graphId")),
        "graphName": text(payload.get("graphName")),
        "revision": int(payload.get("revision") or 0),
        "updatedAt": text(payload.get("updatedAt")) or now_iso(),
        "lastStepId": text(payload.get("lastStepId")),
        "metadata": dict_value(payload.get("metadata")),
        "graph": normalize_graph_body(payload.get("graph")),
    }


def legacy_graph_to_document(
    *,
    case_id: str,
    graph_id: str,
    graph_name: str = "",
    graph: dict[str, Any],
) -> dict[str, Any]:
    return normalize_graph_document(
        {
            "caseId": case_id,
            "graphId": graph_id,
            "graphName": graph_name,
            "graph": graph,
        }
    )
