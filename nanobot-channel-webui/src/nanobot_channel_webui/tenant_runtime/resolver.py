"""Tenant policy resolver exports."""

from __future__ import annotations

from ..permissions.resolver import PolicyResolver

TenantPolicyResolver = PolicyResolver

__all__ = ["PolicyResolver", "TenantPolicyResolver"]
