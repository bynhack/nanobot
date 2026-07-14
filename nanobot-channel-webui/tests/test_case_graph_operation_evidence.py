from __future__ import annotations

import pytest

from nanobot_channel_webui.case_graph.operation_evidence import (
    evidence_from_business_fields,
    evidence_level_for_operation,
    normalize_operation_evidence,
)
from nanobot_channel_webui.case_graph.relation_storage import RelationGraphStorage


@pytest.mark.parametrize(
    ("operation_type", "group_operation", "expected"),
    [
        ("manual_exclude_node", None, "required"),
        ("detail_trade_filter", None, "required"),
        ("manual_node_add", None, "required"),
        ("manual_trade_add", None, "required"),
        ("reality_relation_add", None, "required"),
        ("complete_current_graph", None, "required"),
        ("manual_restore_node", None, "optional"),
        ("summary_analysis", None, "optional"),
        ("investigation_group_create", "create", "optional"),
        ("investigation_group_collapse", "collapse", "automatic"),
        ("investigation_group_expand", "expand", "automatic"),
        ("seed_one_hop", None, "automatic"),
        ("filter_current_graph", None, "automatic"),
    ],
)
def test_operation_evidence_levels(
    operation_type: str,
    group_operation: str | None,
    expected: str,
) -> None:
    assert evidence_level_for_operation(operation_type, group_operation=group_operation) == expected


def test_required_operation_rejects_missing_evidence() -> None:
    with pytest.raises(ValueError, match="请选择操作依据"):
        normalize_operation_evidence("manual_exclude_node", None)


def test_other_reason_requires_note() -> None:
    with pytest.raises(ValueError, match="请补充具体说明"):
        normalize_operation_evidence(
            "manual_exclude_node",
            {"reasonCode": "other", "reasonLabel": "其他", "note": "  "},
        )


def test_evidence_is_trimmed_and_level_is_server_owned() -> None:
    assert normalize_operation_evidence(
        "manual_exclude_node",
        {
            "level": "automatic",
            "reasonCode": "unrelated_to_case",
            "reasonLabel": " 核实与本案无关 ",
            "note": " 经询问确认属于正常经营关系 ",
        },
    ) == {
        "level": "required",
        "reasonCode": "unrelated_to_case",
        "reasonLabel": "核实与本案无关",
        "note": "经询问确认属于正常经营关系",
    }


def test_automatic_operation_gets_automatic_evidence_without_user_input() -> None:
    assert normalize_operation_evidence("seed_one_hop", None) == {"level": "automatic"}


def test_optional_operation_may_omit_evidence() -> None:
    assert normalize_operation_evidence("manual_restore_node", None) == {"level": "optional"}


def test_existing_business_fields_become_operation_evidence() -> None:
    assert evidence_from_business_fields(
        "现实关系说明",
        [("关系说明", " 户籍信息确认母女关系 "), ("空字段", "")],
    ) == {
        "reasonCode": "business_context_fields",
        "reasonLabel": "现实关系说明",
        "note": "关系说明：户籍信息确认母女关系",
    }


def test_empty_business_fields_do_not_fabricate_evidence() -> None:
    assert evidence_from_business_fields("人工补充主体依据", [("发现原因", " ")]) is None


def test_storage_rejects_required_step_without_evidence(tmp_path) -> None:
    storage = RelationGraphStorage(tmp_path)
    with pytest.raises(ValueError, match="请选择操作依据"):
        storage.save_step(
            case_id="case-1",
            graph_id="graph-1",
            step_type="manual_exclude_node",
            request={"caseId": "case-1", "graphId": "graph-1"},
            graph={"nodes": [], "edges": []},
            delta={},
            summary={"label": "取消上图"},
        )


def test_storage_persists_normalized_evidence_outside_request_params(tmp_path) -> None:
    storage = RelationGraphStorage(tmp_path)
    storage.save_step(
        case_id="case-1",
        graph_id="graph-1",
        step_type="manual_exclude_node",
        request={
            "caseId": "case-1",
            "graphId": "graph-1",
            "evidence": {
                "level": "automatic",
                "reasonCode": "unrelated_to_case",
                "reasonLabel": "核实与本案无关",
                "note": "询问笔录已核实",
            },
        },
        graph={"nodes": [], "edges": []},
        delta={},
        summary={"label": "取消上图"},
    )

    step = storage.list_steps("case-1", "graph-1")[-1]
    assert step["operation"]["evidence"] == {
        "level": "required",
        "reasonCode": "unrelated_to_case",
        "reasonLabel": "核实与本案无关",
        "note": "询问笔录已核实",
    }
    assert "evidence" not in step["operation"]["params"]
