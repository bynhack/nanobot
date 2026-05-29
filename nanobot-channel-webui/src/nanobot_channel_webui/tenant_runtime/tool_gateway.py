"""Tenant-aware tool gateway exports."""

from __future__ import annotations

from ..permissions.tool_registry import AuthorizingToolRegistry

ToolGateway = AuthorizingToolRegistry

__all__ = ["AuthorizingToolRegistry", "ToolGateway"]
