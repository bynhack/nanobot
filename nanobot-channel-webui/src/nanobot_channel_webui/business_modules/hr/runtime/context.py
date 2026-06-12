"""Runtime context shared by HR business tool and CLI-compatible commands."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from .policy import AccessPolicy


@dataclass(frozen=True, slots=True)
class BusinessCommandContext:
    chat_id: str
    user_id: str
    workspace: Path
    policy_file: str = ""
    policy: AccessPolicy | None = None
    tool_call_id: str | None = None
