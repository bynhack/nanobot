"""State helpers for WebUI runtime attachment."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(slots=True)
class RuntimeAttachState:
    """Track one AgentLoop's WebUI runtime attachment state."""

    wrapper_name: str | None = None
    wrap_count: int = 0
    hook_registered: bool = False

    @property
    def is_wrapped(self) -> bool:
        return self.wrapper_name is not None

    def mark_wrapped(self, wrapper_name: str) -> None:
        if self.wrapper_name is not None:
            return
        self.wrapper_name = wrapper_name
        self.wrap_count = 1

    def mark_hook_registered(self) -> None:
        self.hook_registered = True

    def to_snapshot(self) -> dict[str, object]:
        return {
            "is_wrapped": self.is_wrapped,
            "wrapper_name": self.wrapper_name or "",
            "wrap_count": self.wrap_count,
            "hook_registered": self.hook_registered,
        }
