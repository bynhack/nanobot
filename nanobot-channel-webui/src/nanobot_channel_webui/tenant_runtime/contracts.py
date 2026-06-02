"""Generic tenant-runtime contracts.

The classes in this module are intentionally business-neutral. HR-specific
fields can still exist in compatibility payloads, but new code should describe
authorization in terms of subjects, scopes, resources, actions, and decisions.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


TENANT_POLICY_VERSION = "tenant-runtime/v1"


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


@dataclass(frozen=True, slots=True)
class TenantSubject:
    """User identity and high-level role for one tenant request."""

    user_id: str = ""
    email: str = ""
    role: str = "user"
    business_role: str = "scoped"
    tenant_id: str = ""

    @property
    def is_admin(self) -> bool:
        return self.role == "admin" or self.business_role == "admin"

    def to_payload(self) -> dict[str, str]:
        return {
            "user_id": self.user_id,
            "email": self.email,
            "role": self.role,
            "business_role": self.business_role,
            "tenant_id": self.tenant_id,
        }

    @classmethod
    def from_payload(cls, payload: dict[str, Any]) -> "TenantSubject":
        return cls(
            user_id=str(payload.get("user_id") or ""),
            email=str(payload.get("email") or ""),
            role=str(payload.get("role") or "user"),
            business_role=str(payload.get("business_role") or payload.get("businessRole") or "scoped"),
            tenant_id=str(payload.get("tenant_id") or payload.get("tenantId") or ""),
        )


@dataclass(frozen=True, slots=True)
class ResourceScope:
    """Scope values attached to one resource dimension, for example company."""

    key: str
    values: tuple[str, ...] = ()

    @property
    def allows_all(self) -> bool:
        return "*" in self.values

    def allows(self, value: str | None) -> bool:
        if self.allows_all:
            return True
        normalized = (value or "").strip()
        return bool(normalized) and normalized in self.values

    def to_payload(self) -> dict[str, Any]:
        return {"key": self.key, "values": list(self.values)}

    @classmethod
    def from_payload(cls, payload: dict[str, Any]) -> "ResourceScope":
        return cls(key=str(payload.get("key") or ""), values=_tuple_of_strings(payload.get("values")))


@dataclass(frozen=True, slots=True)
class ResourcePermission:
    """Allowed actions and scopes for one logical business resource."""

    resource: str
    actions: tuple[str, ...] = ()
    scopes: tuple[ResourceScope, ...] = ()

    def allows_action(self, action: str) -> bool:
        return "*" in self.actions or action in self.actions

    def scope(self, key: str) -> ResourceScope | None:
        return next((scope for scope in self.scopes if scope.key == key), None)

    def to_payload(self) -> dict[str, Any]:
        return {
            "resource": self.resource,
            "actions": list(self.actions),
            "scopes": [scope.to_payload() for scope in self.scopes],
        }

    @classmethod
    def from_payload(cls, payload: dict[str, Any]) -> "ResourcePermission":
        scopes = payload.get("scopes")
        return cls(
            resource=str(payload.get("resource") or ""),
            actions=_tuple_of_strings(payload.get("actions")),
            scopes=tuple(ResourceScope.from_payload(item) for item in scopes if isinstance(item, dict))
            if isinstance(scopes, list)
            else (),
        )


@dataclass(frozen=True, slots=True)
class TenantPolicy:
    """Standard policy payload injected into tools and business skills."""

    subject: TenantSubject = field(default_factory=TenantSubject)
    resources: tuple[ResourcePermission, ...] = ()
    skills: tuple[str, ...] = ()
    chat_id: str = ""
    policy_file: str = ""
    tenant_id: str = ""
    version: str = TENANT_POLICY_VERSION

    @property
    def is_unrestricted(self) -> bool:
        return self.subject.is_admin

    def resource(self, name: str) -> ResourcePermission | None:
        if self.is_unrestricted:
            return ResourcePermission(resource=name, actions=("*",), scopes=(ResourceScope("*", ("*",)),))
        return next((item for item in self.resources if item.resource == name), None)

    def allows(self, resource: str, action: str, *, scope_key: str = "", scope_value: str = "") -> bool:
        if self.is_unrestricted:
            return True
        permission = self.resource(resource)
        if permission is None or not permission.allows_action(action):
            return False
        if not scope_key:
            return True
        scope = permission.scope(scope_key)
        return scope is not None and scope.allows(scope_value)

    def scope_values(self, resource: str, scope_key: str) -> tuple[str, ...]:
        if self.is_unrestricted:
            return ("*",)
        permission = self.resource(resource)
        if permission is None:
            return ()
        scope = permission.scope(scope_key)
        return scope.values if scope is not None else ()

    def to_payload(self) -> dict[str, Any]:
        return {
            "version": self.version,
            "subject": self.subject.to_payload(),
            "resources": [item.to_payload() for item in self.resources],
            "skills": list(self.skills),
            "chat_id": self.chat_id,
            "policy_file": self.policy_file,
            "tenant_id": self.tenant_id or self.subject.tenant_id,
        }

    @classmethod
    def from_payload(cls, payload: dict[str, Any]) -> "TenantPolicy":
        subject_payload = payload.get("subject")
        subject = (
            TenantSubject.from_payload(subject_payload)
            if isinstance(subject_payload, dict)
            else TenantSubject.from_payload(payload)
        )
        resources = payload.get("resources")
        if not isinstance(resources, list) and isinstance(payload.get("data_permissions"), list):
            resources = []
            for item in payload["data_permissions"]:
                if not isinstance(item, dict):
                    continue
                scope_key = str(item.get("scope_key") or item.get("scopeKey") or item.get("scope") or "")
                values = item.get("values")
                resources.append({
                    "resource": item.get("resource"),
                    "actions": item.get("actions"),
                    "scopes": [{"key": scope_key, "values": values}] if scope_key else [],
                })
        if not isinstance(resources, list):
            resources = []
        return cls(
            subject=subject,
            resources=tuple(ResourcePermission.from_payload(item) for item in resources if isinstance(item, dict)),
            skills=_tuple_of_strings(payload.get("skills") or payload.get("skill_allowlist")),
            chat_id=str(payload.get("chat_id") or ""),
            policy_file=str(payload.get("policy_file") or ""),
            tenant_id=str(payload.get("tenant_id") or payload.get("tenantId") or subject.tenant_id or ""),
            version=str(payload.get("version") or TENANT_POLICY_VERSION),
        )
