"""Tenant runtime framework for the WebUI plugin.

This package is the public generic multi-tenant runtime surface. The older
`permissions` package contains the current implementation modules and remains
available as a compatibility import path. New code should prefer imports from
`nanobot_channel_webui.tenant_runtime` unless it is editing the implementation
itself.
"""

from .audit import PermissionAuditLogger, TenantAuditLogger
from .command_gateway import CommandDecision, CommandGateway, CommandPolicyGuard
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
from .guard import GuardDecision, TenantAccessDenied, TenantGuard
from .injector import attach_permission_runtime, attach_tenant_runtime
from .memory_gateway import AuthorizingMemoryStore, MemoryGateway
from .resolver import PolicyResolver, TenantPolicyResolver
from .skill_gateway import AuthorizingSkillsLoader, SkillGateway
from .skill_contract import SkillContract, SkillResourceRequirement, load_skill_contract
from .tool_gateway import AuthorizingToolRegistry, ToolGateway

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
