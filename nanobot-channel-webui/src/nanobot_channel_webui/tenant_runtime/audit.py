"""Tenant runtime audit exports."""

from __future__ import annotations

from ..permissions.audit import AUDIT_SCHEMA_VERSION, PermissionAuditLogger, normalize_audit_event

TenantAuditLogger = PermissionAuditLogger

__all__ = ["AUDIT_SCHEMA_VERSION", "PermissionAuditLogger", "TenantAuditLogger", "normalize_audit_event"]
