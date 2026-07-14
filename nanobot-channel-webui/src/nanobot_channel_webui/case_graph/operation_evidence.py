"""Risk levels and validation for case-graph operation evidence."""

from __future__ import annotations

from typing import Any, Literal, Mapping

OperationEvidenceLevel = Literal["required", "optional", "automatic"]

_REQUIRED_OPERATION_TYPES = {
    "manual_exclude_node",
    "detail_trade_filter",
    "manual_node_add",
    "manual_trade_add",
    "reality_relation_add",
    "complete_current_graph",
}

_OPTIONAL_OPERATION_TYPES = {
    "manual_restore_node",
    "summary_analysis",
}


def evidence_from_business_fields(
    reason_label: str,
    fields: list[tuple[str, Any]],
) -> dict[str, str] | None:
    notes = [
        f"{label}：{str(value).strip()}"
        for label, value in fields
        if str(value or "").strip()
    ]
    if not notes:
        return None
    return {
        "reasonCode": "business_context_fields",
        "reasonLabel": reason_label,
        "note": "；".join(notes),
    }


def evidence_level_for_operation(
    operation_type: str,
    *,
    group_operation: str | None = None,
) -> OperationEvidenceLevel:
    normalized_type = str(operation_type or "").strip()
    normalized_group_operation = str(group_operation or "").strip()
    if normalized_type.startswith("investigation_group_"):
        if normalized_group_operation in {"collapse", "expand"} or normalized_type in {
            "investigation_group_collapse",
            "investigation_group_expand",
        }:
            return "automatic"
        return "optional"
    if normalized_type in _REQUIRED_OPERATION_TYPES:
        return "required"
    if normalized_type in _OPTIONAL_OPERATION_TYPES:
        return "optional"
    return "automatic"


def normalize_operation_evidence(
    operation_type: str,
    evidence: Mapping[str, Any] | None,
    *,
    group_operation: str | None = None,
    level_override: OperationEvidenceLevel | None = None,
) -> dict[str, str]:
    level = level_override or evidence_level_for_operation(
        operation_type,
        group_operation=group_operation,
    )
    payload = evidence if isinstance(evidence, Mapping) else {}
    reason_code = str(payload.get("reasonCode") or "").strip()
    reason_label = str(payload.get("reasonLabel") or "").strip()
    note = str(payload.get("note") or "").strip()

    if level == "required" and not reason_code:
        raise ValueError("请选择操作依据")
    if reason_code and not reason_label:
        raise ValueError("操作依据标签不能为空")
    if reason_code == "other" and not note:
        raise ValueError("选择其他依据时，请补充具体说明")

    normalized: dict[str, str] = {"level": level}
    if reason_code:
        normalized["reasonCode"] = reason_code[:80]
        normalized["reasonLabel"] = reason_label[:120]
    if note:
        normalized["note"] = note[:1000]
    return normalized
