"""Current-user request context helpers."""

from __future__ import annotations

from contextlib import contextmanager
from contextvars import ContextVar, Token
from dataclasses import dataclass
from typing import Any

from .pocketbase import PocketBaseUser, UserRole


@dataclass(frozen=True, slots=True)
class CurrentUser:
    id: str
    email: str
    role: UserRole
    token: str
    business_role: str = ""
    tenant_id: str = ""
    scopes: dict[str, Any] | None = None
    resources: list[dict[str, Any]] | None = None
    skills: list[str] | str | None = None
    tenant_policy: dict[str, Any] | None = None

    @property
    def is_admin(self) -> bool:
        return self.role == "admin"

    @classmethod
    def from_pocketbase_user(cls, user: PocketBaseUser) -> "CurrentUser":
        return cls(
            id=user.id,
            email=user.email,
            role=user.role,
            token=user.token,
            business_role=user.business_role,
            tenant_id=user.tenant_id,
            scopes=user.scopes,
            resources=user.resources,
            skills=user.skills,
            tenant_policy=user.tenant_policy,
        )


_CURRENT_USER: ContextVar[CurrentUser | None] = ContextVar("nanobot_channel_webui_current_user", default=None)


def get_current_user() -> CurrentUser | None:
    return _CURRENT_USER.get()


@contextmanager
def bind_current_user(user: CurrentUser | None):
    token: Token[CurrentUser | None] = _CURRENT_USER.set(user)
    try:
        yield
    finally:
        _CURRENT_USER.reset(token)
