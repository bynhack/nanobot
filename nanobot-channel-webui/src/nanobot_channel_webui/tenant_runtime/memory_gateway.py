"""Tenant-aware memory gateway exports."""

from __future__ import annotations

from ..permissions.memory_store import AuthorizingMemoryStore

MemoryGateway = AuthorizingMemoryStore

__all__ = ["AuthorizingMemoryStore", "MemoryGateway"]
