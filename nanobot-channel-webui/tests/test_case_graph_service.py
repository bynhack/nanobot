from __future__ import annotations

from datetime import datetime
import importlib
import importlib.util
import sys
import types
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import pytest
from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from nanobot.bus.queue import MessageBus


SRC_ROOT = (
    Path(__file__).resolve().parents[1]
    / "src"
    / "nanobot_channel_webui"
    / "case_graph"
)
TYPES_PATH = SRC_ROOT / "types.py"
STORAGE_PATH = SRC_ROOT / "storage.py"
MYSQL_CLIENT_PATH = SRC_ROOT / "mysql_client.py"
SERVICE_PATH = SRC_ROOT / "service.py"
PACKAGE_SRC_ROOT = SRC_ROOT.parent.parent


def _load_service_module() -> types.ModuleType:
    package_name = "nanobot_channel_webui"
    case_graph_package_name = f"{package_name}.case_graph"

    package = types.ModuleType(package_name)
    package.__path__ = [str(SRC_ROOT.parent)]
    sys.modules[package_name] = package

    case_graph_package = types.ModuleType(case_graph_package_name)
    case_graph_package.__path__ = [str(SRC_ROOT)]
    sys.modules[case_graph_package_name] = case_graph_package

    paths_module = types.ModuleType("nanobot.config.paths")
    paths_module.get_workspace_path = lambda: Path("/tmp/nanobot-workspace")
    sys.modules["nanobot.config.paths"] = paths_module

    for module_name, module_path in (
        ("types", TYPES_PATH),
        ("storage", STORAGE_PATH),
        ("mysql_client", MYSQL_CLIENT_PATH),
        ("service", SERVICE_PATH),
    ):
        spec = importlib.util.spec_from_file_location(
            f"{case_graph_package_name}.{module_name}",
            module_path,
        )
        assert spec is not None
        assert spec.loader is not None
        module = importlib.util.module_from_spec(spec)
        sys.modules[f"{case_graph_package_name}.{module_name}"] = module
        spec.loader.exec_module(module)

    return sys.modules[f"{case_graph_package_name}.service"]


def _load_channel_module() -> types.ModuleType:
    paths_module = sys.modules.get("nanobot.config.paths")
    if paths_module is not None and not hasattr(paths_module, "get_data_dir"):
        del sys.modules["nanobot.config.paths"]
    if str(PACKAGE_SRC_ROOT) not in sys.path:
        sys.path.insert(0, str(PACKAGE_SRC_ROOT))
    return importlib.import_module("nanobot_channel_webui.channel")


class FakeCaseGraphStorage:
    def __init__(self) -> None:
        self.graphs: dict[str, dict[str, Any]] = {}
        self.error: Exception | None = None

    def get_graph(self, graph_id: str) -> dict[str, Any] | None:
        if self.error is not None:
            raise self.error
        return self.graphs.get(graph_id)

    def write_current_context(self, graph_id: str, focus: dict[str, Any] | None = None) -> dict[str, Any]:
        if graph_id not in self.graphs:
            raise KeyError(graph_id)
        graph = self.graphs[graph_id]
        return {
            "graphId": graph_id,
            "caseId": graph.get("caseId", ""),
            "graphName": graph.get("graphName", ""),
            "chatId": graph.get("chatId", ""),
            "focus": focus,
        }

    def delete_graph(self, graph_id: str) -> bool:
        return self.graphs.pop(graph_id, None) is not None

    def write_current_context_from_metadata(
        self,
        *,
        graph_id: str,
        case_id: str,
        graph_name: str,
        chat_id: str = "",
        focus: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        return {
            "graphId": graph_id,
            "caseId": case_id,
            "graphName": graph_name,
            "chatId": chat_id,
            "focus": focus,
        }


class FakeCaseGraphService:
    def __init__(self) -> None:
        self.case_list_calls = 0
        self.account_list_calls: list[dict[str, Any]] = []
        self.graph_list_calls: list[str | None] = []
        self.create_calls: list[dict[str, Any]] = []
        self.update_calls: list[dict[str, Any]] = []
        self.delete_calls: list[str] = []
        self.query_calls: list[dict[str, Any]] = []
        self.relation_query_calls: list[dict[str, Any]] = []
        self.relation_complete_calls: list[dict[str, Any]] = []
        self.relation_filter_calls: list[dict[str, Any]] = []
        self.relation_summary_candidate_calls: list[dict[str, Any]] = []
        self.relation_summary_selection_calls: list[dict[str, Any]] = []
        self.relation_exclude_calls: list[dict[str, Any]] = []
        self.relation_restore_calls: list[dict[str, Any]] = []
        self.state_load_calls: list[dict[str, str]] = []
        self.state_layout_calls: list[dict[str, Any]] = []
        self.state_note_calls: list[dict[str, Any]] = []
        self.drilldown_calls: list[dict[str, Any]] = []
        self.drillup_calls: list[dict[str, Any]] = []
        self.drill_calls: list[dict[str, Any]] = []
        self.target_detail_calls: list[dict[str, Any]] = []
        self.case_list_result: list[dict[str, Any]] = [{"id": "37", "caseName": "4", "caseCode": "4", "isCurrent": True}]
        self.account_list_result: list[dict[str, Any]] = [
            {"accountId": "1", "tradeCard": "6222", "accountName": "张三", "isObtain": 1}
        ]
        self.graph_list_result: list[dict[str, Any]] = [
            {"graphId": "graph-1", "caseId": "37", "graphName": "主图", "tradeCardCount": 2, "updatedAt": 123}
        ]
        self.create_result: dict[str, Any] = {
            "graph_id": "graph-created",
            "caseId": "case-1",
            "graphName": "主图",
            "graphContent": "",
            "tradeCards": [],
            "groupMap": {},
            "graphData": None,
            "excludedTrades": [],
            "excludedAccountId": "",
            "excludedAccountName": [],
            "summarySelectedAccountId": [],
            "summarySelectedAccountName": [],
            "sourceSelectId": [],
            "drillNums": 0,
            "drillType": None,
            "minAmount": None,
            "maxAmount": None,
        }
        self.query_result: dict[str, Any] = {
            "nodes": [{"id": "n1", "label": "节点1"}],
            "money": [],
            "phone": [],
            "excludedTrades": [],
            "groups": {},
            "sourceSelectId": ["节点1"],
        }
        self.relation_query_result: dict[str, Any] = {
            "schemaVersion": "case-graph.relation.v1",
            "caseId": "case-1",
            "graphId": "graph-1",
            "queryMode": "seed_one_hop",
            "graph": {"nodes": [{"id": "subject:suspect:1"}], "edges": []},
            "delta": {"addedNodes": [{"id": "subject:suspect:1"}], "addedEdges": []},
            "step": {"stepId": "0001", "type": "seed_one_hop"},
        }
        self.relation_complete_result: dict[str, Any] = {
            "schemaVersion": "case-graph.relation.v1",
            "caseId": "case-1",
            "graphId": "graph-1",
            "queryMode": "complete_current_graph",
            "graph": {"nodes": [], "edges": [{"id": "money:1->2"}]},
            "delta": {"addedNodes": [], "addedEdges": [{"id": "money:1->2"}]},
            "step": {"stepId": "0002", "type": "complete_current_graph"},
        }
        self.relation_filter_result: dict[str, Any] = {
            "schemaVersion": "case-graph.relation.v1",
            "caseId": "case-1",
            "graphId": "graph-1",
            "queryMode": "filter_current_graph",
            "graph": {"nodes": [], "edges": [{"id": "money:filtered"}]},
            "delta": {"addedNodes": [], "addedEdges": [{"id": "money:filtered"}]},
            "step": {"stepId": "0003", "type": "filter_current_graph"},
        }
        self.relation_summary_candidate_result: dict[str, Any] = {
            "caseId": "case-1",
            "graphId": "graph-1",
            "focusNodeId": "subject:suspect:1",
            "items": [{"nodeId": "account:39", "label": "蔡金海", "status": "candidate"}],
        }
        self.relation_summary_selection_result: dict[str, Any] = {
            "schemaVersion": "case-graph.relation.v1",
            "caseId": "case-1",
            "graphId": "graph-1",
            "queryMode": "summary_analysis",
            "graph": {
                "nodes": [
                    {"id": "account:1", "isExcluded": False},
                    {"id": "account:35", "isExcluded": True},
                ],
                "edges": [],
                "excludedNodes": [{"nodeId": "account:35"}],
            },
            "delta": {"addedNodes": [], "addedEdges": [], "updatedNodes": [{"nodeId": "account:35"}]},
            "step": {"stepId": "0004", "type": "summary_analysis"},
        }
        self.relation_exclude_result: dict[str, Any] = {
            "schemaVersion": "case-graph.relation.v1",
            "caseId": "case-1",
            "graphId": "graph-1",
            "queryMode": "manual_exclude_node",
            "graph": {"nodes": [{"id": "account:35", "isExcluded": True}], "edges": [], "excludedNodes": [{"nodeId": "account:35"}]},
            "delta": {"addedNodes": [], "addedEdges": [], "updatedNodes": [{"nodeId": "account:35"}]},
            "step": {"stepId": "0004", "type": "manual_exclude_node"},
        }
        self.relation_restore_result: dict[str, Any] = {
            "schemaVersion": "case-graph.relation.v1",
            "caseId": "case-1",
            "graphId": "graph-1",
            "queryMode": "manual_restore_node",
            "graph": {"nodes": [{"id": "account:35", "isExcluded": False}], "edges": [], "excludedNodes": []},
            "delta": {"addedNodes": [], "addedEdges": [], "updatedNodes": [{"nodeId": "account:35"}]},
            "step": {"stepId": "0005", "type": "manual_restore_node"},
        }
        self.graph_state_result: dict[str, Any] = {
            "schemaVersion": "case-graph.state.v1",
            "caseId": "case-1",
            "graphId": "graph-1",
            "graphName": "图1",
            "revision": 1,
            "updatedAt": "",
            "lastStepId": "0001",
            "graph": {
                "nodes": [{"id": "a"}],
                "edges": [],
                "tradeCards": [],
                "groupMap": {},
                "sourceSelectId": [],
                "summarySelectedAccountId": [],
                "summarySelectedAccountName": [],
                "excludedTrades": [],
                "excludedAccountId": [],
                "excludedAccountName": [],
                "layout": {"nodePositions": {"a": {"x": 100, "y": 200}}, "viewport": {"x": 0, "y": 0, "zoom": 1}},
                "filters": {"minAmount": None, "maxAmount": None, "startTime": "", "endTime": ""},
                "excludedNodes": [],
                "manualEdges": [],
                "annotations": [],
                "graphData": None,
            },
        }
        self.drilldown_result: dict[str, Any] = {"tradeCards": [{"tradeId": "trade-2", "amount": 200}]}
        self.target_detail_result: list[dict[str, Any]] = [{"tradeId": "trade-9"}]
        self.delete_result = True
        self.case_list_error: Exception | None = None
        self.account_list_error: Exception | None = None
        self.create_error: Exception | None = None
        self.query_error: Exception | None = None
        self.drilldown_error: Exception | None = None
        self.target_detail_error: Exception | None = None

    def list_cases(self) -> list[dict[str, Any]]:
        if self.case_list_error is not None:
            raise self.case_list_error
        self.case_list_calls += 1
        return self.case_list_result

    def list_accounts(self, case_id: str, keyword: str = "") -> list[dict[str, Any]]:
        if self.account_list_error is not None:
            raise self.account_list_error
        self.account_list_calls.append({"case_id": case_id, "keyword": keyword})
        return self.account_list_result

    def list_graphs(self, case_id: str | None = None) -> list[dict[str, Any]]:
        self.graph_list_calls.append(case_id)
        return self.graph_list_result

    def create_graph(self, case_id: str, graph_name: str, trade_cards: list[dict[str, Any]]) -> dict[str, Any]:
        if self.create_error is not None:
            raise self.create_error
        self.create_calls.append({
            "case_id": case_id,
            "graph_name": graph_name,
            "trade_cards": trade_cards,
        })
        return self.create_result

    def query_graph(
        self,
        graph_id: str,
        case_id: str,
        trade_cards: list[dict[str, Any]],
        **filters: Any,
    ) -> dict[str, Any]:
        if self.query_error is not None:
            raise self.query_error
        self.query_calls.append({
            "graph_id": graph_id,
            "case_id": case_id,
            "trade_cards": trade_cards,
            "filters": filters,
        })
        return self.query_result

    def query_seed_one_hop(self, payload: dict[str, Any]) -> dict[str, Any]:
        if self.query_error is not None:
            raise self.query_error
        self.relation_query_calls.append(payload)
        return self.relation_query_result

    def complete_current_graph(self, payload: dict[str, Any]) -> dict[str, Any]:
        if self.query_error is not None:
            raise self.query_error
        self.relation_complete_calls.append(payload)
        return self.relation_complete_result

    def filter_current_graph(self, payload: dict[str, Any]) -> dict[str, Any]:
        if self.query_error is not None:
            raise self.query_error
        self.relation_filter_calls.append(payload)
        return self.relation_filter_result

    def query_summary_candidates(self, payload: dict[str, Any]) -> dict[str, Any]:
        if self.query_error is not None:
            raise self.query_error
        self.relation_summary_candidate_calls.append(payload)
        return self.relation_summary_candidate_result

    def apply_summary_selection(self, payload: dict[str, Any]) -> dict[str, Any]:
        if self.query_error is not None:
            raise self.query_error
        self.relation_summary_selection_calls.append(payload)
        return self.relation_summary_selection_result

    def exclude_node(self, payload: dict[str, Any]) -> dict[str, Any]:
        if self.query_error is not None:
            raise self.query_error
        self.relation_exclude_calls.append(payload)
        return self.relation_exclude_result

    def restore_node(self, payload: dict[str, Any]) -> dict[str, Any]:
        if self.query_error is not None:
            raise self.query_error
        self.relation_restore_calls.append(payload)
        return self.relation_restore_result

    def load_current(self, case_id: str, graph_id: str) -> dict[str, Any]:
        self.state_load_calls.append({"case_id": case_id, "graph_id": graph_id})
        return self.graph_state_result

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
        self.state_layout_calls.append(
            {
                "case_id": case_id,
                "graph_id": graph_id,
                "graph_name": graph_name,
                "node_positions": node_positions,
                "position_meta": position_meta or {},
                "group_layout": group_layout or {},
                "viewport": viewport or {},
            }
        )
        return self.graph_state_result

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
        self.state_note_calls.append(
            {
                "case_id": case_id,
                "graph_id": graph_id,
                "graph_name": graph_name,
                "node_id": node_id,
                "note": note,
                "source_note": source_note,
            }
        )
        return self.graph_state_result

    def list_steps(self, case_id: str, graph_id: str) -> list[dict[str, Any]]:
        return [{"stepId": "0001", "operation": {"type": "seed_one_hop"}}]

    def update_graph(self, graph_id: str, patch: dict[str, Any]) -> dict[str, Any]:
        self.update_calls.append({
            "graph_id": graph_id,
            "patch": patch,
        })
        updated = dict(self.create_result)
        updated["graph_id"] = graph_id
        updated.update(patch)
        return updated

    def delete_graph(self, graph_id: str) -> bool:
        self.delete_calls.append(graph_id)
        return self.delete_result

    def drill_down(self, *, graph_id: str, case_id: str, **filters: Any) -> dict[str, Any]:
        if self.drilldown_error is not None:
            raise self.drilldown_error
        self.drilldown_calls.append({
            "graph_id": graph_id,
            "case_id": case_id,
            "filters": filters,
        })
        return self.drilldown_result

    def drill_up(self, *, graph_id: str, case_id: str, **filters: Any) -> dict[str, Any]:
        if self.drilldown_error is not None:
            raise self.drilldown_error
        self.drillup_calls.append({
            "graph_id": graph_id,
            "case_id": case_id,
            "filters": filters,
        })
        return self.drilldown_result

    def drill(self, *, graph_id: str, case_id: str, **filters: Any) -> dict[str, Any]:
        if self.drilldown_error is not None:
            raise self.drilldown_error
        self.drill_calls.append({
            "graph_id": graph_id,
            "case_id": case_id,
            "filters": filters,
        })
        return self.drilldown_result

    def target_detail(
        self,
        *,
        graph_id: str,
        case_id: str,
        payer_cards: list[dict[str, Any]],
        payee_cards: list[dict[str, Any]],
        **filters: Any,
    ) -> list[dict[str, Any]]:
        if self.target_detail_error is not None:
            raise self.target_detail_error
        self.target_detail_calls.append({
            "graph_id": graph_id,
            "case_id": case_id,
            "payer_cards": payer_cards,
            "payee_cards": payee_cards,
            "filters": filters,
        })
        return self.target_detail_result


@asynccontextmanager
async def _case_graph_client(
    *,
    service: FakeCaseGraphService | None = None,
    storage: FakeCaseGraphStorage | None = None,
):
    channel_module = _load_channel_module()
    channel = channel_module.WebUIChannel({"enabled": True}, MessageBus())
    channel._authorize_request = types.MethodType(  # type: ignore[method-assign]
        _allow_request,
        channel,
    )
    channel._case_graph_service = service or FakeCaseGraphService()
    channel._case_graph_relation_service = service or FakeCaseGraphService()
    channel._case_graph_state_service = service or FakeCaseGraphService()
    channel._case_graph_storage = storage or FakeCaseGraphStorage()
    app = channel._create_app(web)

    server = TestServer(app)
    client = TestClient(server)
    await client.start_server()
    try:
        yield client, channel
    finally:
        await client.close()


async def _allow_request(self: Any, request: Any) -> tuple[bool, Any | None, Any | None]:
    return True, None, None


class FakeQueryClient:
    def __init__(self) -> None:
        self.list_cases_calls = 0
        self.list_accounts_calls: list[dict[str, Any]] = []
        self.query_graph_calls: list[dict[str, Any]] = []
        self.drill_down_calls: list[dict[str, Any]] = []
        self.drill_up_calls: list[dict[str, Any]] = []
        self.drill_calls: list[dict[str, Any]] = []
        self.target_detail_calls: list[dict[str, Any]] = []
        self.list_cases_result: list[dict[str, Any]] = [{"id": "37", "caseName": "4", "caseCode": "4", "isCurrent": True}]
        self.list_accounts_result: list[dict[str, Any]] = [
            {"accountId": "1", "tradeCard": "6222", "accountName": "张三", "isObtain": 1}
        ]
        self.query_graph_result: dict[str, Any] = {
            "nodes": [{"id": "account-1", "label": "张三"}],
            "money": [{"id": "trade-2", "from": "account-1", "to": "account-2", "amount": 200, "count": 1}],
            "phone": [],
            "excludedTrades": [],
            "groups": {},
            "sourceSelectId": ["张三"],
        }
        self.drill_down_result: list[dict[str, Any]] = [
            {"tradeId": "trade-2", "amount": 200},
            {"tradeId": "trade-3", "amount": 300},
        ]
        self.target_detail_result: list[dict[str, Any]] = [
            {"tradeId": "trade-9", "payerAccountName": "付款人"}
        ]

    def list_cases(self) -> list[dict[str, Any]]:
        self.list_cases_calls += 1
        return self.list_cases_result

    def list_accounts(self, case_id: str, keyword: str = "") -> list[dict[str, Any]]:
        self.list_accounts_calls.append({"case_id": case_id, "keyword": keyword})
        return self.list_accounts_result

    def query_graph(self, payload: dict[str, Any]) -> dict[str, Any]:
        self.query_graph_calls.append(payload)
        result = dict(self.query_graph_result)
        if ("excludedTrades" not in result or result.get("excludedTrades") == []) and payload.get("excludedTrades"):
            result["excludedTrades"] = list(payload.get("excludedTrades") or [])
        return result

    def drill_down(self, payload: dict[str, Any]) -> list[dict[str, Any]]:
        self.drill_down_calls.append(payload)
        return self.drill_down_result

    def drill_up(self, payload: dict[str, Any]) -> list[dict[str, Any]]:
        self.drill_up_calls.append(payload)
        return self.drill_down_result

    def drill(self, payload: dict[str, Any]) -> list[dict[str, Any]]:
        self.drill_calls.append(payload)
        return self.drill_down_result

    def target_detail(self, payload: dict[str, Any]) -> list[dict[str, Any]]:
        self.target_detail_calls.append(payload)
        return self.target_detail_result


def test_query_graph_returns_original_trade_vo_shape_and_persists_request_trade_cards(tmp_path: Path) -> None:
    module = _load_service_module()
    query_client = FakeQueryClient()
    storage = module.CaseGraphStorage(workspace=tmp_path)
    service = module.CaseGraphService(storage=storage, query_client=query_client)

    created = service.create_graph(
        case_id="case-1",
        graph_name="主图",
        trade_cards=[{"tradeId": "trade-1", "amount": 100}],
    )
    storage.update_graph(
        created["graph_id"],
        {
            "excludedTrades": ["trade-x"],
            "excludedAccountId": ["account-z"],
        },
    )

    result = service.query_graph(
        created["graph_id"],
        "case-1",
        [{"tradeId": "trade-1", "amount": 100}],
        direction="out",
    )

    saved = storage.get_graph(created["graph_id"])

    assert set(result.keys()) == {"nodes", "money", "phone", "excludedTrades", "groups", "sourceSelectId"}
    assert result["nodes"][0]["id"] == "account-1"
    assert query_client.query_graph_calls == [
        {
            "graphId": created["graph_id"],
            "caseId": "case-1",
            "tradeCards": [{"tradeId": "trade-1", "amount": 100}],
            "excludedTrades": ["trade-x"],
            "excludedAccountId": ["account-z"],
            "direction": "out",
        }
    ]
    assert saved is not None
    assert saved["tradeCards"] == [{"tradeId": "trade-1", "amount": 100}]
    assert saved["graphData"]["nodes"][0]["id"] == "account-1"
    assert saved["excludedTrades"] == ["trade-x"]
    assert saved["excludedAccountId"] == ["account-z"]


def test_query_graph_persists_original_runtime_fields_from_result(tmp_path: Path) -> None:
    module = _load_service_module()
    query_client = FakeQueryClient()
    query_client.query_graph_result = {
        "nodes": [{"id": "100", "label": "张三"}],
        "money": [{"from": "100", "to": "200", "amount": 88, "count": 1}],
        "phone": [],
        "excludedTrades": ["serial-1"],
        "groups": {"100": {"groupId": "group-1", "groupName": "团伙一", "tradeCard": []}},
        "sourceSelectId": ["张三"],
    }
    storage = module.CaseGraphStorage(workspace=tmp_path)
    service = module.CaseGraphService(storage=storage, query_client=query_client)

    created = service.create_graph(
        case_id="case-1",
        graph_name="主图",
        trade_cards=[{"tradeId": "trade-1", "amount": 100}],
    )

    result = service.query_graph(created["graph_id"], "case-1", [{"tradeId": "trade-1", "amount": 100}])
    saved = storage.get_graph(created["graph_id"])

    assert result["nodes"][0]["id"] == "100"
    assert saved is not None
    assert saved["graphData"]["sourceSelectId"] == ["张三"]
    assert saved["groupMap"]["100"]["groupId"] == "group-1"
    assert saved["sourceSelectId"] == ["张三"]
    assert saved["tradeCards"] == [{"tradeId": "trade-1", "amount": 100}]


def test_query_graph_reuses_stored_source_select_id_when_selected_cards_unchanged(tmp_path: Path) -> None:
    module = _load_service_module()
    query_client = FakeQueryClient()
    query_client.query_graph_result = {
        "nodes": [{"id": "100", "label": "查询结果主体"}],
        "money": [],
        "phone": [],
        "excludedTrades": [],
        "groups": {},
        "sourceSelectId": ["旧主体A", "旧主体B"],
    }
    storage = module.CaseGraphStorage(workspace=tmp_path)
    service = module.CaseGraphService(storage=storage, query_client=query_client)

    created = service.create_graph(
        case_id="case-1",
        graph_name="主图",
        trade_cards=[{"tradeId": "trade-1", "amount": 100}],
    )
    storage.update_graph(
        created["graph_id"],
        {
            "sourceSelectId": ["旧主体A", "旧主体B"],
        },
    )

    result = service.query_graph(
        created["graph_id"],
        "case-1",
        [{"tradeId": "trade-1", "amount": 100}],
        isSelectedTradeCardChanged=False,
        sourceSelectId=["请求里的新主体"],
    )

    assert query_client.query_graph_calls == [
        {
            "graphId": created["graph_id"],
            "caseId": "case-1",
            "tradeCards": [{"tradeId": "trade-1", "amount": 100}],
            "excludedTrades": [],
            "excludedAccountId": "",
            "isSelectedTradeCardChanged": False,
            "sourceSelectId": ["旧主体A", "旧主体B"],
        }
    ]
    assert result["sourceSelectId"] == ["旧主体A", "旧主体B"]


def test_query_client_group_map_collapses_member_nodes_into_group_node() -> None:
    _load_service_module()
    mysql_module = sys.modules["nanobot_channel_webui.case_graph.mysql_client"]
    client_cls = mysql_module.PyMySQLCaseGraphQueryClient

    nodes, money, groups = client_cls._apply_groups(
        nodes=[
            {"id": "100", "label": "张三", "accountId": "100", "tradeCard": "6222", "accountName": "张三"},
            {"id": "200", "label": "李四", "accountId": "200", "tradeCard": "6333", "accountName": "李四"},
            {"id": "300", "label": "王五", "accountId": "300", "tradeCard": "6444", "accountName": "王五"},
        ],
        money=[
            {"from": "100", "to": "300", "amount": 10, "count": 1},
            {"from": "200", "to": "300", "amount": 15, "count": 2},
            {"from": "100", "to": "200", "amount": 99, "count": 9},
        ],
        groups={
            "100": {
                "groupId": "group-1",
                "groupName": "团伙一",
                "tradeCard": [
                    {"accountId": "100", "tradeCard": "6222", "accountName": "张三"},
                    {"accountId": "200", "tradeCard": "6333", "accountName": "李四"},
                ],
            }
        },
    )

    node_ids = {item["id"] for item in nodes}
    assert "group-1" in node_ids
    assert "100" not in node_ids
    assert "200" not in node_ids
    assert "300" in node_ids
    assert groups["group-1"]["groupName"] == "团伙一"
    assert money == [
        {
            "id": "group-1->300",
            "from": "group-1",
            "to": "300",
            "amount": 25.0,
            "count": 3,
            "tradeAmount": 25.0,
            "tradeCount": 3,
            "startDate": None,
            "endDate": None,
        }
    ]


def test_drill_down_appends_unique_trade_cards(tmp_path: Path) -> None:
    module = _load_service_module()
    query_client = FakeQueryClient()
    storage = module.CaseGraphStorage(workspace=tmp_path)
    service = module.CaseGraphService(storage=storage, query_client=query_client)

    created = service.create_graph(
        case_id="case-1",
        graph_name="主图",
        trade_cards=[
            {"tradeId": "trade-1", "amount": 100},
            {"tradeId": "trade-2", "amount": 200},
        ],
    )

    result = service.drill_down(
        graph_id=created["graph_id"],
        case_id="case-1",
        payer="payer-1",
        payee="payee-1",
        drill_type="out",
    )

    saved = storage.get_graph(created["graph_id"])

    assert query_client.drill_down_calls == [
        {
            "graphId": created["graph_id"],
            "caseId": "case-1",
            "tradeCards": [
                {"tradeId": "trade-1", "amount": 100},
                {"tradeId": "trade-2", "amount": 200},
            ],
            "excludedTrades": [],
            "excludedAccountId": "",
            "payer": "payer-1",
            "payee": "payee-1",
            "drill_type": "out",
        }
    ]
    assert result["tradeCards"] == [
        {"tradeId": "trade-1", "amount": 100},
        {"tradeId": "trade-2", "amount": 200},
        {"tradeId": "trade-3", "amount": 300},
    ]
    assert saved is not None
    assert saved["tradeCards"] == result["tradeCards"]


def test_drill_down_passes_existing_exclusions_to_query_client(tmp_path: Path) -> None:
    module = _load_service_module()
    query_client = FakeQueryClient()
    storage = module.CaseGraphStorage(workspace=tmp_path)
    service = module.CaseGraphService(storage=storage, query_client=query_client)

    created = service.create_graph(
        case_id="case-1",
        graph_name="主图",
        trade_cards=[{"tradeId": "trade-1", "amount": 100}],
    )
    storage.update_graph(
        created["graph_id"],
        {
            "excludedTrades": ["trade-x"],
            "excludedAccountId": None,
        },
    )

    service.drill_down(
        graph_id=created["graph_id"],
        case_id="case-1",
        payer="payer-1",
        payee="payee-1",
    )

    assert query_client.drill_down_calls == [
        {
            "graphId": created["graph_id"],
            "caseId": "case-1",
            "tradeCards": [{"tradeId": "trade-1", "amount": 100}],
            "excludedTrades": ["trade-x"],
            "excludedAccountId": None,
            "payer": "payer-1",
            "payee": "payee-1",
        }
    ]


def test_drill_down_derives_payer_from_trade_card_payload(tmp_path: Path) -> None:
    module = _load_service_module()
    query_client = FakeQueryClient()
    storage = module.CaseGraphStorage(workspace=tmp_path)
    service = module.CaseGraphService(storage=storage, query_client=query_client)

    created = service.create_graph(
        case_id="case-1",
        graph_name="主图",
        trade_cards=[{"tradeId": "trade-1", "amount": 100}],
    )

    service.drill_down(
        graph_id=created["graph_id"],
        case_id="case-1",
        tradeCard=[{"accountId": "100", "tradeCard": "6222", "accountName": "张三"}],
        drill_type="out",
    )

    assert query_client.drill_down_calls == [
        {
            "graphId": created["graph_id"],
            "caseId": "case-1",
            "tradeCards": [{"tradeId": "trade-1", "amount": 100}],
            "excludedTrades": [],
            "excludedAccountId": "",
            "tradeCard": [{"accountId": "100", "tradeCard": "6222", "accountName": "张三"}],
            "drill_type": "out",
            "payer": "100",
        }
    ]


def test_query_graph_allows_upstream_to_explicitly_clear_excluded_account_id(tmp_path: Path) -> None:
    module = _load_service_module()
    query_client = FakeQueryClient()
    query_client.query_graph_result = {
        "nodes": [],
        "money": [],
        "phone": [],
        "excludedTrades": [],
        "groups": {},
        "sourceSelectId": [],
    }
    storage = module.CaseGraphStorage(workspace=tmp_path)
    service = module.CaseGraphService(storage=storage, query_client=query_client)

    created = service.create_graph(
        case_id="case-1",
        graph_name="主图",
        trade_cards=[{"tradeId": "trade-1", "amount": 100}],
    )
    storage.update_graph(created["graph_id"], {"excludedAccountId": ["account-z"]})

    service.query_graph(
        created["graph_id"],
        "case-1",
        [{"tradeId": "tradeId-from-request", "amount": 999}],
        excludedAccountId=None,
    )

    saved = storage.get_graph(created["graph_id"])

    assert saved is not None
    assert saved["excludedAccountId"] is None


def test_query_graph_does_not_overwrite_stored_trade_cards_when_upstream_omits_them(tmp_path: Path) -> None:
    module = _load_service_module()
    query_client = FakeQueryClient()
    query_client.query_graph_result = {
        "nodes": [{"id": "account-1", "label": "张三"}],
        "money": [],
        "phone": [],
        "excludedTrades": [],
        "groups": {},
        "sourceSelectId": ["张三"],
    }
    storage = module.CaseGraphStorage(workspace=tmp_path)
    service = module.CaseGraphService(storage=storage, query_client=query_client)

    created = service.create_graph(
        case_id="case-1",
        graph_name="主图",
        trade_cards=[{"tradeId": "trade-stored", "amount": 100}],
    )

    service.query_graph(
        created["graph_id"],
        "case-1",
        [{"tradeId": "trade-request", "amount": 999}],
    )

    saved = storage.get_graph(created["graph_id"])

    assert saved is not None
    assert saved["tradeCards"] == [{"tradeId": "trade-request", "amount": 999}]


def test_query_graph_missing_optional_fields_does_not_clobber_graph_state(tmp_path: Path) -> None:
    module = _load_service_module()
    query_client = FakeQueryClient()
    query_client.query_graph_result = {
        "nodes": [],
        "money": [],
        "phone": [],
    }
    storage = module.CaseGraphStorage(workspace=tmp_path)
    service = module.CaseGraphService(storage=storage, query_client=query_client)

    created = service.create_graph(
        case_id="case-1",
        graph_name="主图",
        trade_cards=[{"tradeId": "trade-1", "amount": 100}],
    )
    storage.update_graph(
        created["graph_id"],
        {
            "excludedTrades": ["trade-x"],
            "excludedAccountId": ["account-z"],
        },
    )

    service.query_graph(created["graph_id"], "case-1", [{"tradeId": "ignored"}], excludedAccountId=["account-z"])

    saved = storage.get_graph(created["graph_id"])

    assert saved is not None
    assert saved["tradeCards"] == [{"tradeId": "ignored"}]
    assert saved["excludedTrades"] == ["trade-x"]
    assert saved["excludedAccountId"] == ["account-z"]


def test_target_detail_passes_payload_through_query_client(tmp_path: Path) -> None:
    module = _load_service_module()
    query_client = FakeQueryClient()
    query_client.target_detail_result = [{"tradeId": "trade-9", "payerAccountName": "付款人"}]
    storage = module.CaseGraphStorage(workspace=tmp_path)
    service = module.CaseGraphService(storage=storage, query_client=query_client)
    created = service.create_graph(case_id="case-1", graph_name="主图", trade_cards=[])

    detail = service.target_detail(
        graph_id=created["graph_id"],
        case_id="case-1",
        payer_cards=[{"accountId": "100", "tradeCard": "6222", "accountName": "付款人"}],
        payee_cards=[{"accountId": "200", "tradeCard": "9558", "accountName": "收款人"}],
        min_amount=500,
    )

    assert query_client.target_detail_calls == [
        {
            "graphId": created["graph_id"],
            "caseId": "case-1",
            "payerCards": [{"accountId": "100", "tradeCard": "6222", "accountName": "付款人"}],
            "payeeCards": [{"accountId": "200", "tradeCard": "9558", "accountName": "收款人"}],
            "min_amount": 500,
        }
    ]
    assert detail == [{"tradeId": "trade-9", "payerAccountName": "付款人"}]


def test_list_cases_passes_through_query_client(tmp_path: Path) -> None:
    module = _load_service_module()
    query_client = FakeQueryClient()
    storage = module.CaseGraphStorage(workspace=tmp_path)
    service = module.CaseGraphService(storage=storage, query_client=query_client)

    result = service.list_cases()

    assert query_client.list_cases_calls == 1
    assert result == query_client.list_cases_result


def test_list_accounts_passes_through_query_client(tmp_path: Path) -> None:
    module = _load_service_module()
    query_client = FakeQueryClient()
    storage = module.CaseGraphStorage(workspace=tmp_path)
    service = module.CaseGraphService(storage=storage, query_client=query_client)

    result = service.list_accounts("case-37", "伍")

    assert query_client.list_accounts_calls == [{"case_id": "case-37", "keyword": "伍"}]
    assert result == query_client.list_accounts_result


def test_pymysql_drill_down_maps_counterparty_rows_to_trade_cards() -> None:
    _load_service_module()
    mysql_client_module = sys.modules["nanobot_channel_webui.case_graph.mysql_client"]

    class StubClient(mysql_client_module.PyMySQLCaseGraphQueryClient):
        def _counterparty_rows(self, **kwargs: Any) -> list[dict[str, Any]]:
            return [
                {"account_id": 42, "pay_account": "6222", "account_name": "张三"},
                {"account_id": 99, "pay_account": "9558", "account_name": "李四"},
            ]

    client = StubClient(
        mysql_client_module.CaseGraphMySQLConfig(
            host="127.0.0.1",
            port=3306,
            user="root",
            password="secret",
            database="jingzhen",
        )
    )

    result = client.drill_down(
        {
            "caseId": "case-1",
            "payer": "payer-1",
            "drill_type": "out",
            "tradeCards": [{"accountId": "99", "tradeCard": "9558"}],
        }
    )

    assert result == [
        {
            "tradeId": "account-42",
            "accountId": "42",
            "tradeCard": "6222",
            "accountName": "张三",
        }
    ]


def test_pymysql_query_graph_applies_amount_and_time_filters() -> None:
    _load_service_module()
    mysql_client_module = sys.modules["nanobot_channel_webui.case_graph.mysql_client"]

    class StubClient(mysql_client_module.PyMySQLCaseGraphQueryClient):
        def __init__(self, config: Any) -> None:
            super().__init__(config)
            self.last_sql = ""
            self.last_params: tuple[Any, ...] = ()

        def _query(self, sql: str, params: tuple[Any, ...]) -> list[dict[str, Any]]:
            self.last_sql = sql
            self.last_params = params
            return []

    client = StubClient(
        mysql_client_module.CaseGraphMySQLConfig(
            host="127.0.0.1",
            port=3306,
            user="root",
            password="secret",
            database="jingzhen",
        )
    )

    client.query_graph(
        {
            "caseId": "case-1",
            "tradeCards": [{"accountId": "99", "tradeCard": "9558"}],
            "minAmount": 100,
            "maxAmount": 900,
            "startTime": "2024-01-01 00:00:00",
            "endTime": "2024-12-31 23:59:59",
        }
    )

    assert "trade_amount >= %s" in client.last_sql
    assert "trade_amount <= %s" in client.last_sql
    assert "trade_time >= %s" in client.last_sql
    assert "trade_time <= %s" in client.last_sql
    assert 100.0 in client.last_params
    assert 900.0 in client.last_params
    assert "2024-01-01 00:00:00" in client.last_params
    assert "2024-12-31 23:59:59" in client.last_params


def test_pymysql_query_graph_expands_seed_cards_and_uses_subject_labels() -> None:
    _load_service_module()
    mysql_client_module = sys.modules["nanobot_channel_webui.case_graph.mysql_client"]

    class StubClient(mysql_client_module.PyMySQLCaseGraphQueryClient):
        def __init__(self, config: Any) -> None:
            super().__init__(config)
            self.calls = 0

        def _query(self, sql: str, params: tuple[Any, ...]) -> list[dict[str, Any]]:
            self.calls += 1
            if "GROUP BY account_id, pay_account, account_name" in sql:
                if self.calls == 1:
                    return [{"account_id": 200, "pay_account": "A-200", "account_name": "上游主体"}]
                if self.calls == 3:
                    return [{"account_id": 300, "pay_account": "A-300", "account_name": "下游主体"}]
                return []
            return [
                {
                    "payer_account_id": 100,
                    "payer_pay_account": "A-100",
                    "payer_name": "种子主体",
                    "payee_account_id": 200,
                    "payee_pay_account": "A-200",
                    "payee_name": "上游主体",
                    "trade_count": 2,
                    "trade_amount": 88,
                }
            ]

    client = StubClient(
        mysql_client_module.CaseGraphMySQLConfig(
            host="127.0.0.1",
            port=3306,
            user="root",
            password="secret",
            database="jingzhen",
        )
    )

    result = client.query_graph(
        {
            "caseId": "case-1",
            "tradeCards": [
                {
                    "accountId": "100",
                    "tradeCard": "A-100",
                    "accountName": "开户名",
                    "suspectName": "种子主体",
                    "suspectId": "S-1",
                }
            ],
        }
    )

    assert set(result.keys()) == {"nodes", "money", "phone", "excludedTrades", "groups", "sourceSelectId"}
    assert {node["label"] for node in result["nodes"]} >= {"种子主体", "上游主体", "下游主体"}
    assert result["sourceSelectId"][:2] == ["种子主体", "上游主体"]


def test_pymysql_list_accounts_returns_suspect_scoped_accounts() -> None:
    _load_service_module()
    mysql_client_module = sys.modules["nanobot_channel_webui.case_graph.mysql_client"]

    class StubClient(mysql_client_module.PyMySQLCaseGraphQueryClient):
        def _query(self, sql: str, params: tuple[Any, ...]) -> list[dict[str, Any]]:
            assert "ga_suspect_37" in sql
            assert "ga_account_37" in sql
            return [
                {
                    "suspect_id": 1,
                    "suspect_name": "伍华中",
                    "id": 58,
                    "account_name": "深圳市分行",
                    "trade_card": "420000292020251208",
                    "trade_account": None,
                    "account_category": 2,
                    "is_obtain": 1,
                },
                {
                    "suspect_id": 1,
                    "suspect_name": "伍华中",
                    "id": 58,
                    "account_name": "深圳市分行",
                    "trade_card": "420000292020251208",
                    "trade_account": None,
                    "account_category": 2,
                    "is_obtain": 1,
                },
            ]

    client = StubClient(
        mysql_client_module.CaseGraphMySQLConfig(
            host="127.0.0.1",
            port=3306,
            user="root",
            password="secret",
            database="jingzhen",
        )
    )

    result = client.list_accounts("case-37", "伍")

    assert result == [
        {
            "accountId": "58",
            "tradeCard": "420000292020251208",
            "accountName": "深圳市分行",
            "suspectId": "1",
            "suspectName": "伍华中",
            "accountCategory": 2,
            "isObtain": 1,
        }
    ]


def test_pymysql_relation_party_node_marks_cash_breakpoints() -> None:
    _load_service_module()
    mysql_client_module = sys.modules["nanobot_channel_webui.case_graph.mysql_client"]

    deposit_node = mysql_client_module.PyMySQLCaseGraphQueryClient._relation_party_node(
        {
            "payer_account_id": 239,
            "payer_pay_account": "现金交易（存现）",
            "payer_account_name": "现金交易（存现）",
            "cash_flag": "现金",
            "trade_type": "现金交易",
            "trade_abstract": "现金存入",
            "jd_flags": "贷",
        },
        "payer",
    )
    withdraw_node = mysql_client_module.PyMySQLCaseGraphQueryClient._relation_party_node(
        {
            "payee_account_id": "",
            "payee_pay_account": "",
            "payee_account_name": "",
            "cash_flag": "现金",
            "trade_type": "现金交易",
            "trade_abstract": "现金取出",
            "jd_flags": "借",
        },
        "payee",
    )
    account_node = mysql_client_module.PyMySQLCaseGraphQueryClient._relation_party_node(
        {
            "payee_account_id": 137,
            "payee_pay_account": "17371521349",
            "payee_account_name": "伍华中",
            "cash_flag": "现金",
            "trade_type": "现金交易",
            "trade_abstract": "现金存入",
            "jd_flags": "贷",
        },
        "payee",
    )

    assert deposit_node["type"] == "cash"
    assert deposit_node["cashDirection"] == "deposit"
    assert deposit_node["label"] == "现金存入"
    assert withdraw_node["type"] == "cash"
    assert withdraw_node["cashDirection"] == "withdraw"
    assert withdraw_node["label"] == "现金取出"
    assert account_node["type"] == "account"
    assert account_node["label"] == "伍华中"


def test_pymysql_target_detail_serializes_trade_time() -> None:
    _load_service_module()
    mysql_client_module = sys.modules["nanobot_channel_webui.case_graph.mysql_client"]

    class StubClient(mysql_client_module.PyMySQLCaseGraphQueryClient):
        def _query(self, sql: str, params: tuple[Any, ...]) -> list[dict[str, Any]]:
            return [
                {
                    "id": 9,
                    "serial_number": "SN-9",
                    "trade_amount": 12.5,
                    "trade_time": datetime(2026, 1, 2, 3, 4, 5),
                    "trade_abstract": "测试流水",
                    "payer_account_id": 35,
                    "payer_account_name": "付款人",
                    "payer_pay_account": "payer-card",
                    "payee_account_id": 1,
                    "payee_account_name": "收款人",
                    "payee_pay_account": "payee-card",
                }
            ]

    client = StubClient(
        mysql_client_module.CaseGraphMySQLConfig(
            host="127.0.0.1",
            port=3306,
            user="root",
            password="secret",
            database="jingzhen",
        )
    )

    result = client.target_detail(
        {
            "caseId": "case-37",
            "payer": "35",
            "payee": "1",
        }
    )

    assert result == [
        {
            "tradeId": 9,
            "serialNumber": "SN-9",
            "tradeAmount": 12.5,
            "tradeTime": "2026-01-02 03:04:05",
            "tradeAbstract": "测试流水",
            "payerAccountId": 35,
            "payerAccountName": "付款人",
            "payerTradeCard": "payer-card",
            "payeeAccountId": 1,
            "payeeAccountName": "收款人",
            "payeeTradeCard": "payee-card",
        }
    ]


def test_pymysql_target_detail_backfills_empty_party_names_from_request_cards() -> None:
    _load_service_module()
    mysql_client_module = sys.modules["nanobot_channel_webui.case_graph.mysql_client"]

    class StubClient(mysql_client_module.PyMySQLCaseGraphQueryClient):
        def _query(self, sql: str, params: tuple[Any, ...]) -> list[dict[str, Any]]:
            return [
                {
                    "id": 45,
                    "serial_number": "SN-45",
                    "trade_amount": 20000,
                    "trade_time": datetime(2026, 1, 14, 3, 46, 34),
                    "trade_abstract": None,
                    "payer_account_id": 35,
                    "payer_account_name": "",
                    "payer_pay_account": "085e9858ee415e117f9003838@wx.tenpay.com",
                    "payee_account_id": 1,
                    "payee_account_name": "伍华中",
                    "payee_pay_account": "085e9858e90527255ba312e91@wx.tenpay.com",
                }
            ]

    client = StubClient(
        mysql_client_module.CaseGraphMySQLConfig(
            host="127.0.0.1",
            port=3306,
            user="root",
            password="secret",
            database="jingzhen",
        )
    )

    result = client.target_detail(
        {
            "caseId": "case-37",
            "payerCards": [
                {
                    "accountId": "35",
                    "tradeCard": "085e9858ee415e117f9003838@wx.tenpay.com",
                    "accountName": "冯燕青",
                }
            ],
            "payeeCards": [
                {
                    "accountId": "1",
                    "tradeCard": "085e9858e90527255ba312e91@wx.tenpay.com",
                    "accountName": "伍华中",
                }
            ],
        }
    )

    assert result[0]["payerAccountName"] == "冯燕青"
    assert result[0]["payeeAccountName"] == "伍华中"


def test_pymysql_target_detail_uses_raw_trade_table_columns_for_card_matching() -> None:
    _load_service_module()
    mysql_client_module = sys.modules["nanobot_channel_webui.case_graph.mysql_client"]

    class StubClient(mysql_client_module.PyMySQLCaseGraphQueryClient):
        def __init__(self, config: Any) -> None:
            super().__init__(config)
            self.sql = ""
            self.params: tuple[Any, ...] = ()

        def _query(self, sql: str, params: tuple[Any, ...]) -> list[dict[str, Any]]:
            self.sql = sql
            self.params = params
            return []

    client = StubClient(
        mysql_client_module.CaseGraphMySQLConfig(
            host="127.0.0.1",
            port=3306,
            user="root",
            password="secret",
            database="jingzhen",
        )
    )

    client.target_detail(
        {
            "caseId": "case-37",
            "payerCards": [{"accountId": "35", "tradeCard": "payer-card", "accountName": "冯燕青"}],
            "payeeCards": [{"accountId": "1", "tradeCard": "payee-card", "accountName": "伍华中"}],
        }
    )

    assert "payer_suspect_name" not in client.sql
    assert "payee_suspect_name" not in client.sql
    assert "payer_account_name" in client.sql
    assert "payee_account_name" in client.sql
    assert client.params == (35, "35", 1, "1", 200)


@pytest.mark.parametrize(
    ("method_name", "kwargs"),
    [
        (
            "query_graph",
            {
                "graph_id": "missing-graph",
                "case_id": "case-1",
                "trade_cards": [],
            },
        ),
        (
            "drill_down",
            {
                "graph_id": "missing-graph",
                "case_id": "case-1",
            },
        ),
        (
            "target_detail",
            {
                "graph_id": "missing-graph",
                "case_id": "case-1",
                "payer": "payer-1",
                "payee": "payee-1",
            },
        ),
    ],
)
def test_methods_raise_for_missing_graph(
    tmp_path: Path,
    method_name: str,
    kwargs: dict[str, Any],
) -> None:
    module = _load_service_module()
    query_client = FakeQueryClient()
    storage = module.CaseGraphStorage(workspace=tmp_path)
    service = module.CaseGraphService(storage=storage, query_client=query_client)

    method = getattr(service, method_name)

    with pytest.raises(KeyError, match="missing-graph"):
        method(**kwargs)


@pytest.mark.anyio
async def test_http_relation_query_route_calls_service_and_returns_payload() -> None:
    service = FakeCaseGraphService()

    async with _case_graph_client(service=service) as (client, _channel):
        response = await client.post(
            "/api/case-graph/relation/query",
            json={
                "graphId": "graph-1",
                "caseId": "case-1",
                "seeds": [{"suspectId": "1", "accountIds": ["1"]}],
                "direction": "out",
            },
        )

        assert response.status == 200
        assert await response.json() == service.relation_query_result
        assert service.relation_query_calls == [
            {
                "graphId": "graph-1",
                "caseId": "case-1",
                "seeds": [{"suspectId": "1", "accountIds": ["1"]}],
                "direction": "out",
            }
        ]


@pytest.mark.anyio
async def test_http_case_list_route_calls_service_and_returns_payload() -> None:
    service = FakeCaseGraphService()

    async with _case_graph_client(service=service) as (client, _channel):
        response = await client.get("/api/case-graph/cases")

        assert response.status == 200
        assert await response.json() == {"items": service.case_list_result}
        assert service.case_list_calls == 1


@pytest.mark.anyio
async def test_http_account_list_route_calls_service_and_returns_payload() -> None:
    service = FakeCaseGraphService()

    async with _case_graph_client(service=service) as (client, _channel):
        response = await client.get("/api/case-graph/cases/case-37/accounts?keyword=%E4%BC%8D")

        assert response.status == 200
        assert await response.json() == {"items": service.account_list_result}
        assert service.account_list_calls == [{"case_id": "case-37", "keyword": "伍"}]


@pytest.mark.anyio
async def test_http_graph_list_route_calls_service_and_returns_payload() -> None:
    service = FakeCaseGraphService()

    async with _case_graph_client(service=service) as (client, _channel):
        response = await client.get("/api/case-graph/graphs?caseId=37")

        assert response.status == 200
        assert await response.json() == {"items": service.graph_list_result}
        assert service.graph_list_calls == ["37"]


@pytest.mark.anyio
async def test_http_relation_complete_route_calls_service_and_returns_payload() -> None:
    service = FakeCaseGraphService()

    async with _case_graph_client(service=service) as (client, _channel):
        response = await client.post(
            "/api/case-graph/relation/complete",
            json={
                "graphId": "graph-1",
                "caseId": "case-1",
                "accounts": [{"accountId": "1"}, {"accountId": "2"}],
            },
        )

        assert response.status == 200
        assert await response.json() == service.relation_complete_result
        assert service.relation_complete_calls == [
            {
                "graphId": "graph-1",
                "caseId": "case-1",
                "accounts": [{"accountId": "1"}, {"accountId": "2"}],
            }
        ]


@pytest.mark.anyio
async def test_http_relation_filter_route_calls_service_and_returns_payload() -> None:
    service = FakeCaseGraphService()

    async with _case_graph_client(service=service) as (client, _channel):
        response = await client.post(
            "/api/case-graph/relation/filter",
            json={
                "graphId": "graph-1",
                "caseId": "case-1",
                "filters": {
                    "minAmount": 10000,
                    "maxAmount": 50000,
                    "startTime": "2026-01-01 00:00:00",
                    "endTime": "2026-01-31 23:59:59",
                },
            },
        )

        assert response.status == 200
        assert await response.json() == service.relation_filter_result
        assert service.relation_filter_calls == [
            {
                "graphId": "graph-1",
                "caseId": "case-1",
                "filters": {
                    "minAmount": 10000,
                    "maxAmount": 50000,
                    "startTime": "2026-01-01 00:00:00",
                    "endTime": "2026-01-31 23:59:59",
                },
            }
        ]


@pytest.mark.anyio
async def test_http_relation_summary_candidates_route_calls_service_and_returns_payload() -> None:
    service = FakeCaseGraphService()

    async with _case_graph_client(service=service) as (client, _channel):
        response = await client.post(
            "/api/case-graph/relation/summary-candidates",
            json={
                "graphId": "graph-1",
                "caseId": "case-1",
                "focusNodeId": "subject:suspect:1",
                "direction": "both",
                "drillNums": 7,
                "drillType": 2,
                "filters": {"minAmount": 1000},
            },
        )

        assert response.status == 200
        assert await response.json() == service.relation_summary_candidate_result
        assert service.relation_summary_candidate_calls == [
            {
                "graphId": "graph-1",
                "caseId": "case-1",
                "focusNodeId": "subject:suspect:1",
                "direction": "both",
                "drillNums": 7,
                "drillType": 2,
                "filters": {"minAmount": 1000},
            }
        ]


@pytest.mark.anyio
async def test_http_relation_summary_candidates_global_route_allows_no_focus_node() -> None:
    service = FakeCaseGraphService()

    async with _case_graph_client(service=service) as (client, _channel):
        response = await client.post(
            "/api/case-graph/relation/summary-candidates",
            json={
                "graphId": "graph-1",
                "caseId": "case-1",
                "scope": "global",
                "direction": "both",
                "filters": {"minAmount": 1000},
            },
        )

        assert response.status == 200
        assert await response.json() == service.relation_summary_candidate_result
        assert service.relation_summary_candidate_calls == [
            {
                "graphId": "graph-1",
                "caseId": "case-1",
                "scope": "global",
                "direction": "both",
                "filters": {"minAmount": 1000},
            }
        ]


@pytest.mark.anyio
async def test_http_relation_summary_selection_route_calls_service_and_returns_payload() -> None:
    service = FakeCaseGraphService()

    async with _case_graph_client(service=service) as (client, _channel):
        response = await client.post(
            "/api/case-graph/relation/summary-selection",
            json={
                "graphId": "graph-1",
                "caseId": "case-1",
                "focusNodeId": "subject:suspect:1",
                "candidateNodeIds": ["account:35", "account:39"],
                "selectedNodeIds": ["account:39"],
                "direction": "both",
                "drillNums": 7,
                "drillType": 2,
                "filters": {"minAmount": 1000},
                "options": {"nodePositions": {"subject:suspect:1": {"x": 100, "y": 200}}},
            },
        )

        assert response.status == 200
        assert await response.json() == service.relation_summary_selection_result
        assert service.relation_summary_selection_calls == [
            {
                "graphId": "graph-1",
                "caseId": "case-1",
                "focusNodeId": "subject:suspect:1",
                "candidateNodeIds": ["account:35", "account:39"],
                "selectedNodeIds": ["account:39"],
                "direction": "both",
                "drillNums": 7,
                "drillType": 2,
                "filters": {"minAmount": 1000},
                "options": {"nodePositions": {"subject:suspect:1": {"x": 100, "y": 200}}},
            }
        ]


@pytest.mark.anyio
async def test_http_relation_summary_selection_global_route_allows_no_focus_node() -> None:
    service = FakeCaseGraphService()

    async with _case_graph_client(service=service) as (client, _channel):
        response = await client.post(
            "/api/case-graph/relation/summary-selection",
            json={
                "graphId": "graph-1",
                "caseId": "case-1",
                "scope": "global",
                "candidateNodeIds": ["account:35", "account:39"],
                "selectedNodeIds": ["account:39"],
                "selectedCandidates": [
                    {
                        "nodeId": "account:39",
                        "label": "蔡金海",
                        "cards": [{"accountId": "39", "accountName": "蔡金海", "tradeCard": "6222"}],
                    }
                ],
                "filters": {"minAmount": 1000},
                "options": {"nodePositions": {"subject:suspect:1": {"x": 100, "y": 200}}},
            },
        )

        assert response.status == 200
        assert await response.json() == service.relation_summary_selection_result
        assert service.relation_summary_selection_calls == [
            {
                "graphId": "graph-1",
                "caseId": "case-1",
                "scope": "global",
                "candidateNodeIds": ["account:35", "account:39"],
                "selectedNodeIds": ["account:39"],
                "selectedCandidates": [
                    {
                        "nodeId": "account:39",
                        "label": "蔡金海",
                        "cards": [{"accountId": "39", "accountName": "蔡金海", "tradeCard": "6222"}],
                    }
                ],
                "filters": {"minAmount": 1000},
                "options": {"nodePositions": {"subject:suspect:1": {"x": 100, "y": 200}}},
            }
        ]


@pytest.mark.anyio
async def test_http_relation_exclude_and_restore_routes_call_service() -> None:
    service = FakeCaseGraphService()

    async with _case_graph_client(service=service) as (client, _channel):
        exclude_response = await client.post(
            "/api/case-graph/relation/exclude-node",
            json={
                "graphId": "graph-1",
                "caseId": "case-1",
                "nodes": [
                    {"nodeId": "account:35", "label": "冯燕青", "type": "account"},
                    {"nodeId": "account:39", "label": "蔡金海", "type": "account"},
                ],
            },
        )
        restore_response = await client.post(
            "/api/case-graph/relation/restore-node",
            json={
                "graphId": "graph-1",
                "caseId": "case-1",
                "nodeId": "account:35",
            },
        )

        assert exclude_response.status == 200
        assert await exclude_response.json() == service.relation_exclude_result
        assert service.relation_exclude_calls == [
            {
                "graphId": "graph-1",
                "caseId": "case-1",
                "nodes": [
                    {"nodeId": "account:35", "label": "冯燕青", "type": "account"},
                    {"nodeId": "account:39", "label": "蔡金海", "type": "account"},
                ],
            }
        ]
        assert restore_response.status == 200
        assert await restore_response.json() == service.relation_restore_result
        assert service.relation_restore_calls == [
            {
                "graphId": "graph-1",
                "caseId": "case-1",
                "nodeId": "account:35",
            }
        ]


@pytest.mark.anyio
async def test_http_relation_state_routes_call_state_service() -> None:
    service = FakeCaseGraphService()

    async with _case_graph_client(service=service) as (client, _channel):
        get_response = await client.get("/api/case-graph/relation/state/case-1/graph-1")
        layout_response = await client.post(
            "/api/case-graph/relation/state/case-1/graph-1/operations/layout",
            json={
                "graphName": "图1",
                "nodePositions": {"a": {"x": 100, "y": 200}},
                "positionMeta": {"a": {"source": "manual", "locked": True}},
                "groupLayout": {
                    "group-1": {
                        "groupId": "group-1",
                        "collapsedPosition": {"x": 100, "y": 200},
                        "memberPositionsBeforeCollapse": {"a": {"x": 100, "y": 200}},
                    }
                },
                "viewport": {"x": 0, "y": 0, "zoom": 1},
            },
        )
        note_response = await client.post(
            "/api/case-graph/relation/state/case-1/graph-1/operations/node-note",
            json={
                "graphName": "图1",
                "nodeId": "a",
                "sourceNote": "重点核查",
                "note": "疑似共同取现",
            },
        )
        steps_response = await client.get("/api/case-graph/relation/state/case-1/graph-1/steps")

        assert get_response.status == 200
        assert await get_response.json() == service.graph_state_result
        assert layout_response.status == 200
        assert await layout_response.json() == service.graph_state_result
        assert note_response.status == 200
        assert await note_response.json() == service.graph_state_result
        assert await steps_response.json() == {"items": [{"stepId": "0001", "operation": {"type": "seed_one_hop"}}]}
        assert service.state_load_calls == [{"case_id": "case-1", "graph_id": "graph-1"}]
        assert service.state_layout_calls == [
            {
                "case_id": "case-1",
                "graph_id": "graph-1",
                "graph_name": "图1",
                "node_positions": {"a": {"x": 100, "y": 200}},
                "position_meta": {"a": {"source": "manual", "locked": True}},
                "group_layout": {
                    "group-1": {
                        "groupId": "group-1",
                        "collapsedPosition": {"x": 100, "y": 200},
                        "memberPositionsBeforeCollapse": {"a": {"x": 100, "y": 200}},
                    }
                },
                "viewport": {"x": 0, "y": 0, "zoom": 1},
            }
        ]
        assert service.state_note_calls == [
            {
                "case_id": "case-1",
                "graph_id": "graph-1",
                "graph_name": "图1",
                "node_id": "a",
                "source_note": "重点核查",
                "note": "疑似共同取现",
            }
        ]


@pytest.mark.anyio
async def test_http_target_detail_route_calls_service_and_returns_payload() -> None:
    service = FakeCaseGraphService()

    async with _case_graph_client(service=service) as (client, _channel):
        response = await client.post(
            "/api/case-graph/target-detail",
            json={
                "graphId": "graph-1",
                "caseId": "case-1",
                "payerCards": [{"accountId": "100", "tradeCard": "6222"}],
                "payeeCards": [{"accountId": "200", "tradeCard": "9558"}],
                "min_amount": 500,
            },
        )

        assert response.status == 200
        assert await response.json() == service.target_detail_result
        assert service.target_detail_calls == [
            {
                "graph_id": "graph-1",
                "case_id": "case-1",
                "payer_cards": [{"accountId": "100", "tradeCard": "6222"}],
                "payee_cards": [{"accountId": "200", "tradeCard": "9558"}],
                "filters": {"min_amount": 500},
            }
        ]


@pytest.mark.anyio
async def test_http_create_and_detail_routes_return_payloads() -> None:
    service = FakeCaseGraphService()
    storage = FakeCaseGraphStorage()
    storage.graphs["graph-existing"] = {
        "graph_id": "graph-existing",
        "caseId": "case-1",
        "graphName": "存量图",
        "tradeCards": [{"tradeId": "trade-1"}],
        "excludedTrades": [],
        "excludedAccountId": "",
        "drillNums": 0,
        "drillType": None,
    }

    async with _case_graph_client(service=service, storage=storage) as (client, _channel):
        create_response = await client.post(
            "/api/case-graph/graphs",
            json={"caseId": "case-1", "graphName": "主图", "tradeCards": []},
        )
        detail_response = await client.get("/api/case-graph/graph/graph-existing")

        assert create_response.status == 200
        assert await create_response.json() == service.create_result
        assert service.create_calls == [
            {"case_id": "case-1", "graph_name": "主图", "trade_cards": []}
        ]
        assert detail_response.status == 200
        assert await detail_response.json() == storage.graphs["graph-existing"]


@pytest.mark.anyio
async def test_http_update_route_persists_graph_patch() -> None:
    service = FakeCaseGraphService()

    async with _case_graph_client(service=service) as (client, _channel):
        response = await client.post(
            "/api/case-graph/graph/graph-1",
            json={"graphName": "更新后", "sourceSelectId": ["张三"]},
        )

        assert response.status == 200
        assert await response.json() == {
            **service.create_result,
            "graph_id": "graph-1",
            "graphName": "更新后",
            "sourceSelectId": ["张三"],
        }
        assert service.update_calls == [
            {
                "graph_id": "graph-1",
                "patch": {"graphName": "更新后", "sourceSelectId": ["张三"]},
            }
        ]


@pytest.mark.anyio
async def test_http_delete_graph_route_removes_graph_files() -> None:
    service = FakeCaseGraphService()
    storage = FakeCaseGraphStorage()
    storage.graphs["graph-existing"] = {
        "graph_id": "graph-existing",
        "caseId": "case-1",
        "graphName": "存量图",
        "tradeCards": [],
        "excludedTrades": [],
        "excludedAccountId": "",
        "drillNums": 0,
        "drillType": None,
    }

    async with _case_graph_client(service=service, storage=storage) as (client, _channel):
        response = await client.delete("/api/case-graph/graph/graph-existing")

        assert response.status == 200
        assert await response.json() == {"ok": True}
        assert service.delete_calls == ["graph-existing"]


@pytest.mark.anyio
async def test_http_delete_graph_route_also_deletes_bound_chat() -> None:
    service = FakeCaseGraphService()
    storage = FakeCaseGraphStorage()
    chat_id = "11111111-1111-4111-8111-111111111111"
    storage.graphs["graph-existing"] = {
        "graph_id": "graph-existing",
        "caseId": "case-1",
        "graphName": "存量图",
        "tradeCards": [],
        "excludedTrades": [],
        "excludedAccountId": "",
        "drillNums": 0,
        "drillType": None,
        "chatId": chat_id,
    }

    class FakeSessionStore:
        def __init__(self) -> None:
            self.delete_calls: list[str] = []

        def delete_session(self, deleted_chat_id: str) -> bool:
            self.delete_calls.append(deleted_chat_id)
            return True

    class FakeRegistry:
        def __init__(self) -> None:
            self.delete_calls: list[dict[str, Any]] = []

        async def delete_chat(self, deleted_chat_id: str, payload: dict[str, Any]) -> None:
            self.delete_calls.append({"chat_id": deleted_chat_id, "payload": payload})

    async with _case_graph_client(service=service, storage=storage) as (client, channel):
        session_store = FakeSessionStore()
        registry = FakeRegistry()
        channel._sessions = session_store
        channel._registry = registry

        response = await client.delete("/api/case-graph/graph/graph-existing")

        assert response.status == 200
        assert await response.json() == {"ok": True}
        assert service.delete_calls == ["graph-existing"]
        assert session_store.delete_calls == [chat_id]
        assert registry.delete_calls == [
            {
                "chat_id": chat_id,
                "payload": {"type": "session.deleted", "chatId": chat_id},
            }
        ]


@pytest.mark.anyio
async def test_http_delete_graph_route_returns_404_for_missing_graph() -> None:
    service = FakeCaseGraphService()
    service.delete_result = False

    async with _case_graph_client(service=service) as (client, _channel):
        response = await client.delete("/api/case-graph/graph/missing")

        assert response.status == 404
        assert (await response.json())["error"] == "图不存在"
        assert service.delete_calls == ["missing"]


@pytest.mark.anyio
async def test_http_route_returns_400_when_required_fields_missing() -> None:
    async with _case_graph_client() as (client, _channel):
        response = await client.post(
            "/api/case-graph/target-detail",
            json={"graphId": "graph-1", "caseId": "case-1", "payerCards": [{"accountId": "100"}]},
        )

        assert response.status == 400
        assert "payeeCards" in (await response.json())["error"]


@pytest.mark.anyio
async def test_http_route_returns_400_for_invalid_json_body() -> None:
    async with _case_graph_client() as (client, _channel):
        response = await client.post(
            "/api/case-graph/relation/query",
            data="{",
            headers={"Content-Type": "application/json"},
        )

        assert response.status == 400
        assert (await response.json())["error"] == "请求体不是有效 JSON"


@pytest.mark.anyio
@pytest.mark.parametrize(
    ("path", "payload", "message"),
    [
        (
            "/api/case-graph/relation/query",
            {"graphId": {}, "caseId": "case-1", "seeds": [{"accountIds": ["1"]}]},
            "graphId",
        ),
        (
            "/api/case-graph/relation/query",
            {"graphId": "graph-1", "caseId": "case-1", "seeds": ["bad-seed"]},
            "seeds",
        ),
        (
            "/api/case-graph/target-detail",
            {"graphId": "graph-1", "caseId": "case-1", "payerCards": "bad", "payeeCards": []},
            "payerCards",
        ),
    ],
)
async def test_http_routes_reject_invalid_field_types(
    path: str,
    payload: dict[str, Any],
    message: str,
) -> None:
    async with _case_graph_client() as (client, _channel):
        response = await client.post(path, json=payload)

        assert response.status == 400
        assert message in (await response.json())["error"]


@pytest.mark.anyio
async def test_http_detail_route_maps_corrupt_graph_to_conflict_response(tmp_path: Path) -> None:
    channel_module = _load_channel_module()
    service = FakeCaseGraphService()
    storage = FakeCaseGraphStorage()

    class FakeCorruptError(channel_module.CaseGraphCorruptError):
        kind = "data_corrupt"

    storage.error = FakeCorruptError("graph-bad")

    async with _case_graph_client(service=service, storage=storage) as (client, _channel):
        response = await client.get("/api/case-graph/graph/graph-bad")

        assert response.status == 409
        assert await response.json() == {
            "error": "图数据损坏: graph-bad",
            "kind": "data_corrupt",
            "graphId": "graph-bad",
        }


@pytest.mark.anyio
async def test_http_context_route_falls_back_to_request_graph_metadata() -> None:
    service = FakeCaseGraphService()
    storage = FakeCaseGraphStorage()

    async with _case_graph_client(service=service, storage=storage) as (client, _channel):
        response = await client.post(
            "/api/case-graph/context",
            json={
                "graphId": "graph-new",
                "caseId": "case-1",
                "graphName": "主图",
                "chatId": "chat-1",
                "focus": {"type": "node", "nodeId": "account:1"},
            },
        )

        assert response.status == 200
        assert await response.json() == {
            "graphId": "graph-new",
            "caseId": "case-1",
            "graphName": "主图",
            "chatId": "chat-1",
            "focus": {"type": "node", "nodeId": "account:1"},
        }


@pytest.mark.anyio
async def test_http_relation_query_route_maps_service_runtime_error_to_json_failure() -> None:
    service = FakeCaseGraphService()
    service.query_error = RuntimeError("db down")

    async with _case_graph_client(service=service) as (client, _channel):
        response = await client.post(
            "/api/case-graph/relation/query",
            json={
                "graphId": "graph-1",
                "caseId": "case-1",
                "seeds": [{"suspectId": "1", "accountIds": ["1"]}],
            },
        )

        assert response.status == 502
        assert (await response.json())["error"] == "关系图查询失败: db down"


@pytest.mark.anyio
async def test_http_create_route_maps_service_runtime_error_to_json_failure() -> None:
    service = FakeCaseGraphService()
    service.create_error = RuntimeError("disk full")

    async with _case_graph_client(service=service) as (client, _channel):
        response = await client.post(
            "/api/case-graph/graphs",
            json={"caseId": "case-1", "graphName": "主图", "tradeCards": []},
        )

        assert response.status == 500
        assert (await response.json())["error"] == "建图失败: disk full"
