"""Tenant-aware command gateway exports."""

from __future__ import annotations

from ..permissions.command_policy import CommandDecision, CommandPolicyGuard

CommandGateway = CommandPolicyGuard

__all__ = ["CommandDecision", "CommandGateway", "CommandPolicyGuard"]
