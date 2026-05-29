"""Tenant runtime context primitives.

This module is the generic naming layer for the current WebUI permission
context. `PolicyContext` remains available as a backwards-compatible alias while
new code should prefer `TenantContext` and tenant-context helpers.
"""

from __future__ import annotations

from ..permissions.context import (
    PolicyContext,
    bind_policy_context,
    get_policy_context,
)

TenantContext = PolicyContext
get_tenant_context = get_policy_context
bind_tenant_context = bind_policy_context

__all__ = [
    "PolicyContext",
    "TenantContext",
    "bind_policy_context",
    "bind_tenant_context",
    "get_policy_context",
    "get_tenant_context",
]
