"""Current-user request context helpers."""

from __future__ import annotations

from contextlib import contextmanager
from contextvars import ContextVar, Token
from dataclasses import dataclass

from .pocketbase import PocketBaseUser, UserRole


@dataclass(frozen=True, slots=True)
class CurrentUser:
    id: str
    email: str
    role: UserRole
    token: str

    @property
    def is_admin(self) -> bool:
        return self.role == "admin"

    @classmethod
    def from_pocketbase_user(cls, user: PocketBaseUser) -> "CurrentUser":
        return cls(id=user.id, email=user.email, role=user.role, token=user.token)


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
