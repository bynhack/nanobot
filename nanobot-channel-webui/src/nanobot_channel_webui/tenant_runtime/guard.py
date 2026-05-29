"""Guard SDK for business skills and command wrappers."""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .contracts import TenantPolicy


class TenantAccessDenied(PermissionError):
    """Raised when a scoped user attempts to access unauthorized data."""


@dataclass(frozen=True, slots=True)
class GuardDecision:
    allowed: bool
    reason: str


class TenantGuard:
    """Small SDK used by business skills to enforce injected tenant policy."""

    def __init__(self, policy: TenantPolicy) -> None:
        self.policy = policy

    @classmethod
    def from_payload(cls, payload: dict[str, Any]) -> "TenantGuard":
        return cls(TenantPolicy.from_payload(payload))

    @classmethod
    def from_file(cls, path: str | Path) -> "TenantGuard":
        payload = json.loads(Path(path).read_text(encoding="utf-8"))
        return cls.from_payload(payload)

    @classmethod
    def from_environment(cls, env: dict[str, str] | None = None) -> "TenantGuard":
        source = env or os.environ
        policy_file = source.get("NANOBOT_WEBUI_POLICY_FILE", "").strip()
        if policy_file:
            return cls.from_file(policy_file)
        payload = {
            "user_id": source.get("NANOBOT_WEBUI_USER_ID", ""),
            "email": source.get("NANOBOT_WEBUI_USER_EMAIL", ""),
            "role": source.get("NANOBOT_WEBUI_ROLE", "admin"),
            "business_role": source.get("NANOBOT_WEBUI_BUSINESS_ROLE", "admin"),
            "resources": [],
            "scopes": {},
        }
        return cls.from_payload(payload)

    @property
    def is_unrestricted(self) -> bool:
        return self.policy.is_unrestricted

    def decide(
        self,
        resource: str,
        action: str,
        *,
        scope_key: str = "",
        scope_value: str = "",
    ) -> GuardDecision:
        if self.policy.allows(resource, action, scope_key=scope_key, scope_value=scope_value):
            return GuardDecision(True, "allowed")
        return GuardDecision(False, "tenant_scope_denied")

    def require(
        self,
        resource: str,
        action: str,
        *,
        scope_key: str = "",
        scope_value: str = "",
    ) -> None:
        decision = self.decide(resource, action, scope_key=scope_key, scope_value=scope_value)
        if not decision.allowed:
            raise TenantAccessDenied(decision.reason)

    def filter_scope_values(self, resource: str, action: str, values: list[str], *, scope_key: str) -> list[str]:
        return [
            value
            for value in values
            if self.policy.allows(resource, action, scope_key=scope_key, scope_value=value)
        ]

    def scope_rows(
        self,
        resource: str,
        action: str,
        rows: list[dict[str, Any]],
        *,
        scope_key: str,
        field: str | None = None,
    ) -> list[dict[str, Any]]:
        """Filter dictionaries by one scoped business field.

        Business skills should use this after loading data and before returning
        results. The field defaults to `scope_key`, so a company scope expects a
        `company` field unless the skill passes a domain-specific field name.
        """

        source_field = field or scope_key
        return [
            row
            for row in rows
            if self.policy.allows(
                resource,
                action,
                scope_key=scope_key,
                scope_value=str(row.get(source_field) or ""),
            )
        ]

    def allowed_scope_values(self, resource: str, scope_key: str) -> tuple[str, ...]:
        return self.policy.scope_values(resource, scope_key)
