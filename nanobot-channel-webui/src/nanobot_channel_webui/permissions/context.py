"""Per-request permission context."""

from __future__ import annotations

import json
from contextlib import contextmanager
from contextvars import ContextVar, Token
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


@dataclass(frozen=True, slots=True)
class PolicyContext:
    """Resolved permissions for one WebUI user request."""

    user_id: str = ""
    email: str = ""
    role: str = "user"
    business_role: str = "scoped"
    tenant_id: str = ""
    skill_allowlist: frozenset[str] = field(default_factory=frozenset)
    scopes: dict[str, tuple[str, ...]] = field(default_factory=dict)
    resources: tuple[dict[str, Any], ...] = ()
    exec_mode: str = "allow"
    chat_id: str = ""
    policy_file: str = ""

    @property
    def is_admin(self) -> bool:
        return self.role == "admin" or self.business_role == "admin"

    @property
    def is_unrestricted(self) -> bool:
        return self.is_admin

    def can_use_skill(self, name: str) -> bool:
        if self.is_unrestricted:
            return True
        return "*" in self.skill_allowlist or name in self.skill_allowlist

    def to_policy_payload(self) -> dict[str, Any]:
        payload = {
            "user_id": self.user_id,
            "email": self.email,
            "tenant_id": self.tenant_id,
            "role": self.role,
            "business_role": self.business_role,
            "scopes": {key: list(values) for key, values in self.effective_scopes.items()},
            "resources": [dict(item) for item in self.resources],
            "chat_id": self.chat_id,
            "policy_file": self.policy_file,
        }
        payload.update(self.to_tenant_policy().to_payload())
        return payload

    def to_tenant_policy(self):
        from ..tenant_runtime.contracts import TenantPolicy

        return TenantPolicy.from_payload(
            {
                "user_id": self.user_id,
                "email": self.email,
                "tenant_id": self.tenant_id,
                "role": self.role,
                "business_role": self.business_role,
                "scopes": {key: list(values) for key, values in self.effective_scopes.items()},
                "resources": [dict(item) for item in self.resources],
                "skills": sorted(self.skill_allowlist),
                "chat_id": self.chat_id,
                "policy_file": self.policy_file,
            }
        )

    @property
    def effective_scopes(self) -> dict[str, tuple[str, ...]]:
        return self.scopes

    @classmethod
    def from_payload(cls, payload: dict[str, Any]) -> "PolicyContext":
        role = str(payload.get("role") or "user").strip()
        business_role = str(payload.get("business_role") or ("admin" if role == "admin" else "hr_specialist")).strip()
        return cls(
            user_id=str(payload.get("user_id") or ""),
            email=str(payload.get("email") or ""),
            tenant_id=str(payload.get("tenant_id") or payload.get("tenantId") or ""),
            role=role,
            business_role=business_role,
            skill_allowlist=frozenset(
                _tuple_of_strings(payload.get("skills") or payload.get("skill_allowlist") or payload.get("allowed_skills"))
            ),
            scopes=_normalize_scopes(payload.get("scopes")),
            resources=tuple(dict(item) for item in payload.get("resources", []) if isinstance(item, dict))
            if isinstance(payload.get("resources"), list)
            else (),
            exec_mode="allow" if role == "admin" or business_role == "admin" else "deny_by_default",
            chat_id=str(payload.get("chat_id") or ""),
            policy_file=str(payload.get("policy_file") or ""),
        )

    def with_chat(self, chat_id: str, policy_file: str = "") -> "PolicyContext":
        return PolicyContext(
            user_id=self.user_id,
            email=self.email,
            tenant_id=self.tenant_id,
            role=self.role,
            business_role=self.business_role,
            skill_allowlist=self.skill_allowlist,
            scopes=self.scopes,
            resources=self.resources,
            exec_mode=self.exec_mode,
            chat_id=chat_id,
            policy_file=policy_file,
        )

    def write_policy_file(self, root: Path) -> "PolicyContext":
        if self.is_unrestricted or not self.chat_id:
            return self
        policy_dir = root / ".nanobot_channel_webui" / "policies"
        policy_dir.mkdir(parents=True, exist_ok=True)
        path = policy_dir / f"{self.chat_id}.json"
        path.write_text(
            json.dumps(self.to_policy_payload(), ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        return self.with_chat(self.chat_id, str(path))


_POLICY_CONTEXT: ContextVar[PolicyContext | None] = ContextVar(
    "nanobot_channel_webui_policy_context",
    default=None,
)


def get_policy_context() -> PolicyContext | None:
    return _POLICY_CONTEXT.get()


def _tuple_of_strings(value: Any) -> tuple[str, ...]:
    if value is None:
        return ()
    if isinstance(value, str):
        items = value.replace("，", ",").split(",")
    elif isinstance(value, (list, tuple, set, frozenset)):
        items = value
    else:
        items = (value,)
    return tuple(str(item).strip() for item in items if str(item).strip())


def _normalize_scopes(raw: Any) -> dict[str, tuple[str, ...]]:
    if not isinstance(raw, dict):
        return {}
    result: dict[str, tuple[str, ...]] = {}
    for key, value in raw.items():
        if isinstance(value, str):
            values = tuple(item.strip() for item in value.replace("，", ",").split(",") if item.strip())
        elif isinstance(value, (list, tuple, set, frozenset)):
            values = tuple(str(item).strip() for item in value if str(item).strip())
        else:
            values = ()
        if values:
            result[str(key).strip()] = values
    return result


@contextmanager
def bind_policy_context(policy: PolicyContext | None):
    token: Token[PolicyContext | None] = _POLICY_CONTEXT.set(policy)
    try:
        yield
    finally:
        _POLICY_CONTEXT.reset(token)
