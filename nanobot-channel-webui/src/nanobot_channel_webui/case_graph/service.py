"""Minimal orchestration layer for case graph queries."""

from __future__ import annotations

from typing import Any, Protocol
from uuid import uuid4

from .mysql_client import CaseGraphQueryClient, QueryPayload
from .storage import CaseGraphStorage
from .types import CaseGraphState, JSONValue

_MISSING = object()


class CaseGraphStateStore(Protocol):
    def create_graph(self, payload: dict[str, Any]) -> CaseGraphState: ...

    def get_graph(self, graph_id: str) -> CaseGraphState | None: ...

    def update_graph(self, graph_id: str, patch: dict[str, Any]) -> CaseGraphState: ...


class CaseGraphService:
    def __init__(
        self,
        *,
        storage: CaseGraphStateStore | None = None,
        query_client: CaseGraphQueryClient,
    ) -> None:
        self._storage = storage or CaseGraphStorage()
        self._query_client = query_client

    def create_graph(
        self,
        case_id: str,
        graph_name: str,
        trade_cards: list[dict[str, Any]],
    ) -> CaseGraphState:
        return self._storage.create_graph(
            {
                "graph_id": uuid4().hex,
                "caseId": case_id,
                "graphName": graph_name,
                "graphContent": "",
                "tradeCards": list(trade_cards),
                "groupMap": {},
                "graphData": None,
                "excludedTrades": [],
                "excludedAccountId": "",
                "excludedAccountName": [],
                "summarySelectedAccountId": [],
                "summarySelectedAccountName": [],
                "sourceSelectId": [],
                "drillNums": 10,
                "drillType": 1,
                "minAmount": None,
                "maxAmount": None,
            }
        )

    def list_cases(self) -> list[dict[str, Any]]:
        return self._query_client.list_cases()

    def list_accounts(self, case_id: str, keyword: str = "") -> list[dict[str, Any]]:
        return self._query_client.list_accounts(case_id, keyword)

    def list_graphs(self, case_id: str | None = None) -> list[dict[str, Any]]:
        return self._storage.list_graphs(case_id)

    def update_graph(self, graph_id: str, patch: dict[str, Any]) -> CaseGraphState:
        return self._storage.update_graph(graph_id, patch)

    def query_graph(
        self,
        graph_id: str,
        case_id: str,
        trade_cards: list[dict[str, Any]],
        **filters: Any,
    ) -> dict[str, Any]:
        state = self._require_graph(graph_id)
        resolved_filters = dict(filters)
        if (
            resolved_filters.get("isSelectedTradeCardChanged") is False
            and isinstance(state.get("sourceSelectId"), list)
            and state["sourceSelectId"]
        ):
            resolved_filters["sourceSelectId"] = list(state["sourceSelectId"])
        payload: QueryPayload = {
            "graphId": graph_id,
            "caseId": case_id,
            "tradeCards": list(trade_cards),
            "excludedTrades": state["excludedTrades"],
            "excludedAccountId": state["excludedAccountId"],
            **resolved_filters,
        }
        result = self._query_client.query_graph(payload)
        next_trade_cards = self._coerce_trade_cards(
            result.get("tradeCards", _MISSING),
            fallback=list(trade_cards),
        )
        next_excluded_trades = self._coerce_excluded_trades(
            result.get("excludedTrades", _MISSING),
            fallback=state["excludedTrades"],
        )
        next_excluded_account_id = self._coerce_json_value(
            result.get(
                "excludedAccountId",
                resolved_filters["excludedAccountId"] if "excludedAccountId" in resolved_filters else _MISSING,
            ),
            fallback=state["excludedAccountId"],
        )
        next_group_map = self._coerce_mapping(
            result.get("groups", _MISSING),
            fallback=state["groupMap"],
        )
        next_source_select_id = self._coerce_string_list(
            result.get("sourceSelectId", _MISSING),
            fallback=state["sourceSelectId"],
        )
        self._storage.update_graph(
            graph_id,
            {
                "caseId": case_id,
                "tradeCards": next_trade_cards,
                "graphData": result,
                "groupMap": next_group_map,
                "excludedTrades": next_excluded_trades,
                "excludedAccountId": next_excluded_account_id,
                "sourceSelectId": next_source_select_id,
            },
        )
        return result

    def drill_down(
        self,
        *,
        graph_id: str,
        case_id: str,
        **filters: Any,
    ) -> dict[str, list[dict[str, Any]]]:
        return self._drill_graph(graph_id=graph_id, case_id=case_id, drill_method="drill_down", **filters)

    def drill_up(
        self,
        *,
        graph_id: str,
        case_id: str,
        **filters: Any,
    ) -> dict[str, list[dict[str, Any]]]:
        return self._drill_graph(graph_id=graph_id, case_id=case_id, drill_method="drill_up", **filters)

    def drill(
        self,
        *,
        graph_id: str,
        case_id: str,
        **filters: Any,
    ) -> dict[str, list[dict[str, Any]]]:
        return self._drill_graph(graph_id=graph_id, case_id=case_id, drill_method="drill", **filters)

    def _drill_graph(
        self,
        *,
        graph_id: str,
        case_id: str,
        drill_method: str,
        **filters: Any,
    ) -> dict[str, list[dict[str, Any]]]:
        state = self._require_graph(graph_id)
        resolved_filters = dict(filters)
        resolved_filters.update(self._resolve_drill_match_fields(filters))
        payload: QueryPayload = {
            "graphId": graph_id,
            "caseId": case_id,
            "tradeCards": list(state["tradeCards"]),
            "excludedTrades": state["excludedTrades"],
            "excludedAccountId": state["excludedAccountId"],
            **resolved_filters,
        }
        new_trade_cards = getattr(self._query_client, drill_method)(payload)
        merged_trade_cards = self._merge_trade_cards(state["tradeCards"], new_trade_cards)
        self._storage.update_graph(graph_id, {"tradeCards": merged_trade_cards})
        return {"tradeCards": merged_trade_cards}

    def target_detail(
        self,
        *,
        graph_id: str,
        case_id: str,
        payer_cards: list[dict[str, Any]] | None = None,
        payee_cards: list[dict[str, Any]] | None = None,
        payer: str | None = None,
        payee: str | None = None,
        **filters: Any,
    ) -> Any:
        self._require_graph(graph_id)
        resolved_payer_cards = self._coerce_detail_cards(payer_cards, fallback_text=payer)
        resolved_payee_cards = self._coerce_detail_cards(payee_cards, fallback_text=payee)
        payload: QueryPayload = {
            "graphId": graph_id,
            "caseId": case_id,
            "payerCards": resolved_payer_cards,
            "payeeCards": resolved_payee_cards,
            **filters,
        }
        return self._query_client.target_detail(payload)

    def _require_graph(self, graph_id: str) -> CaseGraphState:
        state = self._storage.get_graph(graph_id)
        if state is None:
            raise KeyError(graph_id)
        return state

    @classmethod
    def _resolve_drill_match_fields(cls, filters: dict[str, Any]) -> dict[str, Any]:
        resolved: dict[str, Any] = {}
        match_value = cls._resolve_drill_match_value(filters)
        if not match_value:
            return resolved
        drill_type = str(filters.get("drill_type") or filters.get("direction") or "").strip().lower()
        if drill_type == "in":
            if not str(filters.get("payee") or "").strip():
                resolved["payee"] = match_value
            return resolved
        if drill_type == "out":
            if not str(filters.get("payer") or "").strip():
                resolved["payer"] = match_value
            return resolved
        if not str(filters.get("payer") or "").strip():
            resolved["payer"] = match_value
        if not str(filters.get("payee") or "").strip():
            resolved["payee"] = match_value
        return resolved

    @staticmethod
    def _resolve_drill_match_value(filters: dict[str, Any]) -> str:
        trade_cards = filters.get("tradeCard")
        if not isinstance(trade_cards, list):
            return ""
        for item in trade_cards:
            if not isinstance(item, dict):
                continue
            for raw in (item.get("accountId"), item.get("tradeCard"), item.get("accountName")):
                value = str(raw or "").strip()
                if value:
                    return value
        return ""

    @staticmethod
    def _merge_trade_cards(
        current_trade_cards: list[dict[str, Any]],
        new_trade_cards: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        merged = list(current_trade_cards)
        seen_trade_ids = {
            str(card["tradeId"])
            for card in current_trade_cards
            if isinstance(card, dict) and "tradeId" in card
        }
        for card in new_trade_cards:
            trade_id = card.get("tradeId") if isinstance(card, dict) else None
            if trade_id is not None and str(trade_id) in seen_trade_ids:
                continue
            if trade_id is not None:
                seen_trade_ids.add(str(trade_id))
            merged.append(card)
        return merged

    @staticmethod
    def _coerce_trade_cards(
        value: Any,
        *,
        fallback: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        if value is _MISSING:
            return list(fallback)
        if isinstance(value, list) and all(isinstance(item, dict) for item in value):
            return list(value)
        return list(fallback)

    @staticmethod
    def _coerce_excluded_trades(
        value: Any,
        *,
        fallback: list[str],
    ) -> list[str]:
        if value is _MISSING:
            return list(fallback)
        if isinstance(value, list):
            return [str(item) for item in value if str(item)]
        return list(fallback)

    @staticmethod
    def _coerce_json_value(value: Any, *, fallback: JSONValue) -> JSONValue:
        if value is _MISSING:
            return fallback
        if value is None:
            return None
        if isinstance(value, (str, int, float, bool, list, dict)):
            return value
        return fallback

    @staticmethod
    def _coerce_mapping(value: Any, *, fallback: dict[str, Any]) -> dict[str, Any]:
        if value is _MISSING:
            return dict(fallback)
        if isinstance(value, dict):
            return {str(key): item for key, item in value.items()}
        return dict(fallback)

    @staticmethod
    def _coerce_string_list(value: Any, *, fallback: list[str]) -> list[str]:
        if value is _MISSING:
            return list(fallback)
        if isinstance(value, list):
            return [str(item) for item in value if str(item)]
        return list(fallback)

    @staticmethod
    def _coerce_detail_cards(
        cards: list[dict[str, Any]] | None,
        *,
        fallback_text: str | None,
    ) -> list[dict[str, Any]]:
        if isinstance(cards, list):
            return [card for card in cards if isinstance(card, dict)]
        subject = str(fallback_text or "").strip()
        if not subject:
            return []
        return [{"tradeCard": subject}]
