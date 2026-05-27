"""Orchestration for relation graph investigation steps."""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Protocol
from uuid import uuid4

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

    def query_relation_global_candidates(
        self,
        *,
        case_id: str,
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
        filters = dict(payload.get("filters") or {}) if isinstance(payload.get("filters"), dict) else {}
        graph = self._filter_graph_from_trade_facts(current_graph, filters)
        graph = self._apply_excluded_nodes(graph, excluded_nodes)
        self._sync_snapshot_graph(graph_id, graph, trade_cards=self._accounts_from_graph(graph))
        delta = self._build_delta({**current_graph, "edges": []}, graph)
        request = {
            "caseId": case_id,
            "graphId": graph_id,
            "filters": filters,
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
                "label": "全图筛选",
                "addedNodeCount": len(delta["addedNodes"]),
                "addedEdgeCount": len(delta["addedEdges"]),
                "filterCount": len([value for value in filters.values() if value not in (None, "", [])]),
                "excludedNodeCount": len(excluded_nodes),
            },
        )

    def exclude_trades(self, payload: dict[str, Any]) -> dict[str, Any]:
        case_id = str(payload.get("caseId") or "").strip()
        graph_id = str(payload.get("graphId") or "").strip()
        if not case_id:
            raise ValueError("caseId")
        if not graph_id:
            raise ValueError("graphId")
        current_graph = self._storage.load_graph(case_id, graph_id)
        options = dict(payload.get("options") or {}) if isinstance(payload.get("options"), dict) else {}
        current_graph = self._apply_node_positions(current_graph, options)
        excluded_trade_ids = self._text_list(payload.get("excludedTrades"))
        incoming_facts = self._normalize_trade_facts(payload.get("tradeFacts"))
        edge_trade_ids = self._normalize_edge_trade_ids(payload.get("edgeTradeIds"))
        graph = self._apply_trade_exclusions(
            current_graph,
            excluded_trade_ids=excluded_trade_ids,
            incoming_facts=incoming_facts,
            edge_trade_ids=edge_trade_ids,
        )
        graph = self._apply_excluded_nodes(
            graph,
            self._normalize_excluded_nodes_list(current_graph.get("excludedNodes") or []),
        )
        self._sync_snapshot_graph(graph_id, graph, trade_cards=self._accounts_from_graph(graph))
        delta = self._build_delta(current_graph, graph)
        request = {
            "caseId": case_id,
            "graphId": graph_id,
            "excludedTrades": excluded_trade_ids,
            "edgeTradeIds": edge_trade_ids,
            "options": options,
        }
        return self._storage.save_step(
            case_id=case_id,
            graph_id=graph_id,
            step_type="detail_trade_filter",
            request=request,
            graph=graph,
            delta=delta,
            summary={
                "label": "交易核查",
                "excludedTradeCount": len(excluded_trade_ids),
                "tradeFactCount": len(graph.get("tradeFacts") or {}),
                "edgeCount": len(graph.get("edges") or []),
            },
        )

    def exclude_node(self, payload: dict[str, Any]) -> dict[str, Any]:
        case_id = str(payload.get("caseId") or "").strip()
        graph_id = str(payload.get("graphId") or "").strip()
        if not case_id:
            raise ValueError("caseId")
        if not graph_id:
            raise ValueError("graphId")
        raw_nodes = payload.get("nodes")
        if raw_nodes is None:
            node = payload.get("node")
            if not isinstance(node, dict):
                raise ValueError("node")
            raw_nodes = [node]
        if not isinstance(raw_nodes, list):
            raise ValueError("nodes")
        nodes = [node for node in raw_nodes if isinstance(node, dict)]
        if not nodes:
            raise ValueError("node")
        graph = self._storage.load_graph(case_id, graph_id)
        excluded_nodes: list[dict[str, Any]] = []
        seen_node_ids: set[str] = set()
        for node in nodes:
            node_id = str(node.get("nodeId") or node.get("id") or "").strip()
            if not node_id:
                raise ValueError("nodeId")
            if node_id in seen_node_ids:
                continue
            seen_node_ids.add(node_id)
            excluded_nodes.append(self._normalize_excluded_node(node_id, node, graph))
        merged_nodes = self._merge_excluded_nodes(graph, excluded_nodes)
        graph = self._apply_excluded_nodes(graph, merged_nodes)
        self._sync_snapshot_graph(graph_id, graph, trade_cards=self._accounts_from_graph(graph))
        request: dict[str, Any] = {"caseId": case_id, "graphId": graph_id}
        if len(excluded_nodes) == 1:
            request["node"] = excluded_nodes[0]
        else:
            request["nodes"] = excluded_nodes
        return self._storage.save_step(
            case_id=case_id,
            graph_id=graph_id,
            step_type="manual_exclude_node",
            request=request,
            graph=graph,
            delta={"addedNodes": [], "addedEdges": [], "updatedNodes": excluded_nodes, "updatedEdges": []},
            summary={
                "excludedNodeCount": len(graph.get("excludedNodes") or []),
                "updatedNodeCount": len(excluded_nodes),
            },
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

    def add_manual_node(self, payload: dict[str, Any]) -> dict[str, Any]:
        case_id = str(payload.get("caseId") or "").strip()
        graph_id = str(payload.get("graphId") or "").strip()
        label = str(payload.get("label") or payload.get("name") or payload.get("accountName") or "").strip()
        if not case_id:
            raise ValueError("caseId")
        if not graph_id:
            raise ValueError("graphId")
        if not label:
            raise ValueError("label")

        graph = self._storage.load_graph(case_id, graph_id)
        options = dict(payload.get("options") or {}) if isinstance(payload.get("options"), dict) else {}
        graph = self._apply_node_positions(graph, options)
        previous_graph = graph
        nodes_by_id = {
            str(node.get("id") or "").strip(): dict(node)
            for node in graph.get("nodes") or []
            if isinstance(node, dict) and str(node.get("id") or "").strip()
        }
        if not nodes_by_id:
            raise ValueError("graphAnchor")

        trade_card = str(payload.get("tradeCard") or "").strip()
        if trade_card and f"tradeCard:{trade_card}" in self._existing_subject_account_index(graph):
            raise ValueError("duplicateTradeCard")

        created_at = self._now_iso()
        node_id = f"manual:node:{uuid4().hex}"
        account_id = node_id
        discovery_reason = str(payload.get("discoveryReason") or "").strip()
        source_note = str(payload.get("sourceNote") or "").strip()
        note = str(payload.get("note") or "").strip()
        node = {
            "id": node_id,
            "label": label,
            "name": label,
            "accountName": label,
            "accountId": account_id,
            "tradeCard": trade_card,
            "type": "manual",
            "source": "manual",
            "isManual": True,
            "discoveryReason": discovery_reason,
            "sourceNote": source_note,
            "note": note,
            "createdAt": created_at,
            "accounts": [],
        }
        if trade_card:
            node["accounts"] = [
                {
                    "accountId": account_id,
                    "accountName": label,
                    "tradeCard": trade_card,
                    "source": "manual",
                    "discoveryReason": discovery_reason,
                    "sourceNote": source_note,
                }
            ]

        position = payload.get("position")
        if isinstance(position, dict):
            x = self._finite_number(position.get("x"))
            y = self._finite_number(position.get("y"))
            if x is not None and y is not None:
                node["x"] = x
                node["y"] = y
        self._ensure_detached_manual_node_position(node, nodes_by_id)
        nodes_by_id[node_id] = node

        layout = dict(graph.get("layout") or {})
        layout_positions = dict(layout.get("nodePositions") or {})
        x = self._finite_number(node.get("x"))
        y = self._finite_number(node.get("y"))
        if x is not None and y is not None:
            layout_positions[node_id] = {"x": x, "y": y}
        layout["nodePositions"] = layout_positions

        next_graph = {
            **graph,
            "nodes": list(nodes_by_id.values()),
            "layout": layout,
        }
        self._sync_snapshot_graph(graph_id, next_graph, trade_cards=self._accounts_from_graph(next_graph))
        delta = self._build_delta(previous_graph, next_graph)
        request = {
            "caseId": case_id,
            "graphId": graph_id,
            "label": label,
            "tradeCard": trade_card,
            "discoveryReason": discovery_reason,
            "sourceNote": source_note,
            "note": note,
            "position": {"x": x, "y": y} if x is not None and y is not None else None,
            "options": options,
        }
        return self._storage.save_step(
            case_id=case_id,
            graph_id=graph_id,
            step_type="manual_node_add",
            request=request,
            graph=next_graph,
            delta=delta,
            summary={
                "label": "创建交易主体",
                "nodeLabel": label,
                "addedNodeCount": len(delta["addedNodes"]),
                "addedEdgeCount": len(delta["addedEdges"]),
            },
        )

    def add_manual_trade(self, payload: dict[str, Any]) -> dict[str, Any]:
        case_id = str(payload.get("caseId") or "").strip()
        graph_id = str(payload.get("graphId") or "").strip()
        if not case_id:
            raise ValueError("caseId")
        if not graph_id:
            raise ValueError("graphId")
        payer_payload = payload.get("payer")
        payee_payload = payload.get("payee")
        if not isinstance(payer_payload, dict):
            raise ValueError("payer")
        if not isinstance(payee_payload, dict):
            raise ValueError("payee")
        amount = self._finite_number(payload.get("amount"))
        if amount is None or amount < 0:
            raise ValueError("amount")

        graph = self._storage.load_graph(case_id, graph_id)
        options = dict(payload.get("options") or {}) if isinstance(payload.get("options"), dict) else {}
        graph = self._apply_node_positions(graph, options)
        previous_graph = graph
        nodes_by_id = {
            str(node.get("id") or "").strip(): dict(node)
            for node in graph.get("nodes") or []
            if isinstance(node, dict) and str(node.get("id") or "").strip()
        }
        payer_node, payer_created = self._resolve_manual_party(
            payer_payload,
            nodes_by_id,
            field_name="payer",
            fallback_label="付款方",
        )
        payee_node, payee_created = self._resolve_manual_party(
            payee_payload,
            nodes_by_id,
            field_name="payee",
            fallback_label="收款方",
        )
        payer_id = str(payer_node.get("id") or "").strip()
        payee_id = str(payee_node.get("id") or "").strip()
        if not payer_id:
            raise ValueError("payer")
        if not payee_id:
            raise ValueError("payee")
        if payer_id == payee_id:
            raise ValueError("counterparty")
        if payer_created and payee_created:
            raise ValueError("graphAnchor")

        self._ensure_manual_node_position(payer_node, payee_node, created=payer_created, direction=-1)
        self._ensure_manual_node_position(payee_node, payer_node, created=payee_created, direction=1)
        nodes_by_id[payer_id] = payer_node
        nodes_by_id[payee_id] = payee_node

        created_at = self._now_iso()
        method = str(payload.get("method") or "其他").strip() or "其他"
        summary = str(payload.get("summary") or "").strip()
        source_note = str(payload.get("sourceNote") or payload.get("note") or "").strip()
        trade_time = str(payload.get("tradeTime") or "").strip() or None
        trade_id = f"manual:trade:{uuid4().hex}"
        fact = {
            "tradeId": trade_id,
            "serialNumber": trade_id,
            "tradeAmount": amount,
            "tradeTime": trade_time,
            "tradeAbstract": summary or f"人工补充{method}资金往来",
            "payerAccountId": payer_id,
            "payerAccountName": self._node_display_name(payer_node),
            "payerTradeCard": str(payer_node.get("tradeCard") or "").strip(),
            "payeeAccountId": payee_id,
            "payeeAccountName": self._node_display_name(payee_node),
            "payeeTradeCard": str(payee_node.get("tradeCard") or "").strip(),
            "source": "manual",
            "method": method,
            "sourceNote": source_note,
            "createdAt": created_at,
        }
        trade_facts = {
            str(key): dict(value)
            for key, value in (graph.get("tradeFacts") or {}).items()
            if str(key) and isinstance(value, dict)
        }
        trade_facts[trade_id] = fact

        edges_by_id: dict[str, dict[str, Any]] = {}
        for raw_edge in graph.get("edges") or []:
            if not isinstance(raw_edge, dict):
                continue
            edge = dict(raw_edge)
            source, target = self._edge_endpoints(edge)
            if not source or not target or source == target:
                continue
            edge_id = self._canonical_edge_id(edge, source, target)
            edge["id"] = edge_id
            edge["from"] = source
            edge["to"] = target
            edge["source"] = source
            edge["target"] = target
            edges_by_id[edge_id] = edge

        edge_id = f"money:{payer_id}->{payee_id}"
        existing_edge = edges_by_id.get(edge_id)
        if existing_edge:
            edge = dict(existing_edge)
            trade_ids = self._text_list(edge.get("tradeIds"))
            trade_ids.append(fact["tradeId"])
            edge["tradeIds"] = trade_ids
            known_facts = [trade_facts[item] for item in trade_ids if item in trade_facts]
            if known_facts and len(known_facts) == len(trade_ids):
                edge = self._recompute_edge_from_trade_facts(edge, known_facts)
            else:
                previous_amount = self._finite_number(edge.get("tradeAmount")) or self._finite_number(edge.get("amount")) or 0.0
                previous_count = int(self._finite_number(edge.get("tradeCount")) or self._finite_number(edge.get("count")) or 0)
                edge["tradeAmount"] = previous_amount + amount
                edge["amount"] = previous_amount + amount
                edge["tradeCount"] = previous_count + 1
                edge["count"] = previous_count + 1
        else:
            edge = {
                "id": edge_id,
                "from": payer_id,
                "to": payee_id,
                "source": payer_id,
                "target": payee_id,
                "tradeCount": 1,
                "count": 1,
                "tradeAmount": amount,
                "amount": amount,
                "tradeIds": [trade_id],
                "scope": "manual",
            }
        edge["manualTradeCount"] = int(self._finite_number(edge.get("manualTradeCount")) or 0) + 1
        edge["hasManualTrade"] = True
        edge["sourceTypes"] = sorted({*self._text_list(edge.get("sourceTypes")), "manual"})
        if trade_time:
            edge.setdefault("startTime", trade_time)
            edge.setdefault("endTime", trade_time)
            edge.setdefault("startDate", trade_time)
            edge.setdefault("endDate", trade_time)
        edges_by_id[edge_id] = edge

        manual_edges = [
            dict(item)
            for item in graph.get("manualEdges") or []
            if isinstance(item, dict)
        ]
        manual_edges.append({
            "id": f"manual:edge:{uuid4().hex}",
            "from": payer_id,
            "to": payee_id,
            "source": payer_id,
            "target": payee_id,
            "tradeIds": [trade_id],
            "tradeAmount": amount,
            "tradeCount": 1,
            "method": method,
            "summary": summary,
            "sourceNote": source_note,
            "createdAt": created_at,
        })

        layout = dict(graph.get("layout") or {})
        layout_positions = dict(layout.get("nodePositions") or {})
        for node in (payer_node, payee_node):
            node_id = str(node.get("id") or "").strip()
            x = self._finite_number(node.get("x"))
            y = self._finite_number(node.get("y"))
            if node_id and x is not None and y is not None:
                layout_positions[node_id] = {"x": x, "y": y}
        layout["nodePositions"] = layout_positions

        next_graph = {
            **graph,
            "nodes": list(nodes_by_id.values()),
            "edges": list(edges_by_id.values()),
            "tradeFacts": trade_facts,
            "manualEdges": manual_edges,
            "layout": layout,
        }
        self._sync_snapshot_graph(graph_id, next_graph, trade_cards=self._accounts_from_graph(next_graph))
        delta = self._build_delta(previous_graph, next_graph)
        if existing_edge and edge_id not in {str(item.get("id") or "").strip() for item in delta["addedEdges"] if isinstance(item, dict)}:
            delta["updatedEdges"] = [edge]
        request = {
            "caseId": case_id,
            "graphId": graph_id,
            "payer": self._manual_party_request_summary(payer_node, payer_created),
            "payee": self._manual_party_request_summary(payee_node, payee_created),
            "amount": amount,
            "tradeTime": trade_time,
            "method": method,
            "summary": summary,
            "sourceNote": source_note,
            "options": options,
        }
        return self._storage.save_step(
            case_id=case_id,
            graph_id=graph_id,
            step_type="manual_trade_add",
            request=request,
            graph=next_graph,
            delta=delta,
            summary={
                "label": "补充资金往来",
                "amount": amount,
                "method": method,
                "addedNodeCount": len(delta["addedNodes"]),
                "addedEdgeCount": len(delta["addedEdges"]),
                "updatedEdgeCount": len(delta.get("updatedEdges") or []),
            },
        )

    def add_reality_relation(self, payload: dict[str, Any]) -> dict[str, Any]:
        case_id = str(payload.get("caseId") or "").strip()
        graph_id = str(payload.get("graphId") or "").strip()
        source_node_id = str(payload.get("sourceNodeId") or payload.get("source") or "").strip()
        target_node_id = str(payload.get("targetNodeId") or payload.get("target") or "").strip()
        if not case_id:
            raise ValueError("caseId")
        if not graph_id:
            raise ValueError("graphId")
        if not source_node_id:
            raise ValueError("sourceNodeId")
        if not target_node_id:
            raise ValueError("targetNodeId")
        if source_node_id == target_node_id:
            raise ValueError("counterparty")
        relation_type = str(payload.get("relationType") or payload.get("label") or "").strip()
        if not relation_type:
            raise ValueError("relationType")

        graph = self._storage.load_graph(case_id, graph_id)
        options = dict(payload.get("options") or {}) if isinstance(payload.get("options"), dict) else {}
        graph = self._apply_node_positions(graph, options)
        nodes_by_id = {
            str(node.get("id") or "").strip(): dict(node)
            for node in graph.get("nodes") or []
            if isinstance(node, dict) and str(node.get("id") or "").strip()
        }
        if source_node_id not in nodes_by_id:
            raise ValueError("sourceNodeId")
        if target_node_id not in nodes_by_id:
            raise ValueError("targetNodeId")

        relation_id = str(payload.get("relationId") or "").strip() or f"reality:{uuid4().hex}"
        relation = {
            "id": relation_id,
            "source": source_node_id,
            "target": target_node_id,
            "sourceNodeId": source_node_id,
            "targetNodeId": target_node_id,
            "relationType": relation_type,
            "label": str(payload.get("label") or relation_type).strip() or relation_type,
            "note": str(payload.get("note") or "").strip(),
            "sourceType": "manual",
            "createdAt": self._now_iso(),
        }
        previous_relations = [
            dict(item)
            for item in graph.get("realityRelations") or []
            if isinstance(item, dict)
        ]
        relation_key = (source_node_id, target_node_id, relation_type)
        replaced = False
        next_relations: list[dict[str, Any]] = []
        for item in previous_relations:
            item_key = (
                str(item.get("source") or item.get("sourceNodeId") or "").strip(),
                str(item.get("target") or item.get("targetNodeId") or "").strip(),
                str(item.get("relationType") or item.get("label") or "").strip(),
            )
            if item_key == relation_key:
                next_relations.append({**item, **relation, "id": str(item.get("id") or relation_id).strip() or relation_id})
                replaced = True
            else:
                next_relations.append(item)
        if not replaced:
            next_relations.append(relation)
        next_graph = {
            **graph,
            "realityRelations": next_relations,
        }
        self._sync_snapshot_graph(graph_id, next_graph, trade_cards=self._accounts_from_graph(next_graph))
        delta = self._build_delta(graph, next_graph)
        delta["addedRealityRelations"] = [] if replaced else [relation]
        delta["updatedRealityRelations"] = [relation] if replaced else []
        return self._storage.save_step(
            case_id=case_id,
            graph_id=graph_id,
            step_type="reality_relation_add",
            request={
                "caseId": case_id,
                "graphId": graph_id,
                "sourceNodeId": source_node_id,
                "targetNodeId": target_node_id,
                "relationType": relation_type,
                "note": relation["note"],
                "options": options,
            },
            graph=next_graph,
            delta=delta,
            summary={
                "label": "标注现实关系",
                "relationType": relation_type,
                "relationCount": len(next_relations),
            },
        )

    def query_summary_candidates(self, payload: dict[str, Any]) -> dict[str, Any]:
        case_id = str(payload.get("caseId") or "").strip()
        graph_id = str(payload.get("graphId") or "").strip()
        focus_node_id = str(payload.get("focusNodeId") or "").strip()
        if not case_id:
            raise ValueError("caseId")
        if not graph_id:
            raise ValueError("graphId")

        current_graph = self._storage.load_graph(case_id, graph_id)
        if not focus_node_id:
            graph = self._query_client.query_relation_global_candidates(
                case_id=case_id,
                filters=self._summary_relation_filters(),
            )
            return {
                "caseId": case_id,
                "graphId": graph_id,
                "focusNodeId": None,
                "direction": "both",
                "scope": "global",
                "items": self._summary_items_from_global_candidates(
                    current_graph=current_graph,
                    candidates=graph.get("items") or [],
                ),
            }

        focus_accounts = self._accounts_for_node_ids(current_graph, [focus_node_id], {focus_node_id})
        if not focus_accounts:
            raise ValueError("focusNodeAccounts")
        direction = str(payload.get("direction") or "both").strip()
        if direction not in {"in", "out", "both"}:
            direction = "both"
        graph = self._query_client.query_relation_one_hop(
            case_id=case_id,
            seed_accounts=focus_accounts,
            direction=direction,
            filters=self._summary_relation_filters(),
        )
        graph = self._remap_graph_to_existing_subjects(case_id=case_id, graph_id=graph_id, graph=graph)
        return {
            "caseId": case_id,
            "graphId": graph_id,
            "focusNodeId": focus_node_id,
            "direction": direction,
            "items": self._summary_items_from_graph(
                current_graph=current_graph,
                summary_graph=graph,
                focus_node_id=focus_node_id,
                focus_accounts=focus_accounts,
            ),
        }

    def apply_summary_selection(self, payload: dict[str, Any]) -> dict[str, Any]:
        case_id = str(payload.get("caseId") or "").strip()
        graph_id = str(payload.get("graphId") or "").strip()
        focus_node_id = str(payload.get("focusNodeId") or "").strip()
        if not case_id:
            raise ValueError("caseId")
        if not graph_id:
            raise ValueError("graphId")

        graph = self._storage.load_graph(case_id, graph_id)
        options = dict(payload.get("options") or {}) if isinstance(payload.get("options"), dict) else {}
        graph = self._apply_node_positions(graph, options)
        current_excluded_nodes = self._normalize_excluded_nodes_list(graph.get("excludedNodes") or [])
        candidate_node_ids = self._text_list(payload.get("candidateNodeIds"))
        selected_node_ids = set(self._text_list(payload.get("selectedNodeIds")))
        candidate_node_id_set = set(candidate_node_ids)
        if candidate_node_id_set:
            selected_node_ids = {node_id for node_id in selected_node_ids if node_id in candidate_node_id_set}

        selected_accounts = self._dedupe_accounts(
            [
                *self._accounts_for_node_ids(graph, candidate_node_ids, selected_node_ids),
                *self._candidate_accounts_from_payload(payload, selected_node_ids),
            ]
        )
        query_filters = self._summary_relation_filters()
        selected_account_keys = self._account_identity_keys(selected_accounts)
        next_excluded_nodes = [
            item for item in current_excluded_nodes
            if not self._excluded_node_matches_account_keys(item, selected_account_keys)
        ]
        next_graph = self._apply_excluded_nodes(graph, next_excluded_nodes)
        if not focus_node_id:
            expansion_graph = self._summary_graph_from_selected_candidates(payload, selected_node_ids)
            next_graph = self._merge_graphs(next_graph, expansion_graph, keep_base_edges=True)
            next_graph = self._apply_excluded_nodes(next_graph, next_excluded_nodes)
        else:
            focus_accounts = self._accounts_for_node_ids(graph, [focus_node_id], {focus_node_id})
            if not focus_accounts:
                raise ValueError("focusNodeAccounts")
        if focus_node_id and focus_accounts and selected_accounts:
            expansion_graph = self._query_client.query_relation_between_accounts(
                case_id=case_id,
                accounts=self._dedupe_accounts([*focus_accounts, *selected_accounts]),
                filters=query_filters,
            )
            expansion_graph = self._remap_graph_to_existing_subjects(
                case_id=case_id,
                graph_id=graph_id,
                graph=expansion_graph,
            )
            expansion_graph = self._filter_graph_to_selected_summary_edges(
                expansion_graph,
                focus_accounts=focus_accounts,
                selected_accounts=selected_accounts,
            )
            next_graph = self._merge_graphs(next_graph, expansion_graph, keep_base_edges=True)
            next_graph = self._apply_excluded_nodes(next_graph, next_excluded_nodes)
        self._sync_snapshot_graph(graph_id, next_graph, trade_cards=self._accounts_from_graph(next_graph))
        delta = self._build_delta(graph, next_graph)
        updated_nodes = [
            {
                "nodeId": node_id,
                "selected": node_id in selected_node_ids,
            }
            for node_id in candidate_node_ids
        ]
        request = {
            "caseId": case_id,
            "graphId": graph_id,
            "focusNodeId": focus_node_id or None,
            "scope": "node" if focus_node_id else "global",
            "candidateNodeIds": candidate_node_ids,
            "selectedNodeIds": list(selected_node_ids),
            "filters": dict(payload.get("filters") or {}) if isinstance(payload.get("filters"), dict) else {},
            "drillNums": payload.get("drillNums") or payload.get("limit"),
            "drillType": payload.get("drillType"),
            "options": options,
        }
        delta["updatedNodes"] = updated_nodes
        return self._storage.save_step(
            case_id=case_id,
            graph_id=graph_id,
            step_type="summary_analysis",
            request=request,
            graph=next_graph,
            delta=delta,
            summary={
                "label": "线索扩展",
                "candidateNodeCount": len(candidate_node_ids),
                "retainedNodeCount": len(selected_node_ids),
                "excludedNodeCount": len(next_excluded_nodes),
                "addedNodeCount": len(delta["addedNodes"]),
                "addedEdgeCount": len(delta["addedEdges"]),
            },
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

    @staticmethod
    def _summary_relation_filters() -> dict[str, Any]:
        return {"_relationUnbounded": True}

    @classmethod
    def _summary_items_from_global_candidates(
        cls,
        *,
        current_graph: dict[str, Any],
        candidates: list[Any],
    ) -> list[dict[str, Any]]:
        current_nodes = {
            str(node.get("id") or "").strip(): dict(node)
            for node in current_graph.get("nodes") or []
            if isinstance(node, dict) and str(node.get("id") or "").strip()
        }
        identity_index = cls._existing_subject_account_index(current_graph)
        excluded_nodes = cls._normalize_excluded_nodes_list(current_graph.get("excludedNodes") or [])
        excluded_ids = {
            str(item.get("nodeId") or "").strip()
            for item in excluded_nodes
            if str(item.get("nodeId") or "").strip()
        }
        excluded_account_ids, excluded_trade_cards = cls._excluded_account_keys(excluded_nodes)
        items_by_id: dict[str, dict[str, Any]] = {}

        for raw_item in candidates:
            if not isinstance(raw_item, dict):
                continue
            node = cls._summary_candidate_node_from_item(raw_item)
            raw_node_id = str(raw_item.get("nodeId") or node.get("id") or "").strip()
            if not raw_node_id:
                continue
            canonical_id = cls._canonical_node_id(node, identity_index) or raw_node_id
            graph_node = current_nodes.get(canonical_id)
            display_node = cls._merge_node_preserving_layout(graph_node or node, node) if graph_node else node
            item = items_by_id.setdefault(
                canonical_id,
                cls._summary_item_from_node(
                    node_id=canonical_id,
                    node=display_node,
                    is_on_graph=canonical_id in current_nodes,
                    is_excluded=cls._node_matches_exclusion(
                        {**display_node, "id": canonical_id},
                        excluded_ids=excluded_ids,
                        excluded_account_ids=excluded_account_ids,
                        excluded_trade_cards=excluded_trade_cards,
                    ),
                ),
            )
            cls._apply_global_summary_candidate_item(item, raw_item)

        return sorted(
            items_by_id.values(),
            key=lambda item: (
                0 if item.get("status") == "candidate" else 1 if item.get("status") == "excluded" else 2,
                -float(item.get("totalAmount") or 0),
                -len(item.get("tradeIds") or []),
                str(item.get("label") or ""),
            ),
        )

    @classmethod
    def _summary_items_from_graph(
        cls,
        *,
        current_graph: dict[str, Any],
        summary_graph: dict[str, Any],
        focus_node_id: str,
        focus_accounts: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        summary_nodes = {
            str(node.get("id") or "").strip(): dict(node)
            for node in summary_graph.get("nodes") or []
            if isinstance(node, dict) and str(node.get("id") or "").strip()
        }
        current_nodes = {
            str(node.get("id") or "").strip(): dict(node)
            for node in current_graph.get("nodes") or []
            if isinstance(node, dict) and str(node.get("id") or "").strip()
        }
        focus_id = cls._resolve_summary_focus_node_id(summary_graph, focus_node_id, focus_accounts)
        if not focus_id:
            return []
        identity_index = cls._existing_subject_account_index(current_graph)
        excluded_nodes = cls._normalize_excluded_nodes_list(current_graph.get("excludedNodes") or [])
        excluded_ids = {
            str(item.get("nodeId") or "").strip()
            for item in excluded_nodes
            if str(item.get("nodeId") or "").strip()
        }
        excluded_account_ids, excluded_trade_cards = cls._excluded_account_keys(excluded_nodes)
        trade_facts = {
            str(key): dict(value)
            for key, value in (summary_graph.get("tradeFacts") or {}).items()
            if str(key).strip() and isinstance(value, dict)
        }
        items_by_id: dict[str, dict[str, Any]] = {}

        for raw_edge in summary_graph.get("edges") or []:
            if not isinstance(raw_edge, dict):
                continue
            edge = dict(raw_edge)
            source, target = cls._edge_endpoints(edge)
            if not source or not target or (source != focus_id and target != focus_id):
                continue
            direction = "in" if target == focus_id else "out"
            counterparty_id = source if direction == "in" else target
            counterparty = summary_nodes.get(counterparty_id)
            if not counterparty:
                continue
            canonical_id = cls._canonical_node_id(counterparty, identity_index) or counterparty_id
            graph_node = current_nodes.get(canonical_id)
            display_node = cls._merge_node_preserving_layout(graph_node or counterparty, counterparty) if graph_node else counterparty
            item = items_by_id.setdefault(
                canonical_id,
                cls._summary_item_from_node(
                    node_id=canonical_id,
                    node=display_node,
                    is_on_graph=canonical_id in current_nodes,
                    is_excluded=cls._node_matches_exclusion(
                        {**display_node, "id": canonical_id},
                        excluded_ids=excluded_ids,
                        excluded_account_ids=excluded_account_ids,
                        excluded_trade_cards=excluded_trade_cards,
                    ),
                ),
            )
            trade_ids = [
                trade_id for trade_id in (
                    str(trade_id or "").strip() for trade_id in edge.get("tradeIds") or []
                ) if trade_id
            ]
            facts = [trade_facts[trade_id] for trade_id in trade_ids if trade_id in trade_facts]
            if facts:
                for fact in facts:
                    cls._apply_summary_fact(item, fact, direction)
            else:
                cls._apply_summary_edge(item, edge, direction)
            item["tradeIds"] = cls._unique_text_list([*(item.get("tradeIds") or []), *trade_ids])

        return sorted(
            items_by_id.values(),
            key=lambda item: (
                0 if item.get("status") == "candidate" else 1 if item.get("status") == "excluded" else 2,
                -float(item.get("totalAmount") or 0),
                -len(item.get("tradeIds") or []),
                str(item.get("label") or ""),
            ),
        )

    @classmethod
    def _summary_candidate_node_from_item(cls, item: dict[str, Any]) -> dict[str, Any]:
        accounts = cls._normalize_accounts(item.get("accounts") if isinstance(item.get("accounts"), list) else [item])
        first = accounts[0] if accounts else {}
        account_id = str(item.get("accountId") or first.get("accountId") or "").strip()
        trade_card = str(item.get("tradeCard") or first.get("tradeCard") or first.get("payAccount") or "").strip()
        node_id = str(item.get("nodeId") or item.get("id") or "").strip()
        if not node_id:
            node_id = f"account:{account_id}" if account_id else f"account:{trade_card}"
        label = str(
            item.get("label")
            or item.get("accountName")
            or first.get("accountName")
            or trade_card
            or node_id
        ).strip()
        return {
            "id": node_id,
            "type": str(item.get("type") or "account").strip(),
            "role": str(item.get("role") or "candidate").strip(),
            "label": label,
            "accountId": account_id or None,
            "accountIds": [account_id] if account_id else [],
            "tradeCard": trade_card,
            "accountName": label,
            "accounts": accounts,
            "depth": item.get("depth", 1),
        }

    @classmethod
    def _apply_global_summary_candidate_item(cls, item: dict[str, Any], candidate: dict[str, Any]) -> None:
        item["receivedAmount"] = float(item.get("receivedAmount") or 0) + cls._float_value(candidate.get("receivedAmount"))
        item["receivedCount"] = int(item.get("receivedCount") or 0) + int(cls._float_value(candidate.get("receivedCount")))
        item["paidAmount"] = float(item.get("paidAmount") or 0) + cls._float_value(candidate.get("paidAmount"))
        item["paidCount"] = int(item.get("paidCount") or 0) + int(cls._float_value(candidate.get("paidCount")))
        item["totalAmount"] = float(item.get("receivedAmount") or 0) + float(item.get("paidAmount") or 0)
        item["netAmount"] = float(item.get("receivedAmount") or 0) - float(item.get("paidAmount") or 0)
        min_amount = candidate.get("minAmount")
        max_amount = candidate.get("maxAmount")
        if min_amount is not None:
            amount = cls._float_value(min_amount)
            item["minAmount"] = amount if item.get("minAmount") is None else min(float(item["minAmount"]), amount)
        if max_amount is not None:
            amount = cls._float_value(max_amount)
            item["maxAmount"] = amount if item.get("maxAmount") is None else max(float(item["maxAmount"]), amount)
        cls._update_summary_time(item, str(candidate.get("startTime") or "").strip())
        cls._update_summary_time(item, str(candidate.get("endTime") or "").strip())
        item["tradeIds"] = cls._unique_text_list([
            *(item.get("tradeIds") or []),
            *(candidate.get("tradeIds") or []),
        ])
        accounts = cls._dedupe_accounts([
            *(item.get("accounts") or []),
            *(candidate.get("accounts") or []),
        ])
        if accounts:
            item["accounts"] = accounts
            item["accountText"] = "、".join(cls._unique_text_list([
                *(str(account.get("accountId") or "").strip() for account in accounts),
                *(str(account.get("tradeCard") or account.get("payAccount") or "").strip() for account in accounts),
            ]))

    @classmethod
    def _resolve_summary_focus_node_id(
        cls,
        summary_graph: dict[str, Any],
        focus_node_id: str,
        focus_accounts: list[dict[str, Any]],
    ) -> str:
        summary_node_ids = {
            str(node.get("id") or "").strip()
            for node in summary_graph.get("nodes") or []
            if isinstance(node, dict) and str(node.get("id") or "").strip()
        }
        if focus_node_id in summary_node_ids:
            return focus_node_id
        matched_node_ids = cls._node_ids_for_accounts(summary_graph, focus_accounts)
        for node_id in matched_node_ids:
            if node_id in summary_node_ids:
                return node_id
        for node in summary_graph.get("nodes") or []:
            if isinstance(node, dict) and node.get("role") == "seed":
                return str(node.get("id") or "").strip()
        return ""

    @classmethod
    def _summary_item_from_node(
        cls,
        *,
        node_id: str,
        node: dict[str, Any],
        is_on_graph: bool,
        is_excluded: bool,
    ) -> dict[str, Any]:
        accounts = cls._normalize_accounts(node.get("accounts") if isinstance(node.get("accounts"), list) else [node])
        status = "excluded" if is_excluded else "on_graph" if is_on_graph else "candidate"
        label = str(
            node.get("label")
            or node.get("name")
            or node.get("accountName")
            or node.get("tradeCard")
            or node_id
        ).strip()
        return {
            "nodeId": node_id,
            "label": label,
            "accountText": "、".join(cls._unique_text_list([
                *(str(account.get("accountId") or "").strip() for account in accounts),
                *(str(account.get("tradeCard") or "").strip() for account in accounts),
            ])),
            "accounts": accounts,
            "receivedAmount": 0.0,
            "receivedCount": 0,
            "paidAmount": 0.0,
            "paidCount": 0,
            "totalAmount": 0.0,
            "netAmount": 0.0,
            "minAmount": None,
            "maxAmount": None,
            "startTime": "",
            "endTime": "",
            "tradeIds": [],
            "isOnGraph": is_on_graph,
            "isExcluded": is_excluded,
            "status": status,
        }

    @classmethod
    def _apply_summary_fact(cls, item: dict[str, Any], fact: dict[str, Any], direction: str) -> None:
        amount = cls._float_value(fact.get("tradeAmount"))
        if direction == "in":
            item["receivedAmount"] = float(item.get("receivedAmount") or 0) + amount
            item["receivedCount"] = int(item.get("receivedCount") or 0) + 1
        else:
            item["paidAmount"] = float(item.get("paidAmount") or 0) + amount
            item["paidCount"] = int(item.get("paidCount") or 0) + 1
        cls._update_summary_amounts(item, amount, str(fact.get("tradeTime") or "").strip())

    @classmethod
    def _apply_summary_edge(cls, item: dict[str, Any], edge: dict[str, Any], direction: str) -> None:
        amount = cls._float_value(edge.get("tradeAmount") or edge.get("amount"))
        count = int(cls._float_value(edge.get("tradeCount") or edge.get("count")))
        if direction == "in":
            item["receivedAmount"] = float(item.get("receivedAmount") or 0) + amount
            item["receivedCount"] = int(item.get("receivedCount") or 0) + count
        else:
            item["paidAmount"] = float(item.get("paidAmount") or 0) + amount
            item["paidCount"] = int(item.get("paidCount") or 0) + count
        cls._update_summary_amounts(item, amount, str(edge.get("startTime") or edge.get("startDate") or "").strip())
        cls._update_summary_time(item, str(edge.get("endTime") or edge.get("endDate") or "").strip())

    @classmethod
    def _update_summary_amounts(cls, item: dict[str, Any], amount: float, time: str) -> None:
        item["totalAmount"] = float(item.get("totalAmount") or 0) + amount
        item["netAmount"] = float(item.get("receivedAmount") or 0) - float(item.get("paidAmount") or 0)
        item["minAmount"] = amount if item.get("minAmount") is None else min(float(item["minAmount"]), amount)
        item["maxAmount"] = amount if item.get("maxAmount") is None else max(float(item["maxAmount"]), amount)
        cls._update_summary_time(item, time)

    @staticmethod
    def _update_summary_time(item: dict[str, Any], time: str) -> None:
        if not time:
            return
        item["startTime"] = min(str(item.get("startTime") or time), time)
        item["endTime"] = max(str(item.get("endTime") or time), time)

    @staticmethod
    def _float_value(value: Any) -> float:
        try:
            return float(value or 0)
        except (TypeError, ValueError):
            return 0.0

    @staticmethod
    def _unique_text_list(values: list[Any]) -> list[str]:
        return list(dict.fromkeys(str(value or "").strip() for value in values if str(value or "").strip()))

    @classmethod
    def _candidate_accounts_from_payload(
        cls,
        payload: dict[str, Any],
        selected_node_ids: set[str],
    ) -> list[dict[str, Any]]:
        raw_candidates = payload.get("selectedCandidates")
        if raw_candidates is None:
            raw_candidates = payload.get("candidateAccounts")
        candidates = raw_candidates if isinstance(raw_candidates, list) else []
        accounts: list[dict[str, Any]] = []
        for item in candidates:
            if not isinstance(item, dict):
                continue
            node_id = str(item.get("nodeId") or item.get("id") or "").strip()
            if selected_node_ids and node_id and node_id not in selected_node_ids:
                continue
            item_accounts = item.get("accounts")
            if isinstance(item_accounts, list):
                accounts.extend(account for account in item_accounts if isinstance(account, dict))
            else:
                accounts.append(item)
        return cls._normalize_accounts(accounts)

    @classmethod
    def _filter_graph_to_selected_summary_edges(
        cls,
        graph: dict[str, Any],
        *,
        focus_accounts: list[dict[str, Any]],
        selected_accounts: list[dict[str, Any]],
    ) -> dict[str, Any]:
        focus_node_ids = cls._node_ids_for_accounts(graph, focus_accounts)
        selected_node_ids = cls._node_ids_for_accounts(graph, selected_accounts)
        if not focus_node_ids or not selected_node_ids:
            return {"nodes": [], "edges": [], "tradeFacts": {}}
        retained_edges: list[dict[str, Any]] = []
        retained_node_ids: set[str] = set()
        retained_trade_ids: set[str] = set()
        for raw_edge in graph.get("edges") or []:
            if not isinstance(raw_edge, dict):
                continue
            edge = dict(raw_edge)
            source, target = cls._edge_endpoints(edge)
            if not source or not target:
                continue
            if not ((source in focus_node_ids and target in selected_node_ids) or (target in focus_node_ids and source in selected_node_ids)):
                continue
            retained_edges.append(edge)
            retained_node_ids.update((source, target))
            retained_trade_ids.update(
                trade_id for trade_id in (
                    str(trade_id or "").strip() for trade_id in edge.get("tradeIds") or []
                ) if trade_id
            )
        nodes = [
            dict(node)
            for node in graph.get("nodes") or []
            if isinstance(node, dict) and str(node.get("id") or "").strip() in retained_node_ids
        ]
        trade_facts = {
            str(key): dict(value)
            for key, value in (graph.get("tradeFacts") or {}).items()
            if str(key) in retained_trade_ids and isinstance(value, dict)
        }
        return {**graph, "nodes": nodes, "edges": retained_edges, "tradeFacts": trade_facts}

    @classmethod
    def _summary_graph_from_selected_candidates(
        cls,
        payload: dict[str, Any],
        selected_node_ids: set[str],
    ) -> dict[str, Any]:
        if not selected_node_ids:
            return {"nodes": [], "edges": [], "tradeFacts": {}}
        raw_candidates = payload.get("selectedCandidates")
        candidates = raw_candidates if isinstance(raw_candidates, list) else []
        nodes_by_id: dict[str, dict[str, Any]] = {}
        for item in candidates:
            if not isinstance(item, dict):
                continue
            node_id = str(item.get("nodeId") or item.get("id") or "").strip()
            if selected_node_ids and node_id and node_id not in selected_node_ids:
                continue
            node = cls._summary_candidate_node_from_item(item)
            normalized_node_id = str(node.get("id") or "").strip()
            if not normalized_node_id:
                continue
            nodes_by_id[normalized_node_id] = node
        return {"nodes": list(nodes_by_id.values()), "edges": [], "tradeFacts": {}}

    @classmethod
    def _account_identity_keys(cls, accounts: list[dict[str, Any]]) -> tuple[set[str], set[str]]:
        account_ids = {
            str(account.get("accountId") or "").strip()
            for account in accounts
            if str(account.get("accountId") or "").strip()
        }
        trade_cards = {
            str(account.get("tradeCard") or account.get("payAccount") or "").strip()
            for account in accounts
            if str(account.get("tradeCard") or account.get("payAccount") or "").strip()
        }
        return account_ids, trade_cards

    @staticmethod
    def _excluded_node_matches_account_keys(
        excluded_node: dict[str, Any],
        keys: tuple[set[str], set[str]],
    ) -> bool:
        account_ids, trade_cards = keys
        if not account_ids and not trade_cards:
            return False
        return any(str(value or "").strip() in account_ids for value in excluded_node.get("accountIds") or []) or any(
            str(value or "").strip() in trade_cards for value in excluded_node.get("tradeCards") or []
        )

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

    @classmethod
    def _accounts_for_node_ids(
        cls,
        graph: dict[str, Any],
        ordered_node_ids: list[str],
        selected_node_ids: set[str],
    ) -> list[dict[str, Any]]:
        nodes_by_id = {
            str(node.get("id") or "").strip(): dict(node)
            for node in graph.get("nodes") or []
            if isinstance(node, dict) and str(node.get("id") or "").strip()
        }
        accounts: list[dict[str, Any]] = []
        for node_id in ordered_node_ids:
            if node_id not in selected_node_ids:
                continue
            node = nodes_by_id.get(node_id)
            if not node:
                continue
            node_accounts = node.get("accounts")
            if isinstance(node_accounts, list) and node_accounts:
                accounts.extend(account for account in node_accounts if isinstance(account, dict))
            else:
                accounts.append(node)
        return cls._normalize_accounts(accounts)

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

    @classmethod
    def _incident_node_ids(cls, graph: dict[str, Any], focus_node_id: str) -> list[str]:
        node_ids: list[str] = []
        seen: set[str] = set()
        for raw_edge in graph.get("edges") or []:
            if not isinstance(raw_edge, dict):
                continue
            source, target = cls._edge_endpoints(raw_edge)
            if source == focus_node_id and target and target not in seen:
                node_ids.append(target)
                seen.add(target)
            elif target == focus_node_id and source and source not in seen:
                node_ids.append(source)
                seen.add(source)
        return node_ids

    def _load_current_graph(self, case_id: str, graph_id: str) -> dict[str, Any]:
        try:
            return self._storage.load_graph(case_id, graph_id)
        except (FileNotFoundError, KeyError, ValueError, TypeError):
            return {}

    @classmethod
    def _resolve_manual_party(
        cls,
        payload: dict[str, Any],
        nodes_by_id: dict[str, dict[str, Any]],
        *,
        field_name: str,
        fallback_label: str,
    ) -> tuple[dict[str, Any], bool]:
        node_id = str(payload.get("nodeId") or payload.get("id") or "").strip()
        if node_id and node_id in nodes_by_id:
            return dict(nodes_by_id[node_id]), False

        label = str(
            payload.get("label")
            or payload.get("name")
            or payload.get("accountName")
            or payload.get("tradeCard")
            or ""
        ).strip()
        if not payload.get("createNew") and label:
            normalized_label = label.casefold()
            for node in nodes_by_id.values():
                if cls._node_display_name(node).casefold() == normalized_label:
                    return dict(node), False
        if not label:
            raise ValueError(field_name)
        manual_node_id = node_id if node_id and node_id not in nodes_by_id else f"manual:node:{uuid4().hex}"
        trade_card = str(payload.get("tradeCard") or "").strip()
        node = {
            "id": manual_node_id,
            "label": label or fallback_label,
            "name": label or fallback_label,
            "accountName": label or fallback_label,
            "tradeCard": trade_card,
            "accountId": str(payload.get("accountId") or manual_node_id).strip(),
            "type": "manual",
            "source": "manual",
            "isManual": True,
            "accounts": [],
        }
        if trade_card:
            node["accounts"] = [
                {
                    "accountId": node["accountId"],
                    "accountName": node["accountName"],
                    "tradeCard": trade_card,
                    "source": "manual",
                }
            ]
        return node, True

    @classmethod
    def _ensure_manual_node_position(
        cls,
        node: dict[str, Any],
        anchor: dict[str, Any],
        *,
        created: bool,
        direction: int,
    ) -> None:
        if not created:
            return
        if cls._finite_number(node.get("x")) is not None and cls._finite_number(node.get("y")) is not None:
            return
        anchor_x = cls._finite_number(anchor.get("x"))
        anchor_y = cls._finite_number(anchor.get("y"))
        node["x"] = (anchor_x if anchor_x is not None else 520.0) + direction * 360.0
        node["y"] = (anchor_y if anchor_y is not None else 300.0) + 112.0

    @classmethod
    def _ensure_detached_manual_node_position(
        cls,
        node: dict[str, Any],
        existing_nodes: dict[str, dict[str, Any]],
    ) -> None:
        if cls._finite_number(node.get("x")) is not None and cls._finite_number(node.get("y")) is not None:
            return
        points: list[tuple[float, float]] = []
        for existing_node in existing_nodes.values():
            x = cls._finite_number(existing_node.get("x"))
            y = cls._finite_number(existing_node.get("y"))
            if x is not None and y is not None:
                points.append((x, y))
        if not points:
            node["x"] = 520.0
            node["y"] = 300.0
            return
        max_x = max(point[0] for point in points)
        avg_y = sum(point[1] for point in points) / len(points)
        node["x"] = max_x + 320.0
        node["y"] = avg_y

    @staticmethod
    def _now_iso() -> str:
        return datetime.now(UTC).isoformat().replace("+00:00", "Z")

    @staticmethod
    def _node_display_name(node: dict[str, Any]) -> str:
        return str(
            node.get("accountName")
            or node.get("label")
            or node.get("name")
            or node.get("tradeCard")
            or node.get("accountId")
            or node.get("id")
            or ""
        ).strip()

    @classmethod
    def _manual_party_request_summary(cls, node: dict[str, Any], created: bool) -> dict[str, Any]:
        return {
            "nodeId": str(node.get("id") or "").strip(),
            "label": cls._node_display_name(node),
            "created": created,
        }

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
    def _merge_excluded_nodes(
        graph: dict[str, Any],
        excluded_nodes: dict[str, Any] | list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        nodes_by_id = {
            str(item.get("nodeId") or "").strip(): dict(item)
            for item in graph.get("excludedNodes") or []
            if isinstance(item, dict) and str(item.get("nodeId") or "").strip()
        }
        candidates = excluded_nodes if isinstance(excluded_nodes, list) else [excluded_nodes]
        for excluded_node in candidates:
            node_id = str(excluded_node.get("nodeId") or "").strip()
            if node_id:
                nodes_by_id[node_id] = excluded_node
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
            "tradeFacts": {
                **{
                    str(key): dict(value)
                    for key, value in (base_graph.get("tradeFacts") or {}).items()
                    if str(key) and isinstance(value, dict)
                },
                **{
                    str(key): dict(value)
                    for key, value in (incoming_graph.get("tradeFacts") or {}).items()
                    if str(key) and isinstance(value, dict)
                },
            },
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
        layout = dict(graph.get("layout") or {})
        layout["nodePositions"] = {
            **dict(layout.get("nodePositions") or {}),
            **{node_id: {"x": x, "y": y} for node_id, (x, y) in positions.items()},
        }
        return {**graph, "nodes": nodes, "layout": layout}

    @staticmethod
    def _finite_number(value: Any) -> float | None:
        if isinstance(value, bool):
            return None
        if isinstance(value, (int, float)):
            return float(value)
        try:
            return float(value)
        except (TypeError, ValueError):
            return None

    @staticmethod
    def _text_list(value: Any) -> list[str]:
        if isinstance(value, (str, int, float)):
            text = str(value or "").strip()
            return [text] if text else []
        if not isinstance(value, list):
            return []
        return [
            item
            for item in (str(raw or "").strip() for raw in value)
            if item
        ]

    @classmethod
    def _normalize_trade_facts(cls, value: Any) -> dict[str, dict[str, Any]]:
        raw_items: list[Any]
        if isinstance(value, dict):
            raw_items = list(value.values())
        elif isinstance(value, list):
            raw_items = value
        else:
            raw_items = []
        facts: dict[str, dict[str, Any]] = {}
        for raw_item in raw_items:
            if not isinstance(raw_item, dict):
                continue
            fact = dict(raw_item)
            trade_id = str(fact.get("tradeId") or "").strip()
            serial_number = str(fact.get("serialNumber") or "").strip()
            key = trade_id or serial_number
            if not key:
                continue
            fact["tradeId"] = trade_id or key
            fact["serialNumber"] = serial_number
            facts[key] = fact
        return facts

    @classmethod
    def _normalize_edge_trade_ids(cls, value: Any) -> dict[str, list[str]]:
        if not isinstance(value, dict):
            return {}
        normalized: dict[str, list[str]] = {}
        for raw_edge_id, raw_trade_ids in value.items():
            edge_id = str(raw_edge_id or "").strip()
            trade_ids = cls._text_list(raw_trade_ids)
            if edge_id and trade_ids:
                normalized[edge_id] = trade_ids
        return normalized

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

    @classmethod
    def _filter_graph_from_trade_facts(
        cls,
        graph: dict[str, Any],
        filters: dict[str, Any],
    ) -> dict[str, Any]:
        trade_facts = {
            str(key): dict(value)
            for key, value in (graph.get("tradeFacts") or {}).items()
            if str(key) and isinstance(value, dict)
        }
        filter_bounds = cls._normalize_trade_filter_bounds(filters)
        has_active_filter = any(value is not None and value != "" for value in filter_bounds.values())
        excluded_trade_ids = set(cls._text_list(graph.get("excludedTrades")))
        nodes_by_id = {
            str(node.get("id") or "").strip(): dict(node)
            for node in graph.get("nodes") or []
            if isinstance(node, dict) and str(node.get("id") or "").strip()
        }
        retained_node_ids: set[str] = set()
        filtered_edges: list[dict[str, Any]] = []

        for raw_edge in graph.get("edges") or []:
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

            trade_ids = [
                trade_id for trade_id in cls._text_list(edge.get("tradeIds"))
                if trade_id not in excluded_trade_ids
            ]
            if not trade_ids:
                if has_active_filter:
                    raise ValueError("当前图缺少交易流水明细，无法执行全图筛选，请重新分析上图后再筛选")
                retained_node_ids.update((source, target))
                filtered_edges.append(edge)
                continue

            missing_trade_ids = [trade_id for trade_id in trade_ids if trade_id not in trade_facts]
            if missing_trade_ids:
                raise ValueError("当前图的交易流水事实不完整，无法执行全图筛选，请重新分析上图后再筛选")

            matching_trade_ids = [
                trade_id for trade_id in trade_ids
                if cls._trade_fact_matches_filters(trade_facts[trade_id], filter_bounds)
            ]
            if not matching_trade_ids:
                continue

            filtered_facts = [trade_facts[trade_id] for trade_id in matching_trade_ids]
            next_edge = cls._recompute_edge_from_trade_facts(edge, filtered_facts)
            next_edge["tradeIds"] = matching_trade_ids
            retained_node_ids.update((source, target))
            filtered_edges.append(next_edge)

        return {
            **graph,
            "nodes": [node for node_id, node in nodes_by_id.items() if node_id in retained_node_ids],
            "edges": filtered_edges,
            "tradeFacts": trade_facts,
            "filters": {
                "minAmount": filters.get("minAmount"),
                "maxAmount": filters.get("maxAmount"),
                "startTime": str(filters.get("startTime") or "").strip(),
                "endTime": str(filters.get("endTime") or "").strip(),
            },
        }

    @classmethod
    def _normalize_trade_filter_bounds(cls, filters: dict[str, Any]) -> dict[str, Any]:
        return {
            "minAmount": cls._finite_number(filters.get("minAmount")),
            "maxAmount": cls._finite_number(filters.get("maxAmount")),
            "startTime": str(filters.get("startTime") or "").strip(),
            "endTime": str(filters.get("endTime") or "").strip(),
        }

    @classmethod
    def _trade_fact_matches_filters(cls, fact: dict[str, Any], filters: dict[str, Any]) -> bool:
        amount = cls._finite_number(fact.get("tradeAmount"))
        if filters["minAmount"] is not None and (amount is None or amount < filters["minAmount"]):
            return False
        if filters["maxAmount"] is not None and (amount is None or amount > filters["maxAmount"]):
            return False
        trade_time = str(fact.get("tradeTime") or "").strip()
        if filters["startTime"] and (not trade_time or trade_time < filters["startTime"]):
            return False
        if filters["endTime"] and (not trade_time or trade_time > filters["endTime"]):
            return False
        return True

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
    def _apply_trade_exclusions(
        cls,
        graph: dict[str, Any],
        *,
        excluded_trade_ids: list[str],
        incoming_facts: dict[str, dict[str, Any]],
        edge_trade_ids: dict[str, list[str]],
    ) -> dict[str, Any]:
        excluded_set = set(excluded_trade_ids)
        trade_facts = {
            key: dict(value)
            for key, value in (graph.get("tradeFacts") or {}).items()
            if isinstance(value, dict) and str(key or "").strip()
        }
        trade_facts.update(incoming_facts)
        nodes_by_id = {
            str(node.get("id") or "").strip(): dict(node)
            for node in graph.get("nodes") or []
            if isinstance(node, dict) and str(node.get("id") or "").strip()
        }
        retained_node_ids: set[str] = set()
        next_edges: list[dict[str, Any]] = []
        for raw_edge in graph.get("edges") or []:
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
            trade_ids = edge_trade_ids.get(edge_id) or cls._text_list(edge.get("tradeIds"))
            if trade_ids:
                edge["tradeIds"] = trade_ids
                visible_trade_ids = [trade_id for trade_id in trade_ids if trade_id not in excluded_set]
                if not visible_trade_ids:
                    continue
                has_excluded_trade = len(visible_trade_ids) != len(trade_ids)
                known_facts = [
                    trade_facts[trade_id]
                    for trade_id in visible_trade_ids
                    if trade_id in trade_facts
                ]
                if known_facts and len(known_facts) == len(visible_trade_ids):
                    edge = cls._recompute_edge_from_trade_facts(edge, known_facts)
                elif has_excluded_trade:
                    missing = [trade_id for trade_id in visible_trade_ids if trade_id not in trade_facts]
                    if missing:
                        raise ValueError("tradeFacts")
            retained_node_ids.update((source, target))
            next_edges.append(edge)

        next_nodes = [node for node_id, node in nodes_by_id.items() if node_id in retained_node_ids]
        return {
            **graph,
            "nodes": next_nodes,
            "edges": next_edges,
            "excludedTrades": excluded_trade_ids,
            "tradeFacts": trade_facts,
        }

    @classmethod
    def _recompute_edge_from_trade_facts(
        cls,
        edge: dict[str, Any],
        facts: list[dict[str, Any]],
    ) -> dict[str, Any]:
        amount = sum(cls._finite_number(fact.get("tradeAmount")) or 0.0 for fact in facts)
        times = [
            str(fact.get("tradeTime") or "").strip()
            for fact in facts
            if str(fact.get("tradeTime") or "").strip()
        ]
        next_edge = dict(edge)
        next_edge["tradeAmount"] = amount
        next_edge["amount"] = amount
        next_edge["tradeCount"] = len(facts)
        next_edge["count"] = len(facts)
        if times:
            next_edge["startTime"] = min(times)
            next_edge["endTime"] = max(times)
            next_edge["startDate"] = min(times)
            next_edge["endDate"] = max(times)
        return next_edge

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
