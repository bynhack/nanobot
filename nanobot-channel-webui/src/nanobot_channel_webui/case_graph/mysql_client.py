"""Minimal query-client protocol for case graph services."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
import importlib
import re
from typing import Any, Callable, Protocol


QueryPayload = dict[str, Any]
QueryResult = dict[str, Any]
TradeCardsResult = list[dict[str, Any]]
TradeDetailResult = list[dict[str, Any]]

CASH_NODE_LABELS = {
    "deposit": "现金存入",
    "withdraw": "现金取出",
}
CASH_TEXT_PATTERN = re.compile(r"ATM|卡取|卡存|柜台|现金|现金支取|现存|现取|现支|存现|取现|提现|柜面|取款|现金交易")


class CaseGraphQueryClient(Protocol):
    """Boundary for graph-related reads from the case data source."""

    def list_cases(self) -> list[dict[str, Any]]: ...

    def list_accounts(self, case_id: str, keyword: str = "") -> list[dict[str, Any]]: ...

    def case_audit_overview(self, case_id: str) -> dict[str, Any]: ...

    def query_case_audit_trades(self, payload: QueryPayload) -> list[dict[str, Any]]: ...

    def query_graph(self, payload: QueryPayload) -> QueryResult: ...

    def drill_down(self, payload: QueryPayload) -> TradeCardsResult: ...

    def drill_up(self, payload: QueryPayload) -> TradeCardsResult: ...

    def drill(self, payload: QueryPayload) -> TradeCardsResult: ...

    def target_detail(self, payload: QueryPayload) -> TradeDetailResult: ...


@dataclass(slots=True)
class DelegatingCaseGraphQueryClient:
    """Small adapter that forwards calls to injected callables."""

    list_cases_handler: Callable[[], list[dict[str, Any]]]
    list_accounts_handler: Callable[[str, str], list[dict[str, Any]]]
    query_graph_handler: Callable[[QueryPayload], QueryResult]
    drill_down_handler: Callable[[QueryPayload], TradeCardsResult]
    drill_up_handler: Callable[[QueryPayload], TradeCardsResult]
    drill_handler: Callable[[QueryPayload], TradeCardsResult]
    target_detail_handler: Callable[[QueryPayload], TradeDetailResult]
    case_audit_overview_handler: Callable[[str], dict[str, Any]] | None = None
    query_case_audit_trades_handler: Callable[[QueryPayload], list[dict[str, Any]]] | None = None

    def list_cases(self) -> list[dict[str, Any]]:
        return self.list_cases_handler()

    def list_accounts(self, case_id: str, keyword: str = "") -> list[dict[str, Any]]:
        return self.list_accounts_handler(case_id, keyword)

    def case_audit_overview(self, case_id: str) -> dict[str, Any]:
        if self.case_audit_overview_handler is None:
            return {}
        return self.case_audit_overview_handler(case_id)

    def query_case_audit_trades(self, payload: QueryPayload) -> list[dict[str, Any]]:
        if self.query_case_audit_trades_handler is None:
            return []
        return self.query_case_audit_trades_handler(payload)

    def query_graph(self, payload: QueryPayload) -> QueryResult:
        return self.query_graph_handler(payload)

    def drill_down(self, payload: QueryPayload) -> TradeCardsResult:
        return self.drill_down_handler(payload)

    def drill_up(self, payload: QueryPayload) -> TradeCardsResult:
        return self.drill_up_handler(payload)

    def drill(self, payload: QueryPayload) -> TradeCardsResult:
        return self.drill_handler(payload)

    def target_detail(self, payload: QueryPayload) -> TradeDetailResult:
        return self.target_detail_handler(payload)


@dataclass(frozen=True, slots=True)
class CaseGraphMySQLConfig:
    host: str
    port: int
    user: str
    password: str
    database: str


class _JavaHashMapKeyTracker:
    def __init__(self) -> None:
        self._capacity = 16
        self._threshold = 12
        self._size = 0
        self._buckets: list[list[tuple[str, int]]] = [[] for _ in range(self._capacity)]

    def put(self, key: str) -> None:
        hashed = self._spread_hash(self._java_string_hash(key))
        index = hashed & (self._capacity - 1)
        bucket = self._buckets[index]
        for existing_key, _existing_hash in bucket:
            if existing_key == key:
                return
        bucket.append((key, hashed))
        self._size += 1
        if self._size > self._threshold:
            self._resize()

    def remove(self, key: str) -> None:
        hashed = self._spread_hash(self._java_string_hash(key))
        index = hashed & (self._capacity - 1)
        bucket = self._buckets[index]
        for position, (existing_key, _existing_hash) in enumerate(bucket):
            if existing_key == key:
                bucket.pop(position)
                self._size -= 1
                return

    def keys(self) -> list[str]:
        ordered: list[str] = []
        for bucket in self._buckets:
            ordered.extend(key for key, _hashed in bucket)
        return ordered

    def _resize(self) -> None:
        old_buckets = self._buckets
        old_capacity = self._capacity
        self._capacity *= 2
        self._threshold *= 2
        self._buckets = [[] for _ in range(self._capacity)]
        for index, bucket in enumerate(old_buckets):
            if not bucket:
                continue
            low_bucket: list[tuple[str, int]] = []
            high_bucket: list[tuple[str, int]] = []
            for entry in bucket:
                if entry[1] & old_capacity:
                    high_bucket.append(entry)
                else:
                    low_bucket.append(entry)
            if low_bucket:
                self._buckets[index] = low_bucket
            if high_bucket:
                self._buckets[index + old_capacity] = high_bucket

    @staticmethod
    def _java_string_hash(value: str) -> int:
        hashed = 0
        for char in value:
            hashed = (31 * hashed + ord(char)) & 0xFFFFFFFF
        if hashed >= 0x80000000:
            hashed -= 0x100000000
        return hashed

    @staticmethod
    def _spread_hash(value: int) -> int:
        unsigned = value & 0xFFFFFFFF
        return (unsigned ^ (unsigned >> 16)) & 0xFFFFFFFF


@dataclass(slots=True)
class PyMySQLCaseGraphQueryClient:
    """Small real query client backed by the case-scoped MySQL tables."""

    config: CaseGraphMySQLConfig

    def list_cases(self) -> list[dict[str, Any]]:
        rows = self._query(
            """
            SELECT id, case_code, case_name, is_current
            FROM ga_case
            ORDER BY is_current DESC, update_time DESC, id DESC
            LIMIT 200
            """,
            (),
        )
        return [
            {
                "id": str(row.get("id") or ""),
                "caseCode": str(row.get("case_code") or ""),
                "caseName": str(row.get("case_name") or row.get("case_code") or row.get("id") or "").strip(),
                "isCurrent": bool(row.get("is_current")),
            }
            for row in rows
            if str(row.get("id") or "").strip()
        ]

    def list_accounts(self, case_id: str, keyword: str = "") -> list[dict[str, Any]]:
        parsed_case_id = self._parse_case_id(case_id)
        trimmed_keyword = keyword.strip()
        where_sql = ""
        params: tuple[Any, ...] = ()
        if trimmed_keyword:
            like = f"%{trimmed_keyword}%"
            where_sql = """
            WHERE CAST(account.id AS CHAR) = %s
               OR COALESCE(suspect.suspect_name, '') LIKE %s
               OR COALESCE(account.account_name, '') LIKE %s
               OR COALESCE(account.trade_card, '') LIKE %s
               OR COALESCE(account.trade_account, '') LIKE %s
            """
            params = (trimmed_keyword, like, like, like, like)

        rows = self._query(
            f"""
            SELECT
                suspect.id AS suspect_id,
                suspect.suspect_name,
                account.id,
                account.account_name,
                account.trade_card,
                account.trade_account,
                account.account_category,
                account.is_obtain
            FROM ga_account_{parsed_case_id} AS account
            INNER JOIN ga_suspect_{parsed_case_id} AS suspect
                ON (
                    COALESCE(suspect.suspect_name, '') <> ''
                    AND COALESCE(account.account_name, '') = suspect.suspect_name
                )
                OR (
                    COALESCE(suspect.card_no, '') <> ''
                    AND COALESCE(account.id_number, '') = suspect.card_no
                )
            {where_sql}
            ORDER BY suspect.id ASC, account.is_obtain DESC, account.id ASC
            LIMIT 300
            """,
            params,
        )
        items: list[dict[str, Any]] = []
        seen_account_ids: set[str] = set()
        for row in rows:
            account_id = str(row.get("id") or "").strip()
            if not account_id or account_id in seen_account_ids:
                continue
            seen_account_ids.add(account_id)
            items.append(
                {
                    "accountId": account_id,
                    "tradeCard": str(row.get("trade_card") or row.get("trade_account") or "").strip(),
                    "accountName": str(row.get("account_name") or "").strip(),
                    "suspectId": str(row.get("suspect_id") or "").strip(),
                    "suspectName": str(row.get("suspect_name") or row.get("account_name") or "").strip(),
                    "accountCategory": row.get("account_category"),
                    "isObtain": row.get("is_obtain"),
                }
            )
        return items

    def case_audit_overview(self, case_id: str) -> dict[str, Any]:
        parsed_case_id = self._parse_case_id(case_id)
        rows = self._query(
            f"""
            SELECT
                COUNT(*) AS trade_count,
                COUNT(DISTINCT file_id) AS source_file_count,
                SUM(CASE WHEN jd_flag = '借' AND payer_trade_balance IS NULL THEN 1 ELSE 0 END) AS balance_missing_count,
                MIN(trade_time) AS min_trade_time,
                MAX(trade_time) AS max_trade_time,
                COALESCE(SUM(trade_amount), 0) AS total_trade_amount
            FROM ga_trade_{parsed_case_id}
            """,
            (),
        )
        row = rows[0] if rows else {}
        return {
            "tradeCount": row.get("trade_count") or 0,
            "sourceFileCount": row.get("source_file_count") or 0,
            "balanceMissingCount": row.get("balance_missing_count") or 0,
            "minTradeTime": _json_safe_scalar(row.get("min_trade_time")),
            "maxTradeTime": _json_safe_scalar(row.get("max_trade_time")),
            "totalTradeAmount": row.get("total_trade_amount") or 0,
        }

    def query_case_audit_trades(self, payload: QueryPayload) -> list[dict[str, Any]]:
        parsed_case_id = self._parse_case_id(payload.get("caseId"))
        where_parts: list[str] = []
        params: list[Any] = []

        start_time = str(payload.get("startTime") or "").strip()
        if start_time:
            where_parts.append("trade_time >= %s")
            params.append(start_time)
        end_time = str(payload.get("endTime") or "").strip()
        if end_time:
            where_parts.append("trade_time <= %s")
            params.append(end_time)
        min_amount = str(payload.get("minAmount") or "").strip()
        if min_amount:
            where_parts.append("trade_amount >= %s")
            params.append(min_amount)
        max_amount = str(payload.get("maxAmount") or "").strip()
        if max_amount:
            where_parts.append("trade_amount <= %s")
            params.append(max_amount)

        limit = payload.get("limit")
        try:
            parsed_limit = int(limit)
        except (TypeError, ValueError):
            parsed_limit = 200_000
        parsed_limit = min(max(parsed_limit, 1), 500_000)
        where_sql = f"WHERE {' AND '.join(where_parts)}" if where_parts else ""
        rows = self._query(
            f"""
            {self._case_audit_trade_info_cte(parsed_case_id)}
            SELECT *
            FROM audit_trade_info
            {where_sql}
            ORDER BY trade_time ASC, row_id ASC
            LIMIT %s
            """,
            (*params, parsed_limit),
        )
        return rows

    def query_relation_one_hop(
        self,
        *,
        case_id: int | str,
        seed_accounts: list[dict[str, Any]],
        direction: str = "both",
        filters: QueryPayload | None = None,
    ) -> QueryResult:
        parsed_case_id = self._parse_case_id(case_id)
        normalized_direction = direction if direction in {"in", "out", "both"} else "both"
        query_filters = filters or {}
        rows: list[dict[str, Any]] = []
        for seed_group in self._relation_seed_account_groups(seed_accounts):
            seed = self._extract_trade_card_seed(seed_group)
            if not seed["account_ids"] and not seed["pay_accounts"]:
                continue
            for query_direction in self._relation_one_hop_directions(normalized_direction):
                rows.extend(
                    self._query_relation_one_hop_rows(
                        case_id=parsed_case_id,
                        seed=seed,
                        direction=query_direction,
                        query_filters=query_filters,
                    )
                )
        if not rows:
            return {"nodes": [], "edges": []}
        rows = self._dedupe_relation_rows(rows)
        graph = self._relation_graph_from_one_hop_rows(rows, seed_accounts=seed_accounts)
        graph["tradeFacts"] = self._relation_trade_facts_for_rows(parsed_case_id, rows)
        return graph

    def _query_relation_one_hop_rows(
        self,
        *,
        case_id: int,
        seed: dict[str, list[Any]],
        direction: str,
        query_filters: QueryPayload,
    ) -> list[dict[str, Any]]:
        seed_clauses, seed_params = self._seed_where_clause(seed, direction=direction)
        filter_sql, filter_params = self._trade_filter_clauses(query_filters)
        order_by_sql = "trade_amount DESC, trade_count DESC"
        if self._drill_sort_type(query_filters) == 2:
            order_by_sql = "trade_count DESC, trade_amount DESC"
        limit_sql = "" if self._is_unbounded_relation_query(query_filters) else "LIMIT %s"
        params = seed_params + filter_params
        if limit_sql:
            params += (self._query_limit(query_filters),)
        trade_info_cte = self._trade_info_cte(case_id)
        return self._query(
            f"""
            {trade_info_cte}
            SELECT
                payer_account_id,
                payer_pay_account,
                MAX(NULLIF(payer_account_name, '')) AS payer_account_name,
                payee_account_id,
                payee_pay_account,
                MAX(NULLIF(payee_account_name, '')) AS payee_account_name,
                MAX(NULLIF(cash_flag, '')) AS cash_flag,
                MAX(NULLIF(trade_type, '')) AS trade_type,
                MAX(NULLIF(trade_abstract, '')) AS trade_abstract,
                GROUP_CONCAT(DISTINCT jd_flag ORDER BY jd_flag SEPARATOR ',') AS jd_flags,
                COUNT(*) AS trade_count,
                SUM(trade_amount) AS trade_amount,
                MIN(trade_time) AS start_time,
                MAX(trade_time) AS end_time,
                GROUP_CONCAT(id ORDER BY trade_time DESC, id DESC SEPARATOR ',') AS trade_ids
            FROM trade_info
            WHERE {" AND ".join(seed_clauses)}
              {"".join(f" AND {clause}" for clause in filter_sql)}
            GROUP BY
                payer_account_id,
                payer_pay_account,
                payee_account_id,
                payee_pay_account
            ORDER BY {order_by_sql}
            {limit_sql}
            """,
            params,
        )

    def query_relation_between_accounts(
        self,
        *,
        case_id: int | str,
        accounts: list[dict[str, Any]],
        filters: QueryPayload | None = None,
    ) -> QueryResult:
        parsed_case_id = self._parse_case_id(case_id)
        account_ids = self._relation_account_ids(accounts)
        if len(account_ids) < 2:
            return {"nodes": [], "edges": []}
        placeholders = ", ".join(["%s"] * len(account_ids))
        query_filters = filters or {}
        filter_sql, filter_params = self._trade_filter_clauses(query_filters)
        limit_sql = "" if self._is_unbounded_relation_query(query_filters) else "LIMIT 500"
        trade_info_cte = self._trade_info_cte(parsed_case_id)
        rows = self._query(
            f"""
            {trade_info_cte}
            SELECT
                payer_account_id,
                payer_pay_account,
                MAX(NULLIF(payer_account_name, '')) AS payer_account_name,
                payee_account_id,
                payee_pay_account,
                MAX(NULLIF(payee_account_name, '')) AS payee_account_name,
                MAX(NULLIF(cash_flag, '')) AS cash_flag,
                MAX(NULLIF(trade_type, '')) AS trade_type,
                MAX(NULLIF(trade_abstract, '')) AS trade_abstract,
                GROUP_CONCAT(DISTINCT jd_flag ORDER BY jd_flag SEPARATOR ',') AS jd_flags,
                COUNT(*) AS trade_count,
                SUM(trade_amount) AS trade_amount,
                MIN(trade_time) AS start_time,
                MAX(trade_time) AS end_time,
                GROUP_CONCAT(id ORDER BY trade_time DESC, id DESC SEPARATOR ',') AS trade_ids
            FROM trade_info
            WHERE payer_account_id IN ({placeholders})
              AND payee_account_id IN ({placeholders})
              {"".join(f" AND {clause}" for clause in filter_sql)}
            GROUP BY
                payer_account_id,
                payer_pay_account,
                payee_account_id,
                payee_pay_account
            ORDER BY trade_amount DESC, trade_count DESC
            {limit_sql}
            """,
            tuple(account_ids + account_ids) + filter_params,
        )
        graph = self._relation_graph_from_account_rows(rows, scope="graph_internal")
        graph["tradeFacts"] = self._relation_trade_facts_for_rows(parsed_case_id, rows)
        return graph

    def query_relation_global_candidates(
        self,
        *,
        case_id: int | str,
        filters: QueryPayload | None = None,
    ) -> QueryResult:
        parsed_case_id = self._parse_case_id(case_id)
        query_filters = filters or {}
        filter_sql, filter_params = self._trade_filter_clauses(query_filters)
        filter_clause = "".join(f" AND {clause}" for clause in filter_sql)
        trade_info_cte = self._trade_info_cte(parsed_case_id)
        rows = self._query(
            f"""
            {trade_info_cte}
            SELECT
                account_id,
                pay_account,
                MAX(NULLIF(account_name, '')) AS account_name,
                SUM(received_amount) AS received_amount,
                SUM(received_count) AS received_count,
                SUM(paid_amount) AS paid_amount,
                SUM(paid_count) AS paid_count,
                MIN(min_amount) AS min_amount,
                MAX(max_amount) AS max_amount,
                MIN(start_time) AS start_time,
                MAX(end_time) AS end_time,
                GROUP_CONCAT(trade_ids ORDER BY end_time DESC SEPARATOR ',') AS trade_ids
            FROM (
                SELECT
                    payer_account_id AS account_id,
                    payer_pay_account AS pay_account,
                    MAX(NULLIF(payer_account_name, '')) AS account_name,
                    0 AS received_amount,
                    0 AS received_count,
                    SUM(trade_amount) AS paid_amount,
                    COUNT(*) AS paid_count,
                    MIN(trade_amount) AS min_amount,
                    MAX(trade_amount) AS max_amount,
                    MIN(trade_time) AS start_time,
                    MAX(trade_time) AS end_time,
                    GROUP_CONCAT(id ORDER BY trade_time DESC, id DESC SEPARATOR ',') AS trade_ids
                FROM trade_info
                WHERE (payer_account_id IS NOT NULL OR COALESCE(payer_pay_account, '') <> '')
                  {filter_clause}
                GROUP BY payer_account_id, payer_pay_account
                UNION ALL
                SELECT
                    payee_account_id AS account_id,
                    payee_pay_account AS pay_account,
                    MAX(NULLIF(payee_account_name, '')) AS account_name,
                    SUM(trade_amount) AS received_amount,
                    COUNT(*) AS received_count,
                    0 AS paid_amount,
                    0 AS paid_count,
                    MIN(trade_amount) AS min_amount,
                    MAX(trade_amount) AS max_amount,
                    MIN(trade_time) AS start_time,
                    MAX(trade_time) AS end_time,
                    GROUP_CONCAT(id ORDER BY trade_time DESC, id DESC SEPARATOR ',') AS trade_ids
                FROM trade_info
                WHERE (payee_account_id IS NOT NULL OR COALESCE(payee_pay_account, '') <> '')
                  {filter_clause}
                GROUP BY payee_account_id, payee_pay_account
            ) AS party_flows
            GROUP BY account_id, pay_account
            ORDER BY
                (SUM(received_amount) + SUM(paid_amount)) DESC,
                (SUM(received_count) + SUM(paid_count)) DESC
            """,
            filter_params + filter_params,
        )
        return {"items": self._relation_global_candidate_items(rows)}

    def query_graph(self, payload: QueryPayload) -> QueryResult:
        case_id = self._parse_case_id(payload.get("caseId"))
        seed_cards = [dict(card) for card in payload.get("tradeCards") or [] if isinstance(card, dict)]
        if not seed_cards:
            normalized_groups = self._normalize_legacy_query_groups(self._coerce_groups(payload.get("groupMap")))
            return self._build_query_result(
                nodes=[],
                money=[],
                payload=payload,
                groups=normalized_groups,
                trade_cards=[],
            )

        excluded_account_names = self._coerce_string_list(payload.get("excludedAccountName"), fallback=[])
        groups = self._coerce_groups(payload.get("groupMap"))
        working_trade_cards = self._resolve_query_trade_cards(case_id=case_id, payload=payload, seed_cards=seed_cards)

        nodes_by_id: dict[str, dict[str, Any]] = {}
        trade_account_ids: list[int] = []
        node_insert_order = self._append_query_nodes(
            nodes_by_id,
            trade_account_ids,
            working_trade_cards,
            excluded_account_names,
        )

        _first_up_cards, _first_down_cards, up_cards, down_cards = self._query_graph_expanded_cards(
            case_id=case_id,
            payload=payload,
            trade_cards=working_trade_cards,
            excluded_account_names=excluded_account_names,
        )
        expanded_cards = self._dedupe_trade_cards(up_cards + down_cards)

        up_nodes_by_id: dict[str, dict[str, Any]] = {}
        up_trade_account_ids: list[int] = []
        up_insert_order = self._append_query_nodes(
            up_nodes_by_id,
            up_trade_account_ids,
            up_cards,
            excluded_account_names,
        )
        down_nodes_by_id: dict[str, dict[str, Any]] = {}
        down_trade_account_ids: list[int] = []
        down_insert_order = self._append_query_nodes(
            down_nodes_by_id,
            down_trade_account_ids,
            down_cards,
            excluded_account_names,
        )

        trade_account_ids.extend(up_trade_account_ids)
        trade_account_ids.extend(down_trade_account_ids)
        for account_id in self._java_hash_map_key_order(up_insert_order):
            if account_id not in up_nodes_by_id:
                continue
            nodes_by_id[account_id] = up_nodes_by_id[account_id]
            node_insert_order.append(account_id)
        for account_id in self._java_hash_map_key_order(down_insert_order):
            if account_id not in down_nodes_by_id:
                continue
            nodes_by_id[account_id] = down_nodes_by_id[account_id]
            node_insert_order.append(account_id)

        self._group_card_records(expanded_cards, groups)
        normalized_groups = self._normalize_legacy_query_groups(groups)

        excluded_ids = self._coerce_excluded_account_ids(payload.get("excludedAccountId"))
        filter_sql, filter_params = self._trade_filter_clauses(payload)
        rows = self._query_main_trade_rows(
            case_id=case_id,
            account_ids=[account_id for account_id in self._dedupe_int_list(trade_account_ids) if account_id not in excluded_ids],
            excluded_trade_ids=[str(item).strip() for item in payload.get("excludedTrades") or [] if str(item).strip()],
            excluded_account_ids=excluded_ids,
            filter_sql=filter_sql,
            filter_params=filter_params,
        )

        nodes, money = self._construct_query_trade_result(
            rows=rows,
            nodes_by_id=nodes_by_id,
            groups=groups,
            excluded_account_names=excluded_account_names,
            node_insert_order=node_insert_order,
        )
        result_trade_cards = self._dedupe_trade_cards(working_trade_cards + expanded_cards)
        return self._build_query_result(
            nodes=nodes,
            money=money,
            payload=payload,
            groups=normalized_groups,
            trade_cards=result_trade_cards,
        )

    def _resolve_query_trade_cards(
        self,
        *,
        case_id: int,
        payload: QueryPayload,
        seed_cards: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        trade_cards = list(seed_cards)
        summary_ids = self._coerce_excluded_account_ids(payload.get("summarySelectedAccountId"))
        if not summary_ids:
            return trade_cards
        trade_cards.extend(self._list_accounts_by_ids(case_id, summary_ids))
        return self._dedupe_trade_cards(trade_cards)

    def _list_accounts_by_ids(self, case_id: int, account_ids: list[int]) -> list[dict[str, Any]]:
        if not account_ids:
            return []
        placeholders = ", ".join(["%s"] * len(account_ids))
        rows = self._query(
            f"""
            SELECT
                suspect.id AS suspect_id,
                suspect.suspect_name,
                account.id,
                account.account_name,
                account.trade_card,
                account.trade_account,
                account.account_bank,
                account.account_category,
                account.is_obtain
            FROM ga_account_{case_id} AS account
            LEFT JOIN ga_suspect_{case_id} AS suspect
                ON (
                    COALESCE(suspect.suspect_name, '') <> ''
                    AND COALESCE(account.account_name, '') = suspect.suspect_name
                )
                OR (
                    COALESCE(suspect.card_no, '') <> ''
                    AND COALESCE(account.id_number, '') = suspect.card_no
                )
            WHERE account.id IN ({placeholders})
            ORDER BY account.id ASC
            """,
            tuple(account_ids),
        )
        return [
            {
                "accountId": str(row.get("id") or "").strip(),
                "tradeCard": str(row.get("trade_card") or row.get("trade_account") or "").strip(),
                "accountName": str(row.get("account_name") or "").strip(),
                "suspectId": str(row.get("suspect_id") or "").strip() or None,
                "suspectName": str(row.get("suspect_name") or row.get("account_name") or "").strip(),
                "accountBank": str(row.get("account_bank") or "").strip(),
                "accountCategory": row.get("account_category"),
                "isObtain": row.get("is_obtain"),
            }
            for row in rows
            if str(row.get("id") or "").strip()
        ]

    def _query_graph_expanded_cards(
        self,
        *,
        case_id: int,
        payload: QueryPayload,
        trade_cards: list[dict[str, Any]],
        excluded_account_names: list[str],
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
        first_up = self._query_graph_drill_cards(
            case_id=case_id,
            trade_cards=trade_cards,
            direction="in",
            payload=payload,
            excluded_account_names=excluded_account_names,
        )
        first_down = self._query_graph_drill_cards(
            case_id=case_id,
            trade_cards=trade_cards,
            direction="out",
            payload=payload,
            excluded_account_names=excluded_account_names,
        )
        up_cards = self._collect_query_graph_recursive_cards(
            case_id=case_id,
            frontier=first_up,
            direction="in",
            payload=payload,
            excluded_account_names=excluded_account_names,
        )
        down_cards = self._collect_query_graph_recursive_cards(
            case_id=case_id,
            frontier=first_down,
            direction="out",
            payload=payload,
            excluded_account_names=excluded_account_names,
        )
        return first_up, first_down, up_cards, down_cards

    def _collect_query_graph_recursive_cards(
        self,
        *,
        case_id: int,
        frontier: list[dict[str, Any]],
        direction: str,
        payload: QueryPayload,
        excluded_account_names: list[str],
    ) -> list[dict[str, Any]]:
        cards: list[dict[str, Any]] = []
        current_frontier = list(frontier)
        for _ in range(2):
            if not current_frontier:
                break
            cards.extend(current_frontier)
            current_frontier = self._query_graph_drill_cards(
                case_id=case_id,
                trade_cards=current_frontier,
                direction=direction,
                payload=payload,
                excluded_account_names=excluded_account_names,
            )
        return cards

    def _query_graph_drill_cards(
        self,
        *,
        case_id: int,
        trade_cards: list[dict[str, Any]],
        direction: str,
        payload: QueryPayload,
        excluded_account_names: list[str],
    ) -> list[dict[str, Any]]:
        account_ids = [
            int(str(card.get("accountId")).strip())
            for card in trade_cards
            if str(card.get("accountId") or "").strip().isdigit()
        ]
        if not account_ids:
            return []
        filter_sql, filter_params = self._trade_filter_clauses(payload)
        rows = self._query_graph_drill_rows(
            case_id=case_id,
            frontier_ids=account_ids,
            direction=direction,
            excluded_trade_ids=[str(item).strip() for item in payload.get("excludedTrades") or [] if str(item).strip()],
            filter_sql=filter_sql,
            filter_params=filter_params,
            drill_type=1,
        )
        parsed_cards: list[dict[str, Any]] = []
        for row in rows:
            if row.get("accountStr") is not None:
                parsed_cards.extend(self._parse_account_str_cards(row.get("accountStr"), excluded_account_names))
                continue
            account_name = str(row.get("account_name") or "").strip()
            if account_name in excluded_account_names:
                continue
            parsed_cards.append(
                {
                    "tradeId": self._account_trade_id(row.get("account_id"), row.get("pay_account")),
                    "accountId": None if row.get("account_id") in (None, "") else str(row["account_id"]),
                    "tradeCard": self._resolve_trade_card_value(row.get("pay_account")),
                    "accountName": row.get("account_name") or "",
                    "suspectName": row.get("account_name") or "",
                }
            )
        return self._dedupe_trade_cards(parsed_cards)

    def _query_graph_drill_rows(
        self,
        *,
        case_id: int,
        frontier_ids: list[int],
        direction: str,
        excluded_trade_ids: list[str],
        filter_sql: list[str],
        filter_params: tuple[Any, ...],
        drill_type: int,
    ) -> list[dict[str, Any]]:
        trade_info_cte = self._trade_info_cte(case_id)
        is_in = direction == "in"
        select_prefix = "payer" if is_in else "payee"
        match_column = "payee_account_id" if is_in else "payer_account_id"
        opposite_prefix = "payee" if is_in else "payer"
        frontier_placeholders = ", ".join(["%s"] * len(frontier_ids))
        excluded_clause = ""
        params: list[Any] = list(frontier_ids)
        if excluded_trade_ids:
            excluded_clause = f"""
                AND serial_number NOT IN ({", ".join(["%s"] * len(excluded_trade_ids))})
            """
            params.extend(excluded_trade_ids)
        params.extend(filter_params)
        order_by_sql = "trade_amount DESC, trade_count DESC" if drill_type != 2 else "trade_count DESC, trade_amount DESC"
        return self._query(
            f"""
            {trade_info_cte},
            sub_query AS (
                /* compatibility marker: GROUP BY account_id, pay_account, account_name */
                SELECT
                    CONCAT(
                        IFNULL({select_prefix}_account_id, '-'),
                        '_',
                        IFNULL({select_prefix}_trade_card, '-'),
                        '_',
                        IFNULL(IFNULL(NULLIF({select_prefix}_suspect_name, ''), {select_prefix}_pay_account), '-'),
                        '_',
                        IFNULL({select_prefix}_suspect_id_number, '-'),
                        '_',
                        IFNULL({select_prefix}_bank_name, '-')
                    ) AS account,
                    IFNULL(NULLIF({select_prefix}_suspect_name, ''), {select_prefix}_pay_account) AS account_name,
                    trade_amount,
                    serial_number,
                    trade_time
                FROM trade_info
                WHERE IFNULL(NULLIF(payee_suspect_name, ''), payee_pay_account) != IFNULL(NULLIF(payer_suspect_name, ''), payer_pay_account)
                  AND {match_column} IN ({frontier_placeholders})
                  {excluded_clause}
                  {"".join(f" AND {clause}" for clause in filter_sql)}
            )
            SELECT
                GROUP_CONCAT(DISTINCT account SEPARATOR ';') AS accountStr,
                SUM(trade_amount) AS trade_amount,
                COUNT(trade_amount) AS trade_count
            FROM sub_query
            GROUP BY account_name
            ORDER BY {order_by_sql}
            LIMIT 10
            """,
            tuple(params),
        )

    def _parse_account_str_cards(
        self,
        account_str: Any,
        excluded_account_names: list[str],
    ) -> list[dict[str, Any]]:
        text = str(account_str or "").strip()
        if not text:
            return []
        excluded_names = set(excluded_account_names)
        cards: list[dict[str, Any]] = []
        for chunk in text.split(";"):
            parts = chunk.split("_")
            if len(parts) <= 1:
                continue
            account_id = parts[0].strip()
            trade_card = parts[1].strip()
            account_name = parts[2].strip() if len(parts) >= 3 else ""
            suspect_id_number = parts[3].strip() if len(parts) >= 4 else ""
            account_bank = parts[4].strip() if len(parts) >= 5 else ""
            if account_name in excluded_names:
                continue
            cards.append(
                {
                    "tradeId": self._account_trade_id(account_id or None, trade_card),
                    "accountId": None if account_id in ("", "-") else account_id,
                    "tradeCard": trade_card,
                    "accountName": account_name,
                    "suspectName": account_name,
                    "suspectIdNumber": suspect_id_number,
                    "accountBank": account_bank,
                }
            )
        return cards

    def _append_query_nodes(
        self,
        nodes_by_id: dict[str, dict[str, Any]],
        trade_account_ids: list[int],
        cards: list[dict[str, Any]],
        excluded_account_names: list[str],
    ) -> list[str]:
        excluded_names = set(excluded_account_names)
        insert_order: list[str] = []
        for card in cards:
            account_id = str(card.get("accountId") or "").strip()
            if not account_id or not account_id.isdigit():
                continue
            if str(card.get("accountName") or "").strip() in excluded_names:
                continue
            trade_account_ids.append(int(account_id))
            if account_id not in nodes_by_id:
                nodes_by_id[account_id] = self._query_node_from_card(card)
                insert_order.append(account_id)
        return insert_order

    @staticmethod
    def _query_node_from_card(card: dict[str, Any]) -> dict[str, Any]:
        account_id = str(card.get("accountId") or "").strip()
        account_name = str(card.get("suspectName") or card.get("accountName") or "").strip()
        trade_card = str(card.get("tradeCard") or "").strip() or None
        label = account_name or trade_card or account_id
        return {
            "id": account_id,
            "label": label,
            "accountId": account_id or None,
            "suspectId": str(card.get("suspectId") or "").strip() or None,
            "tradeCard": trade_card,
            "accountName": label,
            "x": None,
            "y": None,
            "bank": None,
        }

    @classmethod
    def _group_card_records(cls, records: list[dict[str, Any]], groups: dict[str, Any]) -> None:
        if groups is None:
            return
        unique_records = []
        seen_ids: set[str] = set()
        for record in records:
            account_id = str(record.get("accountId") or "").strip()
            if not account_id or account_id in seen_ids:
                continue
            seen_ids.add(account_id)
            unique_records.append(record)

        grouped: dict[str, list[dict[str, Any]]] = {}
        for record in unique_records:
            account_id = str(record.get("accountId") or "").strip()
            raw_account_name = record.get("accountName")
            if not account_id or raw_account_name is None:
                continue
            account_name = str(raw_account_name).strip()
            grouped.setdefault(account_name, []).append(record)

        existing_keys = set(groups.keys())
        for account_name, members in grouped.items():
            sorted_members = sorted(
                members,
                key=lambda item: str(item.get("accountId") or "").strip(),
            )
            if len(sorted_members) <= 1:
                continue
            group_id = "_".join(str(member.get("accountId") or "").strip() for member in sorted_members)
            group_name = account_name or "_"
            group_info = {
                "groupId": group_id,
                "groupName": group_name,
                "tradeCard": [
                    {
                        **dict(member),
                        "accountName": str(member.get("accountName") or "").strip() or "_",
                        "suspectName": str(member.get("suspectName") or member.get("accountName") or "").strip() or "_",
                        "suspectIdNumber": str(member.get("suspectIdNumber") or "").strip() or "-",
                        "accountBank": str(member.get("accountBank") or "").strip() or "-",
                    }
                    for member in sorted_members
                ],
                "tradeAmount": None,
            }
            for member in sorted_members:
                account_id = str(member.get("accountId") or "").strip()
                if account_id and account_id not in existing_keys:
                    groups[account_id] = group_info

    def _construct_query_trade_result(
        self,
        *,
        rows: list[dict[str, Any]],
        nodes_by_id: dict[str, dict[str, Any]],
        groups: dict[str, Any],
        excluded_account_names: list[str],
        node_insert_order: list[str],
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        excluded_names = set(excluded_account_names)
        for group_item in groups.values():
            if not isinstance(group_item, dict):
                continue
            group_id = str(group_item.get("groupId") or "").strip()
            group_name = str(group_item.get("groupName") or "").strip()
            if not group_id or group_name in excluded_names or group_id in nodes_by_id:
                continue
            nodes_by_id[group_id] = {
                "id": group_id,
                "label": group_name,
                "accountId": None,
                "suspectId": None,
                "tradeCard": None,
                "accountName": None,
                "x": None,
                "y": None,
                "bank": None,
            }
            node_insert_order.append(group_id)

        group_edges: dict[str, dict[str, Any]] = {}
        group_edge_insert_order: list[str] = []
        money: list[dict[str, Any]] = []
        group_member_ids = set(groups.keys())
        for row in rows:
            payer_account_id = row.get("payer_account_id")
            payee_account_id = row.get("payee_account_id")
            if payer_account_id in (None, "") or payee_account_id in (None, ""):
                continue
            payer_id = str(payer_account_id)
            payee_id = str(payee_account_id)
            edge = {
                "from": payer_id,
                "to": payee_id,
                "amount": float(row.get("amount") or row.get("trade_amount") or 0),
                "count": int(row.get("count") or row.get("trade_count") or 0),
                "startDate": _json_safe_scalar(row.get("start_date") or row.get("startDate")),
                "endDate": _json_safe_scalar(row.get("end_date") or row.get("endDate")),
            }
            is_group = False
            payer_group = groups.get(payer_id)
            payee_group = groups.get(payee_id)
            if isinstance(payer_group, dict):
                edge["from"] = str(payer_group.get("groupId") or edge["from"])
                is_group = True
            if isinstance(payee_group, dict):
                edge["to"] = str(payee_group.get("groupId") or edge["to"])
                is_group = True
            if edge["from"] == edge["to"]:
                continue
            if is_group:
                key = f"{edge['from']}_{edge['to']}"
                current = group_edges.get(key)
                if current is None:
                    group_edges[key] = edge
                    group_edge_insert_order.append(key)
                else:
                    group_edges[key] = self._merge_group_edge_with_legacy_dates(current, edge)
                continue
            money.append(edge)

        money.extend(
            group_edges[key]
            for key in self._java_hash_map_key_order(group_edge_insert_order)
            if key in group_edges
        )
        for account_id in group_member_ids:
            nodes_by_id.pop(account_id, None)
        ordered_node_ids = self._java_hash_map_key_order(node_insert_order, removed_keys=group_member_ids)
        return [nodes_by_id[node_id] for node_id in ordered_node_ids if node_id in nodes_by_id], money

    @staticmethod
    def _dedupe_trade_cards(cards: list[dict[str, Any]]) -> list[dict[str, Any]]:
        deduped: list[dict[str, Any]] = []
        seen_ids: set[str] = set()
        for card in cards:
            account_id = str(card.get("accountId") or "").strip()
            if not account_id or account_id in seen_ids:
                continue
            seen_ids.add(account_id)
            deduped.append(card)
        return deduped

    @classmethod
    def _java_hash_map_key_order(
        cls,
        inserted_keys: list[str],
        *,
        removed_keys: set[str] | None = None,
    ) -> list[str]:
        tracker = _JavaHashMapKeyTracker()
        for key in inserted_keys:
            tracker.put(str(key))
        for key in removed_keys or set():
            tracker.remove(str(key))
        return tracker.keys()

    @staticmethod
    def _dedupe_int_list(values: list[int]) -> list[int]:
        deduped: list[int] = []
        seen: set[int] = set()
        for value in values:
            if value in seen:
                continue
            seen.add(value)
            deduped.append(value)
        return deduped

    @staticmethod
    def _merge_group_edge_with_legacy_dates(previous: dict[str, Any], current: dict[str, Any]) -> dict[str, Any]:
        merged = dict(current)
        merged["amount"] = float(current.get("amount") or 0) + float(previous.get("amount") or 0)
        merged["count"] = int(current.get("count") or 0) + int(previous.get("count") or 0)

        start_date_sub = str(previous.get("startDate") or "")
        start_date_cur = str(current.get("startDate") or "")
        if start_date_sub:
            merged["startDate"] = start_date_cur or start_date_sub

        end_date_sub = str(previous.get("endDate") or "")
        end_date_cur = str(current.get("endDate") or "")
        if end_date_sub and end_date_cur:
            if end_date_sub < end_date_cur:
                merged["endDate"] = end_date_cur
            else:
                merged["startDate"] = end_date_sub
        elif end_date_sub and not end_date_cur:
            merged["startDate"] = end_date_sub
        return merged

    def drill_down(self, payload: QueryPayload) -> TradeCardsResult:
        return self._drill(payload, default_direction="out")

    def drill_up(self, payload: QueryPayload) -> TradeCardsResult:
        return self._drill(payload, default_direction="in")

    def drill(self, payload: QueryPayload) -> TradeCardsResult:
        return self._drill(payload, default_direction="both")

    def _drill(self, payload: QueryPayload, *, default_direction: str) -> TradeCardsResult:
        case_id = self._parse_case_id(payload.get("caseId"))
        excluded_sql, excluded_params = self._exclusion_clause(payload)
        filter_sql, filter_params = self._trade_filter_clauses(payload)
        direction = str(payload.get("drill_type") or payload.get("direction") or default_direction).strip().lower()
        drill_type = self._drill_sort_type(payload)
        match_values = self._drill_match_values(payload)

        rows: list[dict[str, Any]] = []
        if direction == "in":
            if match_values:
                rows = self._counterparty_rows(
                    case_id=case_id,
                    match_side="payee",
                    match_values=match_values,
                    select_side="payer",
                    excluded_sql=excluded_sql + filter_sql,
                    excluded_params=excluded_params + filter_params,
                    drill_type=drill_type,
                    limit=self._query_limit(payload),
                )
        elif direction == "out":
            if match_values:
                rows = self._counterparty_rows(
                    case_id=case_id,
                    match_side="payer",
                    match_values=match_values,
                    select_side="payee",
                    excluded_sql=excluded_sql + filter_sql,
                    excluded_params=excluded_params + filter_params,
                    drill_type=drill_type,
                    limit=self._query_limit(payload),
                )
        else:
            if match_values:
                rows.extend(
                    self._counterparty_rows(
                        case_id=case_id,
                        match_side="payer",
                        match_values=match_values,
                        select_side="payee",
                        excluded_sql=excluded_sql + filter_sql,
                        excluded_params=excluded_params + filter_params,
                        drill_type=drill_type,
                        limit=self._query_limit(payload),
                    )
                )
                rows.extend(
                    self._counterparty_rows(
                        case_id=case_id,
                        match_side="payee",
                        match_values=match_values,
                        select_side="payer",
                        excluded_sql=excluded_sql + filter_sql,
                        excluded_params=excluded_params + filter_params,
                        drill_type=drill_type,
                        limit=self._query_limit(payload),
                    )
                )

        current_keys = {
            self._trade_card_key(card)
            for card in payload.get("tradeCards") or []
            if isinstance(card, dict)
        }
        current_keys.update(
            self._trade_card_key(card)
            for card in payload.get("excludedCards") or []
            if isinstance(card, dict)
        )
        results: TradeCardsResult = []
        for row in rows or []:
            if not isinstance(row, dict):
                continue
            card = {
                "tradeId": self._account_trade_id(row.get("account_id"), row.get("pay_account")),
                "accountId": None if row.get("account_id") in (None, "") else str(row["account_id"]),
                "tradeCard": row.get("pay_account") or "",
                "accountName": row.get("account_name") or "",
            }
            key = self._trade_card_key(card)
            if key in current_keys:
                continue
            current_keys.add(key)
            results.append(card)
        return results

    def target_detail(self, payload: QueryPayload) -> TradeDetailResult:
        case_id = self._parse_case_id(payload.get("caseId"))
        payer_cards = self._extract_detail_cards(payload.get("payerCards"), fallback_text=payload.get("payer"))
        payee_cards = self._extract_detail_cards(payload.get("payeeCards"), fallback_text=payload.get("payee"))
        if not payer_cards or not payee_cards:
            return []
        excluded_sql, excluded_params = self._exclusion_clause(payload)
        filter_sql, filter_params = self._trade_filter_clauses(payload)

        rows = self._query(
            f"""
            SELECT
                id,
                serial_number,
                trade_amount,
                trade_time,
                trade_abstract,
                payer_account_id,
                payer_account_name,
                payer_pay_account,
                payee_account_id,
                payee_account_name,
                payee_pay_account
            FROM ga_trade_{case_id}
            WHERE ({self._detail_cards_match_sql('payer', payer_cards)})
              AND ({self._detail_cards_match_sql('payee', payee_cards)})
              {"".join(f" AND {clause}" for clause in excluded_sql)}
              {"".join(f" AND {clause}" for clause in filter_sql)}
            ORDER BY trade_time DESC, id DESC
            LIMIT %s
            """,
            self._detail_cards_match_params(payer_cards)
            + self._detail_cards_match_params(payee_cards)
            + excluded_params
            + filter_params
            + (self._detail_limit(payload),),
        )
        payer_name_index = self._detail_card_name_index(payer_cards)
        payee_name_index = self._detail_card_name_index(payee_cards)

        return [
            {
                "tradeId": row.get("id"),
                "serialNumber": row.get("serial_number"),
                "tradeAmount": float(row.get("trade_amount") or 0),
                "tradeTime": _json_safe_scalar(row.get("trade_time")),
                "tradeAbstract": row.get("trade_abstract") or "",
                "payerAccountId": row.get("payer_account_id"),
                "payerAccountName": row.get("payer_account_name")
                or self._resolve_detail_card_name(
                    payer_name_index,
                    row.get("payer_account_id"),
                    row.get("payer_pay_account"),
                ),
                "payerTradeCard": row.get("payer_pay_account") or "",
                "payeeAccountId": row.get("payee_account_id"),
                "payeeAccountName": row.get("payee_account_name")
                or self._resolve_detail_card_name(
                    payee_name_index,
                    row.get("payee_account_id"),
                    row.get("payee_pay_account"),
                ),
                "payeeTradeCard": row.get("payee_pay_account") or "",
            }
            for row in rows
        ]

    def _query(self, sql: str, params: tuple[Any, ...]) -> list[dict[str, Any]]:
        pymysql, dict_cursor = _load_pymysql()
        connection = pymysql.connect(
            host=self.config.host,
            port=self.config.port,
            user=self.config.user,
            password=self.config.password,
            database=self.config.database,
            cursorclass=dict_cursor,
            charset="utf8mb4",
        )
        try:
            with connection.cursor() as cursor:
                cursor.execute("SET SESSION group_concat_max_len = 16777216")
                cursor.execute(sql, params)
                return list(cursor.fetchall())
        finally:
            connection.close()

    @staticmethod
    def _parse_case_id(value: Any) -> int:
        text = str(value or "").strip()
        match = re.search(r"(\d+)$", text)
        if match is None:
            raise ValueError(f"invalid caseId: {value}")
        return int(match.group(1))

    @staticmethod
    def _case_audit_trade_info_cte(case_id: int) -> str:
        return f"""
            WITH suspect_account AS (
                SELECT *, ROW_NUMBER() OVER (
                    PARTITION BY trade_card, account_name, account_time
                    ORDER BY account_category
                ) AS rn
                FROM (
                    SELECT
                        u.id AS suspect_id,
                        u.card_no AS suspect_id_number,
                        u.suspect_name AS suspect_name,
                        a.id AS account_id,
                        a.trade_card AS trade_card,
                        a.trade_account AS trade_account,
                        a.account_name AS account_name,
                        a.account_time AS account_time,
                        a.cancel_time AS cancel_time,
                        a.account_category AS account_category,
                        a.account_bank AS account_bank,
                        a.is_obtain AS is_obtain
                    FROM ga_suspect_{case_id} u
                    LEFT JOIN ga_account_{case_id} a
                        ON u.card_no = a.id_number
                    WHERE a.id_number IS NOT NULL
                      AND a.id_number <> ''

                    UNION

                    SELECT
                        u.id AS suspect_id,
                        IFNULL(NULLIF(u.card_no, ''), a.id_number) AS suspect_id_number,
                        u.suspect_name AS suspect_name,
                        a.id AS account_id,
                        a.trade_card AS trade_card,
                        a.trade_account AS trade_account,
                        a.account_name AS account_name,
                        a.account_time AS account_time,
                        a.cancel_time AS cancel_time,
                        a.account_category AS account_category,
                        a.account_bank AS account_bank,
                        a.is_obtain AS is_obtain
                    FROM ga_suspect_{case_id} u
                    LEFT JOIN ga_account_{case_id} a
                        ON (u.suspect_name = a.account_name OR u.suspect_name = a.trade_card)
                    WHERE (a.id_number IS NULL OR a.id_number = '' OR u.card_no <> a.id_number)
                ) suspect_account_raw
            ),
            audit_trade_info AS (
                SELECT
                    COALESCE(NULLIF(CAST(gt.order_no AS CHAR), ''), CAST(gt.id AS CHAR)) AS id,
                    gt.id AS row_id,
                    gt.file_id,
                    COALESCE(NULLIF(fm.original_file_name, ''), NULLIF(fm.file_name, ''), CAST(gt.file_id AS CHAR), '') AS file_name,
                    gt.serial_number,
                    gt.trade_amount,
                    gt.trade_time,
                    gt.jd_flag,
                    payee.suspect_id AS payee_suspect_id,
                    COALESCE(NULLIF(gt.payee_account_name, ''), NULLIF(payee.account_name, ''), NULLIF(payee.suspect_name, ''), NULLIF(payee_account.account_name, ''), gt.payee_account_name) AS payee_account_name,
                    IFNULL(NULLIF(payee.trade_card, ''), gt.payee_pay_account) AS payee_trade_card,
                    gt.payee_account_id AS payee_account_id,
                    payer.suspect_id AS payer_suspect_id,
                    COALESCE(NULLIF(gt.payer_account_name, ''), NULLIF(payer.account_name, ''), NULLIF(payer.suspect_name, ''), NULLIF(payer_account.account_name, ''), gt.payer_account_name) AS payer_account_name,
                    IFNULL(NULLIF(payer.trade_card, ''), gt.payer_pay_account) AS payer_trade_card,
                    gt.payer_account_id AS payer_account_id,
                    gt.trade_balance,
                    gt.payer_trade_balance
                FROM ga_trade_{case_id} gt
                LEFT JOIN file_manager fm
                    ON gt.file_id = fm.id
                LEFT JOIN suspect_account payee
                    ON gt.payee_account_id = payee.account_id
                   AND payee.rn = 1
                LEFT JOIN ga_account_{case_id} payee_account
                    ON gt.payee_account_id = payee_account.id
                LEFT JOIN suspect_account payer
                    ON gt.payer_account_id = payer.account_id
                   AND payer.rn = 1
                LEFT JOIN ga_account_{case_id} payer_account
                    ON gt.payer_account_id = payer_account.id
            )
        """

    @staticmethod
    def _extract_trade_card_seed(trade_cards: Any) -> dict[str, list[Any]]:
        account_ids: list[int] = []
        pay_accounts: list[str] = []
        for item in trade_cards or []:
            if not isinstance(item, dict):
                continue
            account_id = item.get("accountId")
            if account_id not in (None, ""):
                try:
                    account_ids.append(int(account_id))
                except (TypeError, ValueError):
                    pass
            for key in ("tradeCard", "payAccount", "accountNo"):
                value = str(item.get(key) or "").strip()
                if value:
                    pay_accounts.append(value)
                    break
        return {
            "account_ids": list(dict.fromkeys(account_ids)),
            "pay_accounts": list(dict.fromkeys(pay_accounts)),
        }

    @staticmethod
    def _seed_where_clause(seed: dict[str, list[Any]], *, direction: str) -> tuple[list[str], tuple[Any, ...]]:
        account_ids = seed["account_ids"]
        pay_accounts = seed["pay_accounts"]
        inbound = direction == "in"
        outbound = direction == "out"

        matchers: list[str] = []
        params: list[Any] = []
        if account_ids:
            placeholders = ",".join(["%s"] * len(account_ids))
            if not inbound:
                matchers.append(f"payer_account_id IN ({placeholders})")
                params.extend(account_ids)
            if not outbound:
                matchers.append(f"payee_account_id IN ({placeholders})")
                params.extend(account_ids)
        if pay_accounts:
            placeholders = ",".join(["%s"] * len(pay_accounts))
            if not inbound:
                matchers.append(f"payer_pay_account IN ({placeholders})")
                params.extend(pay_accounts)
            if not outbound:
                matchers.append(f"payee_pay_account IN ({placeholders})")
                params.extend(pay_accounts)
        if not matchers:
            return ["1 = 0"], ()
        return [
            "(payer_account_id IS NOT NULL OR COALESCE(payer_pay_account, '') <> '')",
            "(payee_account_id IS NOT NULL OR COALESCE(payee_pay_account, '') <> '')",
            "(" + " OR ".join(matchers) + ")",
        ], tuple(params)

    @staticmethod
    def _exclusion_clause(payload: QueryPayload) -> tuple[list[str], tuple[Any, ...]]:
        clauses: list[str] = []
        params: list[Any] = []

        excluded_trades = [str(item).strip() for item in payload.get("excludedTrades") or [] if str(item).strip()]
        numeric_trade_ids = [int(item) for item in excluded_trades if item.isdigit()]
        serial_numbers = [item for item in excluded_trades if not item.isdigit()]
        if numeric_trade_ids:
            clauses.append("id NOT IN (" + ",".join(["%s"] * len(numeric_trade_ids)) + ")")
            params.extend(numeric_trade_ids)
        if serial_numbers:
            clauses.append("serial_number NOT IN (" + ",".join(["%s"] * len(serial_numbers)) + ")")
            params.extend(serial_numbers)

        excluded_account = payload.get("excludedAccountId")
        account_values = excluded_account if isinstance(excluded_account, list) else [excluded_account]
        excluded_accounts = [str(item).strip() for item in account_values if str(item or "").strip()]
        numeric_accounts = [int(item) for item in excluded_accounts if item.isdigit()]
        account_cards = [item for item in excluded_accounts if not item.isdigit()]
        if numeric_accounts:
            placeholders = ",".join(["%s"] * len(numeric_accounts))
            clauses.append(
                "(payer_account_id NOT IN (" + placeholders + ") AND payee_account_id NOT IN (" + placeholders + "))"
            )
            params.extend(numeric_accounts)
            params.extend(numeric_accounts)
        if account_cards:
            placeholders = ",".join(["%s"] * len(account_cards))
            clauses.append(
                "(payer_pay_account NOT IN (" + placeholders + ") AND payee_pay_account NOT IN (" + placeholders + "))"
            )
            params.extend(account_cards)
            params.extend(account_cards)
        return clauses, tuple(params)

    @classmethod
    def _graph_from_rows(
        cls,
        rows: list[dict[str, Any]],
        *,
        seed_cards: list[dict[str, Any]] | None = None,
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        nodes_by_id: dict[str, dict[str, Any]] = {}
        for card in seed_cards or []:
            account_id = str(card.get("accountId") or "").strip()
            trade_card = str(card.get("tradeCard") or card.get("payAccount") or "").strip()
            if not account_id and not trade_card:
                continue
            node_id = cls._node_id(account_id, trade_card)
            label = str(
                card.get("suspectName")
                or card.get("accountName")
                or trade_card
                or node_id
            ).strip()
            nodes_by_id[node_id] = {
                "id": node_id,
                "accountId": account_id or None,
                "tradeCard": trade_card,
                "label": label,
                "accountName": label,
                "name": label,
                "suspectId": str(card.get("suspectId") or "").strip() or None,
            }
        money: list[dict[str, Any]] = []
        for row in rows:
            source_id = PyMySQLCaseGraphQueryClient._node_id(row.get("payer_account_id"), row.get("payer_pay_account"))
            target_id = PyMySQLCaseGraphQueryClient._node_id(row.get("payee_account_id"), row.get("payee_pay_account"))
            nodes_by_id.setdefault(
                source_id,
                {
                    "id": source_id,
                    "accountId": None if row.get("payer_account_id") is None else str(row["payer_account_id"]),
                    "tradeCard": cls._resolve_trade_card_value(
                        row.get("payer_trade_card"),
                        row.get("payer_bank_number"),
                        row.get("payer_pay_account"),
                    ),
                    "label": row.get("payer_name") or cls._resolve_trade_card_value(
                        row.get("payer_trade_card"),
                        row.get("payer_bank_number"),
                        row.get("payer_pay_account"),
                    ) or source_id,
                    "accountName": row.get("payer_name") or cls._resolve_trade_card_value(
                        row.get("payer_trade_card"),
                        row.get("payer_bank_number"),
                        row.get("payer_pay_account"),
                    ) or "",
                    "name": row.get("payer_name") or cls._resolve_trade_card_value(
                        row.get("payer_trade_card"),
                        row.get("payer_bank_number"),
                        row.get("payer_pay_account"),
                    ) or source_id,
                },
            )
            nodes_by_id.setdefault(
                target_id,
                {
                    "id": target_id,
                    "accountId": None if row.get("payee_account_id") is None else str(row["payee_account_id"]),
                    "tradeCard": cls._resolve_trade_card_value(
                        row.get("payee_trade_card"),
                        row.get("payee_bank_number"),
                        row.get("payee_pay_account"),
                    ),
                    "label": row.get("payee_name") or cls._resolve_trade_card_value(
                        row.get("payee_trade_card"),
                        row.get("payee_bank_number"),
                        row.get("payee_pay_account"),
                    ) or target_id,
                    "accountName": row.get("payee_name") or cls._resolve_trade_card_value(
                        row.get("payee_trade_card"),
                        row.get("payee_bank_number"),
                        row.get("payee_pay_account"),
                    ) or "",
                    "name": row.get("payee_name") or cls._resolve_trade_card_value(
                        row.get("payee_trade_card"),
                        row.get("payee_bank_number"),
                        row.get("payee_pay_account"),
                    ) or target_id,
                },
            )
            money.append(
                {
                    "id": f"{source_id}->{target_id}",
                    "from": source_id,
                    "to": target_id,
                    "amount": float(row.get("trade_amount") or 0),
                    "count": int(row.get("trade_count") or 0),
                    "tradeAmount": float(row.get("trade_amount") or 0),
                    "tradeCount": int(row.get("trade_count") or 0),
                    "startDate": _json_safe_scalar(row.get("start_date")),
                    "endDate": _json_safe_scalar(row.get("end_date")),
                }
            )
        return list(nodes_by_id.values()), money

    @classmethod
    def _relation_graph_from_one_hop_rows(
        cls,
        rows: list[dict[str, Any]],
        *,
        seed_accounts: list[dict[str, Any]],
    ) -> QueryResult:
        seed_nodes = cls._relation_seed_nodes(seed_accounts)
        nodes_by_id: dict[str, dict[str, Any]] = {node["id"]: node for node in seed_nodes}
        seed_lookup = cls._relation_seed_lookup(seed_nodes)
        edges: list[dict[str, Any]] = []
        for row in rows:
            payer_seed_id = cls._relation_party_seed_node_id(row, "payer", seed_lookup)
            payee_seed_id = cls._relation_party_seed_node_id(row, "payee", seed_lookup)
            if payer_seed_id and payee_seed_id and payer_seed_id == payee_seed_id:
                continue
            if payer_seed_id and payee_seed_id:
                source_id = payer_seed_id
                target_id = payee_seed_id
                counterparty = None
            elif payer_seed_id:
                counterparty = cls._relation_party_node(row, "payee")
                source_id = payer_seed_id
                target_id = counterparty["id"]
            elif payee_seed_id:
                counterparty = cls._relation_party_node(row, "payer")
                source_id = counterparty["id"]
                target_id = payee_seed_id
            else:
                continue
            if counterparty is not None:
                nodes_by_id.setdefault(counterparty["id"], counterparty)
            edges.append(
                {
                    "id": f"money:{source_id}->{target_id}",
                    "from": source_id,
                    "to": target_id,
                    "source": source_id,
                    "target": target_id,
                    "scope": "seed_to_counterparty",
                    "tradeAmount": float(row.get("trade_amount") or 0),
                    "tradeCount": int(row.get("trade_count") or 0),
                    "startTime": _json_safe_scalar(row.get("start_time") or row.get("startDate")),
                    "endTime": _json_safe_scalar(row.get("end_time") or row.get("endDate")),
                    "tradeIds": cls._relation_trade_ids(row),
                }
            )
        return {"nodes": list(nodes_by_id.values()), "edges": edges}

    @classmethod
    def _relation_seed_nodes(cls, seed_accounts: list[dict[str, Any]]) -> list[dict[str, Any]]:
        return [cls._relation_seed_node(accounts) for accounts in cls._relation_seed_account_groups(seed_accounts)]

    @classmethod
    def _relation_seed_account_groups(cls, seed_accounts: list[dict[str, Any]]) -> list[list[dict[str, Any]]]:
        groups: dict[str, list[dict[str, Any]]] = {}
        for account in seed_accounts:
            key = cls._relation_seed_group_key(account)
            groups.setdefault(key, []).append(account)
        return list(groups.values())

    @staticmethod
    def _relation_one_hop_directions(direction: str) -> list[str]:
        if direction == "in":
            return ["in"]
        if direction == "out":
            return ["out"]
        return ["in", "out"]

    @classmethod
    def _dedupe_relation_rows(cls, rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
        deduped: dict[tuple[str, str, str, str], dict[str, Any]] = {}
        for row in rows:
            key = cls._relation_row_pair_key(row)
            if key not in deduped:
                deduped[key] = dict(row)
        return list(deduped.values())

    @staticmethod
    def _relation_row_pair_key(row: dict[str, Any]) -> tuple[str, str, str, str]:
        return (
            str(row.get("payer_account_id") or "").strip(),
            str(row.get("payer_pay_account") or "").strip(),
            str(row.get("payee_account_id") or "").strip(),
            str(row.get("payee_pay_account") or "").strip(),
        )

    @staticmethod
    def _relation_seed_group_key(account: dict[str, Any]) -> str:
        suspect_id = str(account.get("suspectId") or "").strip()
        if suspect_id:
            return f"suspect:{suspect_id}"
        suspect_name = str(account.get("suspectName") or "").strip()
        if suspect_name:
            return f"name:{suspect_name}"
        account_name = str(account.get("accountName") or "").strip()
        if account_name:
            return f"account-name:{account_name}"
        account_id = str(account.get("accountId") or "").strip()
        if account_id:
            return f"account:{account_id}"
        trade_card = str(account.get("tradeCard") or account.get("payAccount") or "").strip()
        return f"card:{trade_card or 'seed'}"

    @classmethod
    def _relation_seed_node(cls, seed_accounts: list[dict[str, Any]]) -> dict[str, Any]:
        first = seed_accounts[0] if seed_accounts else {}
        suspect_id = str(first.get("suspectId") or "").strip()
        suspect_name = str(first.get("suspectName") or first.get("accountName") or "").strip()
        account_ids = [
            str(account.get("accountId") or "").strip()
            for account in seed_accounts
            if str(account.get("accountId") or "").strip()
        ]
        accounts = [
            {
                "accountId": str(account.get("accountId") or "").strip() or None,
                "tradeCard": str(account.get("tradeCard") or account.get("payAccount") or "").strip(),
                "accountName": str(account.get("accountName") or suspect_name).strip(),
            }
            for account in seed_accounts
            if str(account.get("accountId") or account.get("tradeCard") or account.get("payAccount") or "").strip()
        ]
        node_key = suspect_id or suspect_name or (account_ids[0] if account_ids else "seed")
        node_id = f"subject:suspect:{node_key}" if suspect_id else f"subject:{node_key}"
        return {
            "id": node_id,
            "type": "subject",
            "role": "seed",
            "label": suspect_name or node_key,
            "suspectId": suspect_id or None,
            "suspectName": suspect_name,
            "accountIds": account_ids,
            "accounts": accounts,
            "depth": 0,
        }

    @staticmethod
    def _relation_seed_lookup(seed_nodes: list[dict[str, Any]]) -> dict[str, dict[str, str]]:
        account_ids: dict[str, str] = {}
        pay_accounts: dict[str, str] = {}
        for node in seed_nodes:
            node_id = str(node.get("id") or "").strip()
            if not node_id:
                continue
            for account_id in node.get("accountIds") or []:
                normalized_account_id = str(account_id or "").strip()
                if normalized_account_id:
                    account_ids[normalized_account_id] = node_id
            for account in node.get("accounts") or []:
                if not isinstance(account, dict):
                    continue
                normalized_account_id = str(account.get("accountId") or "").strip()
                trade_card = str(account.get("tradeCard") or account.get("payAccount") or "").strip()
                if normalized_account_id:
                    account_ids[normalized_account_id] = node_id
                if trade_card:
                    pay_accounts[trade_card] = node_id
        return {"accountIds": account_ids, "payAccounts": pay_accounts}

    @staticmethod
    def _relation_party_seed_node_id(
        row: dict[str, Any],
        prefix: str,
        seed_lookup: dict[str, dict[str, str]],
    ) -> str | None:
        account_id = str(row.get(f"{prefix}_account_id") or "").strip()
        pay_account = str(row.get(f"{prefix}_pay_account") or "").strip()
        return (
            seed_lookup["accountIds"].get(account_id)
            if account_id
            else None
        ) or (
            seed_lookup["payAccounts"].get(pay_account)
            if pay_account
            else None
        )

    @staticmethod
    def _relation_party_is_seed(
        row: dict[str, Any],
        prefix: str,
        seed_ids: set[str],
        seed_cards: set[str],
    ) -> bool:
        account_id = str(row.get(f"{prefix}_account_id") or "").strip()
        pay_account = str(row.get(f"{prefix}_pay_account") or "").strip()
        return (account_id and account_id in seed_ids) or (pay_account and pay_account in seed_cards)

    @classmethod
    def _relation_party_node(cls, row: dict[str, Any], prefix: str) -> dict[str, Any]:
        account_id = str(row.get(f"{prefix}_account_id") or "").strip()
        trade_card = str(row.get(f"{prefix}_pay_account") or "").strip()
        account_name = str(row.get(f"{prefix}_account_name") or "").strip()
        cash_direction = cls._relation_cash_direction(row, prefix)
        if cash_direction:
            label = CASH_NODE_LABELS[cash_direction]
            cash_key = account_id or trade_card or cash_direction
            node_id = f"cash:{cash_direction}:{cash_key}"
            return {
                "id": node_id,
                "type": "cash",
                "role": "cash",
                "label": label,
                "accountId": account_id or None,
                "accountIds": [account_id] if account_id else [],
                "tradeCard": trade_card or label,
                "accountName": account_name or label,
                "accounts": [
                    {
                        "accountId": account_id or None,
                        "tradeCard": trade_card or label,
                        "accountName": account_name or label,
                    }
                ],
                "cashDirection": cash_direction,
                "isCash": True,
                "depth": 1,
            }
        node_id = f"account:{account_id}" if account_id else f"account:{trade_card}"
        label = account_name or trade_card or node_id
        return {
            "id": node_id,
            "type": "account",
            "role": "counterparty",
            "label": label,
            "accountId": account_id or None,
            "accountIds": [account_id] if account_id else [],
            "tradeCard": trade_card,
            "accountName": account_name,
            "accounts": [
                {
                    "accountId": account_id or None,
                    "tradeCard": trade_card,
                    "accountName": account_name,
                }
            ],
            "depth": 1,
        }

    @classmethod
    def _relation_cash_direction(cls, row: dict[str, Any], prefix: str) -> str | None:
        account_id = str(row.get(f"{prefix}_account_id") or "").strip()
        trade_card = str(row.get(f"{prefix}_pay_account") or "").strip()
        account_name = str(row.get(f"{prefix}_account_name") or "").strip()
        party_text = f"{trade_card} {account_name}".replace(" ", "")
        transaction_text = " ".join(
            str(row.get(key) or "")
            for key in ("cash_flag", "trade_type", "trade_abstract")
        ).replace(" ", "")
        normalized_text = f"{party_text} {transaction_text}"
        has_cash_text = bool(CASH_TEXT_PATTERN.search(party_text))
        has_cash_endpoint = has_cash_text or ((not account_id and not trade_card) and bool(CASH_TEXT_PATTERN.search(transaction_text)))
        if not has_cash_endpoint:
            return None
        if "存现" in normalized_text or "现金交易（存现）" in normalized_text or "现金存入" in normalized_text:
            return "deposit"
        if "取现" in normalized_text or "现金交易（取现）" in normalized_text or "现金取出" in normalized_text or "取款" in normalized_text:
            return "withdraw"
        jd_flags = {item.strip() for item in str(row.get("jd_flags") or "").split(",") if item.strip()}
        if prefix == "payer" and ("贷" in jd_flags or "D" in jd_flags):
            return "deposit"
        if prefix == "payee" and ("借" in jd_flags or "J" in jd_flags):
            return "withdraw"
        if account_name.startswith("现金交易") or trade_card.startswith("现金交易"):
            return "deposit" if prefix == "payer" else "withdraw"
        return None

    @classmethod
    def _relation_graph_from_account_rows(cls, rows: list[dict[str, Any]], *, scope: str) -> QueryResult:
        nodes_by_id: dict[str, dict[str, Any]] = {}
        edges: list[dict[str, Any]] = []
        for row in rows:
            source = cls._relation_party_node(row, "payer")
            target = cls._relation_party_node(row, "payee")
            source["role"] = "current"
            target["role"] = "current"
            source["depth"] = 0
            target["depth"] = 0
            nodes_by_id.setdefault(source["id"], source)
            nodes_by_id.setdefault(target["id"], target)
            edges.append(
                {
                    "id": f"money:{source['id']}->{target['id']}",
                    "from": source["id"],
                    "to": target["id"],
                    "source": source["id"],
                    "target": target["id"],
                    "scope": scope,
                    "tradeAmount": float(row.get("trade_amount") or 0),
                    "tradeCount": int(row.get("trade_count") or 0),
                    "startTime": _json_safe_scalar(row.get("start_time") or row.get("startDate")),
                    "endTime": _json_safe_scalar(row.get("end_time") or row.get("endDate")),
                    "tradeIds": cls._relation_trade_ids(row),
                }
            )
        return {"nodes": list(nodes_by_id.values()), "edges": edges}

    @classmethod
    def _relation_global_candidate_items(cls, rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
        items: list[dict[str, Any]] = []
        for row in rows:
            account_id = str(row.get("account_id") or "").strip()
            trade_card = str(row.get("pay_account") or "").strip()
            if not account_id and not trade_card:
                continue
            node = cls._relation_party_node(
                {
                    "payer_account_id": account_id,
                    "payer_pay_account": trade_card,
                    "payer_account_name": row.get("account_name") or "",
                },
                "payer",
            )
            received_amount = float(row.get("received_amount") or 0)
            paid_amount = float(row.get("paid_amount") or 0)
            received_count = int(row.get("received_count") or 0)
            paid_count = int(row.get("paid_count") or 0)
            items.append(
                {
                    "nodeId": node["id"],
                    "label": node["label"],
                    "accountText": "、".join(
                        value for value in [account_id, trade_card] if value
                    ),
                    "accounts": node["accounts"],
                    "receivedAmount": received_amount,
                    "receivedCount": received_count,
                    "paidAmount": paid_amount,
                    "paidCount": paid_count,
                    "totalAmount": received_amount + paid_amount,
                    "netAmount": received_amount - paid_amount,
                    "minAmount": None if row.get("min_amount") is None else float(row.get("min_amount") or 0),
                    "maxAmount": None if row.get("max_amount") is None else float(row.get("max_amount") or 0),
                    "startTime": _json_safe_scalar(row.get("start_time")),
                    "endTime": _json_safe_scalar(row.get("end_time")),
                    "tradeIds": cls._relation_trade_ids(row),
                }
            )
        return items

    @staticmethod
    def _relation_trade_ids(row: dict[str, Any]) -> list[str]:
        raw_trade_ids = row.get("trade_ids")
        if raw_trade_ids is None:
            return []
        return [
            item
            for item in (str(raw).strip() for raw in str(raw_trade_ids).split(","))
            if item
        ]

    def _relation_trade_facts_for_rows(
        self,
        case_id: int,
        rows: list[dict[str, Any]],
    ) -> dict[str, dict[str, Any]]:
        trade_ids = list(
            dict.fromkeys(
                trade_id
                for row in rows
                for trade_id in self._relation_trade_ids(row)
            )
        )
        if not trade_ids:
            return {}

        facts: dict[str, dict[str, Any]] = {}
        for index in range(0, len(trade_ids), 500):
            chunk = trade_ids[index:index + 500]
            placeholders = ", ".join(["%s"] * len(chunk))
            trade_info_cte = self._trade_info_cte(case_id)
            detail_rows = self._query(
                f"""
                {trade_info_cte}
                SELECT
                    id,
                    serial_number,
                    trade_amount,
                    trade_time,
                    trade_abstract,
                    remark,
                    jd_flag,
                    trade_type,
                    cash_flag,
                    trade_network_name,
                    trade_network_code,
                    cash_flag,
                    third_pay_type,
                    third_pay_type_code,
                    ip_addr,
                    mac_addr,
                    terminal_no,
                    pos_no,
                    trade_device_type,
                    trade_device_no,
                    order_no,
                    third_order,
                    outer_serial_number,
                    payee_marchant_name,
                    payee_marchant_code,
                    payee_organ_info,
                    payer_bank_name,
                    payee_bank_name,
                    payer_account_id,
                    payer_account_name,
                    payer_pay_account,
                    payee_account_id,
                    payee_account_name,
                    payee_pay_account
                FROM trade_info
                WHERE id IN ({placeholders})
                """,
                tuple(chunk),
            )
            for row in detail_rows:
                trade_id = str(row.get("id") or "").strip()
                if not trade_id:
                    continue
                facts[trade_id] = {
                    "tradeId": trade_id,
                    "serialNumber": row.get("serial_number"),
                    "tradeAmount": float(row.get("trade_amount") or 0),
                    "tradeTime": _json_safe_scalar(row.get("trade_time")),
                    "tradeAbstract": row.get("trade_abstract") or "",
                    "remark": row.get("remark") or "",
                    "debitCreditFlag": row.get("jd_flag") or "",
                    "tradeType": row.get("trade_type") or "",
                    "cashFlag": row.get("cash_flag") or "",
                    "isCash": bool(row.get("cash_flag") or CASH_TEXT_PATTERN.search(
                        " ".join(
                            str(row.get(key) or "")
                            for key in ("trade_type", "trade_abstract", "remark")
                        )
                    )),
                    "tradeChannel": row.get("trade_network_name") or row.get("third_pay_type") or "",
                    "tradeChannelCode": row.get("trade_network_code") or row.get("third_pay_type_code") or "",
                    "thirdPayType": row.get("third_pay_type") or "",
                    "thirdPayTypeCode": row.get("third_pay_type_code") or "",
                    "ipAddress": row.get("ip_addr") or "",
                    "macAddress": row.get("mac_addr") or "",
                    "terminalNo": row.get("terminal_no") or "",
                    "posNo": row.get("pos_no") or "",
                    "deviceType": row.get("trade_device_type") or "",
                    "deviceNo": row.get("trade_device_no") or "",
                    "orderNo": row.get("order_no") or "",
                    "thirdOrderNo": row.get("third_order") or "",
                    "outerSerialNumber": row.get("outer_serial_number") or "",
                    "merchantName": row.get("payee_marchant_name") or "",
                    "merchantCode": row.get("payee_marchant_code") or "",
                    "counterpartyInstitution": row.get("payee_organ_info") or "",
                    "payerBankName": row.get("payer_bank_name") or "",
                    "payeeBankName": row.get("payee_bank_name") or "",
                    "payerAccountId": row.get("payer_account_id"),
                    "payerAccountName": row.get("payer_account_name") or "",
                    "payerTradeCard": row.get("payer_pay_account") or "",
                    "payeeAccountId": row.get("payee_account_id"),
                    "payeeAccountName": row.get("payee_account_name") or "",
                    "payeeTradeCard": row.get("payee_pay_account") or "",
                }
        return facts

    @staticmethod
    def _relation_account_ids(accounts: list[dict[str, Any]]) -> list[int]:
        ids: list[int] = []
        seen: set[int] = set()
        for account in accounts:
            account_id = str(account.get("accountId") or "").strip()
            if not account_id.isdigit():
                continue
            parsed = int(account_id)
            if parsed in seen:
                continue
            seen.add(parsed)
            ids.append(parsed)
        return ids

    @staticmethod
    def _node_id(account_id: Any, pay_account: Any) -> str:
        if account_id not in (None, ""):
            return str(account_id).strip()
        return str(pay_account or "").strip()

    @staticmethod
    def _account_trade_id(account_id: Any, pay_account: Any) -> str:
        if account_id not in (None, ""):
            return f"account-{account_id}"
        return f"card-{str(pay_account or '').strip()}"

    @staticmethod
    def _resolve_trade_card_value(*values: Any) -> str:
        for value in values:
            text = str(value or "").strip()
            if text:
                return text
        return ""

    @staticmethod
    def _trade_card_key(card: dict[str, Any]) -> str:
        account_id = str(card.get("accountId") or "").strip()
        if account_id:
            return account_id
        trade_card = str(card.get("tradeCard") or card.get("payAccount") or card.get("accountNo") or "").strip()
        return trade_card

    @staticmethod
    def _merge_trade_cards(
        current_trade_cards: list[dict[str, Any]],
        new_trade_cards: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        merged = list(current_trade_cards)
        seen_keys = {
            PyMySQLCaseGraphQueryClient._trade_card_key(card)
            for card in current_trade_cards
            if isinstance(card, dict)
        }
        for card in new_trade_cards:
            if not isinstance(card, dict):
                continue
            key = PyMySQLCaseGraphQueryClient._trade_card_key(card)
            if key and key in seen_keys:
                continue
            if key:
                seen_keys.add(key)
            merged.append(card)
        return merged

    @staticmethod
    def _coerce_excluded_account_ids(value: Any) -> list[int]:
        raw_values = value if isinstance(value, list) else [value]
        results: list[int] = []
        for raw in raw_values:
            text = str(raw or "").strip()
            if not text:
                continue
            for part in text.split("_"):
                trimmed = part.strip()
                if not trimmed:
                    continue
                try:
                    results.append(int(trimmed))
                except ValueError:
                    continue
        return results

    @staticmethod
    def _coerce_string_list(value: Any, *, fallback: list[str]) -> list[str]:
        if not isinstance(value, list):
            return list(fallback)
        return [str(item).strip() for item in value if str(item).strip()]

    def _query_main_trade_rows(
        self,
        *,
        case_id: int,
        account_ids: list[int],
        excluded_trade_ids: list[str],
        excluded_account_ids: list[int],
        filter_sql: list[str],
        filter_params: tuple[Any, ...],
    ) -> list[dict[str, Any]]:
        if not account_ids:
            return []
        trade_info_cte = self._trade_info_cte(case_id)
        params: list[Any] = list(filter_params)
        if excluded_trade_ids:
            excluded_placeholder = ", ".join(["%s"] * len(excluded_trade_ids))
            excluded_trade_clause = f"AND id NOT IN ({excluded_placeholder})"
            params.extend(excluded_trade_ids)
        else:
            excluded_trade_clause = ""
        account_placeholders = ", ".join(["%s"] * len(account_ids))
        if excluded_account_ids:
            excluded_account_placeholders = ", ".join(["%s"] * len(excluded_account_ids))
            excluded_when_payee = f"AND gt.payer_account_id NOT IN ({excluded_account_placeholders})"
            excluded_when_payer = f"AND gt.payee_account_id NOT IN ({excluded_account_placeholders})"
            params.extend(account_ids)
            params.extend(excluded_account_ids)
            params.extend(account_ids)
            params.extend(excluded_account_ids)
        else:
            excluded_when_payee = ""
            excluded_when_payer = ""
            params.extend(account_ids)
            params.extend(account_ids)
        return self._query(
            f"""
            {trade_info_cte},
            trade_info_filter AS (
                SELECT * FROM trade_info
                WHERE {" AND ".join(filter_sql) if filter_sql else "1=1"}
                {excluded_trade_clause}
            )
            SELECT
                IFNULL(gt.payer_pay_account, gt.payer_bank_number) AS payer_id,
                gt.payer_account_name AS payer_name,
                gt.payer_account_id,
                IFNULL(gt.payee_pay_account, gt.payee_bank_number) AS payee_id,
                gt.payee_account_name AS payee_name,
                gt.payee_account_id,
                ROUND(SUM(gt.trade_amount), 2) AS amount,
                COUNT(*) AS count,
                MIN(gt.trade_time) AS start_date,
                MAX(gt.trade_time) AS end_date
            FROM trade_info_filter gt
            WHERE (
                (
                    gt.payee_account_id IN ({account_placeholders})
                    {excluded_when_payee}
                )
                OR
                (
                    gt.payer_account_id IN ({account_placeholders})
                    {excluded_when_payer}
                )
            )
            GROUP BY
                payer_id,
                payer_name,
                gt.payer_account_id,
                payee_id,
                payee_name,
                gt.payee_account_id
            """,
            tuple(params),
        )

    def _drill_cards_for_direction(
        self,
        *,
        case_id: int,
        frontier: list[dict[str, Any]],
        direction: str,
        filter_sql: list[str],
        filter_params: tuple[Any, ...],
        excluded_trade_ids: list[str],
        drill_type: int,
        seen_keys: set[str],
        excluded_names: set[str],
    ) -> list[dict[str, Any]]:
        frontier_ids = [
            int(str(card.get("accountId")).strip())
            for card in frontier
            if str(card.get("accountId") or "").strip().isdigit()
        ]
        if not frontier_ids:
            return []
        rows = self._query_drill_candidate_rows(
            case_id=case_id,
            frontier_ids=frontier_ids,
            direction=direction,
            filter_sql=filter_sql,
            filter_params=filter_params,
            excluded_trade_ids=excluded_trade_ids,
        )
        grouped: dict[str, dict[str, Any]] = {}
        for row in rows:
            account_name = str(row.get("account_name") or "").strip()
            if not account_name or account_name in excluded_names:
                continue
            bucket = grouped.setdefault(
                account_name,
                {"amount": 0.0, "count": 0, "cards": []},
            )
            bucket["amount"] = float(bucket["amount"]) + float(row.get("trade_amount") or 0)
            bucket["count"] = int(bucket["count"]) + 1
            bucket["cards"].append(row)
        ordered = sorted(
            grouped.items(),
            key=lambda item: (
                -int(item[1]["count"]) if drill_type == 2 else -float(item[1]["amount"]),
                -float(item[1]["amount"]) if drill_type == 2 else -int(item[1]["count"]),
                item[0],
            ),
        )[:10]
        next_cards: list[dict[str, Any]] = []
        for _, bucket in ordered:
            for row in bucket["cards"]:
                card = {
                    "tradeId": self._account_trade_id(row.get("account_id"), row.get("trade_card")),
                    "accountId": None if row.get("account_id") in (None, "") else str(row["account_id"]),
                    "tradeCard": self._resolve_trade_card_value(
                        row.get("trade_card"),
                        row.get("bank_number"),
                        row.get("pay_account"),
                    ),
                    "accountName": row.get("account_name") or "",
                    "suspectName": row.get("account_name") or "",
                    "accountBank": row.get("bank_name") or "",
                }
                key = self._trade_card_key(card)
                if not key or key in seen_keys:
                    continue
                seen_keys.add(key)
                next_cards.append(card)
        return next_cards

    def _query_drill_candidate_rows(
        self,
        *,
        case_id: int,
        frontier_ids: list[int],
        direction: str,
        filter_sql: list[str],
        filter_params: tuple[Any, ...],
        excluded_trade_ids: list[str],
    ) -> list[dict[str, Any]]:
        trade_info_cte = self._trade_info_cte(case_id)
        is_in = direction == "in"
        match_col = "payee_account_id" if is_in else "payer_account_id"
        select_prefix = "payer" if is_in else "payee"
        opposite_prefix = "payee" if is_in else "payer"
        frontier_placeholders = ", ".join(["%s"] * len(frontier_ids))
        excluded_trade_clause = ""
        params: list[Any] = list(frontier_ids)
        if excluded_trade_ids:
            excluded_trade_clause = f"AND serial_number NOT IN ({', '.join(['%s'] * len(excluded_trade_ids))})"
            params.extend(excluded_trade_ids)
        params.extend(filter_params)
        return self._query(
            f"""
            {trade_info_cte}
            SELECT
                {select_prefix}_account_id AS account_id,
                {select_prefix}_trade_card AS trade_card,
                {select_prefix}_bank_number AS bank_number,
                {select_prefix}_pay_account AS pay_account,
                {select_prefix}_suspect_name AS account_name,
                {select_prefix}_bank_name AS bank_name,
                trade_amount
            FROM trade_info
            WHERE COALESCE(NULLIF({select_prefix}_suspect_name, ''), {select_prefix}_pay_account) != COALESCE(NULLIF({opposite_prefix}_suspect_name, ''), {opposite_prefix}_pay_account)
              AND {match_col} IN ({frontier_placeholders})
              {excluded_trade_clause}
              {"".join(f" AND {clause}" for clause in filter_sql)}
            """,
            tuple(params),
        )

    @staticmethod
    def _merge_auto_groups(records: list[dict[str, Any]], groups: dict[str, Any]) -> None:
        grouped: dict[str, list[dict[str, Any]]] = {}
        seen_member_ids = set(groups.keys())
        for record in records:
            account_id = str(record.get("accountId") or "").strip()
            account_name = str(record.get("accountName") or "").strip()
            if not account_id or not account_name or account_id in seen_member_ids:
                continue
            grouped.setdefault(account_name, []).append(record)
        for account_name, members in grouped.items():
            unique_members = sorted(
                {str(member.get("accountId") or "").strip(): member for member in members}.values(),
                key=lambda item: str(item.get("accountId") or "").strip(),
            )
            if len(unique_members) < 2:
                continue
            group_id = "_".join(str(member.get("accountId") or "").strip() for member in unique_members)
            group_item = {
                "groupId": group_id,
                "groupName": account_name,
                "tradeCard": [PyMySQLCaseGraphQueryClient._normalize_group_member(member) for member in unique_members],
                "tradeAmount": None,
            }
            for member in unique_members:
                account_id = str(member.get("accountId") or "").strip()
                if account_id and account_id not in groups:
                    groups[account_id] = group_item

    def _counterparty_rows(
        self,
        *,
        case_id: int,
        match_side: str,
        match_values: list[str],
        select_side: str,
        excluded_sql: list[str],
        excluded_params: tuple[Any, ...],
        drill_type: int,
        limit: int,
    ) -> list[dict[str, Any]]:
        trade_info_cte = self._trade_info_cte(case_id)
        where_parts = [
            "(" + " OR ".join(self._account_match_sql(match_side, value) for value in match_values) + ")",
            f"({select_side}_account_id IS NOT NULL OR COALESCE({select_side}_pay_account, '') <> '')",
        ] + excluded_sql
        order_by_sql = "trade_amount DESC, trade_count DESC"
        if drill_type == 2:
            order_by_sql = "trade_count DESC, trade_amount DESC"
        return self._query(
            f"""
            {trade_info_cte}
            SELECT
                {select_side}_account_id AS account_id,
                {select_side}_pay_account AS pay_account,
                {select_side}_suspect_name AS account_name,
                COUNT(*) AS trade_count,
                SUM(trade_amount) AS trade_amount
            FROM trade_info
            WHERE {" AND ".join(where_parts)}
            GROUP BY account_id, pay_account, account_name
            ORDER BY {order_by_sql}
            LIMIT %s
            """,
            self._account_match_params_many(match_values) + excluded_params + (limit,),
        )

    @staticmethod
    def _trade_info_cte(case_id: int) -> str:
        return f"""
            WITH suspect_account AS (
                SELECT *, ROW_NUMBER() OVER (
                    PARTITION BY trade_card, account_name, account_time
                    ORDER BY account_category
                ) AS rn
                FROM (
                    SELECT
                        u.id AS suspect_id,
                        u.card_no AS suspect_id_number,
                        u.suspect_name AS suspect_name,
                        a.id AS account_id,
                        a.trade_card AS trade_card,
                        a.trade_account AS trade_account,
                        a.account_name AS account_name,
                        a.account_time AS account_time,
                        a.cancel_time AS cancel_time,
                        a.account_category AS account_category,
                        a.account_bank AS account_bank,
                        a.is_obtain AS is_obtain
                    FROM ga_suspect_{case_id} u
                    LEFT JOIN ga_account_{case_id} a
                        ON u.card_no = a.id_number
                    WHERE a.id_number IS NOT NULL
                      AND a.id_number <> ''

                    UNION

                    SELECT
                        u.id AS suspect_id,
                        IFNULL(NULLIF(u.card_no, ''), a.id_number) AS suspect_id_number,
                        u.suspect_name AS suspect_name,
                        a.id AS account_id,
                        a.trade_card AS trade_card,
                        a.trade_account AS trade_account,
                        a.account_name AS account_name,
                        a.account_time AS account_time,
                        a.cancel_time AS cancel_time,
                        a.account_category AS account_category,
                        a.account_bank AS account_bank,
                        a.is_obtain AS is_obtain
                    FROM ga_suspect_{case_id} u
                    LEFT JOIN ga_account_{case_id} a
                        ON (u.suspect_name = a.account_name OR u.suspect_name = a.trade_card)
                    WHERE (a.id_number IS NULL OR a.id_number = '' OR u.card_no <> a.id_number)
                ) suspect_account_raw
            ),
            trade_info AS (
                SELECT
                    id,
                    serial_number,
                    trade_amount,
                    trade_time,
                    trade_abstract,
                    remark,
                    trade_type,
                    trade_network_name,
                    trade_network_code,
                    third_pay_type,
                    third_pay_type_code,
                    ip_addr,
                    mac_addr,
                    terminal_no,
                    pos_no,
                    trade_device_type,
                    trade_device_no,
                    order_no,
                    third_order,
                    outer_serial_number,
                    payee_marchant_name,
                    payee_marchant_code,
                    payee_organ_info,
                    jd_flag,
                    payee_suspect_id,
                    payee_id_number,
                    IFNULL(NULLIF(payee_suspect_id_number, ''), NULLIF(payee_id_number, '')) AS payee_suspect_id_number,
                    payee_account_name,
                    IFNULL(NULLIF(payee_suspect_name, ''), payee_account_name) AS payee_suspect_name,
                    payee_bank_number,
                    IFNULL(NULLIF(IFNULL(NULLIF(payee_trade_card, ''), payee_bank_number), ''), payee_pay_account) AS payee_trade_card,
                    payee_pay_account,
                    payee_account_id,
                    payee_trade_account,
                    payee_account_time,
                    payee_cancel_time,
                    payee_bank_name,
                    payer_suspect_id,
                    payer_id_number,
                    IFNULL(NULLIF(payer_suspect_id_number, ''), NULLIF(payer_id_number, '')) AS payer_suspect_id_number,
                    payer_account_name,
                    IFNULL(NULLIF(payer_suspect_name, ''), payer_account_name) AS payer_suspect_name,
                    payer_bank_number,
                    IFNULL(NULLIF(IFNULL(NULLIF(payer_trade_card, ''), payer_bank_number), ''), payer_pay_account) AS payer_trade_card,
                    payer_pay_account,
                    payer_account_id,
                    payer_trade_account,
                    payer_account_time,
                    payer_cancel_time,
                    payer_bank_name,
                    cash_flag,
                    data_flag
                FROM (
                    SELECT
                        gt.id,
                        gt.serial_number,
                        gt.trade_amount,
                        gt.trade_time,
                        gt.trade_abstract,
                        gt.remark,
                        gt.trade_type,
                        gt.trade_network_name,
                        gt.trade_network_code,
                        gt.cash_flag,
                        gt.third_pay_type,
                        gt.third_pay_type_code,
                        gt.ip_addr,
                        gt.mac_addr,
                        gt.terminal_no,
                        gt.pos_no,
                        gt.trade_device_type,
                        gt.trade_device_no,
                        gt.order_no,
                        gt.third_order,
                        gt.outer_serial_number,
                        gt.payee_marchant_name,
                        gt.payee_marchant_code,
                        gt.payee_organ_info,
                        gt.jd_flag,
                        payee.suspect_id AS payee_suspect_id,
                        gt.payee_id_number,
                        COALESCE(NULLIF(payee.suspect_id_number, ''), payee_account.id_number) AS payee_suspect_id_number,
                        COALESCE(NULLIF(gt.payee_account_name, ''), NULLIF(payee.account_name, ''), NULLIF(payee.suspect_name, ''), NULLIF(payee_account.account_name, ''), gt.payee_account_name) AS payee_account_name,
                        payee.suspect_name AS payee_suspect_name,
                        gt.payee_bank_number,
                        payee.trade_card AS payee_trade_card,
                        gt.payee_pay_account,
                        gt.payee_account_id AS payee_account_id,
                        payee.trade_account AS payee_trade_account,
                        payee.account_time AS payee_account_time,
                        payee.cancel_time AS payee_cancel_time,
                        gt.payee_bank_name,
                        payer.suspect_id AS payer_suspect_id,
                        gt.payer_id_number,
                        COALESCE(NULLIF(payer.suspect_id_number, ''), payer_account.id_number) AS payer_suspect_id_number,
                        COALESCE(NULLIF(gt.payer_account_name, ''), NULLIF(payer.account_name, ''), NULLIF(payer.suspect_name, ''), NULLIF(payer_account.account_name, ''), gt.payer_account_name) AS payer_account_name,
                        payer.suspect_name AS payer_suspect_name,
                        gt.payer_bank_number,
                        payer.trade_card AS payer_trade_card,
                        gt.payer_pay_account,
                        gt.payer_account_id AS payer_account_id,
                        payer.trade_account AS payer_trade_account,
                        payer.account_time AS payer_account_time,
                        payer.cancel_time AS payer_cancel_time,
                        gt.payer_bank_name,
                        gt.data_flag
                    FROM ga_trade_{case_id} gt
                    LEFT JOIN suspect_account payee
                        ON gt.payee_account_id = payee.account_id
                       AND payee.rn = 1
                    LEFT JOIN ga_account_{case_id} payee_account
                        ON gt.payee_account_id = payee_account.id
                    LEFT JOIN suspect_account payer
                        ON gt.payer_account_id = payer.account_id
                       AND payer.rn = 1
                    LEFT JOIN ga_account_{case_id} payer_account
                        ON gt.payer_account_id = payer_account.id
                    WHERE gt.data_flag = 0
                ) tmp
            )
        """

    @staticmethod
    def _account_match_sql(prefix: str, value: str) -> str:
        if value.isdigit():
            return f"{prefix}_account_id = %s OR {prefix}_pay_account = %s"
        return (
            f"{prefix}_pay_account = %s OR "
            f"{prefix}_account_name = %s OR "
            f"COALESCE({prefix}_suspect_name, '') = %s"
        )

    @staticmethod
    def _account_match_params(value: str) -> tuple[Any, ...]:
        if value.isdigit():
            numeric = int(value)
            return (numeric, value)
        return (value, value, value)

    @classmethod
    def _account_match_params_many(cls, values: list[str]) -> tuple[Any, ...]:
        params: list[Any] = []
        for value in values:
            params.extend(cls._account_match_params(value))
        return tuple(params)

    @classmethod
    def _detail_cards_match_sql(cls, prefix: str, cards: list[dict[str, Any]]) -> str:
        return " OR ".join(
            f"({cls._detail_card_match_sql(prefix, value)})"
            for value in cls._detail_card_values(cards)
        )

    @classmethod
    def _detail_cards_match_params(cls, cards: list[dict[str, Any]]) -> tuple[Any, ...]:
        params: list[Any] = []
        for value in cls._detail_card_values(cards):
            params.extend(cls._detail_card_match_params(value))
        return tuple(params)

    @staticmethod
    def _detail_card_match_sql(prefix: str, value: str) -> str:
        if value.isdigit():
            return f"{prefix}_account_id = %s OR {prefix}_pay_account = %s"
        return f"{prefix}_pay_account = %s OR {prefix}_account_name = %s"

    @staticmethod
    def _detail_card_match_params(value: str) -> tuple[Any, ...]:
        if value.isdigit():
            numeric = int(value)
            return (numeric, value)
        return (value, value)

    @staticmethod
    def _detail_card_values(cards: list[dict[str, Any]]) -> list[str]:
        values: list[str] = []
        for card in cards:
            if not isinstance(card, dict):
                continue
            for raw in (
                card.get("accountId"),
                card.get("tradeCard"),
                card.get("suspectName"),
                card.get("accountName"),
            ):
                value = str(raw or "").strip()
                if value:
                    values.append(value)
                    break
        return values

    @staticmethod
    def _detail_card_name_index(cards: list[dict[str, Any]]) -> dict[str, str]:
        index: dict[str, str] = {}
        for card in cards:
            if not isinstance(card, dict):
                continue
            name = str(card.get("accountName") or card.get("suspectName") or "").strip()
            if not name:
                continue
            for raw in (
                card.get("accountId"),
                card.get("tradeCard"),
                card.get("payAccount"),
                card.get("accountNo"),
            ):
                value = str(raw or "").strip()
                if value:
                    index.setdefault(value, name)
        return index

    @staticmethod
    def _resolve_detail_card_name(
        index: dict[str, str],
        account_id: Any,
        pay_account: Any,
    ) -> str:
        for raw in (account_id, pay_account):
            value = str(raw or "").strip()
            if value and value in index:
                return index[value]
        return ""

    def _expand_query_trade_cards(
        self,
        payload: QueryPayload,
        *,
        excluded_account_names: list[str] | None = None,
    ) -> list[dict[str, Any]]:
        seed_cards = [card for card in payload.get("tradeCards") or [] if isinstance(card, dict)]
        if not seed_cards:
            return []
        case_id = self._parse_case_id(payload.get("caseId"))
        filter_sql, filter_params = self._trade_filter_clauses(payload)
        excluded_names = set(excluded_account_names or [])
        all_cards = [dict(card) for card in seed_cards]
        seen_keys = {self._trade_card_key(card) for card in all_cards if self._trade_card_key(card)}

        for match_side, select_side in (("payee", "payer"), ("payer", "payee")):
            frontier = [dict(card) for card in seed_cards]
            for _ in range(3):
                next_cards = self._expand_counterparty_cards(
                    case_id=case_id,
                    frontier=frontier,
                    match_side=match_side,
                    select_side=select_side,
                    filter_sql=filter_sql,
                    filter_params=filter_params,
                    seen_keys=seen_keys,
                    excluded_names=excluded_names,
                    limit=self._query_limit(payload),
                )
                if not next_cards:
                    break
                all_cards.extend(next_cards)
                frontier = next_cards

        return all_cards

    def _expand_counterparty_cards(
        self,
        *,
        case_id: int,
        frontier: list[dict[str, Any]],
        match_side: str,
        select_side: str,
        filter_sql: list[str],
        filter_params: tuple[Any, ...],
        seen_keys: set[str],
        excluded_names: set[str],
        limit: int,
    ) -> list[dict[str, Any]]:
        match_values = self._detail_card_values(frontier)
        if not match_values:
            return []
        rows = self._counterparty_rows(
            case_id=case_id,
            match_side=match_side,
            match_values=match_values,
            select_side=select_side,
            excluded_sql=filter_sql,
            excluded_params=filter_params,
            drill_type=1,
            limit=limit,
        )
        cards: list[dict[str, Any]] = []
        for row in rows:
            account_name = str(row.get("account_name") or "").strip()
            if account_name in excluded_names:
                continue
            card = {
                "tradeId": self._account_trade_id(row.get("account_id"), row.get("pay_account")),
                "accountId": None if row.get("account_id") in (None, "") else str(row["account_id"]),
                "tradeCard": self._resolve_trade_card_value(row.get("pay_account")),
                "accountName": row.get("account_name") or "",
                "suspectName": row.get("account_name") or "",
            }
            key = self._trade_card_key(card)
            if not key or key in seen_keys:
                continue
            seen_keys.add(key)
            cards.append(card)
        return cards

    @classmethod
    def _extract_detail_cards(
        cls,
        cards: Any,
        *,
        fallback_text: Any = None,
    ) -> list[dict[str, Any]]:
        if isinstance(cards, list):
            return [card for card in cards if isinstance(card, dict)]
        text = str(fallback_text or "").strip()
        if not text:
            return []
        return [{"tradeCard": text}]

    @classmethod
    def _drill_match_values(cls, payload: QueryPayload) -> list[str]:
        values = cls._detail_card_values(cls._extract_detail_cards(payload.get("tradeCard")))
        if values:
            return values
        for raw in (payload.get("payer"), payload.get("payee")):
            value = str(raw or "").strip()
            if value:
                values.append(value)
        return list(dict.fromkeys(values))

    @staticmethod
    def _query_limit(payload: QueryPayload) -> int:
        raw = payload.get("limit") or payload.get("drillNums") or 200
        try:
            return max(1, min(int(raw), 1000))
        except (TypeError, ValueError):
            return 200

    @staticmethod
    def _drill_sort_type(payload: QueryPayload) -> int:
        raw = payload.get("drillType")
        try:
            value = int(raw)
        except (TypeError, ValueError):
            return 1
        return value if value in {1, 2, 3} else 1

    @staticmethod
    def _detail_limit(payload: QueryPayload) -> int:
        raw = payload.get("limit") or 200
        try:
            return max(1, min(int(raw), 1000))
        except (TypeError, ValueError):
            return 200

    @staticmethod
    def _is_unbounded_relation_query(payload: QueryPayload) -> bool:
        return payload.get("_relationUnbounded") is True

    @staticmethod
    def _trade_filter_clauses(payload: QueryPayload) -> tuple[list[str], tuple[Any, ...]]:
        clauses: list[str] = []
        params: list[Any] = []

        min_amount = PyMySQLCaseGraphQueryClient._coerce_amount(
            payload.get("minAmount", payload.get("min_amount"))
        )
        if min_amount is not None:
            clauses.append("trade_amount >= %s")
            params.append(min_amount)

        max_amount = PyMySQLCaseGraphQueryClient._coerce_amount(
            payload.get("maxAmount", payload.get("max_amount"))
        )
        if max_amount is not None:
            clauses.append("trade_amount <= %s")
            params.append(max_amount)

        start_time = str(payload.get("startTime") or "").strip()
        if start_time:
            clauses.append("trade_time >= %s")
            params.append(start_time)

        end_time = str(payload.get("endTime") or "").strip()
        if end_time:
            clauses.append("trade_time <= %s")
            params.append(end_time)

        return clauses, tuple(params)

    @staticmethod
    def _coerce_amount(value: Any) -> float | None:
        if value in (None, ""):
            return None
        try:
            return float(value)
        except (TypeError, ValueError):
            return None

    @staticmethod
    def _coerce_groups(value: Any) -> dict[str, Any]:
        if isinstance(value, dict):
            return {str(key): item for key, item in value.items()}
        return {}

    @classmethod
    def _normalize_legacy_query_groups(cls, groups: dict[str, Any]) -> dict[str, Any]:
        normalized: dict[str, Any] = {}
        for raw_key, raw_value in groups.items():
            if not isinstance(raw_value, dict):
                continue
            trade_cards = raw_value.get("tradeCard")
            members = [card for card in trade_cards if isinstance(card, dict)] if isinstance(trade_cards, list) else []
            normalized[str(raw_key)] = {
                "groupId": str(raw_value.get("groupId") or raw_key).strip(),
                "groupName": str(raw_value.get("groupName") or raw_key).strip(),
                "tradeCard": [cls._normalize_group_member(card) for card in members],
                "tradeAmount": raw_value.get("tradeAmount"),
            }
        return normalized

    @classmethod
    def _apply_groups(
        cls,
        *,
        nodes: list[dict[str, Any]],
        money: list[dict[str, Any]],
        groups: dict[str, Any],
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]:
        if not groups:
            return nodes, money, groups

        normalized_groups, node_to_group = cls._normalize_group_map(groups)
        if not normalized_groups or not node_to_group:
            return nodes, money, normalized_groups

        grouped_nodes: dict[str, dict[str, Any]] = {}
        for group_item in normalized_groups.values():
            group_id = str(group_item["groupId"])
            grouped_nodes[group_id] = {
                "id": group_id,
                "label": str(group_item.get("groupName") or group_id),
                "name": str(group_item.get("groupName") or group_id),
                "accountName": str(group_item.get("groupName") or ""),
                "groupId": group_id,
                "groupName": str(group_item.get("groupName") or group_id),
                "isGroup": True,
            }

        for node in nodes:
            node_id = str(node.get("id") or "").strip()
            if not node_id:
                continue
            if node_id in node_to_group:
                continue
            grouped_nodes[node_id] = node

        grouped_money: dict[tuple[str, str], dict[str, Any]] = {}
        for edge in money:
            edge_from = str(edge.get("from") or "").strip()
            edge_to = str(edge.get("to") or "").strip()
            if not edge_from or not edge_to:
                continue
            mapped_from = node_to_group.get(edge_from, edge_from)
            mapped_to = node_to_group.get(edge_to, edge_to)
            if mapped_from == mapped_to:
                continue
            key = (mapped_from, mapped_to)
            current = grouped_money.get(key)
            edge_amount = float(edge.get("amount") or edge.get("tradeAmount") or 0)
            edge_count = int(edge.get("count") or edge.get("tradeCount") or 0)
            if current is None:
                grouped_money[key] = {
                    "id": f"{mapped_from}->{mapped_to}",
                    "from": mapped_from,
                    "to": mapped_to,
                    "amount": edge_amount,
                    "count": edge_count,
                    "tradeAmount": edge_amount,
                    "tradeCount": edge_count,
                    "startDate": edge.get("startDate"),
                    "endDate": edge.get("endDate"),
                }
                continue
            current["amount"] = float(current.get("amount") or 0) + edge_amount
            current["count"] = int(current.get("count") or 0) + edge_count
            current["tradeAmount"] = float(current.get("tradeAmount") or 0) + edge_amount
            current["tradeCount"] = int(current.get("tradeCount") or 0) + edge_count
            current["startDate"] = cls._pick_start(current.get("startDate"), edge.get("startDate"))
            current["endDate"] = cls._pick_end(current.get("endDate"), edge.get("endDate"))

        return list(grouped_nodes.values()), list(grouped_money.values()), normalized_groups

    @classmethod
    def _normalize_group_map(
        cls,
        groups: dict[str, Any],
    ) -> tuple[dict[str, dict[str, Any]], dict[str, str]]:
        normalized: dict[str, dict[str, Any]] = {}
        node_to_group: dict[str, str] = {}
        for raw_key, raw_value in groups.items():
            if not isinstance(raw_value, dict):
                continue
            group_id = str(raw_value.get("groupId") or raw_key).strip()
            if not group_id:
                continue
            group_name = str(raw_value.get("groupName") or group_id).strip()
            trade_cards = raw_value.get("tradeCard")
            members = [card for card in trade_cards if isinstance(card, dict)] if isinstance(trade_cards, list) else []
            normalized[group_id] = {
                **raw_value,
                "groupId": group_id,
                "groupName": group_name,
                "tradeCard": [cls._normalize_group_member(card) for card in members],
                "tradeAmount": raw_value.get("tradeAmount"),
            }
            for key in cls._group_member_keys(raw_key, members):
                node_to_group[key] = group_id
        return normalized, node_to_group

    @staticmethod
    def _normalize_group_member(card: dict[str, Any]) -> dict[str, Any]:
        suspect_id = card.get("suspectId")
        return {
            "accountId": str(card.get("accountId") or "").strip() or None,
            "accountName": str(card.get("accountName") or "").strip() or None,
            "tradeCard": PyMySQLCaseGraphQueryClient._resolve_trade_card_value(
                card.get("tradeCard"),
                card.get("accountNo"),
                card.get("payAccount"),
            ),
            "suspectId": None if suspect_id in (None, "") else str(suspect_id),
            "suspectIdNumber": card.get("suspectIdNumber"),
            "accountStr": card.get("accountStr"),
            "accountBank": card.get("accountBank"),
            "countPartName": card.get("countPartName"),
        }

    @classmethod
    def _group_member_keys(
        cls,
        raw_key: str,
        members: list[dict[str, Any]],
    ) -> set[str]:
        keys: set[str] = set()
        base_key = str(raw_key or "").strip()
        if base_key:
            keys.add(base_key)
        for card in members:
            account_id = str(card.get("accountId") or "").strip()
            trade_card = str(card.get("tradeCard") or card.get("payAccount") or card.get("accountNo") or "").strip()
            account_name = str(card.get("accountName") or "").strip()
            if account_id:
                keys.add(account_id)
            if trade_card:
                keys.add(trade_card)
            if account_name:
                keys.add(account_name)
        return keys

    @staticmethod
    def _pick_start(current: Any, candidate: Any) -> Any:
        if not current:
            return candidate
        if not candidate:
            return current
        return min(str(current), str(candidate))

    @staticmethod
    def _pick_end(current: Any, candidate: Any) -> Any:
        if not current:
            return candidate
        if not candidate:
            return current
        return max(str(current), str(candidate))

    @classmethod
    def _build_query_result(
        cls,
        *,
        nodes: list[dict[str, Any]],
        money: list[dict[str, Any]],
        payload: QueryPayload,
        groups: dict[str, Any],
        trade_cards: list[dict[str, Any]] | None = None,
    ) -> QueryResult:
        if payload.get("isSelectedTradeCardChanged") is False and isinstance(payload.get("sourceSelectId"), list):
            source_select_id = [str(item).strip() for item in payload.get("sourceSelectId") or [] if str(item).strip()]
        else:
            source_select_id = [str(node.get("label") or node.get("name") or "").strip() for node in nodes]
            source_select_id = [value for value in source_select_id if value]
        return {
            "nodes": nodes,
            "money": money,
            "phone": [],
            "excludedTrades": list(payload.get("excludedTrades") or []),
            "groups": groups,
            "sourceSelectId": source_select_id,
        }


def _load_pymysql() -> tuple[Any, Any]:
    try:
        pymysql = importlib.import_module("pymysql")
        cursors = importlib.import_module("pymysql.cursors")
    except ModuleNotFoundError as exc:
        raise RuntimeError("PyMySQL 未安装，无法执行 case-graph 数据库查询") from exc
    return pymysql, cursors.DictCursor


def _json_safe_scalar(value: Any) -> Any:
    if isinstance(value, (datetime, date)):
        return value.isoformat(sep=" ")
    return value
