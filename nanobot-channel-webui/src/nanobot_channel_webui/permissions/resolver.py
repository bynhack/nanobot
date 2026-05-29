"""Resolve WebUI users into permission contexts."""

from __future__ import annotations

from typing import Any

from ..user_context import CurrentUser
from .context import PolicyContext


HR_UMBRELLA_RESOURCE = "hr.employee"
HR_DERIVED_RESOURCES = (
    "hr.organization",
    "hr.department",
    "hr.employee",
    "hr.contract",
    "hr.performance",
    "hr.insurance",
    "hr.personnel_change",
    "hr.disciplinary",
    "hr.seal_usage",
)


class PolicyResolver:
    """Build a conservative default policy for WebUI users."""

    def resolve(self, user: CurrentUser | None) -> PolicyContext:
        if user is None or user.is_admin:
            return PolicyContext()

        tenant_policy = getattr(user, "tenant_policy", None)
        if isinstance(tenant_policy, dict):
            payload = dict(tenant_policy)
            payload.setdefault("user_id", user.id)
            payload.setdefault("email", user.email)
            payload.setdefault("role", user.role)
            payload.setdefault("business_role", self._business_role(user))
            payload["resources"] = _expand_hr_umbrella_resources(payload.get("resources"))
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
            resources=tuple(_expand_hr_umbrella_resources(resources)),
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
        return [item for item in values if item]

    @staticmethod
    def _resources(user: CurrentUser) -> list[dict[str, Any]]:
        raw = getattr(user, "resources", None)
        if isinstance(raw, list):
            return [dict(item) for item in raw if isinstance(item, dict)]
        return []


def _expand_hr_umbrella_resources(raw: Any) -> list[dict[str, Any]]:
    """Normalize the legacy HR umbrella permission into explicit business resources.

    Existing HR users were configured with a coarse ``hr.employee`` permission that
    represented the whole HR data domain. The runtime contract is now resource
    based, so we expand that umbrella into the concrete HR resources while keeping
    any explicitly configured resource authoritative.
    """

    if not isinstance(raw, list):
        return []

    resources = [dict(item) for item in raw if isinstance(item, dict)]
    explicit_resources = {
        str(item.get("resource") or "").strip()
        for item in resources
        if str(item.get("resource") or "").strip() and str(item.get("resource") or "").strip() != HR_UMBRELLA_RESOURCE
    }
    result: list[dict[str, Any]] = []
    seen: set[str] = set()

    for item in resources:
        resource = str(item.get("resource") or "").strip()
        if not resource:
            continue

        if resource not in seen:
            result.append(dict(item))
            seen.add(resource)

        if resource != HR_UMBRELLA_RESOURCE:
            continue

        for derived in HR_DERIVED_RESOURCES:
            if derived in seen or derived in explicit_resources:
                continue
            expanded = dict(item)
            expanded["resource"] = derived
            result.append(expanded)
            seen.add(derived)

    return result
