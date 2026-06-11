from __future__ import annotations

import importlib.util
import json
import sys
import types
from pathlib import Path

import pytest


SRC_ROOT = (
    Path(__file__).resolve().parents[1]
    / "src"
    / "nanobot_channel_webui"
    / "case_graph"
)
TYPES_PATH = SRC_ROOT / "types.py"
STORAGE_PATH = SRC_ROOT / "storage.py"


def _load_storage_module() -> types.ModuleType:
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

    types_spec = importlib.util.spec_from_file_location(
        f"{case_graph_package_name}.types",
        TYPES_PATH,
    )
    assert types_spec is not None
    assert types_spec.loader is not None
    types_module = importlib.util.module_from_spec(types_spec)
    sys.modules[f"{case_graph_package_name}.types"] = types_module
    types_spec.loader.exec_module(types_module)

    storage_spec = importlib.util.spec_from_file_location(
        f"{case_graph_package_name}.storage",
        STORAGE_PATH,
    )
    assert storage_spec is not None
    assert storage_spec.loader is not None
    storage_module = importlib.util.module_from_spec(storage_spec)
    sys.modules[f"{case_graph_package_name}.storage"] = storage_module
    storage_spec.loader.exec_module(storage_module)
    return storage_module


def test_create_graph_can_be_loaded_back(tmp_path: Path) -> None:
    module = _load_storage_module()
    service = module.CaseGraphStorage(workspace=tmp_path)

    created = service.create_graph(
        {
            "graph_id": "graph-1",
            "caseId": "case-1",
            "graphName": "主图",
            "tradeCards": [{"tradeId": "trade-1"}],
            "excludedTrades": [],
            "excludedAccountId": "",
            "drillNums": 1,
            "drillType": "out",
        }
    )

    loaded = service.get_graph("graph-1")

    assert loaded == created


def test_update_graph_persists_graph_state_fields(tmp_path: Path) -> None:
    module = _load_storage_module()
    service = module.CaseGraphStorage(workspace=tmp_path)
    service.create_graph(
        {
            "graph_id": "graph-1",
            "caseId": "case-1",
            "graphName": "主图",
            "tradeCards": [],
            "excludedTrades": [],
            "excludedAccountId": "",
            "drillNums": 1,
            "drillType": "out",
        }
    )

    updated = service.update_graph(
        "graph-1",
        {
            "excludedTrades": ["trade-2", "trade-3"],
            "excludedAccountId": "account-9",
            "drillNums": 3,
            "drillType": "in",
        },
    )

    reloaded = service.get_graph("graph-1")

    assert updated["excludedTrades"] == ["trade-2", "trade-3"]
    assert updated["excludedAccountId"] == "account-9"
    assert updated["drillNums"] == 3
    assert updated["drillType"] == "in"
    assert reloaded == updated


def test_update_graph_does_not_sync_relation_graph_state_into_nested_graph_file(tmp_path: Path) -> None:
    module = _load_storage_module()
    service = module.CaseGraphStorage(workspace=tmp_path)
    service.create_graph(
        {
            "graph_id": "graph-layout",
            "caseId": "case-1",
            "graphName": "主图",
            "tradeCards": [],
            "excludedTrades": [],
            "excludedAccountId": "",
            "drillNums": 1,
            "drillType": "out",
        }
    )

    service.update_graph(
        "graph-layout",
        {
            "graphData": {
                "nodes": [
                    {"id": "wu", "label": "伍华中", "x": 206, "y": 68},
                    {"id": "feng", "label": "冯燕青", "x": 954, "y": 1960},
                ],
                "money": [
                    {"id": "money:wu->feng", "from": "wu", "to": "feng", "source": "wu", "target": "feng"},
                ],
                "phone": [],
                "groups": {},
                "excludedTrades": [],
                "sourceSelectId": [],
            }
        },
    )

    relation_graph_file = (
        tmp_path
        / "data"
        / "case_graphs"
        / "case-1"
        / "graph-layout"
        / "graph.json"
    )
    assert not relation_graph_file.exists()


def test_create_graph_round_trips_original_snapshot_fields(tmp_path: Path) -> None:
    module = _load_storage_module()
    service = module.CaseGraphStorage(workspace=tmp_path)

    created = service.create_graph(
        {
            "graph_id": "graph-rich",
            "caseId": "case-1",
            "graphName": "主图",
            "graphContent": '{"cells":[]}',
            "tradeCards": [{"tradeId": "trade-1"}],
            "groupMap": {"100": {"groupId": "group-1", "groupName": "团伙一", "tradeCard": []}},
            "graphData": {
                "nodes": [{"id": "100", "label": "张三"}],
                "money": [{"from": "100", "to": "200", "amount": 88, "count": 1}],
                "phone": [],
                "groups": {},
                "excludedTrades": ["serial-1"],
                "sourceSelectId": ["张三"],
            },
            "excludedTrades": ["serial-1"],
            "excludedAccountId": ["100"],
            "excludedAccountName": ["张三"],
            "summarySelectedAccountId": ["200"],
            "summarySelectedAccountName": ["李四"],
            "sourceSelectId": ["张三"],
            "chatId": "11111111-1111-4111-8111-111111111111",
            "drillNums": 2,
            "drillType": 1,
            "minAmount": 100,
            "maxAmount": 2000,
        }
    )

    loaded = service.get_graph("graph-rich")

    assert created["graphContent"] == '{"cells":[]}'
    assert created["groupMap"]["100"]["groupId"] == "group-1"
    assert created["graphData"]["sourceSelectId"] == ["张三"]
    assert created["excludedAccountName"] == ["张三"]
    assert created["summarySelectedAccountName"] == ["李四"]
    assert created["sourceSelectId"] == ["张三"]
    assert created["chatId"] == "11111111-1111-4111-8111-111111111111"
    assert created["minAmount"] == 100
    assert created["maxAmount"] == 2000
    assert loaded == created


def test_current_context_is_written_per_case_and_graph(tmp_path: Path) -> None:
    module = _load_storage_module()
    service = module.CaseGraphStorage(workspace=tmp_path)
    service.create_graph(
        {
            "graph_id": "graph-context",
            "caseId": "case-1",
            "graphName": "主图",
            "tradeCards": [],
            "excludedTrades": [],
            "excludedAccountId": "",
            "drillNums": 1,
            "drillType": "out",
            "chatId": "22222222-2222-4222-8222-222222222222",
        }
    )

    context = service.write_current_context("graph-context", {"type": "node", "nodeId": "137"})

    context_path = (
        tmp_path
        / "data"
        / "case_graph_contexts"
        / "case-1"
        / "graph-context"
        / "current_context.json"
    )
    assert context_path.exists()
    assert not (tmp_path / "data" / "current_case_graph_context.json").exists()
    assert context["contextFile"] == str(context_path.resolve())
    assert context["chatId"] == "22222222-2222-4222-8222-222222222222"
    assert context["focus"] == {"type": "node", "nodeId": "137"}


def test_current_context_can_be_written_from_graph_metadata_without_snapshot(tmp_path: Path) -> None:
    module = _load_storage_module()
    service = module.CaseGraphStorage(workspace=tmp_path)

    context = service.write_current_context_from_metadata(
        graph_id="graph-context",
        case_id="case-1",
        graph_name="主图",
        chat_id="22222222-2222-4222-8222-222222222222",
        focus={"type": "node", "nodeId": "137"},
    )

    context_path = (
        tmp_path
        / "data"
        / "case_graph_contexts"
        / "case-1"
        / "graph-context"
        / "current_context.json"
    )
    assert context_path.exists()
    assert context["graphId"] == "graph-context"
    assert context["caseId"] == "case-1"
    assert context["graphName"] == "主图"
    assert context["chatId"] == "22222222-2222-4222-8222-222222222222"


def test_list_graphs_includes_graph_chat_id(tmp_path: Path) -> None:
    module = _load_storage_module()
    service = module.CaseGraphStorage(workspace=tmp_path)
    service.create_graph(
        {
            "graph_id": "graph-chat",
            "caseId": "case-1",
            "graphName": "主图",
            "tradeCards": [],
            "excludedTrades": [],
            "excludedAccountId": "",
            "drillNums": 1,
            "drillType": "out",
            "chatId": "33333333-3333-4333-8333-333333333333",
        }
    )

    [item] = service.list_graphs("case-1")

    assert item["chatId"] == "33333333-3333-4333-8333-333333333333"


def test_delete_graph_removes_snapshot_relation_state_and_context_files(tmp_path: Path) -> None:
    module = _load_storage_module()
    service = module.CaseGraphStorage(workspace=tmp_path)
    service.create_graph(
        {
            "graph_id": "graph-delete",
            "caseId": "case-1",
            "graphName": "主图",
            "tradeCards": [],
            "excludedTrades": [],
            "excludedAccountId": "",
            "drillNums": 1,
            "drillType": "out",
        }
    )
    snapshot_path = service._path_for_graph("graph-delete")
    relation_dir = (
        tmp_path
        / "data"
        / "case_graphs"
        / "case-1"
        / "graph-delete"
    )
    relation_dir.mkdir(parents=True)
    (relation_dir / "graph.json").write_text("{}", encoding="utf-8")
    context_dir = (
        tmp_path
        / "data"
        / "case_graph_contexts"
        / "case-1"
        / "graph-delete"
    )
    context_dir.mkdir(parents=True)
    (context_dir / "current_context.json").write_text("{}", encoding="utf-8")

    assert service.delete_graph("graph-delete") is True

    assert not snapshot_path.exists()
    assert not relation_dir.exists()
    assert not context_dir.exists()
    assert service.get_graph("graph-delete") is None


def test_delete_graph_returns_false_for_missing_graph(tmp_path: Path) -> None:
    module = _load_storage_module()
    service = module.CaseGraphStorage(workspace=tmp_path)

    assert service.delete_graph("missing") is False


def test_create_graph_rejects_empty_graph_id(tmp_path: Path) -> None:
    module = _load_storage_module()
    service = module.CaseGraphStorage(workspace=tmp_path)

    with pytest.raises(ValueError, match="graph_id"):
        service.create_graph(
            {
                "graph_id": "",
                "caseId": "case-1",
                "graphName": "主图",
                "tradeCards": [],
                "excludedTrades": [],
                "excludedAccountId": "",
                "drillNums": 1,
                "drillType": "out",
            }
        )


def test_create_graph_round_trips_excluded_account_and_drill_type(tmp_path: Path) -> None:
    module = _load_storage_module()
    service = module.CaseGraphStorage(workspace=tmp_path)

    created = service.create_graph(
        {
            "graph_id": "graph-2",
            "caseId": "case-1",
            "graphName": "主图",
            "tradeCards": [],
            "excludedTrades": [],
            "excludedAccountId": ["account-1", "account-2"],
            "drillNums": 1,
            "drillType": 2,
        }
    )

    loaded = service.get_graph("graph-2")

    assert created["excludedAccountId"] == ["account-1", "account-2"]
    assert isinstance(created["excludedAccountId"], list)
    assert created["drillType"] == 2
    assert isinstance(created["drillType"], int)
    assert loaded == created


def test_update_graph_raises_for_missing_graph(tmp_path: Path) -> None:
    module = _load_storage_module()
    service = module.CaseGraphStorage(workspace=tmp_path)

    with pytest.raises(KeyError, match="missing-graph"):
        service.update_graph("missing-graph", {"drillNums": 2})


def test_update_graph_rejects_invalid_trade_cards_without_overwriting_state(tmp_path: Path) -> None:
    module = _load_storage_module()
    service = module.CaseGraphStorage(workspace=tmp_path)
    created = service.create_graph(
        {
            "graph_id": "graph-3",
            "caseId": "case-1",
            "graphName": "主图",
            "tradeCards": [{"tradeId": "trade-1"}],
            "excludedTrades": ["trade-1"],
            "excludedAccountId": "",
            "drillNums": 1,
            "drillType": "out",
        }
    )

    with pytest.raises(TypeError, match="tradeCards"):
        service.update_graph("graph-3", {"tradeCards": "bad-payload"})

    assert service.get_graph("graph-3") == created


def test_update_graph_rejects_invalid_excluded_trades_without_overwriting_state(tmp_path: Path) -> None:
    module = _load_storage_module()
    service = module.CaseGraphStorage(workspace=tmp_path)
    created = service.create_graph(
        {
            "graph_id": "graph-4",
            "caseId": "case-1",
            "graphName": "主图",
            "tradeCards": [{"tradeId": "trade-1"}],
            "excludedTrades": ["trade-1"],
            "excludedAccountId": "",
            "drillNums": 1,
            "drillType": "out",
        }
    )

    with pytest.raises(TypeError, match="excludedTrades"):
        service.update_graph("graph-4", {"excludedTrades": "bad-payload"})

    assert service.get_graph("graph-4") == created


def test_graph_id_is_trimmed_for_storage_lookup(tmp_path: Path) -> None:
    module = _load_storage_module()
    service = module.CaseGraphStorage(workspace=tmp_path)

    created = service.create_graph(
        {
            "graph_id": " graph-5 ",
            "caseId": "case-1",
            "graphName": "主图",
            "tradeCards": [],
            "excludedTrades": [],
            "excludedAccountId": "",
            "drillNums": 1,
            "drillType": "out",
        }
    )

    assert created["graph_id"] == "graph-5"
    assert service.get_graph("graph-5") == created
    assert service.get_graph(" graph-5 ") == created
    assert len(list((tmp_path / "data" / "case_graphs").glob("*.json"))) == 1


def test_create_graph_rejects_nested_non_json_value(tmp_path: Path) -> None:
    module = _load_storage_module()
    service = module.CaseGraphStorage(workspace=tmp_path)

    with pytest.raises(TypeError, match="excludedAccountId"):
        service.create_graph(
            {
                "graph_id": "graph-6",
                "caseId": "case-1",
                "graphName": "主图",
                "tradeCards": [],
                "excludedTrades": [],
                "excludedAccountId": {"accounts": [object()]},
                "drillNums": 1,
                "drillType": "out",
            }
        )


def test_get_graph_raises_for_corrupt_file(tmp_path: Path) -> None:
    module = _load_storage_module()
    service = module.CaseGraphStorage(workspace=tmp_path)
    service.create_graph(
        {
            "graph_id": "graph-7",
            "caseId": "case-1",
            "graphName": "主图",
            "tradeCards": [],
            "excludedTrades": [],
            "excludedAccountId": "",
            "drillNums": 1,
            "drillType": "out",
        }
    )
    path = service._path_for_graph("graph-7")
    path.write_text("{broken", encoding="utf-8")

    with pytest.raises(module.CaseGraphDataCorruptError, match="graph-7"):
        service.get_graph("graph-7")


def test_update_graph_raises_for_corrupt_file(tmp_path: Path) -> None:
    module = _load_storage_module()
    service = module.CaseGraphStorage(workspace=tmp_path)
    service.create_graph(
        {
            "graph_id": "graph-8",
            "caseId": "case-1",
            "graphName": "主图",
            "tradeCards": [],
            "excludedTrades": [],
            "excludedAccountId": "",
            "drillNums": 1,
            "drillType": "out",
        }
    )
    path = service._path_for_graph("graph-8")
    path.write_text("{broken", encoding="utf-8")

    with pytest.raises(module.CaseGraphDataCorruptError, match="graph-8"):
        service.update_graph("graph-8", {"drillNums": 2})


def test_get_graph_raises_for_mismatched_graph_id_in_file(tmp_path: Path) -> None:
    module = _load_storage_module()
    service = module.CaseGraphStorage(workspace=tmp_path)
    service.create_graph(
        {
            "graph_id": "graph-9",
            "caseId": "case-1",
            "graphName": "主图",
            "tradeCards": [],
            "excludedTrades": [],
            "excludedAccountId": "",
            "drillNums": 1,
            "drillType": "out",
        }
    )
    path = service._path_for_graph("graph-9")
    path.write_text(
        """{
  "graph_id": "other-graph",
  "caseId": "case-1",
  "graphName": "主图",
  "tradeCards": [],
  "excludedTrades": [],
  "excludedAccountId": "",
  "drillNums": 1,
  "drillType": "out"
}
""",
        encoding="utf-8",
    )

    with pytest.raises(module.CaseGraphGraphIdMismatchError, match="graph-9"):
        service.get_graph("graph-9")


def test_update_graph_raises_for_mismatched_graph_id_in_file(tmp_path: Path) -> None:
    module = _load_storage_module()
    service = module.CaseGraphStorage(workspace=tmp_path)
    service.create_graph(
        {
            "graph_id": "graph-10",
            "caseId": "case-1",
            "graphName": "主图",
            "tradeCards": [],
            "excludedTrades": [],
            "excludedAccountId": "",
            "drillNums": 1,
            "drillType": "out",
        }
    )
    path = service._path_for_graph("graph-10")
    path.write_text(
        """{
  "graph_id": " other-graph ",
  "caseId": "case-1",
  "graphName": "主图",
  "tradeCards": [],
  "excludedTrades": [],
  "excludedAccountId": "",
  "drillNums": 1,
  "drillType": "out"
}
""",
        encoding="utf-8",
    )

    with pytest.raises(module.CaseGraphGraphIdMismatchError, match="graph-10"):
        service.update_graph("graph-10", {"drillNums": 2})


def test_corrupt_error_kinds_are_distinguishable(tmp_path: Path) -> None:
    module = _load_storage_module()
    service = module.CaseGraphStorage(workspace=tmp_path)
    service.create_graph(
        {
            "graph_id": "graph-11",
            "caseId": "case-1",
            "graphName": "主图",
            "tradeCards": [],
            "excludedTrades": [],
            "excludedAccountId": "",
            "drillNums": 1,
            "drillType": "out",
        }
    )
    corrupt_path = service._path_for_graph("graph-11")
    corrupt_path.write_text("{broken", encoding="utf-8")

    with pytest.raises(module.CaseGraphCorruptError) as corrupt_exc:
        service.get_graph("graph-11")

    assert isinstance(corrupt_exc.value, module.CaseGraphDataCorruptError)
    assert corrupt_exc.value.kind == "data_corrupt"

    service.create_graph(
        {
            "graph_id": "graph-12",
            "caseId": "case-1",
            "graphName": "主图",
            "tradeCards": [],
            "excludedTrades": [],
            "excludedAccountId": "",
            "drillNums": 1,
            "drillType": "out",
        }
    )
    mismatch_path = service._path_for_graph("graph-12")
    mismatch_path.write_text(
        """{
  "graph_id": "other-graph",
  "caseId": "case-1",
  "graphName": "主图",
  "tradeCards": [],
  "excludedTrades": [],
  "excludedAccountId": "",
  "drillNums": 1,
  "drillType": "out"
}
""",
        encoding="utf-8",
    )

    with pytest.raises(module.CaseGraphCorruptError) as mismatch_exc:
        service.update_graph("graph-12", {"drillNums": 2})

    assert isinstance(mismatch_exc.value, module.CaseGraphGraphIdMismatchError)
    assert mismatch_exc.value.kind == "graph_id_mismatch"
