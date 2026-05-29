"""Tenant runtime injection exports."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from ..permissions.injector import attach_permission_runtime


def attach_tenant_runtime(bus: Any, *, workspace: Path) -> bool:
    """Attach tenant runtime gateways to the live AgentLoop."""
    return attach_permission_runtime(bus, workspace=workspace)


__all__ = ["attach_permission_runtime", "attach_tenant_runtime"]
