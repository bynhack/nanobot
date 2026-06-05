from __future__ import annotations

import json
from pathlib import Path
import sys
import types

import pytest

PACKAGE_SRC_ROOT = Path(__file__).resolve().parents[1] / "src"
if str(PACKAGE_SRC_ROOT) not in sys.path:
    sys.path.insert(0, str(PACKAGE_SRC_ROOT))

CASE_GRAPH_SRC_ROOT = PACKAGE_SRC_ROOT / "nanobot_channel_webui" / "case_graph"
package = types.ModuleType("nanobot_channel_webui")
package.__path__ = [str(PACKAGE_SRC_ROOT / "nanobot_channel_webui")]
sys.modules["nanobot_channel_webui"] = package
case_graph_package = types.ModuleType("nanobot_channel_webui.case_graph")
case_graph_package.__path__ = [str(CASE_GRAPH_SRC_ROOT)]
sys.modules["nanobot_channel_webui.case_graph"] = case_graph_package

from nanobot_channel_webui.case_graph.relation_storage import RelationGraphStorage
from nanobot_channel_webui.case_graph.graph_state_service import GraphStateService
from nanobot_channel_webui.case_graph.relation_types import normalize_relation_query_payload
from nanobot_channel_webui.case_graph.mysql_client import CaseGraphMySQLConfig, PyMySQLCaseGraphQueryClient
from nanobot_channel_webui.case_graph.relation_service import RelationGraphService


class DummyRelationQueryClient:
    def query_relation_one_hop(self, **_: object) -> dict[str, object]:
        raise AssertionError("query_relation_one_hop should not be called")

    def query_relation_between_accounts(self, **_: object) -> dict[str, object]:
        raise AssertionError("query_relation_between_accounts should not be called")

    def query_relation_global_candidates(self, **_: object) -> dict[str, object]:
        raise AssertionError("query_relation_global_candidates should not be called")


def test_normalize_relation_query_payload_requires_seed_accounts() -> None:
    payload = normalize_relation_query_payload({
        "caseId": "37",
        "graphId": "graph-1",
        "seeds": [
            {
                "suspectId": "1",
                "suspectName": "伍华中",
                "accountIds": ["1", "3"],
                "excludedAccountIds": ["3"],
            }
        ],
        "direction": "both",
        "filters": {"minAmount": 100},
    })

    assert payload["caseId"] == "37"
    assert payload["seeds"][0]["accountIds"] == ["1", "3"]
    assert payload["seeds"][0]["activeAccountIds"] == ["1"]
    assert payload["direction"] == "both"
    assert payload["filters"]["minAmount"] == 100
    assert payload["drillNums"] == 10
    assert payload["drillType"] == 1


def test_normalize_relation_query_payload_keeps_graph_drill_config() -> None:
    payload = normalize_relation_query_payload({
        "caseId": "37",
        "graphId": "graph-1",
        "seeds": [
            {
                "suspectName": "伍华中",
                "accountIds": ["1"],
                "accounts": [{"accountId": "1", "tradeCard": "W-1", "accountName": "伍华中"}],
            }
        ],
        "direction": "out",
        "drillNums": "7",
        "drillType": "2",
    })

    assert payload["drillNums"] == 7
    assert payload["drillType"] == 2


def test_relation_storage_writes_graph_and_step(tmp_path: Path) -> None:
    storage = RelationGraphStorage(tmp_path)
    result = storage.save_step(
        case_id="37",
        graph_id="graph-1",
        step_type="seed_one_hop",
        request={"caseId": "37"},
        graph={"nodes": [], "edges": [], "drillNums": 6, "drillType": 2},
        delta={"addedNodes": [], "addedEdges": [], "updatedNodes": [], "updatedEdges": []},
        summary={"addedNodeCount": 0, "addedEdgeCount": 0},
    )

    graph_file = tmp_path / ".nanobot_channel_webui" / "case_graphs" / "37" / "graph-1" / "graph.json"
    step_file = tmp_path / ".nanobot_channel_webui" / "case_graphs" / "37" / "graph-1" / "steps" / "0001-seed-one-hop.json"
    assert graph_file.exists()
    assert step_file.exists()
    assert result["step"]["stepId"] == "0001"
    assert result["step"]["file"] == str(step_file)
    assert result["graph"]["drillNums"] == 6
    assert result["graph"]["drillType"] == 2


def test_relation_storage_updates_graph_settings_without_new_step(tmp_path: Path) -> None:
    storage = RelationGraphStorage(tmp_path)
    storage.save_step(
        case_id="37",
        graph_id="graph-1",
        step_type="seed_one_hop",
        request={"caseId": "37"},
        graph={"nodes": [], "edges": [], "drillNums": 10, "drillType": 1},
        delta={"addedNodes": [], "addedEdges": [], "updatedNodes": [], "updatedEdges": []},
        summary={},
    )

    current = storage._repository.update_graph_settings(
        case_id="37",
        graph_id="graph-1",
        settings={"drillNums": 3, "drillType": 2},
    )
    steps = storage._repository.list_steps("37", "graph-1")

    assert current["graph"]["drillNums"] == 3
    assert current["graph"]["drillType"] == 2
    assert [step["stepId"] for step in steps] == ["0001"]


def test_relation_storage_current_projection_matches_latest_step_graph(tmp_path: Path) -> None:
    storage = RelationGraphStorage(tmp_path)
    storage.save_step(
        case_id="37",
        graph_id="graph-1",
        step_type="seed_one_hop",
        request={"caseId": "37"},
        graph={"nodes": [{"id": "a", "x": 100, "y": 200}], "edges": []},
        delta={"addedNodes": [], "addedEdges": [], "updatedNodes": [], "updatedEdges": []},
        summary={},
    )
    second = storage.save_step(
        case_id="37",
        graph_id="graph-1",
        step_type="filter_current_graph",
        request={"caseId": "37", "filters": {"minAmount": 100}},
        graph={"nodes": [{"id": "a"}], "edges": [], "layout": {"nodePositions": {"a": {"x": 120, "y": 240}}}},
        delta={"addedNodes": [], "addedEdges": [], "updatedNodes": [], "updatedEdges": []},
        summary={},
    )

    current = storage._repository.load_current("37", "graph-1")

    assert second["graphState"]["revision"] == 2
    assert current["revision"] == 2
    assert current["graph"] == second["graphState"]["graph"]
    assert current["graph"]["layout"]["nodePositions"]["a"] == {"x": 120.0, "y": 240.0}


def test_relation_service_removes_multiple_investigation_group_members(tmp_path: Path) -> None:
    storage = RelationGraphStorage(tmp_path)
    storage.save_step(
        case_id="37",
        graph_id="graph-1",
        step_type="seed_one_hop",
        request={"caseId": "37"},
        graph={
            "nodes": [{"id": "a"}, {"id": "b"}, {"id": "c"}, {"id": "d"}],
            "edges": [],
            "investigationGroups": [
                {
                    "id": "group-1",
                    "name": "研判组 1",
                    "memberNodeIds": ["a", "b", "c", "d"],
                    "collapsed": True,
                }
            ],
        },
        delta={"addedNodes": [], "addedEdges": [], "updatedNodes": [], "updatedEdges": []},
        summary={},
    )
    service = RelationGraphService(query_client=DummyRelationQueryClient(), storage=storage, workspace_root=tmp_path)

    result = service.apply_investigation_group({
        "caseId": "37",
        "graphId": "graph-1",
        "operation": "remove_member",
        "groupId": "group-1",
        "memberNodeIds": ["a", "b"],
    })

    group = result["graph"]["investigationGroups"][0]
    assert group["memberNodeIds"] == ["c", "d"]
    assert result["delta"]["updatedGroups"][0]["memberNodeIds"] == ["c", "d"]
    assert result["step"]["type"] == "investigation_group_remove_member"


def test_relation_service_adds_members_to_investigation_group_and_detaches_other_group(tmp_path: Path) -> None:
    storage = RelationGraphStorage(tmp_path)
    storage.save_step(
        case_id="37",
        graph_id="graph-1",
        step_type="seed_one_hop",
        request={"caseId": "37"},
        graph={
            "nodes": [{"id": "a"}, {"id": "b"}, {"id": "c"}, {"id": "d"}, {"id": "e"}],
            "edges": [],
            "investigationGroups": [
                {
                    "id": "group-1",
                    "name": "研判组 1",
                    "memberNodeIds": ["a", "b"],
                    "collapsed": True,
                },
                {
                    "id": "group-2",
                    "name": "研判组 2",
                    "memberNodeIds": ["c", "d", "e"],
                    "collapsed": True,
                },
            ],
        },
        delta={"addedNodes": [], "addedEdges": [], "updatedNodes": [], "updatedEdges": []},
        summary={},
    )
    service = RelationGraphService(query_client=DummyRelationQueryClient(), storage=storage, workspace_root=tmp_path)

    result = service.apply_investigation_group({
        "caseId": "37",
        "graphId": "graph-1",
        "operation": "add_members",
        "groupId": "group-1",
        "memberNodeIds": ["c"],
    })

    groups = {group["id"]: group for group in result["graph"]["investigationGroups"]}
    assert groups["group-1"]["memberNodeIds"] == ["a", "b", "c"]
    assert groups["group-2"]["memberNodeIds"] == ["d", "e"]
    assert result["delta"]["updatedGroups"][0]["id"] == "group-1"
    assert result["step"]["type"] == "investigation_group_add_members"


def test_graph_repository_patches_latest_step_layout_without_new_step(tmp_path: Path) -> None:
    storage = RelationGraphStorage(tmp_path)
    storage.save_step(
        case_id="37",
        graph_id="graph-1",
        step_type="seed_one_hop",
        request={"caseId": "37"},
        graph={"nodes": [{"id": "a"}, {"id": "b"}], "edges": []},
        delta={"addedNodes": [], "addedEdges": [], "updatedNodes": [], "updatedEdges": []},
        summary={},
    )

    current = storage._repository.update_latest_step_layout(
        case_id="37",
        graph_id="graph-1",
        node_positions={"a": {"x": 100, "y": 200}, "b": {"x": 300, "y": 400}},
    )
    steps = storage._repository.list_steps("37", "graph-1")

    assert current["revision"] == 1
    assert len(steps) == 1
    assert current["graph"]["layout"]["nodePositions"] == {
        "a": {"x": 100.0, "y": 200.0},
        "b": {"x": 300.0, "y": 400.0},
    }
    assert steps[0]["graph"]["layout"]["nodePositions"] == current["graph"]["layout"]["nodePositions"]


def test_graph_state_service_writes_current_context_from_relation_state(tmp_path: Path) -> None:
    storage = RelationGraphStorage(tmp_path)
    storage.save_step(
        case_id="37",
        graph_id="graph-1",
        step_type="seed_one_hop",
        request={"caseId": "37", "graphName": "图1"},
        graph={
            "nodes": [{"id": "a"}, {"id": "b"}],
            "edges": [{"id": "money:a->b", "from": "a", "to": "b"}],
            "tradeFacts": {"10": {"tradeId": "10"}},
        },
        delta={
            "addedNodes": [{"id": "a"}, {"id": "b"}],
            "addedEdges": [{"id": "money:a->b"}],
            "updatedNodes": [],
            "updatedEdges": [],
        },
        summary={"label": "一跳分析"},
    )

    service = GraphStateService(tmp_path)
    context = service.write_current_context(
        case_id="37",
        graph_id="graph-1",
        graph_name="图1",
        chat_id="22222222-2222-4222-8222-222222222222",
        focus={"type": "node", "nodeId": "a"},
    )

    context_path = (
        tmp_path
        / ".nanobot_channel_webui"
        / "case_graph_contexts"
        / "37"
        / "graph-1"
        / "current_context.json"
    )
    assert context_path.exists()
    assert context["graphFile"].endswith("/case_graphs/37/graph-1/graph.json")
    assert context["tradeFactsFile"].endswith("/case_graphs/37/graph-1/facts/trades.jsonl")
    assert context["latestStepId"] == "0001"
    assert context["latestOperation"]["label"] == "一跳分析"
    assert context["deltaSummary"]["addedNodeCount"] == 2
    assert context["graphStats"]["tradeFactCount"] == 1
    assert context["chatId"] == "22222222-2222-4222-8222-222222222222"


def test_graph_repository_moves_trade_facts_to_jsonl_fact_store(tmp_path: Path) -> None:
    storage = RelationGraphStorage(tmp_path)
    result = storage.save_step(
        case_id="37",
        graph_id="graph-1",
        step_type="seed_one_hop",
        request={"caseId": "37", "graphName": "图1"},
        graph={
            "nodes": [{"id": "a"}, {"id": "b"}],
            "edges": [{"id": "money:a->b", "from": "a", "to": "b", "tradeIds": ["10"]}],
            "tradeFacts": {
                "10": {
                    "tradeId": "10",
                    "serialNumber": "S-10",
                    "tradeAmount": 1200,
                    "tradeTime": "2026-01-01 10:00:00",
                    "tradeAbstract": "测试流水",
                    "ipAddress": "10.0.0.1",
                    "macAddress": "AA:BB:CC",
                    "merchantName": "测试商户",
                    "orderNo": "ORDER-10",
                }
            },
        },
        delta={"addedNodes": [], "addedEdges": [], "updatedNodes": [], "updatedEdges": []},
        summary={},
    )

    graph_dir = storage.graph_dir("37", "graph-1")
    graph_payload = json.loads((graph_dir / "graph.json").read_text(encoding="utf-8"))
    step_payload = json.loads((graph_dir / "steps" / "0001-seed-one-hop.json").read_text(encoding="utf-8"))
    facts_path = graph_dir / "facts" / "trades.jsonl"
    facts = [json.loads(line) for line in facts_path.read_text(encoding="utf-8").splitlines() if line.strip()]

    assert "tradeFacts" not in graph_payload["graph"]
    assert "tradeFacts" not in step_payload["graph"]
    assert graph_payload["graph"]["factStore"] == {
        "tradeFactsPath": "facts/trades.jsonl",
        "tradeFactCount": 1,
    }
    assert facts == [
        {
            "tradeId": "10",
            "serialNumber": "S-10",
            "tradeAmount": 1200,
            "tradeTime": "2026-01-01 10:00:00",
            "tradeAbstract": "测试流水",
            "ipAddress": "10.0.0.1",
            "macAddress": "AA:BB:CC",
            "merchantName": "测试商户",
            "orderNo": "ORDER-10",
        }
    ]
    assert result["graph"]["tradeFacts"]["10"]["merchantName"] == "测试商户"
    assert storage.load_graph("37", "graph-1")["tradeFacts"]["10"]["ipAddress"] == "10.0.0.1"


def test_relation_seed_one_hop_queries_only_seed_counterparties() -> None:
    class StubClient(PyMySQLCaseGraphQueryClient):
        def _query(self, sql: str, params: tuple[object, ...]) -> list[dict[str, object]]:
            if "GROUP_CONCAT" not in sql:
                assert "WHERE id IN" in sql
                assert "FROM trade_info" in sql
                assert "WHERE gt.data_flag = 0" in sql
                assert params == ("10", "11")
                return [
                    {"id": 10, "serial_number": "S-10", "trade_amount": 15000, "trade_time": "2026-01-14 03:46:33"},
                    {"id": 11, "serial_number": "S-11", "trade_amount": 25000, "trade_time": "2026-01-14 03:46:34"},
                ]
            assert "payer_account_id IN" in sql or "payee_account_id IN" in sql
            assert "FROM trade_info" in sql
            assert "LEFT JOIN ga_account_37" in sql
            assert "WHERE gt.data_flag = 0" in sql
            assert params[-1] == 200
            return [
                {
                    "payer_account_id": 35,
                    "payer_pay_account": "P-35",
                    "payer_account_name": "冯燕青",
                    "payee_account_id": 1,
                    "payee_pay_account": "W-1",
                    "payee_account_name": "伍华中",
                    "trade_count": 2,
                    "trade_amount": 40000,
                    "start_time": "2026-01-14 03:46:33",
                    "end_time": "2026-01-14 03:46:34",
                    "trade_ids": "10,11",
                }
            ]

    client = StubClient(CaseGraphMySQLConfig(host="", port=3306, user="", password="", database=""))
    result = client.query_relation_one_hop(
        case_id=37,
        seed_accounts=[
            {"accountId": "1", "tradeCard": "W-1", "accountName": "伍华中", "suspectId": "1", "suspectName": "伍华中"}
        ],
        direction="both",
        filters={},
    )

    assert result["nodes"][0]["id"] == "subject:suspect:1"
    assert result["nodes"][0]["role"] == "seed"
    assert result["edges"][0]["scope"] == "seed_to_counterparty"
    assert result["edges"][0]["tradeAmount"] == 40000.0
    assert result["tradeFacts"]["10"]["serialNumber"] == "S-10"


def test_relation_seed_one_hop_keeps_multiple_seed_subjects_separate() -> None:
    class StubClient(PyMySQLCaseGraphQueryClient):
        def __init__(self) -> None:
            super().__init__(CaseGraphMySQLConfig(host="", port=3306, user="", password="", database=""))
            self.relation_query_params: list[tuple[object, ...]] = []

        def _query(self, sql: str, params: tuple[object, ...]) -> list[dict[str, object]]:
            if "GROUP_CONCAT" not in sql:
                assert "WHERE id IN" in sql
                assert set(params) == {"10", "11", "12"}
                return [
                    {"id": 10, "serial_number": "S-10", "trade_amount": 20000, "trade_time": "2026-01-14 03:46:33"},
                    {"id": 11, "serial_number": "S-11", "trade_amount": 24000, "trade_time": "2026-01-18 23:10:34"},
                    {"id": 12, "serial_number": "S-12", "trade_amount": 40000, "trade_time": "2026-01-21 01:26:16"},
                ]
            self.relation_query_params.append(params)
            assert "LIMIT %s" in sql
            if params == (1, "W-1", 200) and "payee_account_id IN" in sql:
                assert "payee_account_id IN" in sql
                assert "payee_pay_account IN" in sql
                assert "payer_account_id IN" not in sql
                return [
                    {
                        "payer_account_id": 9,
                        "payer_pay_account": "C-9",
                        "payer_account_name": "蔡召东",
                        "payee_account_id": 1,
                        "payee_pay_account": "W-1",
                        "payee_account_name": "伍华中",
                        "trade_count": 1,
                        "trade_amount": 24000,
                        "start_time": "2026-01-18 23:10:34",
                        "end_time": "2026-01-18 23:10:34",
                        "trade_ids": "11",
                    },
                    {
                        "payer_account_id": 35,
                        "payer_pay_account": "F-35",
                        "payer_account_name": "冯燕青",
                        "payee_account_id": 1,
                        "payee_pay_account": "W-1",
                        "payee_account_name": "伍华中",
                        "trade_count": 2,
                        "trade_amount": 40000,
                        "start_time": "2026-01-21 01:26:16",
                        "end_time": "2026-01-21 01:26:16",
                        "trade_ids": "12",
                    },
                ]
            if params == (1, "W-1", 200):
                assert "payer_account_id IN" in sql
                assert "payer_pay_account IN" in sql
                return []
            if params == (35, "F-35", 200):
                if "payer_account_id IN" in sql:
                    return [
                        {
                            "payer_account_id": 35,
                            "payer_pay_account": "F-35",
                            "payer_account_name": "冯燕青",
                            "payee_account_id": 107,
                            "payee_pay_account": "G-107",
                            "payee_account_name": "冯光彩",
                            "trade_count": 1,
                            "trade_amount": 20000,
                            "start_time": "2026-01-14 03:46:33",
                            "end_time": "2026-01-14 03:46:33",
                            "trade_ids": "10",
                        },
                        {
                            "payer_account_id": 35,
                            "payer_pay_account": "F-35",
                            "payer_account_name": "冯燕青",
                            "payee_account_id": 1,
                            "payee_pay_account": "W-1",
                            "payee_account_name": "伍华中",
                            "trade_count": 2,
                            "trade_amount": 40000,
                            "start_time": "2026-01-21 01:26:16",
                            "end_time": "2026-01-21 01:26:16",
                            "trade_ids": "12",
                        },
                    ]
                return []
            return []

    client = StubClient()
    result = client.query_relation_one_hop(
        case_id=37,
        seed_accounts=[
            {"accountId": "1", "tradeCard": "W-1", "accountName": "伍华中", "suspectId": "1", "suspectName": "伍华中"},
            {"accountId": "35", "tradeCard": "F-35", "accountName": "冯燕青", "suspectId": "2", "suspectName": "冯燕青"},
        ],
        direction="both",
        filters={},
    )

    nodes = {node["id"]: node for node in result["nodes"]}
    edges = {edge["id"]: edge for edge in result["edges"]}

    assert nodes["subject:suspect:1"]["label"] == "伍华中"
    assert nodes["subject:suspect:1"]["accountIds"] == ["1"]
    assert nodes["subject:suspect:2"]["label"] == "冯燕青"
    assert nodes["subject:suspect:2"]["accountIds"] == ["35"]
    assert edges["money:subject:suspect:2->account:107"]["from"] == "subject:suspect:2"
    assert edges["money:account:9->subject:suspect:1"]["to"] == "subject:suspect:1"
    assert edges["money:subject:suspect:2->subject:suspect:1"]["tradeIds"] == ["12"]
    assert result["tradeFacts"]["12"]["serialNumber"] == "S-12"
    assert client.relation_query_params == [
        (1, "W-1", 200),
        (1, "W-1", 200),
        (35, "F-35", 200),
        (35, "F-35", 200),
    ]


def test_relation_seed_one_hop_applies_graph_drill_config() -> None:
    class StubClient(PyMySQLCaseGraphQueryClient):
        def __init__(self) -> None:
            super().__init__(CaseGraphMySQLConfig(host="", port=3306, user="", password="", database=""))
            self.last_sql = ""
            self.last_params: tuple[object, ...] = ()

        def _query(self, sql: str, params: tuple[object, ...]) -> list[dict[str, object]]:
            self.last_sql = sql
            self.last_params = params
            return []

    client = StubClient()
    client.query_relation_one_hop(
        case_id=37,
        seed_accounts=[{"accountId": "1", "tradeCard": "W-1", "accountName": "伍华中"}],
        direction="out",
        filters={"drillNums": 7, "drillType": 2},
    )

    assert "ORDER BY trade_count DESC, trade_amount DESC" in client.last_sql
    assert "LIMIT %s" in client.last_sql
    assert client.last_params[-1] == 7


def test_relation_seed_one_hop_limits_each_direction_for_single_seed() -> None:
    class StubClient(PyMySQLCaseGraphQueryClient):
        def __init__(self) -> None:
            super().__init__(CaseGraphMySQLConfig(host="", port=3306, user="", password="", database=""))
            self.calls: list[tuple[str, tuple[object, ...]]] = []

        def _query(self, sql: str, params: tuple[object, ...]) -> list[dict[str, object]]:
            self.calls.append((sql, params))
            return []

    client = StubClient()
    client.query_relation_one_hop(
        case_id=37,
        seed_accounts=[{"accountId": "1", "tradeCard": "W-1", "accountName": "伍华中"}],
        direction="both",
        filters={"drillNums": 10},
    )

    assert len(client.calls) == 2
    assert "payee_account_id IN" in client.calls[0][0]
    assert "payer_account_id IN" not in client.calls[0][0]
    assert client.calls[0][1] == (1, "W-1", 10)
    assert "payer_account_id IN" in client.calls[1][0]
    assert "payee_account_id IN" not in client.calls[1][0]
    assert client.calls[1][1] == (1, "W-1", 10)


def test_relation_seed_one_hop_can_run_without_limit_for_summary_candidates() -> None:
    class StubClient(PyMySQLCaseGraphQueryClient):
        def __init__(self) -> None:
            super().__init__(CaseGraphMySQLConfig(host="", port=3306, user="", password="", database=""))
            self.last_sql = ""
            self.last_params: tuple[object, ...] = ()

        def _query(self, sql: str, params: tuple[object, ...]) -> list[dict[str, object]]:
            self.last_sql = sql
            self.last_params = params
            return []

    client = StubClient()
    client.query_relation_one_hop(
        case_id=37,
        seed_accounts=[{"accountId": "1", "tradeCard": "W-1", "accountName": "伍华中"}],
        direction="both",
        filters={"_relationUnbounded": True},
    )

    assert "LIMIT %s" not in client.last_sql
    assert client.last_params == (1, "W-1")


def test_relation_global_candidates_uses_enriched_trade_info() -> None:
    class StubClient(PyMySQLCaseGraphQueryClient):
        def __init__(self) -> None:
            super().__init__(CaseGraphMySQLConfig(host="", port=3306, user="", password="", database=""))
            self.last_sql = ""
            self.last_params: tuple[object, ...] = ()

        def _query(self, sql: str, params: tuple[object, ...]) -> list[dict[str, object]]:
            self.last_sql = sql
            self.last_params = params
            return []

    client = StubClient()
    client.query_relation_global_candidates(case_id=37, filters={"minAmount": 1000})

    assert "FROM trade_info" in client.last_sql
    assert "LEFT JOIN ga_account_37" in client.last_sql
    assert "WHERE gt.data_flag = 0" in client.last_sql
    assert client.last_params == (1000.0, 1000.0)


def test_relation_service_persists_seed_one_hop_step(tmp_path: Path) -> None:
    class StubClient:
        def __init__(self) -> None:
            self.calls: list[dict[str, object]] = []

        def query_relation_one_hop(
            self,
            *,
            case_id: str,
            seed_accounts: list[dict[str, object]],
            direction: str,
            filters: dict[str, object],
        ) -> dict[str, object]:
            self.calls.append(
                {
                    "case_id": case_id,
                    "seed_accounts": seed_accounts,
                    "direction": direction,
                    "filters": filters,
                }
            )
            return {
                "nodes": [{"id": "subject:suspect:1"}, {"id": "account:35"}],
                "edges": [{"id": "money:subject:suspect:1->account:35"}],
            }

    client = StubClient()
    service = RelationGraphService(storage=RelationGraphStorage(tmp_path), query_client=client)
    result = service.query_seed_one_hop(
        {
            "caseId": "37",
            "graphId": "graph-1",
            "seeds": [
                {
                    "suspectId": "1",
                    "suspectName": "伍华中",
                    "accountIds": ["1", "2"],
                    "excludedAccountIds": ["2"],
                    "accounts": [
                        {"accountId": "1", "tradeCard": "W-1", "accountName": "伍华中"},
                        {"accountId": "2", "tradeCard": "W-2", "accountName": "伍华中"},
                    ],
                }
            ],
            "direction": "both",
            "filters": {"minAmount": 100},
            "drillNums": 5,
            "drillType": 2,
        }
    )

    assert client.calls == [
        {
            "case_id": "37",
            "seed_accounts": [
                {
                    "accountId": "1",
                    "tradeCard": "W-1",
                    "accountName": "伍华中",
                    "suspectId": "1",
                    "suspectName": "伍华中",
                }
            ],
            "direction": "both",
            "filters": {"minAmount": 100, "drillNums": 5, "drillType": 2, "limit": 5},
        }
    ]
    assert result["schemaVersion"] == "case-graph.relation.v1"
    assert result["step"]["type"] == "seed_one_hop"
    assert result["graph"]["nodes"][0]["id"] == "subject:suspect:1"
    assert result["graph"]["drillNums"] == 5
    assert result["graph"]["drillType"] == 2
    assert (tmp_path / ".nanobot_channel_webui" / "case_graphs" / "37" / "graph-1" / "graph.json").exists()


def test_relation_service_syncs_only_snapshot_metadata_after_seed_query(tmp_path: Path) -> None:
    class StubSnapshotStorage:
        def __init__(self) -> None:
            self.patch: dict[str, object] | None = None

        def update_graph(self, graph_id: str, patch: dict[str, object]) -> dict[str, object]:
            assert graph_id == "graph-1"
            self.patch = patch
            return patch

    class StubClient:
        def query_relation_one_hop(
            self,
            *,
            case_id: str,
            seed_accounts: list[dict[str, object]],
            direction: str,
            filters: dict[str, object],
        ) -> dict[str, object]:
            return {
                "nodes": [{"id": "subject:suspect:1"}],
                "edges": [{"id": "money:subject:suspect:1->account:35"}],
            }

    snapshot_storage = StubSnapshotStorage()
    service = RelationGraphService(
        workspace_root=tmp_path,
        query_client=StubClient(),
        snapshot_storage=snapshot_storage,
    )
    service.query_seed_one_hop(
        {
            "caseId": "37",
            "graphId": "graph-1",
            "seeds": [
                {
                    "suspectId": "1",
                    "suspectName": "伍华中",
                    "accountIds": ["1"],
                    "accounts": [{"accountId": "1", "tradeCard": "W-1", "accountName": "伍华中"}],
                }
            ],
        }
    )

    assert snapshot_storage.patch is not None
    assert "graphData" not in snapshot_storage.patch
    assert snapshot_storage.patch["tradeCards"] == [
        {
            "accountId": "1",
            "tradeCard": "W-1",
            "accountName": "伍华中",
            "suspectId": "1",
            "suspectName": "伍华中",
        }
    ]


def test_relation_complete_queries_current_graph_internal_relations() -> None:
    class StubClient(PyMySQLCaseGraphQueryClient):
        def _query(self, sql: str, params: tuple[object, ...]) -> list[dict[str, object]]:
            if "GROUP_CONCAT" not in sql:
                assert "WHERE id IN" in sql
                assert "FROM trade_info" in sql
                assert params == ("20", "21")
                return [
                    {"id": 20, "serial_number": "S-20", "trade_amount": 10000, "trade_time": "2026-01-14 03:46:33"},
                    {"id": 21, "serial_number": "S-21", "trade_amount": 30000, "trade_time": "2026-01-14 03:46:34"},
                ]
            assert "payer_account_id IN" in sql
            assert "payee_account_id IN" in sql
            assert "FROM trade_info" in sql
            assert "WHERE gt.data_flag = 0" in sql
            assert params == (1, 35, 1, 35)
            return [
                {
                    "payer_account_id": 35,
                    "payer_pay_account": "P-35",
                    "payer_account_name": "冯燕青",
                    "payee_account_id": 1,
                    "payee_pay_account": "W-1",
                    "payee_account_name": "伍华中",
                    "trade_count": 2,
                    "trade_amount": 40000,
                    "start_time": "2026-01-14 03:46:33",
                    "end_time": "2026-01-14 03:46:34",
                    "trade_ids": "20,21",
                }
            ]

    client = StubClient(CaseGraphMySQLConfig(host="", port=3306, user="", password="", database=""))
    result = client.query_relation_between_accounts(
        case_id=37,
        accounts=[
            {"accountId": "1", "tradeCard": "W-1", "accountName": "伍华中"},
            {"accountId": "35", "tradeCard": "P-35", "accountName": "冯燕青"},
        ],
        filters={},
    )

    assert result["nodes"][0]["id"] == "account:35"
    assert result["edges"][0]["scope"] == "graph_internal"
    assert result["tradeFacts"]["20"]["serialNumber"] == "S-20"


def test_relation_between_accounts_can_run_without_limit_for_summary_selection() -> None:
    class StubClient(PyMySQLCaseGraphQueryClient):
        def __init__(self) -> None:
            super().__init__(CaseGraphMySQLConfig(host="", port=3306, user="", password="", database=""))
            self.last_sql = ""
            self.last_params: tuple[object, ...] = ()

        def _query(self, sql: str, params: tuple[object, ...]) -> list[dict[str, object]]:
            self.last_sql = sql
            self.last_params = params
            return []

    client = StubClient()
    client.query_relation_between_accounts(
        case_id=37,
        accounts=[
            {"accountId": "1", "tradeCard": "W-1", "accountName": "伍华中"},
            {"accountId": "35", "tradeCard": "P-35", "accountName": "冯燕青"},
        ],
        filters={"_relationUnbounded": True},
    )

    assert "LIMIT 500" not in client.last_sql
    assert client.last_params == (1, 35, 1, 35)


def test_relation_service_complete_persists_internal_relation_step(tmp_path: Path) -> None:
    class StubClient:
        def query_relation_one_hop(
            self,
            *,
            case_id: str,
            seed_accounts: list[dict[str, object]],
            direction: str,
            filters: dict[str, object],
        ) -> dict[str, object]:
            return {"nodes": [], "edges": []}

        def query_relation_between_accounts(
            self,
            *,
            case_id: str,
            accounts: list[dict[str, object]],
            filters: dict[str, object],
        ) -> dict[str, object]:
            assert accounts == [
                {"accountId": "1", "tradeCard": "W-1", "accountName": "伍华中"},
                {"accountId": "35", "tradeCard": "P-35", "accountName": "冯燕青"},
            ]
            return {
                "nodes": [{"id": "account:35"}, {"id": "account:1"}],
                "edges": [{"id": "money:account:35->account:1", "scope": "graph_internal"}],
            }

    service = RelationGraphService(storage=RelationGraphStorage(tmp_path), query_client=StubClient())
    result = service.complete_current_graph(
        {
            "caseId": "37",
            "graphId": "graph-1",
            "accounts": [
                {"accountId": "1", "tradeCard": "W-1", "accountName": "伍华中"},
                {"accountId": "35", "tradeCard": "P-35", "accountName": "冯燕青"},
            ],
            "filters": {},
        }
    )

    assert result["queryMode"] == "complete_current_graph"
    assert result["step"]["stepId"] == "0001"
    assert result["delta"]["addedEdges"][0]["scope"] == "graph_internal"


def test_relation_service_complete_reuses_subject_node_for_seed_accounts(tmp_path: Path) -> None:
    class StubClient:
        def query_relation_one_hop(
            self,
            *,
            case_id: str,
            seed_accounts: list[dict[str, object]],
            direction: str,
            filters: dict[str, object],
        ) -> dict[str, object]:
            return {"nodes": [], "edges": []}

        def query_relation_between_accounts(
            self,
            *,
            case_id: str,
            accounts: list[dict[str, object]],
            filters: dict[str, object],
        ) -> dict[str, object]:
            return {
                "nodes": [
                    {"id": "account:35", "accountId": "35", "label": "冯燕青"},
                    {"id": "account:1", "accountId": "1", "label": "伍华中"},
                ],
                "edges": [{"id": "money:account:35->account:1", "from": "account:35", "to": "account:1", "scope": "graph_internal"}],
            }

    storage = RelationGraphStorage(tmp_path)
    storage.save_step(
        case_id="37",
        graph_id="graph-1",
        step_type="seed_one_hop",
        request={"caseId": "37"},
        graph={
            "nodes": [
                {
                    "id": "subject:suspect:1",
                    "type": "subject",
                    "label": "伍华中",
                    "accounts": [
                        {"accountId": "1", "tradeCard": "W-1", "accountName": "伍华中"},
                        {"accountId": "3", "tradeCard": "W-3", "accountName": "伍华中"},
                    ],
                },
                {"id": "account:35", "accountId": "35", "label": "冯燕青"},
            ],
            "edges": [{"id": "money:account:35->subject:suspect:1", "from": "account:35", "to": "subject:suspect:1"}],
        },
        delta={"addedNodes": [], "addedEdges": [], "updatedNodes": [], "updatedEdges": []},
        summary={},
    )

    service = RelationGraphService(storage=storage, query_client=StubClient())
    result = service.complete_current_graph(
        {
            "caseId": "37",
            "graphId": "graph-1",
            "accounts": [
                {"accountId": "1", "tradeCard": "W-1", "accountName": "伍华中"},
                {"accountId": "35", "tradeCard": "P-35", "accountName": "冯燕青"},
            ],
        }
    )

    node_ids = [node["id"] for node in result["graph"]["nodes"]]
    assert "subject:suspect:1" in node_ids
    assert "account:1" not in node_ids
    assert result["graph"]["edges"][0]["to"] == "subject:suspect:1"


def test_relation_service_seed_query_reuses_existing_account_node_when_counterparty_becomes_seed(tmp_path: Path) -> None:
    class StubClient:
        def query_relation_one_hop(
            self,
            *,
            case_id: str,
            seed_accounts: list[dict[str, object]],
            direction: str,
            filters: dict[str, object],
        ) -> dict[str, object]:
            return {
                "nodes": [
                    {
                        "id": "subject:冯燕青",
                        "type": "subject",
                        "role": "seed",
                        "label": "冯燕青",
                        "accountIds": ["35"],
                        "accounts": [{"accountId": "35", "tradeCard": "P-35", "accountName": "冯燕青"}],
                    },
                    {"id": "account:1", "accountId": "1", "tradeCard": "W-1", "label": "伍华中"},
                ],
                "edges": [
                    {
                        "id": "money:subject:冯燕青->account:1",
                        "from": "subject:冯燕青",
                        "to": "account:1",
                        "source": "subject:冯燕青",
                        "target": "account:1",
                    }
                ],
            }

        def query_relation_between_accounts(
            self,
            *,
            case_id: str,
            accounts: list[dict[str, object]],
            filters: dict[str, object],
        ) -> dict[str, object]:
            return {"nodes": [], "edges": []}

    storage = RelationGraphStorage(tmp_path)
    storage.save_step(
        case_id="37",
        graph_id="graph-1",
        step_type="seed_one_hop",
        request={"caseId": "37"},
        graph={
            "nodes": [
                {
                    "id": "subject:suspect:1",
                    "type": "subject",
                    "label": "伍华中",
                    "accounts": [{"accountId": "1", "tradeCard": "W-1", "accountName": "伍华中"}],
                },
                {
                    "id": "account:35",
                    "type": "account",
                    "accountId": "35",
                    "tradeCard": "P-35",
                    "accountName": "冯燕青",
                    "label": "冯燕青",
                    "accounts": [{"accountId": "35", "tradeCard": "P-35", "accountName": "冯燕青"}],
                },
            ],
            "edges": [
                {
                    "id": "money:account:35->subject:suspect:1",
                    "from": "account:35",
                    "to": "subject:suspect:1",
                    "source": "account:35",
                    "target": "subject:suspect:1",
                }
            ],
        },
        delta={"addedNodes": [], "addedEdges": [], "updatedNodes": [], "updatedEdges": []},
        summary={},
    )

    service = RelationGraphService(storage=storage, query_client=StubClient())
    result = service.query_seed_one_hop(
        {
            "caseId": "37",
            "graphId": "graph-1",
            "seeds": [
                {
                    "suspectName": "冯燕青",
                    "accountIds": ["35"],
                    "accounts": [{"accountId": "35", "tradeCard": "P-35", "accountName": "冯燕青"}],
                }
            ],
        }
    )

    node_ids = [node["id"] for node in result["graph"]["nodes"]]
    assert "account:35" in node_ids
    assert "subject:冯燕青" not in node_ids
    assert result["graph"]["edges"][0]["from"] == "account:35"


def test_relation_service_seed_query_adds_missing_edge_to_existing_graph_node_for_any_direction(tmp_path: Path) -> None:
    class StubClient:
        def __init__(self) -> None:
            self.one_hop_directions: list[str] = []
            self.internal_relation_accounts: list[dict[str, object]] | None = None

        def query_relation_one_hop(
            self,
            *,
            case_id: str,
            seed_accounts: list[dict[str, object]],
            direction: str,
            filters: dict[str, object],
        ) -> dict[str, object]:
            self.one_hop_directions.append(direction)
            return {
                "nodes": [
                    {
                        "id": "subject:冯光彩",
                        "type": "subject",
                        "role": "seed",
                        "label": "冯光彩",
                        "accountIds": ["107"],
                        "accounts": [{"accountId": "107", "tradeCard": "G-107", "accountName": "冯光彩"}],
                    },
                    {
                        "id": "account:35",
                        "type": "account",
                        "accountId": "35",
                        "tradeCard": "P-35",
                        "label": "冯燕青",
                    },
                ],
                "edges": [
                    {
                        "id": "money:account:35->subject:冯光彩",
                        "from": "account:35",
                        "to": "subject:冯光彩",
                        "source": "account:35",
                        "target": "subject:冯光彩",
                        "tradeAmount": 166100,
                    }
                ],
            }

        def query_relation_between_accounts(
            self,
            *,
            case_id: str,
            accounts: list[dict[str, object]],
            filters: dict[str, object],
        ) -> dict[str, object]:
            self.internal_relation_accounts = accounts
            return {
                "nodes": [
                    {
                        "id": "account:107",
                        "type": "account",
                        "accountId": "107",
                        "tradeCard": "G-107",
                        "label": "冯光彩",
                    },
                    {
                        "id": "account:35",
                        "type": "account",
                        "accountId": "35",
                        "tradeCard": "P-35",
                        "label": "冯燕青",
                    },
                    {
                        "id": "account:999",
                        "type": "account",
                        "accountId": "999",
                        "tradeCard": "X-999",
                        "label": "不在图上的交易对手",
                    },
                ],
                "edges": [
                    {
                        "id": "money:account:107->account:35",
                        "from": "account:107",
                        "to": "account:35",
                        "source": "account:107",
                        "target": "account:35",
                        "scope": "graph_internal",
                        "tradeAmount": 20000,
                    },
                    {
                        "id": "money:account:107->account:999",
                        "from": "account:107",
                        "to": "account:999",
                        "source": "account:107",
                        "target": "account:999",
                        "scope": "graph_internal",
                        "tradeAmount": 999,
                    },
                ],
            }

    storage = RelationGraphStorage(tmp_path)
    storage.save_step(
        case_id="37",
        graph_id="graph-1",
        step_type="seed_one_hop",
        request={"caseId": "37"},
        graph={
            "nodes": [
                {
                    "id": "account:107",
                    "type": "account",
                    "accountId": "107",
                    "tradeCard": "G-107",
                    "accountName": "冯光彩",
                    "label": "冯光彩",
                    "accounts": [{"accountId": "107", "tradeCard": "G-107", "accountName": "冯光彩"}],
                },
                {
                    "id": "account:35",
                    "type": "account",
                    "accountId": "35",
                    "tradeCard": "P-35",
                    "accountName": "冯燕青",
                    "label": "冯燕青",
                    "accounts": [{"accountId": "35", "tradeCard": "P-35", "accountName": "冯燕青"}],
                },
            ],
            "edges": [
                {
                    "id": "money:account:35->account:107",
                    "from": "account:35",
                    "to": "account:107",
                    "source": "account:35",
                    "target": "account:107",
                }
            ],
        },
        delta={"addedNodes": [], "addedEdges": [], "updatedNodes": [], "updatedEdges": []},
        summary={},
    )

    client = StubClient()
    service = RelationGraphService(storage=storage, query_client=client)
    result: dict[str, object] = {}
    for direction in ("in", "out", "both"):
        result = service.query_seed_one_hop(
            {
                "caseId": "37",
                "graphId": "graph-1",
                "seeds": [
                    {
                        "suspectName": "冯光彩",
                        "accountIds": ["107"],
                        "accounts": [{"accountId": "107", "tradeCard": "G-107", "accountName": "冯光彩"}],
                    }
                ],
                "direction": direction,
            }
        )

    edge_ids = {edge["id"] for edge in result["graph"]["edges"]}
    node_ids = {node["id"] for node in result["graph"]["nodes"]}
    assert edge_ids == {"money:account:35->account:107", "money:account:107->account:35"}
    assert "account:999" not in node_ids
    assert result["delta"]["addedEdges"] == []
    assert client.one_hop_directions == ["in", "out", "both"]
    assert client.internal_relation_accounts == [
        {"accountId": "107", "tradeCard": "G-107", "accountName": "冯光彩", "suspectId": "", "suspectName": "冯光彩"},
        {"accountId": "35", "tradeCard": "P-35", "accountName": "冯燕青"},
    ]


def test_relation_service_seed_query_persists_cumulative_graph_across_steps(tmp_path: Path) -> None:
    class StubClient:
        def __init__(self) -> None:
            self.calls = 0

        def query_relation_one_hop(
            self,
            *,
            case_id: str,
            seed_accounts: list[dict[str, object]],
            direction: str,
            filters: dict[str, object],
        ) -> dict[str, object]:
            self.calls += 1
            if self.calls == 1:
                return {
                    "nodes": [
                        {
                            "id": "subject:suspect:1",
                            "type": "subject",
                            "label": "伍华中",
                            "accounts": [{"accountId": "1", "tradeCard": "W-1", "accountName": "伍华中"}],
                            "x": 100,
                            "y": 120,
                        },
                        {"id": "account:35", "accountId": "35", "tradeCard": "P-35", "label": "冯燕青", "x": 360, "y": 120},
                    ],
                    "edges": [
                        {"id": "money:account:35->subject:suspect:1", "from": "account:35", "to": "subject:suspect:1"}
                    ],
                }
            return {
                "nodes": [
                    {
                        "id": "subject:冯燕青",
                        "type": "subject",
                        "label": "冯燕青",
                        "accountIds": ["35"],
                        "accounts": [{"accountId": "35", "tradeCard": "P-35", "accountName": "冯燕青"}],
                    },
                    {"id": "account:88", "accountId": "88", "tradeCard": "Z-88", "label": "张三"},
                ],
                "edges": [{"id": "money:subject:冯燕青->account:88", "from": "subject:冯燕青", "to": "account:88"}],
            }

        def query_relation_between_accounts(
            self,
            *,
            case_id: str,
            accounts: list[dict[str, object]],
            filters: dict[str, object],
        ) -> dict[str, object]:
            return {"nodes": [], "edges": []}

    storage = RelationGraphStorage(tmp_path)
    service = RelationGraphService(storage=storage, query_client=StubClient())
    service.query_seed_one_hop(
        {
            "caseId": "37",
            "graphId": "graph-1",
            "seeds": [
                {
                    "suspectId": "1",
                    "suspectName": "伍华中",
                    "accountIds": ["1"],
                    "accounts": [{"accountId": "1", "tradeCard": "W-1", "accountName": "伍华中"}],
                }
            ],
        }
    )
    result = service.query_seed_one_hop(
        {
            "caseId": "37",
            "graphId": "graph-1",
            "seeds": [
                {
                    "suspectName": "冯燕青",
                    "accountIds": ["35"],
                    "accounts": [{"accountId": "35", "tradeCard": "P-35", "accountName": "冯燕青"}],
                }
            ],
        }
    )

    graph = storage.load_graph("37", "graph-1")
    node_ids = {node["id"] for node in graph["nodes"]}
    edge_ids = {edge["id"] for edge in graph["edges"]}
    assert node_ids == {"subject:suspect:1", "account:35", "account:88"}
    assert "subject:冯燕青" not in node_ids
    assert edge_ids == {"money:account:35->subject:suspect:1", "money:account:35->account:88"}
    assert result["graph"] == graph
    assert graph["nodes"][0]["x"] == 100


def test_relation_service_seed_query_preserves_client_node_positions(tmp_path: Path) -> None:
    class StubClient:
        def query_relation_one_hop(
            self,
            *,
            case_id: str,
            seed_accounts: list[dict[str, object]],
            direction: str,
            filters: dict[str, object],
        ) -> dict[str, object]:
            return {
                "nodes": [
                    {
                        "id": "subject:冯燕青",
                        "type": "subject",
                        "label": "冯燕青",
                        "accountIds": ["35"],
                        "accounts": [{"accountId": "35", "tradeCard": "P-35", "accountName": "冯燕青"}],
                    },
                    {"id": "account:88", "accountId": "88", "tradeCard": "Z-88", "label": "张三"},
                ],
                "edges": [{"id": "money:subject:冯燕青->account:88", "from": "subject:冯燕青", "to": "account:88"}],
            }

        def query_relation_between_accounts(
            self,
            *,
            case_id: str,
            accounts: list[dict[str, object]],
            filters: dict[str, object],
        ) -> dict[str, object]:
            return {"nodes": [], "edges": []}

    storage = RelationGraphStorage(tmp_path)
    storage.save_step(
        case_id="37",
        graph_id="graph-1",
        step_type="seed_one_hop",
        request={"caseId": "37"},
        graph={
            "nodes": [
                {
                    "id": "subject:suspect:1",
                    "type": "subject",
                    "label": "伍华中",
                    "accounts": [{"accountId": "1", "tradeCard": "W-1", "accountName": "伍华中"}],
                },
                {
                    "id": "account:35",
                    "type": "account",
                    "accountId": "35",
                    "tradeCard": "P-35",
                    "label": "冯燕青",
                    "accounts": [{"accountId": "35", "tradeCard": "P-35", "accountName": "冯燕青"}],
                },
            ],
            "edges": [{"id": "money:account:35->subject:suspect:1", "from": "account:35", "to": "subject:suspect:1"}],
        },
        delta={"addedNodes": [], "addedEdges": [], "updatedNodes": [], "updatedEdges": []},
        summary={},
    )
    service = RelationGraphService(storage=storage, query_client=StubClient())
    result = service.query_seed_one_hop(
        {
            "caseId": "37",
            "graphId": "graph-1",
            "seeds": [
                {
                    "suspectName": "冯燕青",
                    "accountIds": ["35"],
                    "accounts": [{"accountId": "35", "tradeCard": "P-35", "accountName": "冯燕青"}],
                }
            ],
            "options": {
                "nodePositions": {
                    "subject:suspect:1": {"x": 320, "y": 240},
                    "account:35": {"x": 560, "y": 240},
                }
            },
        }
    )

    assert result["graph"]["nodes"][0]["x"] == 320
    assert result["graph"]["nodes"][0]["y"] == 240
    assert result["graph"]["nodes"][1]["x"] == 560
    assert result["graph"]["nodes"][1]["y"] == 240


def test_relation_service_complete_preserves_manual_exclusions(tmp_path: Path) -> None:
    class StubClient:
        def __init__(self) -> None:
            self.calls: list[dict[str, object]] = []

        def query_relation_one_hop(
            self,
            *,
            case_id: str,
            seed_accounts: list[dict[str, object]],
            direction: str,
            filters: dict[str, object],
        ) -> dict[str, object]:
            return {"nodes": [], "edges": []}

        def query_relation_between_accounts(
            self,
            *,
            case_id: str,
            accounts: list[dict[str, object]],
            filters: dict[str, object],
        ) -> dict[str, object]:
            self.calls.append({"case_id": case_id, "accounts": accounts, "filters": filters})
            return {
                "nodes": [
                    {
                        "id": "subject:suspect:1",
                        "type": "subject",
                        "label": "伍华中",
                        "accounts": [{"accountId": "1", "tradeCard": "W-1", "accountName": "伍华中"}],
                    }
                ],
                "edges": [],
            }

    storage = RelationGraphStorage(tmp_path)
    storage.save_step(
        case_id="37",
        graph_id="graph-1",
        step_type="seed_one_hop",
        request={"caseId": "37"},
        graph={
            "nodes": [
                {
                    "id": "subject:suspect:1",
                    "type": "subject",
                    "label": "伍华中",
                    "accounts": [{"accountId": "1", "tradeCard": "W-1", "accountName": "伍华中"}],
                },
                {"id": "account:35", "accountId": "35", "tradeCard": "P-35", "accountName": "冯燕青"},
            ],
            "edges": [{"id": "money:account:35->subject:suspect:1", "from": "account:35", "to": "subject:suspect:1"}],
        },
        delta={"addedNodes": [], "addedEdges": [], "updatedNodes": [], "updatedEdges": []},
        summary={},
    )
    client = StubClient()
    service = RelationGraphService(storage=storage, query_client=client)
    service.exclude_node(
        {
            "caseId": "37",
            "graphId": "graph-1",
            "node": {"nodeId": "account:35", "label": "冯燕青", "type": "account", "accountIds": ["35"]},
        }
    )

    result = service.complete_current_graph(
        {
            "caseId": "37",
            "graphId": "graph-1",
            "accounts": [
                {"accountId": "1", "tradeCard": "W-1", "accountName": "伍华中"},
                {"accountId": "35", "tradeCard": "P-35", "accountName": "冯燕青"},
            ],
        }
    )

    assert client.calls == [
        {
            "case_id": "37",
            "accounts": [{"accountId": "1", "tradeCard": "W-1", "accountName": "伍华中"}],
            "filters": {},
        }
    ]
    assert result["queryMode"] == "complete_current_graph"
    assert result["step"]["summary"]["excludedNodeCount"] == 1
    assert result["graph"]["excludedNodes"][0]["nodeId"] == "account:35"
    excluded_node = next(node for node in result["graph"]["nodes"] if node["id"] == "account:35")
    assert excluded_node["isExcluded"] is True


def test_relation_service_filter_current_graph_persists_filter_step(tmp_path: Path) -> None:
    class StubClient:
        def __init__(self) -> None:
            self.calls: list[dict[str, object]] = []

        def query_relation_one_hop(
            self,
            *,
            case_id: str,
            seed_accounts: list[dict[str, object]],
            direction: str,
            filters: dict[str, object],
        ) -> dict[str, object]:
            return {"nodes": [], "edges": []}

        def query_relation_between_accounts(
            self,
            *,
            case_id: str,
            accounts: list[dict[str, object]],
            filters: dict[str, object],
        ) -> dict[str, object]:
            self.calls.append({"case_id": case_id, "accounts": accounts, "filters": filters})
            raise AssertionError("full-graph filtering must use persisted trade facts")

    storage = RelationGraphStorage(tmp_path)
    storage.save_step(
        case_id="37",
        graph_id="graph-1",
        step_type="seed_one_hop",
        request={"caseId": "37"},
        graph={
            "nodes": [
                {
                    "id": "subject:suspect:1",
                    "type": "subject",
                    "label": "伍华中",
                    "accounts": [{"accountId": "1", "tradeCard": "W-1", "accountName": "伍华中"}],
                },
                {"id": "account:35", "accountId": "35", "tradeCard": "P-35", "accountName": "冯燕青"},
            ],
            "edges": [
                {
                    "id": "money:account:35->subject:suspect:1",
                    "from": "account:35",
                    "to": "subject:suspect:1",
                    "tradeIds": ["1", "2", "3"],
                    "tradeAmount": 85000,
                    "tradeCount": 3,
                }
            ],
            "tradeFacts": {
                "1": {"tradeId": "1", "tradeAmount": 5000, "tradeTime": "2026-01-01 10:00:00"},
                "2": {"tradeId": "2", "tradeAmount": 20000, "tradeTime": "2026-01-10 10:00:00"},
                "3": {"tradeId": "3", "tradeAmount": 60000, "tradeTime": "2026-02-01 10:00:00"},
            },
        },
        delta={"addedNodes": [], "addedEdges": [], "updatedNodes": [], "updatedEdges": []},
        summary={},
    )

    client = StubClient()
    service = RelationGraphService(storage=storage, query_client=client)
    result = service.filter_current_graph(
        {
            "caseId": "37",
            "graphId": "graph-1",
            "filters": {
                "minAmount": 10000,
                "maxAmount": 50000,
                "startTime": "2026-01-01 00:00:00",
                "endTime": "2026-01-31 23:59:59",
            },
        }
    )

    assert client.calls == []
    assert result["queryMode"] == "filter_current_graph"
    assert result["step"]["stepId"] == "0002"
    assert result["step"]["summary"]["label"] == "全图筛选"
    assert result["step"]["summary"]["filterCount"] == 4
    assert result["graph"]["edges"][0]["tradeAmount"] == 20000
    assert result["graph"]["edges"][0]["tradeCount"] == 1
    assert result["graph"]["edges"][0]["tradeIds"] == ["2"]


def test_relation_service_filter_removes_nodes_without_filtered_edges(tmp_path: Path) -> None:
    class StubClient:
        def query_relation_one_hop(
            self,
            *,
            case_id: str,
            seed_accounts: list[dict[str, object]],
            direction: str,
            filters: dict[str, object],
        ) -> dict[str, object]:
            return {"nodes": [], "edges": []}

        def query_relation_between_accounts(
            self,
            *,
            case_id: str,
            accounts: list[dict[str, object]],
            filters: dict[str, object],
        ) -> dict[str, object]:
            raise AssertionError("full-graph filtering must use persisted trade facts")

    storage = RelationGraphStorage(tmp_path)
    storage.save_step(
        case_id="37",
        graph_id="graph-1",
        step_type="seed_one_hop",
        request={"caseId": "37"},
        graph={
            "nodes": [
                {"id": "account:1", "accountId": "1", "tradeCard": "W-1", "label": "伍华中", "x": 100, "y": 100},
                {"id": "account:35", "accountId": "35", "tradeCard": "P-35", "label": "冯燕青", "x": 300, "y": 100},
                {"id": "account:136", "accountId": "136", "tradeCard": "P-136", "label": "账号 136", "x": 300, "y": 300},
                {"id": "account:140", "accountId": "140", "tradeCard": "P-140", "label": "账号 140", "x": 300, "y": 500},
            ],
            "edges": [
                {"id": "money:account:35->account:1", "from": "account:35", "to": "account:1", "tradeIds": ["1"]},
                {"id": "money:account:136->account:1", "from": "account:136", "to": "account:1", "tradeIds": ["2"]},
                {"id": "money:account:140->account:1", "from": "account:140", "to": "account:1", "tradeIds": ["3"]},
            ],
            "tradeFacts": {
                "1": {"tradeId": "1", "tradeAmount": 15000, "tradeTime": "2026-01-01 10:00:00"},
                "2": {"tradeId": "2", "tradeAmount": 9000, "tradeTime": "2026-01-01 10:00:00"},
                "3": {"tradeId": "3", "tradeAmount": 100, "tradeTime": "2026-01-01 10:00:00"},
            },
        },
        delta={"addedNodes": [], "addedEdges": [], "updatedNodes": [], "updatedEdges": []},
        summary={},
    )

    service = RelationGraphService(storage=storage, query_client=StubClient())
    result = service.filter_current_graph(
        {
            "caseId": "37",
            "graphId": "graph-1",
            "filters": {"minAmount": 10000},
            "options": {
                "nodePositions": {
                    "account:1": {"x": 100, "y": 100},
                    "account:35": {"x": 300, "y": 100},
                    "account:136": {"x": 300, "y": 300},
                    "account:140": {"x": 300, "y": 500},
                }
            },
        }
    )

    assert {node["id"] for node in result["graph"]["nodes"]} == {"account:1", "account:35"}
    assert result["graphState"]["graph"]["layout"]["nodePositions"] == {
        "account:1": {"x": 100.0, "y": 100.0},
        "account:35": {"x": 300.0, "y": 100.0},
    }


def test_relation_service_filter_does_not_add_edges_between_existing_counterparties(tmp_path: Path) -> None:
    class StubClient:
        def query_relation_one_hop(
            self,
            *,
            case_id: str,
            seed_accounts: list[dict[str, object]],
            direction: str,
            filters: dict[str, object],
        ) -> dict[str, object]:
            return {"nodes": [], "edges": []}

        def query_relation_between_accounts(
            self,
            *,
            case_id: str,
            accounts: list[dict[str, object]],
            filters: dict[str, object],
        ) -> dict[str, object]:
            raise AssertionError("full-graph filtering must use persisted trade facts")

    storage = RelationGraphStorage(tmp_path)
    storage.save_step(
        case_id="37",
        graph_id="graph-1",
        step_type="seed_one_hop",
        request={"caseId": "37"},
        graph={
            "nodes": [
                {
                    "id": "subject:suspect:1",
                    "type": "subject",
                    "label": "伍华中",
                    "accounts": [{"accountId": "1", "tradeCard": "W-1", "accountName": "伍华中"}],
                },
                {"id": "account:35", "accountId": "35", "tradeCard": "P-35", "label": "冯燕青"},
                {"id": "account:9", "accountId": "9", "tradeCard": "P-9", "label": "蔡召东"},
            ],
            "edges": [
                {
                    "id": "money:account:35->subject:suspect:1",
                    "from": "account:35",
                    "to": "subject:suspect:1",
                    "tradeIds": ["1"],
                },
                {
                    "id": "money:subject:suspect:1->account:9",
                    "from": "subject:suspect:1",
                    "to": "account:9",
                    "tradeIds": ["2"],
                },
            ],
            "tradeFacts": {
                "1": {"tradeId": "1", "tradeAmount": 40000, "tradeTime": "2026-01-01 10:00:00"},
                "2": {"tradeId": "2", "tradeAmount": 500, "tradeTime": "2026-01-01 10:00:00"},
            },
        },
        delta={"addedNodes": [], "addedEdges": [], "updatedNodes": [], "updatedEdges": []},
        summary={},
    )

    service = RelationGraphService(storage=storage, query_client=StubClient())
    result = service.filter_current_graph(
        {
            "caseId": "37",
            "graphId": "graph-1",
            "filters": {"minAmount": 1000},
        }
    )

    assert {edge["id"] for edge in result["graph"]["edges"]} == {
        "money:account:35->subject:suspect:1",
    }
    assert "account:9" not in {node["id"] for node in result["graph"]["nodes"]}


def test_relation_service_filter_preserves_retained_node_positions(tmp_path: Path) -> None:
    class StubClient:
        def query_relation_one_hop(
            self,
            *,
            case_id: str,
            seed_accounts: list[dict[str, object]],
            direction: str,
            filters: dict[str, object],
        ) -> dict[str, object]:
            return {"nodes": [], "edges": []}

        def query_relation_between_accounts(
            self,
            *,
            case_id: str,
            accounts: list[dict[str, object]],
            filters: dict[str, object],
        ) -> dict[str, object]:
            raise AssertionError("full-graph filtering must use persisted trade facts")

    storage = RelationGraphStorage(tmp_path)
    storage.save_step(
        case_id="37",
        graph_id="graph-1",
        step_type="seed_one_hop",
        request={"caseId": "37"},
        graph={
            "nodes": [
                {"id": "account:1", "accountId": "1", "tradeCard": "W-1", "label": "伍华中", "x": 580, "y": 68},
                {"id": "account:35", "accountId": "35", "tradeCard": "P-35", "label": "冯燕青", "x": 206, "y": 68},
                {"id": "account:32", "accountId": "32", "tradeCard": "P-32", "label": "赵引", "x": 954, "y": 17612},
                {"id": "account:229", "accountId": "229", "tradeCard": "P-229", "label": "冯多", "x": 954, "y": 928},
            ],
            "edges": [
                {"id": "money:account:35->account:1", "from": "account:35", "to": "account:1", "tradeIds": ["1"]},
                {"id": "money:account:32->account:1", "from": "account:32", "to": "account:1", "tradeIds": ["2"]},
                {"id": "money:account:1->account:229", "from": "account:1", "to": "account:229", "tradeIds": ["3"]},
            ],
            "tradeFacts": {
                "1": {"tradeId": "1", "tradeAmount": 15000, "tradeTime": "2026-01-01 10:00:00"},
                "2": {"tradeId": "2", "tradeAmount": 25000, "tradeTime": "2026-01-01 10:00:00"},
                "3": {"tradeId": "3", "tradeAmount": 35000, "tradeTime": "2026-01-01 10:00:00"},
            },
        },
        delta={"addedNodes": [], "addedEdges": [], "updatedNodes": [], "updatedEdges": []},
        summary={},
    )

    service = RelationGraphService(storage=storage, query_client=StubClient())
    result = service.filter_current_graph(
        {
            "caseId": "37",
            "graphId": "graph-1",
            "filters": {"minAmount": 10000},
            "options": {
                "nodePositions": {
                    "account:1": {"x": 580, "y": 68},
                    "account:35": {"x": 206, "y": 68},
                    "account:32": {"x": 954, "y": 17612},
                    "account:229": {"x": 954, "y": 928},
                }
            },
        }
    )

    assert result["graphState"]["graph"]["layout"]["nodePositions"] == {
        "account:1": {"x": 580.0, "y": 68.0},
        "account:35": {"x": 206.0, "y": 68.0},
        "account:32": {"x": 954.0, "y": 17612.0},
        "account:229": {"x": 954.0, "y": 928.0},
    }


def test_relation_service_filter_preserves_manual_exclusions(tmp_path: Path) -> None:
    class StubClient:
        def __init__(self) -> None:
            self.calls: list[dict[str, object]] = []

        def query_relation_one_hop(
            self,
            *,
            case_id: str,
            seed_accounts: list[dict[str, object]],
            direction: str,
            filters: dict[str, object],
        ) -> dict[str, object]:
            return {"nodes": [], "edges": []}

        def query_relation_between_accounts(
            self,
            *,
            case_id: str,
            accounts: list[dict[str, object]],
            filters: dict[str, object],
        ) -> dict[str, object]:
            self.calls.append({"case_id": case_id, "accounts": accounts, "filters": filters})
            raise AssertionError("full-graph filtering must use persisted trade facts")

    storage = RelationGraphStorage(tmp_path)
    storage.save_step(
        case_id="37",
        graph_id="graph-1",
        step_type="seed_one_hop",
        request={"caseId": "37"},
        graph={
            "nodes": [
                {
                    "id": "subject:suspect:1",
                    "type": "subject",
                    "label": "伍华中",
                    "accounts": [{"accountId": "1", "tradeCard": "W-1", "accountName": "伍华中"}],
                },
                {"id": "account:35", "accountId": "35", "tradeCard": "P-35", "accountName": "冯燕青"},
            ],
            "edges": [
                {
                    "id": "money:account:35->subject:suspect:1",
                    "from": "account:35",
                    "to": "subject:suspect:1",
                    "tradeIds": ["1"],
                }
            ],
            "tradeFacts": {
                "1": {"tradeId": "1", "tradeAmount": 40000, "tradeTime": "2026-01-01 10:00:00"},
            },
        },
        delta={"addedNodes": [], "addedEdges": [], "updatedNodes": [], "updatedEdges": []},
        summary={},
    )
    client = StubClient()
    service = RelationGraphService(storage=storage, query_client=client)
    service.exclude_node(
        {
            "caseId": "37",
            "graphId": "graph-1",
            "node": {"nodeId": "account:35", "label": "冯燕青", "type": "account", "accountIds": ["35"]},
        }
    )

    result = service.filter_current_graph(
        {
            "caseId": "37",
            "graphId": "graph-1",
            "filters": {"minAmount": 10000},
        }
    )

    assert client.calls == []
    assert result["step"]["summary"]["excludedNodeCount"] == 1
    assert result["graph"]["excludedNodes"][0]["nodeId"] == "account:35"
    excluded_node = next(node for node in result["graph"]["nodes"] if node["id"] == "account:35")
    assert excluded_node["isExcluded"] is True


def test_relation_service_excludes_and_restores_manual_node(tmp_path: Path) -> None:
    class StubClient:
        def query_relation_one_hop(
            self,
            *,
            case_id: str,
            seed_accounts: list[dict[str, object]],
            direction: str,
            filters: dict[str, object],
        ) -> dict[str, object]:
            return {"nodes": [], "edges": []}

        def query_relation_between_accounts(
            self,
            *,
            case_id: str,
            accounts: list[dict[str, object]],
            filters: dict[str, object],
        ) -> dict[str, object]:
            return {"nodes": [], "edges": []}

    storage = RelationGraphStorage(tmp_path)
    storage.save_step(
        case_id="37",
        graph_id="graph-1",
        step_type="seed_one_hop",
        request={"caseId": "37"},
        graph={
            "nodes": [
                {
                    "id": "subject:suspect:1",
                    "type": "subject",
                    "label": "伍华中",
                    "accounts": [{"accountId": "1", "tradeCard": "W-1", "accountName": "伍华中"}],
                },
                {"id": "account:35", "accountId": "35", "tradeCard": "P-35", "accountName": "冯燕青"},
            ],
            "edges": [{"id": "money:account:35->subject:suspect:1", "from": "account:35", "to": "subject:suspect:1"}],
        },
        delta={"addedNodes": [], "addedEdges": [], "updatedNodes": [], "updatedEdges": []},
        summary={},
    )

    service = RelationGraphService(storage=storage, query_client=StubClient())
    excluded = service.exclude_node(
        {
            "caseId": "37",
            "graphId": "graph-1",
            "node": {"nodeId": "account:35", "label": "冯燕青", "type": "account", "accountIds": ["35"]},
        }
    )

    assert excluded["queryMode"] == "manual_exclude_node"
    assert excluded["step"]["stepId"] == "0002"
    assert excluded["graph"]["nodes"][1]["isExcluded"] is True
    assert excluded["graph"]["edges"][0]["isExcluded"] is True
    assert excluded["graph"]["excludedNodes"][0]["nodeId"] == "account:35"

    restored = service.restore_node(
        {
            "caseId": "37",
            "graphId": "graph-1",
            "nodeId": "account:35",
        }
    )

    assert restored["queryMode"] == "manual_restore_node"
    assert restored["step"]["stepId"] == "0003"
    assert restored["graph"]["nodes"][1].get("isExcluded") is False
    assert restored["graph"]["edges"][0].get("isExcluded") is False
    assert restored["graph"]["excludedNodes"] == []


def test_relation_service_excludes_multiple_nodes_in_one_step(tmp_path: Path) -> None:
    class StubClient:
        def query_relation_one_hop(self, **_kwargs: object) -> dict[str, object]:
            return {"nodes": [], "edges": []}

        def query_relation_between_accounts(self, **_kwargs: object) -> dict[str, object]:
            return {"nodes": [], "edges": []}

        def query_relation_global_candidates(self, **_kwargs: object) -> dict[str, object]:
            return {"items": []}

    storage = RelationGraphStorage(tmp_path)
    storage.save_step(
        case_id="37",
        graph_id="graph-1",
        step_type="seed_one_hop",
        request={"caseId": "37"},
        graph={
            "nodes": [
                {"id": "subject:suspect:1", "type": "subject", "label": "伍华中"},
                {"id": "account:35", "accountId": "35", "tradeCard": "P-35", "accountName": "冯燕青"},
                {"id": "account:39", "accountId": "39", "tradeCard": "P-39", "accountName": "蔡金海"},
            ],
            "edges": [
                {"id": "money:account:35->subject:suspect:1", "from": "account:35", "to": "subject:suspect:1"},
                {"id": "money:subject:suspect:1->account:39", "from": "subject:suspect:1", "to": "account:39"},
            ],
        },
        delta={"addedNodes": [], "addedEdges": [], "updatedNodes": [], "updatedEdges": []},
        summary={},
    )

    service = RelationGraphService(storage=storage, query_client=StubClient())
    result = service.exclude_node(
        {
            "caseId": "37",
            "graphId": "graph-1",
            "nodes": [
                {"nodeId": "account:35", "label": "冯燕青", "type": "account", "accountIds": ["35"]},
                {"nodeId": "account:39", "label": "蔡金海", "type": "account", "accountIds": ["39"]},
            ],
        }
    )

    steps = sorted(
        (tmp_path / ".nanobot_channel_webui" / "case_graphs" / "37" / "graph-1" / "steps").glob("*.json")
    )
    assert [step.name for step in steps] == ["0001-seed-one-hop.json", "0002-manual-exclude-node.json"]
    assert result["step"]["stepId"] == "0002"
    assert result["step"]["summary"]["updatedNodeCount"] == 2
    assert [node["nodeId"] for node in result["delta"]["updatedNodes"]] == ["account:35", "account:39"]
    assert result["graph"]["nodes"][1]["isExcluded"] is True
    assert result["graph"]["nodes"][2]["isExcluded"] is True
    assert all(edge["isExcluded"] for edge in result["graph"]["edges"])


def test_relation_service_adds_manual_trade_without_moving_existing_nodes(tmp_path: Path) -> None:
    class StubClient:
        def query_relation_one_hop(self, **_kwargs: object) -> dict[str, object]:
            return {"nodes": [], "edges": []}

        def query_relation_between_accounts(self, **_kwargs: object) -> dict[str, object]:
            return {"nodes": [], "edges": []}

        def query_relation_global_candidates(self, **_kwargs: object) -> dict[str, object]:
            return {"items": []}

    storage = RelationGraphStorage(tmp_path)
    storage.save_step(
        case_id="37",
        graph_id="graph-1",
        step_type="seed_one_hop",
        request={"caseId": "37"},
        graph={
            "nodes": [
                {"id": "a", "label": "冯燕青", "accountId": "35", "x": 120, "y": 240},
                {"id": "b", "label": "冯光彩", "accountId": "36", "x": 520, "y": 240},
            ],
            "edges": [],
            "layout": {"nodePositions": {"a": {"x": 120, "y": 240}, "b": {"x": 520, "y": 240}}},
        },
        delta={"addedNodes": [], "addedEdges": [], "updatedNodes": [], "updatedEdges": []},
        summary={},
    )

    service = RelationGraphService(storage=storage, query_client=StubClient())
    result = service.add_manual_trade(
        {
            "caseId": "37",
            "graphId": "graph-1",
            "payer": {"nodeId": "a", "label": "冯燕青"},
            "payee": {"nodeId": "b", "label": "冯光彩"},
            "amount": 5000,
            "method": "现金",
            "summary": "办案人员补充现金往来",
            "options": {"nodePositions": {"a": {"x": 120, "y": 240}, "b": {"x": 520, "y": 240}}},
        }
    )

    assert result["queryMode"] == "manual_trade_add"
    assert result["step"]["summary"]["label"] == "补充资金往来"
    assert result["graph"]["nodes"][0]["x"] == 120.0
    assert result["graph"]["nodes"][1]["x"] == 520.0
    assert result["graph"]["layout"]["nodePositions"]["a"] == {"x": 120.0, "y": 240.0}
    assert result["graph"]["edges"][0]["id"] == "money:a->b"
    assert result["graph"]["edges"][0]["tradeAmount"] == 5000
    assert result["graph"]["manualEdges"][0]["method"] == "现金"
    assert next(iter(result["graph"]["tradeFacts"].values()))["source"] == "manual"


def test_relation_service_adds_manual_node_without_moving_existing_nodes(tmp_path: Path) -> None:
    class StubClient:
        def query_relation_one_hop(self, **_kwargs: object) -> dict[str, object]:
            return {"nodes": [], "edges": []}

        def query_relation_between_accounts(self, **_kwargs: object) -> dict[str, object]:
            return {"nodes": [], "edges": []}

        def query_relation_global_candidates(self, **_kwargs: object) -> dict[str, object]:
            return {"items": []}

    storage = RelationGraphStorage(tmp_path)
    storage.save_step(
        case_id="37",
        graph_id="graph-1",
        step_type="seed_one_hop",
        request={"caseId": "37"},
        graph={
            "nodes": [
                {"id": "a", "label": "冯燕青", "accountId": "35", "x": 120, "y": 240},
                {"id": "b", "label": "冯光彩", "accountId": "36", "x": 520, "y": 240},
            ],
            "edges": [],
            "layout": {"nodePositions": {"a": {"x": 120, "y": 240}, "b": {"x": 520, "y": 240}}},
        },
        delta={"addedNodes": [], "addedEdges": [], "updatedNodes": [], "updatedEdges": []},
        summary={},
    )

    service = RelationGraphService(storage=storage, query_client=StubClient())
    result = service.add_manual_node(
        {
            "caseId": "37",
            "graphId": "graph-1",
            "label": "现金交付人",
            "tradeCard": "CASH-001",
            "discoveryReason": "询问笔录提到现金交付",
            "sourceNote": "询问笔录第 3 页",
            "note": "先作为图上临时交易主体研判",
            "position": {"x": 880, "y": 360},
            "options": {"nodePositions": {"a": {"x": 120, "y": 240}, "b": {"x": 520, "y": 240}}},
        }
    )

    assert result["queryMode"] == "manual_node_add"
    assert result["step"]["summary"]["label"] == "创建交易主体"
    assert result["graph"]["layout"]["nodePositions"]["a"] == {"x": 120.0, "y": 240.0}
    assert result["graph"]["layout"]["nodePositions"]["b"] == {"x": 520.0, "y": 240.0}
    assert len(result["delta"]["addedNodes"]) == 1
    added_node = result["delta"]["addedNodes"][0]
    assert added_node["label"] == "现金交付人"
    assert added_node["tradeCard"] == "CASH-001"
    assert added_node["isManual"] is True
    assert added_node["discoveryReason"] == "询问笔录提到现金交付"
    assert result["graph"]["layout"]["nodePositions"][added_node["id"]] == {"x": 880.0, "y": 360.0}


def test_relation_service_rejects_manual_node_without_graph_anchor(tmp_path: Path) -> None:
    class StubClient:
        def query_relation_one_hop(self, **_kwargs: object) -> dict[str, object]:
            return {"nodes": [], "edges": []}

        def query_relation_between_accounts(self, **_kwargs: object) -> dict[str, object]:
            return {"nodes": [], "edges": []}

        def query_relation_global_candidates(self, **_kwargs: object) -> dict[str, object]:
            return {"items": []}

    storage = RelationGraphStorage(tmp_path)
    storage.save_step(
        case_id="37",
        graph_id="graph-1",
        step_type="create",
        request={"caseId": "37"},
        graph={"nodes": [], "edges": []},
        delta={"addedNodes": [], "addedEdges": [], "updatedNodes": [], "updatedEdges": []},
        summary={},
    )

    service = RelationGraphService(storage=storage, query_client=StubClient())
    with pytest.raises(ValueError) as exc:
        service.add_manual_node({"caseId": "37", "graphId": "graph-1", "label": "现金交付人"})

    assert exc.value.args[0] == "graphAnchor"


def test_relation_service_adds_manual_trade_with_new_graph_only_node(tmp_path: Path) -> None:
    class StubClient:
        def query_relation_one_hop(self, **_kwargs: object) -> dict[str, object]:
            return {"nodes": [], "edges": []}

        def query_relation_between_accounts(self, **_kwargs: object) -> dict[str, object]:
            return {"nodes": [], "edges": []}

        def query_relation_global_candidates(self, **_kwargs: object) -> dict[str, object]:
            return {"items": []}

    storage = RelationGraphStorage(tmp_path)
    storage.save_step(
        case_id="37",
        graph_id="graph-1",
        step_type="seed_one_hop",
        request={"caseId": "37"},
        graph={"nodes": [{"id": "a", "label": "冯燕青", "x": 120, "y": 240}], "edges": []},
        delta={"addedNodes": [], "addedEdges": [], "updatedNodes": [], "updatedEdges": []},
        summary={},
    )

    service = RelationGraphService(storage=storage, query_client=StubClient())
    result = service.add_manual_trade(
        {
            "caseId": "37",
            "graphId": "graph-1",
            "payer": {"nodeId": "a", "label": "冯燕青"},
            "payee": {"label": "现金交付人", "createNew": True},
            "amount": 1200,
            "method": "现金",
        }
    )

    assert len(result["delta"]["addedNodes"]) == 1
    added_node = result["delta"]["addedNodes"][0]
    assert added_node["label"] == "现金交付人"
    assert added_node["isManual"] is True
    assert result["graph"]["edges"][0]["target"] == added_node["id"]


def test_relation_service_rejects_manual_trade_without_graph_anchor(tmp_path: Path) -> None:
    class StubClient:
        def query_relation_one_hop(self, **_kwargs: object) -> dict[str, object]:
            return {"nodes": [], "edges": []}

        def query_relation_between_accounts(self, **_kwargs: object) -> dict[str, object]:
            return {"nodes": [], "edges": []}

        def query_relation_global_candidates(self, **_kwargs: object) -> dict[str, object]:
            return {"items": []}

    storage = RelationGraphStorage(tmp_path)
    storage.save_step(
        case_id="37",
        graph_id="graph-1",
        step_type="create",
        request={"caseId": "37"},
        graph={"nodes": [], "edges": []},
        delta={"addedNodes": [], "addedEdges": [], "updatedNodes": [], "updatedEdges": []},
        summary={},
    )

    service = RelationGraphService(storage=storage, query_client=StubClient())
    with pytest.raises(ValueError) as exc:
        service.add_manual_trade(
            {
                "caseId": "37",
                "graphId": "graph-1",
                "payer": {"label": "现金交付人", "createNew": True},
                "payee": {"label": "现金接收人", "createNew": True},
                "amount": 1200,
                "method": "现金",
            }
        )

    assert exc.value.args[0] == "graphAnchor"


def test_relation_service_adds_reality_relation_without_money_edge(tmp_path: Path) -> None:
    class StubClient:
        def query_relation_one_hop(self, **_kwargs: object) -> dict[str, object]:
            return {"nodes": [], "edges": []}

        def query_relation_between_accounts(self, **_kwargs: object) -> dict[str, object]:
            return {"nodes": [], "edges": []}

        def query_relation_global_candidates(self, **_kwargs: object) -> dict[str, object]:
            return {"items": []}

    storage = RelationGraphStorage(tmp_path)
    storage.save_step(
        case_id="37",
        graph_id="graph-1",
        step_type="seed_one_hop",
        request={"caseId": "37"},
        graph={
            "nodes": [{"id": "a", "label": "冯燕青"}, {"id": "b", "label": "冯光彩"}],
            "edges": [],
        },
        delta={"addedNodes": [], "addedEdges": [], "updatedNodes": [], "updatedEdges": []},
        summary={},
    )

    service = RelationGraphService(storage=storage, query_client=StubClient())
    result = service.add_reality_relation(
        {
            "caseId": "37",
            "graphId": "graph-1",
            "sourceNodeId": "a",
            "targetNodeId": "b",
            "relationType": "母女",
            "note": "户籍信息确认",
        }
    )

    assert result["queryMode"] == "reality_relation_add"
    assert result["step"]["summary"]["label"] == "标注现实关系"
    assert result["graph"]["edges"] == []
    assert result["graph"]["realityRelations"][0]["relationType"] == "母女"
    assert result["delta"]["addedRealityRelations"][0]["source"] == "a"


def test_relation_service_queries_summary_candidates_from_database(tmp_path: Path) -> None:
    class StubClient:
        def __init__(self) -> None:
            self.one_hop_calls: list[dict[str, object]] = []

        def query_relation_one_hop(
            self,
            *,
            case_id: str,
            seed_accounts: list[dict[str, object]],
            direction: str,
            filters: dict[str, object],
        ) -> dict[str, object]:
            self.one_hop_calls.append(
                {
                    "case_id": case_id,
                    "seed_accounts": seed_accounts,
                    "direction": direction,
                    "filters": filters,
                }
            )
            return {
                "nodes": [
                    {"id": "account:1", "accountId": "1", "accountName": "伍华中", "role": "seed"},
                    {"id": "account:35", "accountId": "35", "accountName": "冯燕青"},
                    {"id": "account:50", "accountId": "50", "accountName": "库中新主体"},
                ],
                "edges": [
                    {
                        "id": "money:account:35->account:1",
                        "from": "account:35",
                        "to": "account:1",
                        "tradeAmount": 4000,
                        "tradeCount": 2,
                        "tradeIds": ["10", "11"],
                    },
                    {
                        "id": "money:account:1->account:50",
                        "from": "account:1",
                        "to": "account:50",
                        "tradeAmount": 9000,
                        "tradeCount": 1,
                        "tradeIds": ["12"],
                    },
                ],
                "tradeFacts": {
                    "10": {"tradeId": "10", "tradeAmount": 1000, "tradeTime": "2026-01-01 10:00:00"},
                    "11": {"tradeId": "11", "tradeAmount": 3000, "tradeTime": "2026-01-02 10:00:00"},
                    "12": {"tradeId": "12", "tradeAmount": 9000, "tradeTime": "2026-01-03 10:00:00"},
                },
            }

        def query_relation_between_accounts(
            self,
            *,
            case_id: str,
            accounts: list[dict[str, object]],
            filters: dict[str, object],
        ) -> dict[str, object]:
            raise AssertionError("summary preview should only query candidates")

    storage = RelationGraphStorage(tmp_path)
    storage.save_step(
        case_id="37",
        graph_id="graph-1",
        step_type="seed_one_hop",
        request={"caseId": "37"},
        graph={
            "nodes": [
                {"id": "account:1", "accountId": "1", "accountName": "伍华中", "x": 100, "y": 200},
                {"id": "account:35", "accountId": "35", "accountName": "冯燕青", "x": 300, "y": 200},
            ],
            "edges": [],
            "excludedNodes": [{"nodeId": "account:35", "label": "冯燕青", "accountIds": ["35"]}],
        },
        delta={"addedNodes": [], "addedEdges": [], "updatedNodes": [], "updatedEdges": []},
        summary={},
    )

    query_client = StubClient()
    service = RelationGraphService(storage=storage, query_client=query_client)
    result = service.query_summary_candidates(
        {
            "caseId": "37",
            "graphId": "graph-1",
            "focusNodeId": "account:1",
            "direction": "both",
            "filters": {"minAmount": 1000},
            "drillNums": 7,
            "drillType": 2,
        }
    )

    assert query_client.one_hop_calls == [
        {
            "case_id": "37",
            "seed_accounts": [{"accountId": "1", "tradeCard": "", "accountName": "伍华中"}],
            "direction": "both",
            "filters": {"_relationUnbounded": True},
        }
    ]
    assert [item["nodeId"] for item in result["items"]] == ["account:50", "account:35"]
    assert result["items"][0]["status"] == "candidate"
    assert result["items"][0]["paidAmount"] == 9000
    assert result["items"][1]["status"] == "excluded"
    assert result["items"][1]["receivedAmount"] == 4000


def test_relation_service_queries_global_summary_candidates_from_database(tmp_path: Path) -> None:
    class StubClient:
        def __init__(self) -> None:
            self.global_calls: list[dict[str, object]] = []

        def query_relation_one_hop(
            self,
            *,
            case_id: str,
            seed_accounts: list[dict[str, object]],
            direction: str,
            filters: dict[str, object],
        ) -> dict[str, object]:
            raise AssertionError("global summary preview should not require a focus node")

        def query_relation_between_accounts(
            self,
            *,
            case_id: str,
            accounts: list[dict[str, object]],
            filters: dict[str, object],
        ) -> dict[str, object]:
            raise AssertionError("global summary preview should only query candidates")

        def query_relation_global_candidates(
            self,
            *,
            case_id: str,
            filters: dict[str, object],
        ) -> dict[str, object]:
            self.global_calls.append({"case_id": case_id, "filters": filters})
            return {
                "items": [
                    {
                        "nodeId": "account:50",
                        "label": "库中新主体",
                        "accounts": [{"accountId": "50", "accountName": "库中新主体"}],
                        "receivedAmount": 6000,
                        "receivedCount": 2,
                        "paidAmount": 9000,
                        "paidCount": 1,
                        "minAmount": 1000,
                        "maxAmount": 9000,
                        "startTime": "2026-01-01 10:00:00",
                        "endTime": "2026-01-03 10:00:00",
                        "tradeIds": ["10", "11", "12"],
                    },
                    {
                        "nodeId": "account:35",
                        "label": "冯燕青",
                        "accounts": [{"accountId": "35", "accountName": "冯燕青"}],
                        "receivedAmount": 4000,
                        "receivedCount": 1,
                        "paidAmount": 0,
                        "paidCount": 0,
                        "minAmount": 4000,
                        "maxAmount": 4000,
                        "startTime": "2026-01-02 10:00:00",
                        "endTime": "2026-01-02 10:00:00",
                        "tradeIds": ["13"],
                    },
                ]
            }

    storage = RelationGraphStorage(tmp_path)
    storage.save_step(
        case_id="37",
        graph_id="graph-1",
        step_type="seed_one_hop",
        request={"caseId": "37"},
        graph={
            "nodes": [
                {"id": "account:1", "accountId": "1", "accountName": "伍华中", "x": 100, "y": 200},
                {"id": "account:35", "accountId": "35", "accountName": "冯燕青", "x": 300, "y": 200},
            ],
            "edges": [],
            "excludedNodes": [{"nodeId": "account:35", "label": "冯燕青", "accountIds": ["35"]}],
        },
        delta={"addedNodes": [], "addedEdges": [], "updatedNodes": [], "updatedEdges": []},
        summary={},
    )

    query_client = StubClient()
    service = RelationGraphService(storage=storage, query_client=query_client)
    result = service.query_summary_candidates(
        {
            "caseId": "37",
            "graphId": "graph-1",
            "scope": "global",
        }
    )

    assert query_client.global_calls == [
        {
            "case_id": "37",
            "filters": {"_relationUnbounded": True},
        }
    ]
    assert result["scope"] == "global"
    assert [item["nodeId"] for item in result["items"]] == ["account:50", "account:35"]
    assert result["items"][0]["status"] == "candidate"
    assert result["items"][0]["totalAmount"] == 15000
    assert result["items"][1]["status"] == "excluded"


def test_relation_service_applies_summary_selection_from_current_graph(tmp_path: Path) -> None:
    class StubClient:
        def __init__(self) -> None:
            self.one_hop_calls: list[dict[str, object]] = []
            self.between_calls: list[dict[str, object]] = []

        def query_relation_one_hop(
            self,
            *,
            case_id: str,
            seed_accounts: list[dict[str, object]],
            direction: str,
            filters: dict[str, object],
        ) -> dict[str, object]:
            self.one_hop_calls.append(
                {
                    "case_id": case_id,
                    "seed_accounts": seed_accounts,
                    "direction": direction,
                    "filters": filters,
                }
            )
            return {
                "nodes": [
                    {"id": "account:35", "accountId": "35", "accountName": "冯燕青"},
                    {"id": "account:50", "accountId": "50", "accountName": "新增关联主体"},
                ],
                "edges": [
                    {
                        "id": "money:account:35->account:50",
                        "from": "account:35",
                        "to": "account:50",
                        "tradeIds": ["50"],
                    }
                ],
                "tradeFacts": {"50": {"tradeId": "50", "amount": 8800}},
            }

        def query_relation_between_accounts(
            self,
            *,
            case_id: str,
            accounts: list[dict[str, object]],
            filters: dict[str, object],
        ) -> dict[str, object]:
            self.between_calls.append(
                {
                    "case_id": case_id,
                    "accounts": accounts,
                    "filters": filters,
                }
            )
            return {
                "nodes": [
                    {"id": "account:1", "accountId": "1", "accountName": "伍华中"},
                    {"id": "account:35", "accountId": "35", "accountName": "冯燕青"},
                    {"id": "account:50", "accountId": "50", "accountName": "新增关联主体"},
                ],
                "edges": [
                    {
                        "id": "money:account:35->account:1",
                        "from": "account:35",
                        "to": "account:1",
                        "tradeIds": ["1"],
                    },
                    {
                        "id": "money:account:1->account:50",
                        "from": "account:1",
                        "to": "account:50",
                        "tradeIds": ["50"],
                    },
                ],
                "tradeFacts": {"50": {"tradeId": "50", "amount": 8800}},
            }

    storage = RelationGraphStorage(tmp_path)
    storage.save_step(
        case_id="37",
        graph_id="graph-1",
        step_type="seed_one_hop",
        request={"caseId": "37"},
        graph={
            "nodes": [
                {"id": "account:1", "accountId": "1", "accountName": "伍华中", "x": 100, "y": 200},
                {"id": "account:35", "accountId": "35", "accountName": "冯燕青", "x": 300, "y": 200},
                {"id": "account:39", "accountId": "39", "accountName": "蔡金海", "x": 500, "y": 200},
                {"id": "account:99", "accountId": "99", "accountName": "已排除主体", "x": 700, "y": 200},
            ],
            "edges": [
                {"id": "money:account:35->account:1", "from": "account:35", "to": "account:1", "tradeIds": ["1"]},
                {"id": "money:account:39->account:1", "from": "account:39", "to": "account:1", "tradeIds": ["2"]},
            ],
            "excludedNodes": [
                {"nodeId": "account:35", "label": "冯燕青", "type": "account", "accountIds": ["35"], "reason": "manual"},
                {"nodeId": "account:99", "label": "已排除主体", "type": "account", "accountIds": ["99"], "reason": "manual"},
            ],
        },
        delta={"addedNodes": [], "addedEdges": [], "updatedNodes": [], "updatedEdges": []},
        summary={},
    )

    query_client = StubClient()
    service = RelationGraphService(storage=storage, query_client=query_client)
    result = service.apply_summary_selection(
        {
            "caseId": "37",
            "graphId": "graph-1",
            "focusNodeId": "account:1",
            "candidateNodeIds": ["account:35", "account:39", "account:50"],
            "selectedNodeIds": ["account:35", "account:50"],
            "selectedCandidates": [
                {"nodeId": "account:35", "accounts": [{"accountId": "35", "accountName": "冯燕青"}]},
                {"nodeId": "account:50", "accounts": [{"accountId": "50", "accountName": "新增关联主体"}]},
            ],
            "filters": {"minAmount": 1000},
            "drillNums": 7,
            "drillType": 2,
            "options": {
                "nodePositions": {
                    "account:1": {"x": 100, "y": 200},
                    "account:35": {"x": 300, "y": 200},
                    "account:39": {"x": 500, "y": 200},
                    "account:99": {"x": 700, "y": 200},
                }
            },
        }
    )

    nodes_by_id = {node["id"]: node for node in result["graph"]["nodes"]}
    edges_by_id = {edge["id"]: edge for edge in result["graph"]["edges"]}
    excluded_ids = {item["nodeId"] for item in result["graph"]["excludedNodes"]}

    assert result["queryMode"] == "summary_analysis"
    assert result["step"]["stepId"] == "0002"
    assert result["step"]["summary"]["label"] == "线索扩展"
    assert result["step"]["summary"]["candidateNodeCount"] == 3
    assert result["step"]["summary"]["retainedNodeCount"] == 2
    assert result["step"]["summary"]["addedNodeCount"] == 1
    assert result["step"]["summary"]["addedEdgeCount"] == 1
    assert query_client.one_hop_calls == []
    assert query_client.between_calls == [
        {
            "case_id": "37",
            "accounts": [
                {"accountId": "1", "tradeCard": "", "accountName": "伍华中"},
                {"accountId": "35", "tradeCard": "", "accountName": "冯燕青"},
                {"accountId": "50", "tradeCard": "", "accountName": "新增关联主体"},
            ],
            "filters": {"_relationUnbounded": True},
        }
    ]
    assert excluded_ids == {"account:99"}
    assert nodes_by_id["account:35"]["isExcluded"] is False
    assert nodes_by_id["account:39"].get("isExcluded") is False
    assert nodes_by_id["account:50"]["isExcluded"] is False
    assert edges_by_id["money:account:35->account:1"]["isExcluded"] is False
    assert edges_by_id["money:account:39->account:1"].get("isExcluded") is False
    assert edges_by_id["money:account:1->account:50"]["isExcluded"] is False
    assert result["graphState"]["graph"]["layout"]["nodePositions"] == {
        "account:1": {"x": 100.0, "y": 200.0},
        "account:35": {"x": 300.0, "y": 200.0},
        "account:39": {"x": 500.0, "y": 200.0},
        "account:99": {"x": 700.0, "y": 200.0},
    }


def test_relation_service_applies_global_summary_selection_as_nodes(tmp_path: Path) -> None:
    class StubClient:
        def query_relation_one_hop(
            self,
            *,
            case_id: str,
            seed_accounts: list[dict[str, object]],
            direction: str,
            filters: dict[str, object],
        ) -> dict[str, object]:
            raise AssertionError("global summary selection should not drill from a focus node")

        def query_relation_between_accounts(
            self,
            *,
            case_id: str,
            accounts: list[dict[str, object]],
            filters: dict[str, object],
        ) -> dict[str, object]:
            raise AssertionError("global summary selection only adds selected candidate nodes")

        def query_relation_global_candidates(
            self,
            *,
            case_id: str,
            filters: dict[str, object],
        ) -> dict[str, object]:
            return {"items": []}

    storage = RelationGraphStorage(tmp_path)
    storage.save_step(
        case_id="37",
        graph_id="graph-1",
        step_type="seed_one_hop",
        request={"caseId": "37"},
        graph={
            "nodes": [
                {"id": "account:1", "accountId": "1", "accountName": "伍华中", "x": 100, "y": 200},
                {"id": "account:35", "accountId": "35", "accountName": "已取消主体", "x": 300, "y": 200},
            ],
            "edges": [],
            "excludedNodes": [
                {"nodeId": "account:35", "label": "已取消主体", "type": "account", "accountIds": ["35"], "reason": "manual"},
            ],
        },
        delta={"addedNodes": [], "addedEdges": [], "updatedNodes": [], "updatedEdges": []},
        summary={},
    )

    service = RelationGraphService(storage=storage, query_client=StubClient())
    result = service.apply_summary_selection(
        {
            "caseId": "37",
            "graphId": "graph-1",
            "scope": "global",
            "candidateNodeIds": ["account:35", "account:50"],
            "selectedNodeIds": ["account:35", "account:50"],
            "selectedCandidates": [
                {"nodeId": "account:35", "label": "已取消主体", "accounts": [{"accountId": "35", "accountName": "已取消主体"}]},
                {"nodeId": "account:50", "label": "新增候选主体", "accounts": [{"accountId": "50", "accountName": "新增候选主体"}]},
            ],
            "options": {
                "nodePositions": {
                    "account:1": {"x": 100, "y": 200},
                    "account:35": {"x": 300, "y": 200},
                }
            },
        }
    )

    nodes_by_id = {node["id"]: node for node in result["graph"]["nodes"]}

    assert result["queryMode"] == "summary_analysis"
    assert result["step"]["summary"]["label"] == "线索扩展"
    assert result["step"]["summary"]["candidateNodeCount"] == 2
    assert result["step"]["summary"]["retainedNodeCount"] == 2
    assert result["step"]["summary"]["addedNodeCount"] == 1
    assert result["step"]["summary"]["addedEdgeCount"] == 0
    assert result["step"]["request"]["scope"] == "global"
    assert result["graph"]["excludedNodes"] == []
    assert nodes_by_id["account:35"].get("isExcluded") is False
    assert nodes_by_id["account:50"]["accountName"] == "新增候选主体"
    assert result["graphState"]["graph"]["layout"]["nodePositions"] == {
        "account:1": {"x": 100.0, "y": 200.0},
        "account:35": {"x": 300.0, "y": 200.0},
    }


def test_relation_service_filters_detail_trades_from_persisted_facts(tmp_path: Path) -> None:
    class StubClient:
        def query_relation_one_hop(
            self,
            *,
            case_id: str,
            seed_accounts: list[dict[str, object]],
            direction: str,
            filters: dict[str, object],
        ) -> dict[str, object]:
            return {"nodes": [], "edges": []}

        def query_relation_between_accounts(
            self,
            *,
            case_id: str,
            accounts: list[dict[str, object]],
            filters: dict[str, object],
        ) -> dict[str, object]:
            raise AssertionError("detail trade filtering must not query the database")

    storage = RelationGraphStorage(tmp_path)
    storage.save_step(
        case_id="37",
        graph_id="graph-1",
        step_type="seed_one_hop",
        request={"caseId": "37"},
        graph={
            "nodes": [
                {"id": "account:1", "accountId": "1", "accountName": "伍华中", "x": 100, "y": 200},
                {"id": "account:35", "accountId": "35", "accountName": "冯燕青", "x": 300, "y": 200},
            ],
            "edges": [
                {
                    "id": "money:account:35->account:1",
                    "from": "account:35",
                    "to": "account:1",
                    "source": "account:35",
                    "target": "account:1",
                    "tradeIds": ["1", "2"],
                    "tradeAmount": 3000,
                    "tradeCount": 2,
                }
            ],
        },
        delta={"addedNodes": [], "addedEdges": [], "updatedNodes": [], "updatedEdges": []},
        summary={},
    )

    service = RelationGraphService(storage=storage, query_client=StubClient())
    result = service.exclude_trades(
        {
            "caseId": "37",
            "graphId": "graph-1",
            "excludedTrades": ["2"],
            "edgeTradeIds": {"money:account:35->account:1": ["1", "2"]},
            "tradeFacts": [
                {
                    "tradeId": "1",
                    "serialNumber": "S-1",
                    "tradeAmount": 1000,
                    "tradeTime": "2026-01-01 10:00:00",
                    "payerAccountId": "35",
                    "payeeAccountId": "1",
                },
                {
                    "tradeId": "2",
                    "serialNumber": "S-2",
                    "tradeAmount": 2000,
                    "tradeTime": "2026-01-02 10:00:00",
                    "payerAccountId": "35",
                    "payeeAccountId": "1",
                },
            ],
            "options": {"nodePositions": {"account:1": {"x": 111, "y": 222}}},
        }
    )

    edge = result["graph"]["edges"][0]
    assert result["queryMode"] == "detail_trade_filter"
    assert result["step"]["summary"]["label"] == "交易核查"
    assert result["graph"]["excludedTrades"] == ["2"]
    assert edge["tradeAmount"] == 1000
    assert edge["tradeCount"] == 1
    assert edge["tradeIds"] == ["1", "2"]
    assert result["graph"]["tradeFacts"]["1"]["serialNumber"] == "S-1"
    assert result["graphState"]["graph"]["layout"]["nodePositions"]["account:1"] == {"x": 111.0, "y": 222.0}


def test_relation_service_restores_fully_removed_trade_edge_from_facts(tmp_path: Path) -> None:
    class StubClient:
        pass

    storage = RelationGraphStorage(tmp_path)
    storage.save_step(
        case_id="37",
        graph_id="graph-1",
        step_type="seed_one_hop",
        request={"caseId": "37"},
        graph={
            "nodes": [
                {
                    "id": "subject:suspect:1",
                    "type": "subject",
                    "label": "伍华中",
                    "accountIds": ["1"],
                    "accounts": [{"accountId": "1", "tradeCard": "W-1", "accountName": "伍华中"}],
                },
                {
                    "id": "account:35",
                    "type": "account",
                    "label": "冯燕青",
                    "accountId": "35",
                    "tradeCard": "F-35",
                    "accountName": "冯燕青",
                },
                {
                    "id": "account:9",
                    "type": "account",
                    "label": "其他主体",
                    "accountId": "9",
                    "tradeCard": "O-9",
                    "accountName": "其他主体",
                },
            ],
            "edges": [
                {
                    "id": "money:account:35->subject:suspect:1",
                    "from": "account:35",
                    "to": "subject:suspect:1",
                    "source": "account:35",
                    "target": "subject:suspect:1",
                    "tradeIds": ["45", "220"],
                    "tradeAmount": 40000,
                    "tradeCount": 2,
                },
                {
                    "id": "money:subject:suspect:1->account:9",
                    "from": "subject:suspect:1",
                    "to": "account:9",
                    "source": "subject:suspect:1",
                    "target": "account:9",
                    "tradeIds": ["9"],
                    "tradeAmount": 1000,
                    "tradeCount": 1,
                }
            ],
            "tradeFacts": {
                "45": {
                    "tradeId": "45",
                    "serialNumber": "S-45",
                    "tradeAmount": 20000,
                    "tradeTime": "2026-01-14 03:46:34",
                    "payerAccountId": "35",
                    "payerAccountName": "冯燕青",
                    "payerTradeCard": "F-35",
                    "payeeAccountId": "1",
                    "payeeAccountName": "伍华中",
                    "payeeTradeCard": "W-1",
                },
                "220": {
                    "tradeId": "220",
                    "serialNumber": "S-220",
                    "tradeAmount": 20000,
                    "tradeTime": "2026-01-14 03:46:33",
                    "payerAccountId": "35",
                    "payerAccountName": "冯燕青",
                    "payerTradeCard": "F-35",
                    "payeeAccountId": "1",
                    "payeeAccountName": "伍华中",
                    "payeeTradeCard": "W-1",
                },
                "9": {
                    "tradeId": "9",
                    "serialNumber": "S-9",
                    "tradeAmount": 1000,
                    "tradeTime": "2026-01-14 04:00:00",
                    "payerAccountId": "1",
                    "payerAccountName": "伍华中",
                    "payerTradeCard": "W-1",
                    "payeeAccountId": "9",
                    "payeeAccountName": "其他主体",
                    "payeeTradeCard": "O-9",
                },
            },
        },
        delta={"addedNodes": [], "addedEdges": [], "updatedNodes": [], "updatedEdges": []},
        summary={},
    )
    service = RelationGraphService(storage=storage, query_client=StubClient())
    excluded = service.exclude_trades(
        {
            "caseId": "37",
            "graphId": "graph-1",
            "excludedTrades": ["45", "220"],
            "edgeTradeIds": {"money:account:35->subject:suspect:1": ["45", "220"]},
            "tradeFacts": {},
        }
    )
    assert [edge["id"] for edge in excluded["graph"]["edges"]] == ["money:subject:suspect:1->account:9"]
    assert {node["id"] for node in excluded["graph"]["nodes"]} == {"subject:suspect:1", "account:9"}

    restored = service.exclude_trades(
        {
            "caseId": "37",
            "graphId": "graph-1",
            "excludedTrades": [],
            "edgeTradeIds": {},
            "tradeFacts": {},
        }
    )

    assert restored["graph"]["excludedTrades"] == []
    assert {node["id"] for node in restored["graph"]["nodes"]} == {"account:35", "subject:suspect:1", "account:9"}
    edge = next(edge for edge in restored["graph"]["edges"] if edge["id"] == "money:account:35->subject:suspect:1")
    assert edge["id"] == "money:account:35->subject:suspect:1"
    assert edge["tradeIds"] == ["220", "45"]
    assert edge["tradeAmount"] == 40000
    assert edge["tradeCount"] == 2
    assert restored["delta"]["addedEdges"][0]["id"] == "money:account:35->subject:suspect:1"
