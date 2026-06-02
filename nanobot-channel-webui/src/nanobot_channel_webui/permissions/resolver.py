"""Resolve WebUI users into permission contexts."""

from __future__ import annotations

from typing import Any

from ..user_context import CurrentUser
from .context import PolicyContext


class PolicyResolver:
    """Build a conservative default policy for WebUI users."""

    def resolve(self, user: CurrentUser | None) -> PolicyContext:
        if user is None:
            return PolicyContext()
        if user.is_admin:
            return PolicyContext(
                user_id=user.id,
                email=user.email,
                tenant_id=str(getattr(user, "tenant_id", "") or ""),
                role="admin",
                business_role="admin",
                skill_allowlist=frozenset({"*"}),
                exec_mode="allow",
            )

        tenant_policy = getattr(user, "tenant_policy", None)
        if isinstance(tenant_policy, dict):
            payload = dict(tenant_policy)
            payload.setdefault("user_id", user.id)
            payload.setdefault("email", user.email)
            payload.setdefault("role", user.role)
            payload.setdefault("business_role", self._business_role(user))
            return PolicyContext.from_payload(payload)

        scopes = self._scopes(user)
        skills = self._skills(user)
        resources = self._resources(user)
        return PolicyContext(
            user_id=user.id,
            email=user.email,
            tenant_id=str(getattr(user, "tenant_id", "") or ""),
            role=user.role,
            business_role=self._business_role(user),
            skill_allowlist=frozenset(skills),
            scopes=scopes,
            resources=tuple(resources),
            exec_mode="deny_by_default",
        )

    @staticmethod
    def _business_role(user: CurrentUser) -> str:
        raw = getattr(user, "business_role", "") or getattr(user, "businessRole", "")
        return str(raw).strip() or "hr_specialist"

    @staticmethod
    def _scopes(user: CurrentUser) -> dict[str, tuple[str, ...]]:
        raw = getattr(user, "scopes", None)
        result: dict[str, tuple[str, ...]] = {}
        if isinstance(raw, dict):
            for key, value in raw.items():
                if isinstance(value, str):
                    values = tuple(item.strip() for item in value.replace("，", ",").split(",") if item.strip())
                elif isinstance(value, (list, tuple, set)):
                    values = tuple(str(item).strip() for item in value if str(item).strip())
                else:
                    values = ()
                if values:
                    result[str(key).strip()] = values
        return result

    @staticmethod
    def _skills(user: CurrentUser) -> list[str]:
        raw = getattr(user, "skills", None)
        if isinstance(raw, str):
            values = [item.strip() for item in raw.replace("，", ",").split(",")]
        elif isinstance(raw, (list, tuple, set)):
            values = [str(item).strip() for item in raw]
        else:
            values = []
        result: list[str] = []
        seen: set[str] = set()
        for value in values:
            if value and value not in seen:
                result.append(value)
                seen.add(value)
        return result

    @staticmethod
    def _resources(user: CurrentUser) -> list[dict[str, Any]]:
        raw = getattr(user, "resources", None)
        if isinstance(raw, list):
            return [dict(item) for item in raw if isinstance(item, dict)]
        return []
