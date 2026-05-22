from __future__ import annotations

from pathlib import Path
import sys
import types

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
from nanobot_channel_webui.case_graph.relation_types import normalize_relation_query_payload
from nanobot_channel_webui.case_graph.mysql_client import CaseGraphMySQLConfig, PyMySQLCaseGraphQueryClient
from nanobot_channel_webui.case_graph.relation_service import RelationGraphService


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
        graph={"nodes": [], "edges": []},
        delta={"addedNodes": [], "addedEdges": [], "updatedNodes": [], "updatedEdges": []},
        summary={"addedNodeCount": 0, "addedEdgeCount": 0},
    )

    graph_file = tmp_path / ".nanobot_channel_webui" / "case_graphs" / "37" / "graph-1" / "graph.json"
    step_file = tmp_path / ".nanobot_channel_webui" / "case_graphs" / "37" / "graph-1" / "steps" / "0001-seed-one-hop.json"
    assert graph_file.exists()
    assert step_file.exists()
    assert result["step"]["stepId"] == "0001"
    assert result["step"]["file"] == str(step_file)


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


def test_relation_seed_one_hop_queries_only_seed_counterparties() -> None:
    class StubClient(PyMySQLCaseGraphQueryClient):
        def _query(self, sql: str, params: tuple[object, ...]) -> list[dict[str, object]]:
            assert "payer_account_id IN" in sql or "payee_account_id IN" in sql
            assert "JOIN ga_trade" not in sql
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
            assert "payer_account_id IN" in sql
            assert "payee_account_id IN" in sql
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
            return {
                "nodes": [{"id": "account:1"}, {"id": "account:35"}],
                "edges": [{"id": "money:account:35->account:1", "from": "account:35", "to": "account:1", "scope": "filtered_graph"}],
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

    assert client.calls == [
        {
            "case_id": "37",
            "accounts": [
                {"accountId": "1", "tradeCard": "W-1", "accountName": "伍华中"},
                {"accountId": "35", "tradeCard": "P-35", "accountName": "冯燕青"},
            ],
            "filters": {
                "minAmount": 10000,
                "maxAmount": 50000,
                "startTime": "2026-01-01 00:00:00",
                "endTime": "2026-01-31 23:59:59",
            },
        }
    ]
    assert result["queryMode"] == "filter_current_graph"
    assert result["step"]["stepId"] == "0002"
    assert result["step"]["summary"]["filterCount"] == 4
    assert result["graph"]["edges"][0]["scope"] == "filtered_graph"


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
            return {
                "nodes": [
                    {"id": "account:1", "accountId": "1", "label": "伍华中"},
                    {"id": "account:35", "accountId": "35", "label": "冯燕青"},
                ],
                "edges": [
                    {
                        "id": "money:account:35->account:1",
                        "from": "account:35",
                        "to": "account:1",
                        "scope": "filtered_graph",
                    }
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
                {"id": "account:1", "accountId": "1", "tradeCard": "W-1", "label": "伍华中", "x": 100, "y": 100},
                {"id": "account:35", "accountId": "35", "tradeCard": "P-35", "label": "冯燕青", "x": 300, "y": 100},
                {"id": "account:136", "accountId": "136", "tradeCard": "P-136", "label": "账号 136", "x": 300, "y": 300},
                {"id": "account:140", "accountId": "140", "tradeCard": "P-140", "label": "账号 140", "x": 300, "y": 500},
            ],
            "edges": [
                {"id": "money:account:35->account:1", "from": "account:35", "to": "account:1"},
                {"id": "money:account:136->account:1", "from": "account:136", "to": "account:1"},
                {"id": "money:account:140->account:1", "from": "account:140", "to": "account:1"},
            ],
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
            return {
                "nodes": [
                    {"id": "subject:suspect:1", "label": "伍华中"},
                    {"id": "account:35", "label": "冯燕青"},
                    {"id": "account:9", "label": "蔡召东"},
                ],
                "edges": [
                    {
                        "id": "money:account:35->subject:suspect:1",
                        "from": "account:35",
                        "to": "subject:suspect:1",
                        "tradeAmount": 40000,
                    },
                    {
                        "id": "money:account:9->account:35",
                        "from": "account:9",
                        "to": "account:35",
                        "tradeAmount": 115000,
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
                    "id": "subject:suspect:1",
                    "type": "subject",
                    "label": "伍华中",
                    "accounts": [{"accountId": "1", "tradeCard": "W-1", "accountName": "伍华中"}],
                },
                {"id": "account:35", "accountId": "35", "tradeCard": "P-35", "label": "冯燕青"},
                {"id": "account:9", "accountId": "9", "tradeCard": "P-9", "label": "蔡召东"},
            ],
            "edges": [
                {"id": "money:account:35->subject:suspect:1", "from": "account:35", "to": "subject:suspect:1"},
                {"id": "money:subject:suspect:1->account:9", "from": "subject:suspect:1", "to": "account:9"},
            ],
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
            return {
                "nodes": [
                    {"id": "account:1", "accountId": "1", "label": "伍华中"},
                    {"id": "account:35", "accountId": "35", "label": "冯燕青"},
                    {"id": "account:32", "accountId": "32", "label": "赵引"},
                    {"id": "account:229", "accountId": "229", "label": "冯多"},
                ],
                "edges": [
                    {"id": "money:account:35->account:1", "from": "account:35", "to": "account:1"},
                    {"id": "money:account:32->account:1", "from": "account:32", "to": "account:1"},
                    {"id": "money:account:1->account:229", "from": "account:1", "to": "account:229"},
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
                {"id": "account:1", "accountId": "1", "tradeCard": "W-1", "label": "伍华中", "x": 580, "y": 68},
                {"id": "account:35", "accountId": "35", "tradeCard": "P-35", "label": "冯燕青", "x": 206, "y": 68},
                {"id": "account:32", "accountId": "32", "tradeCard": "P-32", "label": "赵引", "x": 954, "y": 17612},
                {"id": "account:229", "accountId": "229", "tradeCard": "P-229", "label": "冯多", "x": 954, "y": 928},
            ],
            "edges": [
                {"id": "money:account:35->account:1", "from": "account:35", "to": "account:1"},
                {"id": "money:account:32->account:1", "from": "account:32", "to": "account:1"},
                {"id": "money:account:1->account:229", "from": "account:1", "to": "account:229"},
            ],
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
            return {
                "nodes": [{"id": "subject:suspect:1", "type": "subject", "label": "伍华中"}],
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

    result = service.filter_current_graph(
        {
            "caseId": "37",
            "graphId": "graph-1",
            "filters": {"minAmount": 10000},
        }
    )

    assert client.calls == [
        {
            "case_id": "37",
            "accounts": [{"accountId": "1", "tradeCard": "W-1", "accountName": "伍华中"}],
            "filters": {"minAmount": 10000},
        }
    ]
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
