"""Orchestration for relation graph investigation steps."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Protocol

from .relation_storage import RelationGraphStorage
from .relation_types import normalize_relation_query_payload


class RelationGraphQueryClient(Protocol):
    def query_relation_one_hop(
        self,
        *,
        case_id: str,
        seed_accounts: list[dict[str, Any]],
        direction: str,
        filters: dict[str, Any],
    ) -> dict[str, Any]: ...

    def query_relation_between_accounts(
        self,
        *,
        case_id: str,
        accounts: list[dict[str, Any]],
        filters: dict[str, Any],
    ) -> dict[str, Any]: ...


class RelationGraphSnapshotStore(Protocol):
    def update_graph(self, graph_id: str, patch: dict[str, Any]) -> dict[str, Any]: ...


class RelationGraphService:
    def __init__(
        self,
        *,
        query_client: RelationGraphQueryClient,
        storage: RelationGraphStorage | None = None,
        snapshot_storage: RelationGraphSnapshotStore | None = None,
        workspace_root: Path | None = None,
    ) -> None:
        self._query_client = query_client
        if storage is None and workspace_root is None:
            from nanobot.config.paths import get_workspace_path

            workspace_root = get_workspace_path()
        self._storage = storage or RelationGraphStorage(workspace_root or Path.home())
        if snapshot_storage is not None:
            self._snapshot_storage = snapshot_storage
        elif workspace_root is not None:
            from .storage import CaseGraphStorage

            self._snapshot_storage = CaseGraphStorage(workspace=workspace_root)
        else:
            self._snapshot_storage = None

    def query_seed_one_hop(self, payload: dict[str, Any]) -> dict[str, Any]:
        request = normalize_relation_query_payload(payload)
        seed_accounts = self._active_seed_accounts(request["seeds"])
        current_graph = self._load_current_graph(request["caseId"], request["graphId"])
        current_graph = self._apply_node_positions(current_graph, request.get("options"))
        excluded_nodes = self._normalize_excluded_nodes_list(current_graph.get("excludedNodes") or [])
        graph = self._query_client.query_relation_one_hop(
            case_id=request["caseId"],
            seed_accounts=seed_accounts,
            direction=request["direction"],
            filters=self._relation_query_filters(request),
        )
        graph = self._remap_graph_to_existing_subjects(
            case_id=request["caseId"],
            graph_id=request["graphId"],
            graph=graph,
        )
        existing_pair_graph = self._query_existing_seed_pair_relations(
            case_id=request["caseId"],
            graph_id=request["graphId"],
            current_graph=current_graph,
            seed_accounts=seed_accounts,
            filters=self._relation_query_filters(request),
            excluded_nodes=excluded_nodes,
        )
        if existing_pair_graph.get("edges"):
            graph = self._merge_graphs(graph, existing_pair_graph, keep_base_edges=True)
        graph = self._merge_graphs(current_graph, graph, keep_base_edges=True)
        graph = self._apply_excluded_nodes(graph, excluded_nodes)
        self._sync_snapshot_graph(
            request["graphId"],
            graph,
            trade_cards=self._accounts_from_graph(graph) or seed_accounts,
        )
        delta = self._build_delta(current_graph, graph)
        return self._storage.save_step(
            case_id=request["caseId"],
            graph_id=request["graphId"],
            step_type="seed_one_hop",
            request=request,
            graph=graph,
            delta=delta,
            summary={
                "addedNodeCount": len(delta["addedNodes"]),
                "addedEdgeCount": len(delta["addedEdges"]),
            },
        )

    def complete_current_graph(self, payload: dict[str, Any]) -> dict[str, Any]:
        case_id = str(payload.get("caseId") or "").strip()
        graph_id = str(payload.get("graphId") or "").strip()
        if not case_id:
            raise ValueError("caseId")
        if not graph_id:
            raise ValueError("graphId")
        current_graph = self._load_current_graph(case_id, graph_id)
        options = dict(payload.get("options") or {}) if isinstance(payload.get("options"), dict) else {}
        current_graph = self._apply_node_positions(current_graph, options)
        excluded_nodes = self._normalize_excluded_nodes_list(current_graph.get("excludedNodes") or [])
        accounts = self._exclude_accounts(
            self._normalize_accounts(payload.get("accounts")),
            excluded_nodes,
        )
        filters = dict(payload.get("filters") or {}) if isinstance(payload.get("filters"), dict) else {}
        graph = self._query_client.query_relation_between_accounts(
            case_id=case_id,
            accounts=accounts,
            filters=filters,
        )
        graph = self._remap_graph_to_existing_subjects(case_id=case_id, graph_id=graph_id, graph=graph)
        graph = self._merge_graphs(current_graph, graph, keep_base_edges=True)
        graph = self._apply_excluded_nodes(graph, excluded_nodes)
        self._sync_snapshot_graph(graph_id, graph, trade_cards=self._accounts_from_graph(graph) or accounts)
        delta = self._build_delta(current_graph, graph)
        request = {
            "caseId": case_id,
            "graphId": graph_id,
            "accounts": accounts,
            "filters": filters,
            "options": options,
        }
        return self._storage.save_step(
            case_id=case_id,
            graph_id=graph_id,
            step_type="complete_current_graph",
            request=request,
            graph=graph,
            delta=delta,
            summary={
                "addedNodeCount": len(delta["addedNodes"]),
                "addedEdgeCount": len(delta["addedEdges"]),
                "excludedNodeCount": len(excluded_nodes),
            },
        )

    def filter_current_graph(self, payload: dict[str, Any]) -> dict[str, Any]:
        case_id = str(payload.get("caseId") or "").strip()
        graph_id = str(payload.get("graphId") or "").strip()
        if not case_id:
            raise ValueError("caseId")
        if not graph_id:
            raise ValueError("graphId")
        current_graph = self._storage.load_graph(case_id, graph_id)
        options = dict(payload.get("options") or {}) if isinstance(payload.get("options"), dict) else {}
        current_graph = self._apply_node_positions(current_graph, options)
        excluded_nodes = self._normalize_excluded_nodes_list(current_graph.get("excludedNodes") or [])
        accounts = self._accounts_from_graph(current_graph)
        filters = dict(payload.get("filters") or {}) if isinstance(payload.get("filters"), dict) else {}
        graph = self._query_client.query_relation_between_accounts(
            case_id=case_id,
            accounts=accounts,
            filters=filters,
        )
        graph = self._remap_graph_to_existing_subjects(case_id=case_id, graph_id=graph_id, graph=graph)
        graph = self._filter_graph_to_returned_edges(current_graph, graph)
        graph = self._apply_excluded_nodes(graph, excluded_nodes)
        self._sync_snapshot_graph(graph_id, graph, trade_cards=self._accounts_from_graph(graph) or accounts)
        delta = self._build_delta({**current_graph, "edges": []}, graph)
        request = {
            "caseId": case_id,
            "graphId": graph_id,
            "filters": filters,
            "accounts": accounts,
            "options": options,
        }
        return self._storage.save_step(
            case_id=case_id,
            graph_id=graph_id,
            step_type="filter_current_graph",
            request=request,
            graph=graph,
            delta=delta,
            summary={
                "addedNodeCount": len(delta["addedNodes"]),
                "addedEdgeCount": len(delta["addedEdges"]),
                "filterCount": len([value for value in filters.values() if value not in (None, "", [])]),
                "excludedNodeCount": len(excluded_nodes),
            },
        )

    def exclude_node(self, payload: dict[str, Any]) -> dict[str, Any]:
        case_id = str(payload.get("caseId") or "").strip()
        graph_id = str(payload.get("graphId") or "").strip()
        if not case_id:
            raise ValueError("caseId")
        if not graph_id:
            raise ValueError("graphId")
        node = payload.get("node")
        if not isinstance(node, dict):
            raise ValueError("node")
        node_id = str(node.get("nodeId") or node.get("id") or "").strip()
        if not node_id:
            raise ValueError("nodeId")
        graph = self._storage.load_graph(case_id, graph_id)
        excluded_node = self._normalize_excluded_node(node_id, node, graph)
        graph = self._apply_excluded_nodes(graph, self._merge_excluded_nodes(graph, excluded_node))
        self._sync_snapshot_graph(graph_id, graph, trade_cards=self._accounts_from_graph(graph))
        return self._storage.save_step(
            case_id=case_id,
            graph_id=graph_id,
            step_type="manual_exclude_node",
            request={"caseId": case_id, "graphId": graph_id, "node": excluded_node},
            graph=graph,
            delta={"addedNodes": [], "addedEdges": [], "updatedNodes": [excluded_node], "updatedEdges": []},
            summary={"excludedNodeCount": len(graph.get("excludedNodes") or [])},
        )

    def restore_node(self, payload: dict[str, Any]) -> dict[str, Any]:
        case_id = str(payload.get("caseId") or "").strip()
        graph_id = str(payload.get("graphId") or "").strip()
        node_id = str(payload.get("nodeId") or "").strip()
        if not case_id:
            raise ValueError("caseId")
        if not graph_id:
            raise ValueError("graphId")
        if not node_id:
            raise ValueError("nodeId")
        graph = self._storage.load_graph(case_id, graph_id)
        excluded_nodes = [
            item for item in graph.get("excludedNodes") or []
            if isinstance(item, dict) and str(item.get("nodeId") or "").strip() != node_id
        ]
        graph = self._apply_excluded_nodes(graph, excluded_nodes)
        self._sync_snapshot_graph(graph_id, graph, trade_cards=self._accounts_from_graph(graph))
        return self._storage.save_step(
            case_id=case_id,
            graph_id=graph_id,
            step_type="manual_restore_node",
            request={"caseId": case_id, "graphId": graph_id, "nodeId": node_id},
            graph=graph,
            delta={"addedNodes": [], "addedEdges": [], "updatedNodes": [{"nodeId": node_id}], "updatedEdges": []},
            summary={"excludedNodeCount": len(excluded_nodes)},
        )

    @staticmethod
    def _active_seed_accounts(seeds: list[dict[str, Any]]) -> list[dict[str, Any]]:
        accounts: list[dict[str, Any]] = []
        seen_ids: set[str] = set()
        for seed in seeds:
            suspect_id = str(seed.get("suspectId") or "").strip()
            suspect_name = str(seed.get("suspectName") or "").strip()
            account_index = {
                str(account.get("accountId") or "").strip(): account
                for account in seed.get("accounts") or []
                if isinstance(account, dict)
            }
            for account_id in seed.get("activeAccountIds") or []:
                normalized_account_id = str(account_id or "").strip()
                if not normalized_account_id or normalized_account_id in seen_ids:
                    continue
                seen_ids.add(normalized_account_id)
                account = dict(account_index.get(normalized_account_id) or {})
                accounts.append(
                    {
                        "accountId": normalized_account_id,
                        "tradeCard": str(account.get("tradeCard") or account.get("payAccount") or "").strip(),
                        "accountName": str(account.get("accountName") or suspect_name).strip(),
                        "suspectId": suspect_id,
                        "suspectName": suspect_name,
                    }
                )
        return accounts

    @staticmethod
    def _relation_query_filters(request: dict[str, Any]) -> dict[str, Any]:
        filters = dict(request.get("filters") or {})
        filters["drillNums"] = request.get("drillNums")
        filters["drillType"] = request.get("drillType")
        filters["limit"] = request.get("drillNums")
        return filters

    def _query_existing_seed_pair_relations(
        self,
        *,
        case_id: str,
        graph_id: str,
        current_graph: dict[str, Any],
        seed_accounts: list[dict[str, Any]],
        filters: dict[str, Any],
        excluded_nodes: list[dict[str, Any]],
    ) -> dict[str, Any]:
        if not current_graph.get("nodes") or not seed_accounts:
            return {"nodes": [], "edges": []}
        current_accounts = self._exclude_accounts(self._accounts_from_graph(current_graph), excluded_nodes)
        existing_accounts = self._accounts_excluding_seed_accounts(current_accounts, seed_accounts)
        if not existing_accounts:
            return {"nodes": [], "edges": []}
        graph = self._query_client.query_relation_between_accounts(
            case_id=case_id,
            accounts=self._dedupe_accounts([*seed_accounts, *existing_accounts]),
            filters=filters,
        )
        graph = self._remap_graph_to_existing_subjects(case_id=case_id, graph_id=graph_id, graph=graph)
        return self._filter_graph_to_seed_existing_edges(current_graph, graph, seed_accounts)

    @classmethod
    def _accounts_excluding_seed_accounts(
        cls,
        accounts: list[dict[str, Any]],
        seed_accounts: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        seed_account_ids = {
            str(account.get("accountId") or "").strip()
            for account in seed_accounts
            if str(account.get("accountId") or "").strip()
        }
        seed_trade_cards = {
            str(account.get("tradeCard") or account.get("payAccount") or "").strip()
            for account in seed_accounts
            if str(account.get("tradeCard") or account.get("payAccount") or "").strip()
        }
        return [
            account for account in accounts
            if str(account.get("accountId") or "").strip() not in seed_account_ids
            and str(account.get("tradeCard") or account.get("payAccount") or "").strip() not in seed_trade_cards
        ]

    @classmethod
    def _dedupe_accounts(cls, accounts: list[dict[str, Any]]) -> list[dict[str, Any]]:
        deduped: list[dict[str, Any]] = []
        seen: set[tuple[str, str]] = set()
        for account in accounts:
            account_id = str(account.get("accountId") or "").strip()
            trade_card = str(account.get("tradeCard") or account.get("payAccount") or "").strip()
            key = (account_id, trade_card)
            if not account_id and not trade_card:
                continue
            if key in seen:
                continue
            seen.add(key)
            deduped.append(dict(account))
        return deduped

    @classmethod
    def _filter_graph_to_seed_existing_edges(
        cls,
        current_graph: dict[str, Any],
        graph: dict[str, Any],
        seed_accounts: list[dict[str, Any]],
    ) -> dict[str, Any]:
        current_nodes_by_id = {
            str(node.get("id") or "").strip(): dict(node)
            for node in current_graph.get("nodes") or []
            if isinstance(node, dict) and str(node.get("id") or "").strip()
        }
        seed_node_ids = cls._node_ids_for_accounts(current_graph, seed_accounts)
        if not seed_node_ids or len(current_nodes_by_id) <= len(seed_node_ids):
            return {"nodes": [], "edges": []}

        retained_edges: list[dict[str, Any]] = []
        retained_node_ids: set[str] = set()
        for raw_edge in graph.get("edges") or []:
            if not isinstance(raw_edge, dict):
                continue
            edge = dict(raw_edge)
            source, target = cls._edge_endpoints(edge)
            if (
                not source
                or not target
                or source == target
                or source not in current_nodes_by_id
                or target not in current_nodes_by_id
            ):
                continue
            if (source in seed_node_ids) == (target in seed_node_ids):
                continue
            edge_id = cls._canonical_edge_id(edge, source, target)
            edge["id"] = edge_id
            edge["from"] = source
            edge["to"] = target
            edge["source"] = source
            edge["target"] = target
            retained_edges.append(edge)
            retained_node_ids.update((source, target))

        if not retained_edges:
            return {"nodes": [], "edges": []}
        incoming_nodes_by_id = {
            str(node.get("id") or "").strip(): dict(node)
            for node in graph.get("nodes") or []
            if isinstance(node, dict) and str(node.get("id") or "").strip()
        }
        return {
            **graph,
            "nodes": [
                cls._merge_node_preserving_layout(current_nodes_by_id[node_id], incoming_nodes_by_id.get(node_id, {}))
                for node_id in retained_node_ids
                if node_id in current_nodes_by_id
            ],
            "edges": retained_edges,
        }

    @classmethod
    def _node_ids_for_accounts(cls, graph: dict[str, Any], accounts: list[dict[str, Any]]) -> set[str]:
        index = cls._existing_subject_account_index(graph)
        node_ids: set[str] = set()
        for account in accounts:
            account_id = str(account.get("accountId") or "").strip()
            trade_card = str(account.get("tradeCard") or account.get("payAccount") or "").strip()
            if account_id:
                node_id = index.get(f"accountId:{account_id}") or index.get(f"account:{account_id}")
                if node_id:
                    node_ids.add(node_id)
            if trade_card:
                node_id = index.get(f"tradeCard:{trade_card}")
                if node_id:
                    node_ids.add(node_id)
        return node_ids

    @staticmethod
    def _normalize_accounts(value: Any) -> list[dict[str, Any]]:
        accounts: list[dict[str, Any]] = []
        seen_ids: set[str] = set()
        for raw in value or []:
            if not isinstance(raw, dict):
                continue
            account_id = str(raw.get("accountId") or "").strip()
            trade_card = str(raw.get("tradeCard") or raw.get("payAccount") or "").strip()
            if not account_id and not trade_card:
                continue
            key = account_id or trade_card
            if key in seen_ids:
                continue
            seen_ids.add(key)
            accounts.append(
                {
                    "accountId": account_id,
                    "tradeCard": trade_card,
                    "accountName": str(raw.get("accountName") or raw.get("label") or "").strip(),
                }
            )
        return accounts

    def _load_current_graph(self, case_id: str, graph_id: str) -> dict[str, Any]:
        try:
            return self._storage.load_graph(case_id, graph_id)
        except (FileNotFoundError, KeyError, ValueError, TypeError):
            return {}

    @classmethod
    def _accounts_from_graph(cls, graph: dict[str, Any]) -> list[dict[str, Any]]:
        accounts: list[dict[str, Any]] = []
        excluded_node_ids = {
            str(item.get("nodeId") or "").strip()
            for item in graph.get("excludedNodes") or []
            if isinstance(item, dict)
        }
        for node in graph.get("nodes") or []:
            if not isinstance(node, dict):
                continue
            if node.get("isExcluded") or str(node.get("id") or "").strip() in excluded_node_ids:
                continue
            node_accounts = node.get("accounts")
            if isinstance(node_accounts, list):
                accounts.extend(account for account in node_accounts if isinstance(account, dict))
                continue
            accounts.append(node)
        return cls._normalize_accounts(accounts)

    @classmethod
    def _normalize_excluded_node(
        cls,
        node_id: str,
        payload_node: dict[str, Any],
        graph: dict[str, Any],
    ) -> dict[str, Any]:
        graph_node = next(
            (
                node for node in graph.get("nodes") or []
                if isinstance(node, dict) and str(node.get("id") or "").strip() == node_id
            ),
            {},
        )
        merged = {**graph_node, **payload_node}
        accounts = cls._normalize_accounts(merged.get("accounts") if isinstance(merged.get("accounts"), list) else [merged])
        return {
            "nodeId": node_id,
            "label": str(
                merged.get("label")
                or merged.get("name")
                or merged.get("accountName")
                or merged.get("tradeCard")
                or node_id
            ).strip(),
            "type": str(merged.get("type") or ("subject" if accounts and len(accounts) > 1 else "account")).strip(),
            "accountIds": [
                account_id for account_id in (
                    str(account.get("accountId") or "").strip() for account in accounts
                ) if account_id
            ],
            "tradeCards": [
                trade_card for trade_card in (
                    str(account.get("tradeCard") or "").strip() for account in accounts
                ) if trade_card
            ],
            "reason": str(merged.get("reason") or "manual").strip(),
        }

    @staticmethod
    def _merge_excluded_nodes(graph: dict[str, Any], excluded_node: dict[str, Any]) -> list[dict[str, Any]]:
        nodes_by_id = {
            str(item.get("nodeId") or "").strip(): dict(item)
            for item in graph.get("excludedNodes") or []
            if isinstance(item, dict) and str(item.get("nodeId") or "").strip()
        }
        nodes_by_id[str(excluded_node.get("nodeId") or "").strip()] = excluded_node
        return list(nodes_by_id.values())

    @classmethod
    def _normalize_excluded_nodes_list(cls, value: Any) -> list[dict[str, Any]]:
        nodes: list[dict[str, Any]] = []
        seen: set[str] = set()
        for item in value or []:
            if not isinstance(item, dict):
                continue
            node_id = str(item.get("nodeId") or item.get("id") or "").strip()
            if not node_id or node_id in seen:
                continue
            seen.add(node_id)
            nodes.append(
                {
                    "nodeId": node_id,
                    "label": str(item.get("label") or item.get("name") or node_id).strip(),
                    "type": str(item.get("type") or "account").strip(),
                    "accountIds": [
                        account_id for account_id in (
                            str(account_id or "").strip() for account_id in item.get("accountIds") or []
                        ) if account_id
                    ],
                    "tradeCards": [
                        trade_card for trade_card in (
                            str(trade_card or "").strip() for trade_card in item.get("tradeCards") or []
                        ) if trade_card
                    ],
                    "reason": str(item.get("reason") or "manual").strip(),
                }
            )
        return nodes

    @classmethod
    def _exclude_accounts(
        cls,
        accounts: list[dict[str, Any]],
        excluded_nodes: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        excluded_account_ids, excluded_trade_cards = cls._excluded_account_keys(excluded_nodes)
        if not excluded_account_ids and not excluded_trade_cards:
            return accounts
        return [
            account for account in accounts
            if str(account.get("accountId") or "").strip() not in excluded_account_ids
            and str(account.get("tradeCard") or "").strip() not in excluded_trade_cards
        ]

    @staticmethod
    def _excluded_account_keys(excluded_nodes: list[dict[str, Any]]) -> tuple[set[str], set[str]]:
        account_ids: set[str] = set()
        trade_cards: set[str] = set()
        for item in excluded_nodes:
            if not isinstance(item, dict):
                continue
            account_ids.update(
                account_id for account_id in (
                    str(account_id or "").strip() for account_id in item.get("accountIds") or []
                ) if account_id
            )
            trade_cards.update(
                trade_card for trade_card in (
                    str(trade_card or "").strip() for trade_card in item.get("tradeCards") or []
                ) if trade_card
            )
        return account_ids, trade_cards

    @classmethod
    def _apply_excluded_nodes(cls, graph: dict[str, Any], excluded_nodes: list[dict[str, Any]]) -> dict[str, Any]:
        excluded_ids = {
            str(item.get("nodeId") or "").strip()
            for item in excluded_nodes
            if str(item.get("nodeId") or "").strip()
        }
        excluded_account_ids, excluded_trade_cards = cls._excluded_account_keys(excluded_nodes)
        nodes = []
        seen_node_ids: set[str] = set()
        for raw_node in graph.get("nodes") or []:
            if not isinstance(raw_node, dict):
                continue
            node = dict(raw_node)
            node_id = str(node.get("id") or "").strip()
            node["isExcluded"] = cls._node_matches_exclusion(
                node,
                excluded_ids=excluded_ids,
                excluded_account_ids=excluded_account_ids,
                excluded_trade_cards=excluded_trade_cards,
            )
            if node_id:
                seen_node_ids.add(node_id)
            nodes.append(node)
        for excluded_node in excluded_nodes:
            node_id = str(excluded_node.get("nodeId") or "").strip()
            if not node_id or node_id in seen_node_ids:
                continue
            nodes.append(cls._excluded_node_to_graph_node(excluded_node))
            seen_node_ids.add(node_id)
        edges = []
        for raw_edge in graph.get("edges") or []:
            if not isinstance(raw_edge, dict):
                continue
            edge = dict(raw_edge)
            source = str(edge.get("from") or edge.get("source") or "").strip()
            target = str(edge.get("to") or edge.get("target") or "").strip()
            edge["isExcluded"] = source in excluded_ids or target in excluded_ids
            edges.append(edge)
        return {**graph, "nodes": nodes, "edges": edges, "excludedNodes": excluded_nodes}

    @staticmethod
    def _node_matches_exclusion(
        node: dict[str, Any],
        *,
        excluded_ids: set[str],
        excluded_account_ids: set[str],
        excluded_trade_cards: set[str],
    ) -> bool:
        node_id = str(node.get("id") or "").strip()
        if node_id in excluded_ids:
            return True
        account_id = str(node.get("accountId") or "").strip()
        trade_card = str(node.get("tradeCard") or node.get("payAccount") or "").strip()
        if account_id and account_id in excluded_account_ids:
            return True
        if trade_card and trade_card in excluded_trade_cards:
            return True
        for account in node.get("accounts") or []:
            if not isinstance(account, dict):
                continue
            account_id = str(account.get("accountId") or "").strip()
            trade_card = str(account.get("tradeCard") or account.get("payAccount") or "").strip()
            if account_id and account_id in excluded_account_ids:
                return True
            if trade_card and trade_card in excluded_trade_cards:
                return True
        return False

    @staticmethod
    def _excluded_node_to_graph_node(excluded_node: dict[str, Any]) -> dict[str, Any]:
        node_id = str(excluded_node.get("nodeId") or "").strip()
        account_ids = [
            str(account_id or "").strip()
            for account_id in excluded_node.get("accountIds") or []
            if str(account_id or "").strip()
        ]
        trade_cards = [
            str(trade_card or "").strip()
            for trade_card in excluded_node.get("tradeCards") or []
            if str(trade_card or "").strip()
        ]
        accounts = [
            {
                "accountId": account_ids[index] if index < len(account_ids) else "",
                "tradeCard": trade_cards[index] if index < len(trade_cards) else "",
                "accountName": str(excluded_node.get("label") or node_id).strip(),
            }
            for index in range(max(len(account_ids), len(trade_cards)))
        ]
        node = {
            "id": node_id,
            "label": str(excluded_node.get("label") or node_id).strip(),
            "type": str(excluded_node.get("type") or "account").strip(),
            "isExcluded": True,
        }
        if accounts:
            node["accounts"] = accounts
        if account_ids:
            node["accountId"] = account_ids[0]
        if trade_cards:
            node["tradeCard"] = trade_cards[0]
        return node

    def _remap_graph_to_existing_subjects(
        self,
        *,
        case_id: str,
        graph_id: str,
        graph: dict[str, Any],
    ) -> dict[str, Any]:
        try:
            current_graph = self._storage.load_graph(case_id, graph_id)
        except (FileNotFoundError, KeyError, ValueError, TypeError):
            return graph
        remap = self._existing_subject_account_index(current_graph)
        if not remap:
            return graph

        existing_nodes = {
            str(node.get("id") or "").strip(): dict(node)
            for node in current_graph.get("nodes") or []
            if isinstance(node, dict) and str(node.get("id") or "").strip()
        }
        nodes_by_id: dict[str, dict[str, Any]] = {}
        endpoint_remap = dict(remap)
        for raw_node in graph.get("nodes") or []:
            if not isinstance(raw_node, dict):
                continue
            node = dict(raw_node)
            node_id = str(node.get("id") or "").strip()
            canonical_id = self._canonical_node_id(node, remap) or node_id
            if node_id and canonical_id:
                endpoint_remap[node_id] = canonical_id
            if canonical_id in existing_nodes:
                nodes_by_id[canonical_id] = existing_nodes[canonical_id]
            elif canonical_id:
                node["id"] = canonical_id
                nodes_by_id[canonical_id] = node

        edges: list[dict[str, Any]] = []
        seen_edges: set[str] = set()
        for raw_edge in graph.get("edges") or []:
            if not isinstance(raw_edge, dict):
                continue
            edge = dict(raw_edge)
            source = self._canonical_endpoint_id(edge.get("from") or edge.get("source"), endpoint_remap)
            target = self._canonical_endpoint_id(edge.get("to") or edge.get("target"), endpoint_remap)
            if not source or not target or source == target:
                continue
            edge["from"] = source
            edge["to"] = target
            edge["source"] = source
            edge["target"] = target
            edge["id"] = f"money:{source}->{target}"
            if edge["id"] in seen_edges:
                continue
            seen_edges.add(edge["id"])
            edges.append(edge)
        return {**graph, "nodes": list(nodes_by_id.values()), "edges": edges}

    @classmethod
    def _merge_graphs(
        cls,
        base_graph: dict[str, Any],
        incoming_graph: dict[str, Any],
        *,
        keep_base_edges: bool,
    ) -> dict[str, Any]:
        base_nodes = [
            dict(node)
            for node in base_graph.get("nodes") or []
            if isinstance(node, dict) and str(node.get("id") or "").strip()
        ]
        incoming_nodes = [
            dict(node)
            for node in incoming_graph.get("nodes") or []
            if isinstance(node, dict) and str(node.get("id") or "").strip()
        ]
        identity_index = cls._existing_subject_account_index({"nodes": base_nodes})
        nodes_by_id: dict[str, dict[str, Any]] = {}
        endpoint_remap: dict[str, str] = {}

        for node in base_nodes:
            node_id = str(node.get("id") or "").strip()
            nodes_by_id[node_id] = node
            endpoint_remap[node_id] = node_id

        for node in incoming_nodes:
            node_id = str(node.get("id") or "").strip()
            canonical_id = cls._canonical_node_id(node, identity_index) or node_id
            endpoint_remap[node_id] = canonical_id
            if canonical_id in nodes_by_id:
                nodes_by_id[canonical_id] = cls._merge_node_preserving_layout(nodes_by_id[canonical_id], node)
                continue
            node["id"] = canonical_id
            nodes_by_id[canonical_id] = node
            cls._index_node_identity(identity_index, node)

        edges_by_id: dict[str, dict[str, Any]] = {}
        if keep_base_edges:
            for raw_edge in base_graph.get("edges") or []:
                if not isinstance(raw_edge, dict):
                    continue
                edge = dict(raw_edge)
                source, target = cls._edge_endpoints(edge)
                if not source or not target or source == target:
                    continue
                edge_id = cls._canonical_edge_id(edge, source, target)
                edge["id"] = edge_id
                edge["from"] = source
                edge["to"] = target
                edge["source"] = source
                edge["target"] = target
                edges_by_id[edge_id] = edge

        for raw_edge in incoming_graph.get("edges") or []:
            if not isinstance(raw_edge, dict):
                continue
            edge = dict(raw_edge)
            raw_source, raw_target = cls._edge_endpoints(edge)
            source = cls._canonical_endpoint_id(raw_source, endpoint_remap)
            target = cls._canonical_endpoint_id(raw_target, endpoint_remap)
            if not source or not target or source == target:
                continue
            edge_id = cls._canonical_edge_id(edge, source, target)
            edge["id"] = edge_id
            edge["from"] = source
            edge["to"] = target
            edge["source"] = source
            edge["target"] = target
            edges_by_id[edge_id] = {**edges_by_id.get(edge_id, {}), **edge}

        return {
            **base_graph,
            **incoming_graph,
            "nodes": list(nodes_by_id.values()),
            "edges": list(edges_by_id.values()),
            "excludedNodes": list(base_graph.get("excludedNodes") or incoming_graph.get("excludedNodes") or []),
        }

    @classmethod
    def _apply_node_positions(cls, graph: dict[str, Any], options: Any) -> dict[str, Any]:
        if not graph or not isinstance(options, dict):
            return graph
        raw_positions = options.get("nodePositions")
        if not isinstance(raw_positions, dict):
            return graph
        positions: dict[str, tuple[float, float]] = {}
        for raw_node_id, raw_point in raw_positions.items():
            if not isinstance(raw_point, dict):
                continue
            node_id = str(raw_node_id or "").strip()
            x = cls._finite_number(raw_point.get("x"))
            y = cls._finite_number(raw_point.get("y"))
            if not node_id or x is None or y is None:
                continue
            positions[node_id] = (x, y)
        if not positions:
            return graph
        nodes = []
        for raw_node in graph.get("nodes") or []:
            if not isinstance(raw_node, dict):
                continue
            node = dict(raw_node)
            node_id = str(node.get("id") or "").strip()
            point = positions.get(node_id)
            if point:
                node["x"], node["y"] = point
            nodes.append(node)
        return {**graph, "nodes": nodes}

    @staticmethod
    def _finite_number(value: Any) -> float | None:
        if isinstance(value, bool):
            return None
        if isinstance(value, (int, float)):
            return float(value)
        return None

    @classmethod
    def _filter_graph_to_returned_edges(
        cls,
        current_graph: dict[str, Any],
        filtered_graph: dict[str, Any],
    ) -> dict[str, Any]:
        current_edge_ids = {
            cls._canonical_edge_id(edge, *cls._edge_endpoints(edge))
            for edge in current_graph.get("edges") or []
            if isinstance(edge, dict)
        }
        filtered_edges = []
        retained_node_ids: set[str] = set()
        for raw_edge in filtered_graph.get("edges") or []:
            if not isinstance(raw_edge, dict):
                continue
            edge = dict(raw_edge)
            source, target = cls._edge_endpoints(edge)
            if not source or not target or source == target:
                continue
            edge_id = cls._canonical_edge_id(edge, source, target)
            if edge_id not in current_edge_ids:
                continue
            edge["id"] = edge_id
            edge["from"] = source
            edge["to"] = target
            edge["source"] = source
            edge["target"] = target
            retained_node_ids.update((source, target))
            filtered_edges.append(edge)

        current_nodes_by_id = {
            str(node.get("id") or "").strip(): dict(node)
            for node in current_graph.get("nodes") or []
            if isinstance(node, dict) and str(node.get("id") or "").strip()
        }
        filtered_nodes_by_id = {
            str(node.get("id") or "").strip(): dict(node)
            for node in filtered_graph.get("nodes") or []
            if isinstance(node, dict) and str(node.get("id") or "").strip()
        }
        nodes = []
        for node_id in retained_node_ids:
            current_node = current_nodes_by_id.get(node_id)
            filtered_node = filtered_nodes_by_id.get(node_id)
            if current_node and filtered_node:
                nodes.append(cls._merge_node_preserving_layout(current_node, filtered_node))
            elif current_node:
                nodes.append(current_node)
            elif filtered_node:
                nodes.append(filtered_node)

        return {
            **current_graph,
            **filtered_graph,
            "nodes": nodes,
            "edges": filtered_edges,
            "excludedNodes": list(current_graph.get("excludedNodes") or filtered_graph.get("excludedNodes") or []),
        }

    @staticmethod
    def _strip_node_positions(graph: dict[str, Any]) -> dict[str, Any]:
        nodes = []
        for raw_node in graph.get("nodes") or []:
            if not isinstance(raw_node, dict):
                continue
            node = dict(raw_node)
            for key in ("x", "y", "fx", "fy"):
                node.pop(key, None)
            nodes.append(node)
        return {**graph, "nodes": nodes}

    @staticmethod
    def _merge_node_preserving_layout(existing: dict[str, Any], incoming: dict[str, Any]) -> dict[str, Any]:
        merged = {**incoming, **existing}
        for key in ("x", "y", "fx", "fy"):
            if key in existing:
                merged[key] = existing[key]
        accounts = []
        seen_accounts: set[tuple[str, str]] = set()
        for account in list(existing.get("accounts") or []) + list(incoming.get("accounts") or []):
            if not isinstance(account, dict):
                continue
            account_id = str(account.get("accountId") or "").strip()
            trade_card = str(account.get("tradeCard") or account.get("payAccount") or "").strip()
            key = (account_id, trade_card)
            if key in seen_accounts:
                continue
            seen_accounts.add(key)
            accounts.append(dict(account))
        if accounts:
            merged["accounts"] = accounts
        return merged

    @classmethod
    def _index_node_identity(cls, index: dict[str, str], node: dict[str, Any]) -> None:
        node_id = str(node.get("id") or "").strip()
        if not node_id:
            return
        account_id = str(node.get("accountId") or "").strip()
        trade_card = str(node.get("tradeCard") or node.get("payAccount") or "").strip()
        if account_id:
            index.setdefault(f"account:{account_id}", node_id)
            index.setdefault(f"accountId:{account_id}", node_id)
        if trade_card:
            index.setdefault(f"tradeCard:{trade_card}", node_id)
        for account in node.get("accounts") or []:
            if not isinstance(account, dict):
                continue
            account_id = str(account.get("accountId") or "").strip()
            trade_card = str(account.get("tradeCard") or account.get("payAccount") or "").strip()
            if account_id:
                index.setdefault(f"account:{account_id}", node_id)
                index.setdefault(f"accountId:{account_id}", node_id)
            if trade_card:
                index.setdefault(f"tradeCard:{trade_card}", node_id)

    @staticmethod
    def _canonical_edge_id(edge: dict[str, Any], source: str, target: str) -> str:
        edge_id = str(edge.get("id") or "").strip()
        if edge_id.startswith("money:"):
            return f"money:{source}->{target}"
        return edge_id or f"money:{source}->{target}"

    @staticmethod
    def _edge_endpoints(edge: dict[str, Any]) -> tuple[str, str]:
        source = str(edge.get("from") or edge.get("source") or "").strip()
        target = str(edge.get("to") or edge.get("target") or "").strip()
        if source and target:
            return source, target
        edge_id = str(edge.get("id") or "").strip()
        if edge_id.startswith("money:") and "->" in edge_id:
            raw_source, raw_target = edge_id.removeprefix("money:").split("->", 1)
            return raw_source.strip(), raw_target.strip()
        return source, target

    @classmethod
    def _build_delta(cls, previous_graph: dict[str, Any], next_graph: dict[str, Any]) -> dict[str, Any]:
        previous_node_ids = {
            str(node.get("id") or "").strip()
            for node in previous_graph.get("nodes") or []
            if isinstance(node, dict)
        }
        previous_edge_ids = {
            cls._canonical_edge_id(edge, *cls._edge_endpoints(edge))
            for edge in previous_graph.get("edges") or []
            if isinstance(edge, dict)
        }
        added_nodes = [
            node for node in next_graph.get("nodes") or []
            if isinstance(node, dict) and str(node.get("id") or "").strip() not in previous_node_ids
        ]
        added_edges = []
        for edge in next_graph.get("edges") or []:
            if not isinstance(edge, dict):
                continue
            source, target = cls._edge_endpoints(edge)
            edge_id = cls._canonical_edge_id(edge, source, target)
            if edge_id not in previous_edge_ids:
                added_edges.append(edge)
        return {
            "addedNodes": added_nodes,
            "addedEdges": added_edges,
            "updatedNodes": [],
            "updatedEdges": [],
        }

    def _sync_snapshot_graph(
        self,
        graph_id: str,
        graph: dict[str, Any],
        *,
        trade_cards: list[dict[str, Any]],
    ) -> None:
        if self._snapshot_storage is None:
            return
        try:
            self._snapshot_storage.update_graph(
                graph_id,
                {
                    "tradeCards": list(trade_cards),
                },
            )
        except KeyError:
            return

    @staticmethod
    def _existing_subject_account_index(graph: dict[str, Any]) -> dict[str, str]:
        index: dict[str, str] = {}
        for node in graph.get("nodes") or []:
            if not isinstance(node, dict):
                continue
            node_id = str(node.get("id") or "").strip()
            if not node_id:
                continue
            account_id = str(node.get("accountId") or "").strip()
            trade_card = str(node.get("tradeCard") or node.get("payAccount") or "").strip()
            if account_id:
                index.setdefault(f"account:{account_id}", node_id)
                index.setdefault(f"accountId:{account_id}", node_id)
            if trade_card:
                index.setdefault(f"tradeCard:{trade_card}", node_id)
            for account in node.get("accounts") or []:
                if not isinstance(account, dict):
                    continue
                account_id = str(account.get("accountId") or "").strip()
                trade_card = str(account.get("tradeCard") or account.get("payAccount") or "").strip()
                if account_id:
                    index.setdefault(f"account:{account_id}", node_id)
                    index.setdefault(f"accountId:{account_id}", node_id)
                if trade_card:
                    index.setdefault(f"tradeCard:{trade_card}", node_id)
        return index

    @classmethod
    def _canonical_node_id(cls, node: dict[str, Any], remap: dict[str, str]) -> str | None:
        node_id = str(node.get("id") or "").strip()
        if node_id in remap:
            return remap[node_id]
        account_id = str(node.get("accountId") or "").strip()
        if account_id and f"accountId:{account_id}" in remap:
            return remap[f"accountId:{account_id}"]
        trade_card = str(node.get("tradeCard") or node.get("payAccount") or "").strip()
        if trade_card and f"tradeCard:{trade_card}" in remap:
            return remap[f"tradeCard:{trade_card}"]
        for account in node.get("accounts") or []:
            if not isinstance(account, dict):
                continue
            account_id = str(account.get("accountId") or "").strip()
            if account_id and f"accountId:{account_id}" in remap:
                return remap[f"accountId:{account_id}"]
            trade_card = str(account.get("tradeCard") or account.get("payAccount") or "").strip()
            if trade_card and f"tradeCard:{trade_card}" in remap:
                return remap[f"tradeCard:{trade_card}"]
        return node_id or None

    @staticmethod
    def _canonical_endpoint_id(value: Any, remap: dict[str, str]) -> str:
        endpoint = str(value or "").strip()
        return remap.get(endpoint, endpoint)
