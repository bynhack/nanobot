"""Tenant runtime framework for the WebUI plugin."""

from __future__ import annotations

from importlib import import_module
from typing import Any

from .context import (
    PolicyContext,
    TenantContext,
    bind_policy_context,
    bind_tenant_context,
    get_policy_context,
    get_tenant_context,
)
from .contracts import (
    TENANT_POLICY_VERSION,
    ResourcePermission,
    ResourceScope,
    TenantPolicy,
    TenantSubject,
)
from .skill_contract import SkillContract, SkillResourceRequirement, load_skill_contract

_LAZY_EXPORTS = {
    "AuthorizingMemoryStore": ".memory_gateway",
    "AuthorizingSkillsLoader": ".skill_gateway",
    "AuthorizingToolRegistry": ".tool_gateway",
    "CommandDecision": ".command_gateway",
    "CommandGateway": ".command_gateway",
    "CommandPolicyGuard": ".command_gateway",
    "GuardDecision": ".guard",
    "MemoryGateway": ".memory_gateway",
    "PermissionAuditLogger": ".audit",
    "PolicyResolver": ".resolver",
    "SkillGateway": ".skill_gateway",
    "TenantAccessDenied": ".guard",
    "TenantAuditLogger": ".audit",
    "TenantGuard": ".guard",
    "TenantPolicyResolver": ".resolver",
    "ToolGateway": ".tool_gateway",
    "attach_permission_runtime": ".injector",
    "attach_tenant_runtime": ".injector",
}

__all__ = [
    "AuthorizingMemoryStore",
    "AuthorizingSkillsLoader",
    "AuthorizingToolRegistry",
    "CommandDecision",
    "CommandGateway",
    "CommandPolicyGuard",
    "GuardDecision",
    "MemoryGateway",
    "PermissionAuditLogger",
    "PolicyContext",
    "PolicyResolver",
    "ResourcePermission",
    "ResourceScope",
    "SkillGateway",
    "SkillContract",
    "SkillResourceRequirement",
    "TENANT_POLICY_VERSION",
    "TenantAuditLogger",
    "TenantAccessDenied",
    "TenantContext",
    "TenantGuard",
    "TenantPolicy",
    "TenantPolicyResolver",
    "TenantSubject",
    "ToolGateway",
    "attach_permission_runtime",
    "attach_tenant_runtime",
    "bind_policy_context",
    "bind_tenant_context",
    "get_policy_context",
    "get_tenant_context",
    "load_skill_contract",
]


def __getattr__(name: str) -> Any:
    module_name = _LAZY_EXPORTS.get(name)
    if module_name is None:
        raise AttributeError(name)
    module = import_module(module_name, __name__)
    value = getattr(module, name)
    globals()[name] = value
    return value
