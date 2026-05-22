"""Case graph state types and normalization helpers."""

from __future__ import annotations

from typing import Any, Mapping, TypedDict


JSONScalar = str | int | float | bool | None
JSONValue = JSONScalar | list[Any] | dict[str, Any]


class CaseGraphState(TypedDict):
    graph_id: str
    caseId: str
    graphName: str
    graphContent: str
    tradeCards: list[dict[str, Any]]
    groupMap: dict[str, Any]
    graphData: JSONValue
    excludedTrades: list[str]
    excludedAccountId: JSONValue
    excludedAccountName: list[str]
    summarySelectedAccountId: list[str]
    summarySelectedAccountName: list[str]
    sourceSelectId: list[str]
    drillNums: int
    drillType: JSONValue
    minAmount: JSONValue
    maxAmount: JSONValue
    chatId: str


class CaseGraphPatch(TypedDict, total=False):
    caseId: str
    graphName: str
    graphContent: str
    tradeCards: list[dict[str, Any]]
    groupMap: dict[str, Any]
    graphData: JSONValue
    excludedTrades: list[str]
    excludedAccountId: JSONValue
    excludedAccountName: list[str]
    summarySelectedAccountId: list[str]
    summarySelectedAccountName: list[str]
    sourceSelectId: list[str]
    drillNums: int
    drillType: JSONValue
    minAmount: JSONValue
    maxAmount: JSONValue
    chatId: str


def _normalize_graph_id(payload: Mapping[str, Any]) -> str:
    graph_id = payload.get("graph_id")
    if not isinstance(graph_id, str) or not graph_id.strip():
        raise ValueError("graph_id is required")
    return graph_id.strip()


def _normalize_json_value(value: Any, *, field_name: str) -> JSONValue:
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, list):
        return [
            _normalize_json_value(item, field_name=field_name)
            for item in value
        ]
    if isinstance(value, dict):
        normalized: dict[str, Any] = {}
        for key, item in value.items():
            if not isinstance(key, str):
                raise TypeError(f"{field_name} contains non-string object key")
            normalized[key] = _normalize_json_value(item, field_name=field_name)
        return normalized
    raise TypeError(f"{field_name} contains unsupported json value type: {type(value).__name__}")


def normalize_case_graph_state(payload: Mapping[str, Any]) -> CaseGraphState:
    trade_cards = payload.get("tradeCards")
    if not isinstance(trade_cards, list):
        raise TypeError("tradeCards must be a list")
    if not all(isinstance(item, dict) for item in trade_cards):
        raise TypeError("tradeCards must contain objects")

    excluded_trades = payload.get("excludedTrades")
    if not isinstance(excluded_trades, list):
        raise TypeError("excludedTrades must be a list")

    def _normalize_string_list(field_name: str) -> list[str]:
        value = payload.get(field_name, [])
        if value is None:
            return []
        if not isinstance(value, list):
            raise TypeError(f"{field_name} must be a list")
        return [str(item) for item in value if str(item)]

    drill_nums = payload.get("drillNums", 0)
    try:
        drill_nums = int(drill_nums)
    except (TypeError, ValueError):
        drill_nums = 0

    return {
        "graph_id": _normalize_graph_id(payload),
        "caseId": str(payload.get("caseId") or ""),
        "graphName": str(payload.get("graphName") or ""),
        "graphContent": str(payload.get("graphContent") or ""),
        "tradeCards": list(trade_cards),
        "groupMap": _normalize_json_value(payload.get("groupMap") or {}, field_name="groupMap"),
        "graphData": _normalize_json_value(payload.get("graphData"), field_name="graphData"),
        "excludedTrades": [str(item) for item in excluded_trades if str(item)],
        "excludedAccountId": _normalize_json_value(
            payload.get("excludedAccountId"),
            field_name="excludedAccountId",
        ),
        "excludedAccountName": _normalize_string_list("excludedAccountName"),
        "summarySelectedAccountId": _normalize_string_list("summarySelectedAccountId"),
        "summarySelectedAccountName": _normalize_string_list("summarySelectedAccountName"),
        "sourceSelectId": _normalize_string_list("sourceSelectId"),
        "drillNums": drill_nums,
        "drillType": _normalize_json_value(payload.get("drillType"), field_name="drillType"),
        "minAmount": _normalize_json_value(payload.get("minAmount"), field_name="minAmount"),
        "maxAmount": _normalize_json_value(payload.get("maxAmount"), field_name="maxAmount"),
        "chatId": str(payload.get("chatId") or "").strip(),
    }
