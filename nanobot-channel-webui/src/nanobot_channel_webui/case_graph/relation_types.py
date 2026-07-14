"""Types and normalization helpers for relation graph workflows."""

from __future__ import annotations

from typing import Any

SCHEMA_VERSION = "case-graph.relation.v1"


def _text(value: Any) -> str:
    return str(value or "").strip()


def _string_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [_text(item) for item in value if _text(item)]


def _positive_int(value: Any, *, default: int, max_value: int = 1000) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return default
    return max(1, min(parsed, max_value))


def _drill_type(value: Any) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return 1
    return parsed if parsed in {1, 2, 3} else 1


def normalize_relation_query_payload(payload: dict[str, Any]) -> dict[str, Any]:
    case_id = _text(payload.get("caseId"))
    graph_id = _text(payload.get("graphId"))
    if not case_id:
        raise ValueError("caseId")
    if not graph_id:
        raise ValueError("graphId")

    seeds: list[dict[str, Any]] = []
    for raw_seed in payload.get("seeds") or []:
        if not isinstance(raw_seed, dict):
            continue
        account_ids = _string_list(raw_seed.get("accountIds"))
        excluded = set(_string_list(raw_seed.get("excludedAccountIds")))
        active = [account_id for account_id in account_ids if account_id not in excluded]
        if not active:
            continue
        seeds.append(
            {
                "suspectId": _text(raw_seed.get("suspectId")),
                "suspectName": _text(raw_seed.get("suspectName")),
                "accountIds": account_ids,
                "excludedAccountIds": sorted(excluded),
                "activeAccountIds": active,
                "accounts": [
                    {
                        "accountId": _text(account.get("accountId")),
                        "tradeCard": _text(account.get("tradeCard") or account.get("payAccount")),
                        "accountName": _text(account.get("accountName")),
                    }
                    for account in raw_seed.get("accounts") or []
                    if isinstance(account, dict) and _text(account.get("accountId")) in active
                ],
            }
        )
    if not seeds:
        raise ValueError("seeds")

    direction = _text(payload.get("direction")) or "both"
    if direction not in {"in", "out", "both"}:
        direction = "both"
    filters = dict(payload.get("filters") or {}) if isinstance(payload.get("filters"), dict) else {}
    options = dict(payload.get("options") or {}) if isinstance(payload.get("options"), dict) else {}
    return {
        "caseId": case_id,
        "graphId": graph_id,
        "seeds": seeds,
        "direction": direction,
        "drillNums": _positive_int(payload.get("drillNums") or payload.get("limit"), default=10),
        "drillType": _drill_type(payload.get("drillType")),
        "filters": filters,
        "options": options,
        "evidence": dict(payload.get("evidence") or {}) if isinstance(payload.get("evidence"), dict) else None,
        "evidenceContext": _text(payload.get("evidenceContext")) or None,
    }
