"""Filesystem persistence for case audit files."""

from __future__ import annotations

import hashlib
import json
import re
import threading
import uuid
from collections.abc import Mapping
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from nanobot.config.paths import get_workspace_path

from ..storage_paths import case_audits_root


AUDIT_SCHEMA_VERSION = "case-audit-file.v1"
AUDIT_CONDITION_LIST_KEYS = ("victimCards", "victimNames", "suspectCards", "suspectNames", "sourceAccountCards", "sourceAccountNames")
AUDIT_CONDITION_TEXT_KEYS = ("sourceMode", "sourceAmount", "sourceLabel", "sourceFromAuditId", "sourceLayerIndex")
AUDIT_FILTER_KEYS = ("startTime", "endTime", "minAmount", "maxAmount")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _text(value: Any) -> str:
    return str(value or "").strip()


def _text_list(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        raw_items = value.replace("，", ",").replace("\n", ",").split(",")
        return list(dict.fromkeys(item.strip() for item in raw_items if item.strip()))
    if isinstance(value, list):
        return list(dict.fromkeys(_text(item) for item in value if _text(item)))
    return []


def _conditions(value: Mapping[str, Any] | None) -> dict[str, Any]:
    source = value or {}
    conditions: dict[str, Any] = {key: _text_list(source.get(key)) for key in AUDIT_CONDITION_LIST_KEYS}
    conditions.update({key: _text(source.get(key)) for key in AUDIT_CONDITION_TEXT_KEYS})
    return conditions


def _filters(value: Mapping[str, Any] | None) -> dict[str, str]:
    source = value or {}
    return {key: _text(source.get(key)) for key in AUDIT_FILTER_KEYS}


def _summary_from_result(result: Mapping[str, Any]) -> dict[str, Any]:
    summary = result.get("summary")
    suspect_results = result.get("suspectResults")
    quality = result.get("quality")
    trades = result.get("trades")
    warnings = quality.get("warnings") if isinstance(quality, dict) else []
    return {
        "summary": dict(summary) if isinstance(summary, dict) else {},
        "suspectResults": list(suspect_results) if isinstance(suspect_results, list) else [],
        "warningCount": len(warnings) if isinstance(warnings, list) else 0,
        "tradeCount": len(trades) if isinstance(trades, list) else 0,
    }


class CaseAuditStorage:
    """Persist case audit files under the plugin workspace."""

    _default_create_lock = threading.Lock()

    def __init__(self, *, workspace: Path | None = None) -> None:
        self._workspace = workspace or get_workspace_path()
        self._root = case_audits_root(self._workspace)
        self._root.mkdir(parents=True, exist_ok=True)

    @staticmethod
    def _file_key(value: str) -> str:
        return hashlib.sha1(value.encode("utf-8")).hexdigest()

    @classmethod
    def _safe_path_segment(cls, value: str) -> str:
        normalized = re.sub(r"[^A-Za-z0-9_.-]+", "-", _text(value))
        return normalized.strip(".-") or cls._file_key(_text(value) or "unknown")

    @staticmethod
    def _normalize_case_id(case_id: str) -> str:
        normalized = _text(case_id)
        if not normalized:
            raise ValueError("caseId")
        return normalized

    @staticmethod
    def _normalize_audit_id(audit_id: str) -> str:
        normalized = _text(audit_id)
        if not normalized:
            raise ValueError("auditId")
        return normalized

    def _case_root(self, case_id: str) -> Path:
        return self._root / self._safe_path_segment(self._normalize_case_id(case_id))

    def _audit_root(self, case_id: str, audit_id: str) -> Path:
        return self._case_root(case_id) / self._safe_path_segment(self._normalize_audit_id(audit_id))

    def _audit_path(self, case_id: str, audit_id: str) -> Path:
        return self._audit_root(case_id, audit_id) / "audit.json"

    def _result_path(self, case_id: str, audit_id: str) -> Path:
        return self._audit_root(case_id, audit_id) / "last_result.json"

    def create_audit(
        self,
        *,
        case_id: str,
        audit_name: str = "",
        conditions: Mapping[str, Any] | None = None,
        filters: Mapping[str, Any] | None = None,
    ) -> dict[str, Any]:
        normalized_case_id = self._normalize_case_id(case_id)
        now = _now_iso()
        audit_id = f"audit-{uuid.uuid4().hex[:12]}"
        state = {
            "schemaVersion": AUDIT_SCHEMA_VERSION,
            "auditId": audit_id,
            "caseId": normalized_case_id,
            "auditName": _text(audit_name) or "涉诈资金审计",
            "createdAt": now,
            "updatedAt": now,
            "conditions": _conditions(conditions),
            "filters": _filters(filters),
            "lastRun": None,
        }
        self._write_atomic(self._audit_path(normalized_case_id, audit_id), state)
        return state

    def get_or_create_default(self, case_id: str) -> dict[str, Any]:
        with self._default_create_lock:
            items = self.list_audits(case_id)
            if items:
                return items[0]
            return self.create_audit(case_id=case_id)

    def get_audit(self, audit_id: str, *, case_id: str | None = None) -> dict[str, Any] | None:
        normalized_audit_id = self._normalize_audit_id(audit_id)
        if case_id:
            path = self._audit_path(self._normalize_case_id(case_id), normalized_audit_id)
            return self._read_audit_path(path)
        for path in self._root.glob("*/**/audit.json"):
            state = self._read_audit_path(path)
            if state and state.get("auditId") == normalized_audit_id:
                return state
        return None

    def list_audits(self, case_id: str) -> list[dict[str, Any]]:
        case_root = self._case_root(case_id)
        if not case_root.exists():
            return []
        items: list[dict[str, Any]] = []
        for path in case_root.glob("*/audit.json"):
            state = self._read_audit_path(path)
            if state is not None:
                items.append(state)
        return sorted(items, key=lambda item: _text(item.get("updatedAt")), reverse=True)

    def update_audit(self, audit_id: str, patch: Mapping[str, Any]) -> dict[str, Any]:
        current = self.get_audit(audit_id, case_id=_text(patch.get("caseId")) or None)
        if current is None:
            raise KeyError(audit_id)
        updated = dict(current)
        if "auditName" in patch:
            updated["auditName"] = _text(patch.get("auditName")) or updated.get("auditName") or "涉诈资金审计"
        if "conditions" in patch and isinstance(patch.get("conditions"), Mapping):
            updated["conditions"] = _conditions(patch.get("conditions"))  # type: ignore[arg-type]
        if "filters" in patch and isinstance(patch.get("filters"), Mapping):
            updated["filters"] = _filters(patch.get("filters"))  # type: ignore[arg-type]
        updated["updatedAt"] = _now_iso()
        self._write_atomic(self._audit_path(updated["caseId"], updated["auditId"]), updated)
        return updated

    def save_run_result(
        self,
        audit_id: str,
        *,
        run_payload: Mapping[str, Any],
        result: Mapping[str, Any],
    ) -> dict[str, Any]:
        current = self.update_audit(
            audit_id,
            {
                "caseId": _text(run_payload.get("caseId")),
                "conditions": {
                    "victimCards": run_payload.get("victimCards"),
                    "victimNames": run_payload.get("victimNames"),
                    "suspectCards": run_payload.get("suspectCards"),
                    "suspectNames": run_payload.get("suspectNames"),
                    "sourceMode": run_payload.get("sourceMode"),
                    "sourceAccountCards": run_payload.get("sourceAccountCards"),
                    "sourceAccountNames": run_payload.get("sourceAccountNames"),
                    "sourceAmount": run_payload.get("sourceAmount"),
                    "sourceLabel": run_payload.get("sourceLabel"),
                    "sourceFromAuditId": run_payload.get("sourceFromAuditId"),
                    "sourceLayerIndex": run_payload.get("sourceLayerIndex"),
                },
                "filters": {
                    "startTime": run_payload.get("startTime"),
                    "endTime": run_payload.get("endTime"),
                    "minAmount": run_payload.get("minAmount"),
                    "maxAmount": run_payload.get("maxAmount"),
                },
            },
        )
        ran_at = _now_iso()
        result_path = self._result_path(current["caseId"], current["auditId"])
        self._write_atomic(result_path, dict(result))
        updated = dict(current)
        updated["lastRun"] = {
            "ranAt": ran_at,
            "resultFile": str(result_path.resolve()),
            **_summary_from_result(result),
        }
        updated["updatedAt"] = ran_at
        self._write_atomic(self._audit_path(updated["caseId"], updated["auditId"]), updated)
        return updated

    def _read_audit_path(self, path: Path) -> dict[str, Any] | None:
        if not path.exists():
            return None
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError, TypeError, ValueError):
            return None
        if not isinstance(payload, dict):
            return None
        case_id = _text(payload.get("caseId"))
        audit_id = _text(payload.get("auditId"))
        if not case_id or not audit_id:
            return None
        return {
            "schemaVersion": AUDIT_SCHEMA_VERSION,
            "auditId": audit_id,
            "caseId": case_id,
            "auditName": _text(payload.get("auditName")) or "涉诈资金审计",
            "createdAt": _text(payload.get("createdAt")),
            "updatedAt": _text(payload.get("updatedAt")),
            "conditions": _conditions(payload.get("conditions") if isinstance(payload.get("conditions"), Mapping) else None),
            "filters": _filters(payload.get("filters") if isinstance(payload.get("filters"), Mapping) else None),
            "lastRun": payload.get("lastRun") if isinstance(payload.get("lastRun"), dict) else None,
        }

    @staticmethod
    def _write_atomic(path: Path, payload: Mapping[str, Any]) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        temp_path = path.with_suffix(".json.tmp")
        temp_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        temp_path.replace(path)
