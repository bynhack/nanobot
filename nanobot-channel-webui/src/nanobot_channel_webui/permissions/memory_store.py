"""Permission-aware wrapper for Nanobot MemoryStore."""

from __future__ import annotations

from typing import Any

from .context import get_policy_context


class AuthorizingMemoryStore:
    """Prevent global workspace memory from leaking into scoped WebUI prompts."""

    _nanobot_webui_permission_wrapper = True

    def __init__(self, original: Any) -> None:
        self._original = original

    def __getattr__(self, name: str) -> Any:
        return getattr(self._original, name)

    def get_memory_context(self, *args: Any, **kwargs: Any) -> str:
        if self._is_scoped_user():
            return ""
        return self._original.get_memory_context(*args, **kwargs)

    def read_unprocessed_history(self, *args: Any, **kwargs: Any) -> list[dict[str, Any]]:
        if self._is_scoped_user():
            return []
        return self._original.read_unprocessed_history(*args, **kwargs)

    @staticmethod
    def _is_scoped_user() -> bool:
        policy = get_policy_context()
        return policy is not None and not policy.is_unrestricted
