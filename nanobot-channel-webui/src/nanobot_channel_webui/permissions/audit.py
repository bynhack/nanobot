"""Permission audit logging."""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Any

from .context import PolicyContext


AUDIT_SCHEMA_VERSION = "tenant-runtime/audit/v1"


class PermissionAuditLogger:
    """Append allow/deny decisions to workspace JSONL."""

    def __init__(self, workspace: Path) -> None:
        self._path = workspace / ".nanobot_channel_webui" / "audit" / "permissions.jsonl"

    @property
    def path(self) -> Path:
        return self._path

    def record(
        self,
        *,
        policy: PolicyContext | None,
        tool: str,
        decision: str,
        reason: str,
        command: str = "",
        metadata: dict[str, Any] | None = None,
    ) -> None:
        if policy is None:
            return
        self._path.parent.mkdir(parents=True, exist_ok=True)
        payload: dict[str, Any] = {
            "version": AUDIT_SCHEMA_VERSION,
            "ts": datetime.now().astimezone().isoformat(),
            "user_id": policy.user_id,
            "email": policy.email,
            "role": policy.role,
            "business_role": policy.business_role,
            "chat_id": policy.chat_id,
            "tool": tool,
            "command": command,
            "decision": decision,
            "reason": reason,
            "scopes": {key: list(values) for key, values in policy.effective_scopes.items()},
            "tenant_policy": policy.to_tenant_policy().to_payload(),
        }
        if metadata:
            payload["metadata"] = metadata
        with self._path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(payload, ensure_ascii=False) + "\n")

    def recent(self, *, email: str = "", include_all: bool = False, limit: int = 100) -> list[dict[str, Any]]:
        if not self._path.exists():
            return []
        rows: list[dict[str, Any]] = []
        try:
            lines = self._path.read_text(encoding="utf-8").splitlines()
        except Exception:
            return []
        for line in reversed(lines):
            if not line.strip():
                continue
            try:
                payload = json.loads(line)
            except json.JSONDecodeError:
                continue
            if not isinstance(payload, dict):
                continue
            if not include_all and email and str(payload.get("email") or "") != email:
                continue
            rows.append(normalize_audit_event(payload))
            if len(rows) >= limit:
                break
        return rows


def normalize_audit_event(payload: dict[str, Any]) -> dict[str, Any]:
    tenant_policy = payload.get("tenant_policy") if isinstance(payload.get("tenant_policy"), dict) else {}
    subject = tenant_policy.get("subject") if isinstance(tenant_policy.get("subject"), dict) else {}
    return {
        "version": str(payload.get("version") or "permissions/audit-legacy"),
        "ts": str(payload.get("ts") or ""),
        "user_id": str(payload.get("user_id") or subject.get("user_id") or ""),
        "email": str(payload.get("email") or subject.get("email") or ""),
        "role": str(payload.get("role") or subject.get("role") or ""),
        "business_role": str(payload.get("business_role") or subject.get("business_role") or ""),
        "chat_id": str(payload.get("chat_id") or tenant_policy.get("chat_id") or ""),
        "tool": str(payload.get("tool") or ""),
        "command": str(payload.get("command") or ""),
        "decision": str(payload.get("decision") or ""),
        "reason": str(payload.get("reason") or ""),
        "scopes": _normalize_audit_scopes(payload, tenant_policy),
        "tenant_policy": tenant_policy,
        "metadata": payload.get("metadata") if isinstance(payload.get("metadata"), dict) else {},
    }


def _normalize_audit_scopes(
    payload: dict[str, Any],
    tenant_policy: dict[str, Any],
) -> dict[str, list[str]]:
    scopes = payload.get("scopes")
    if isinstance(scopes, dict):
        return {
            str(key): [str(item) for item in value if str(item)]
            for key, value in scopes.items()
            if isinstance(value, list)
        }
    legacy_company_scope = payload.get("company_scope")
    if isinstance(legacy_company_scope, list):
        return {"company": [str(item) for item in legacy_company_scope if str(item)]}
    policy_scopes = tenant_policy.get("scopes") if isinstance(tenant_policy.get("scopes"), dict) else {}
    return {
        str(key): [str(item) for item in value if str(item)]
        for key, value in policy_scopes.items()
        if isinstance(value, list)
    }
