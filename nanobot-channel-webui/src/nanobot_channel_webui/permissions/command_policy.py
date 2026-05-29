"""Command-level authorization for shell exec."""

from __future__ import annotations

import re
import shlex
from dataclasses import dataclass
from pathlib import Path

from .context import PolicyContext
from ..tenant_runtime.skill_contract import SkillCapability, SkillContract, load_skill_contract

_DENY_PATTERNS = (
    r"skills/supabase-base/",
    r"SUPABASE_SERVICE",
    r"SUPABASE_SERVICE_ROLE_KEY",
    r"supabase_connector",
    r"(^|/)\.env(\s|$)",
    r"[\n\r]",
    r"(^|[^\\])(&&|\|\||;|\||>|<)",
    r"`",
    r"\$\(",
)


@dataclass(frozen=True, slots=True)
class CommandDecision:
    allowed: bool
    reason: str
    command: str


class CommandPolicyGuard:
    """Authorize commands embedded in the generic exec tool."""

    def __init__(self, workspace: Path | None = None) -> None:
        self._workspace = workspace or Path.home() / ".nanobot" / "workspace"

    def authorize(self, command: str, policy: PolicyContext) -> CommandDecision:
        if policy.is_unrestricted:
            return CommandDecision(True, "admin", command)

        stripped = command.strip()
        normalized = self._strip_safe_workspace_prefix(stripped)
        policy_check_command = self._strip_safe_output_suffix(normalized)
        for pattern in _DENY_PATTERNS:
            if re.search(pattern, policy_check_command):
                return CommandDecision(False, "blocked_sensitive_database_access", command)

        try:
            argv = shlex.split(normalized)
        except ValueError:
            return CommandDecision(False, "invalid_shell_command", command)

        contract_match = self._contract_for_argv(argv)
        if contract_match is None:
            return CommandDecision(False, "exec_default_deny", command)

        contract, declared_command, command_index = contract_match
        if not policy.can_use_skill(contract.name):
            return CommandDecision(False, "skill_not_allowed", command)

        command_name = self._business_command_name(argv, command_index)
        if command_name and command_name in contract.denied_commands:
            return CommandDecision(False, "tenant_contract_command_denied", command)

        capability = self._capability_for_command(contract, command_name)
        if contract.capabilities and capability is None and command_name not in {"help", "--help", "-h"}:
            return CommandDecision(False, "capability_not_allowed", command)

        if not self._contract_allowed(contract, policy, capability):
            return CommandDecision(False, "tenant_contract_resource_denied", command)

        command = self._inject_policy_env(stripped, policy)
        return CommandDecision(True, f"tenant_contract_allowed:{contract.name}:{declared_command}", command)

    def _strip_safe_workspace_prefix(self, command: str) -> str:
        pattern = self._safe_workspace_prefix_pattern()
        return re.sub(pattern, "", command, count=1)

    @staticmethod
    def _strip_safe_output_suffix(command: str) -> str:
        command = re.sub(r"\s+2>\s*&\s*1\s*$", "", command)
        return re.sub(r"(?:\s+2>\s*&\s*1)?\s*\|\s*head\s+-?\d+\s*$", "", command)

    def _contract_for_argv(self, argv: list[str]) -> tuple[SkillContract, str, int] | None:
        skills_root = self._workspace / "skills"
        if not skills_root.exists():
            return None

        for skill_dir in skills_root.iterdir():
            if not skill_dir.is_dir():
                continue
            contract = load_skill_contract(skill_dir)
            if contract is None:
                continue
            for declared_command in contract.commands:
                command_index = self._find_declared_command(argv, declared_command)
                if command_index >= 0:
                    return contract, declared_command, command_index
        return None

    @staticmethod
    def _find_declared_command(argv: list[str], declared_command: str) -> int:
        normalized = declared_command.removeprefix("./")
        for index, token in enumerate(argv):
            candidate = token.removeprefix("./")
            if candidate == normalized or candidate.endswith(f"/{normalized}"):
                return index
        return -1

    @staticmethod
    def _capability_for_command(contract: SkillContract, command_name: str) -> SkillCapability | None:
        for capability in contract.capabilities:
            if command_name in capability.commands:
                return capability
        return None

    @staticmethod
    def _business_command_name(argv: list[str], command_index: int) -> str:
        if command_index + 1 >= len(argv):
            return ""
        first = argv[command_index + 1]
        if first.startswith("business "):
            parts = []
            for token in first.split():
                if token.startswith("--"):
                    break
                parts.append(token)
            return " ".join(parts)
        if first != "business":
            return first
        tokens = ["business"]
        for token in argv[command_index + 2 :]:
            if token.startswith("--") or ">" in token or "<" in token or "|" in token:
                break
            tokens.append(token)
        return " ".join(tokens)

    @staticmethod
    def _contract_allowed(
        contract: SkillContract,
        policy: PolicyContext,
        capability: SkillCapability | None = None,
    ) -> bool:
        resources = capability.resources if capability and capability.resources else contract.resources
        if not resources:
            return True

        tenant_policy = policy.to_tenant_policy()
        for requirement in resources:
            actions = requirement.actions or ("read",)
            for action in actions:
                if not tenant_policy.allows(requirement.resource, action):
                    continue
                if requirement.scope_key and not tenant_policy.scope_values(
                    requirement.resource,
                    requirement.scope_key,
                ):
                    continue
                return True
        return False

    def _inject_policy_env(self, command: str, policy: PolicyContext) -> str:
        if not policy.policy_file:
            return command
        assignments = [
            f"NANOBOT_WEBUI_POLICY_FILE={shlex.quote(policy.policy_file)}",
            f"NANOBOT_WEBUI_USER_ID={shlex.quote(policy.user_id)}",
            f"NANOBOT_WEBUI_USER_EMAIL={shlex.quote(policy.email)}",
        ]
        env_prefix = " ".join(assignments)
        safe_prefix_match = re.match(self._safe_workspace_prefix_pattern(), command)
        if safe_prefix_match:
            return f"{safe_prefix_match.group(0)}{env_prefix} {command[safe_prefix_match.end():]}"
        return f"{env_prefix} {command}"

    @staticmethod
    def _safe_workspace_prefix_pattern_for(workspace: Path) -> str:
        raw_workspace = re.escape(str(workspace))
        quoted_workspace = re.escape(shlex.quote(str(workspace)))
        return rf"^cd\s+(?:{raw_workspace}|{quoted_workspace})\s+&&\s+"

    def _safe_workspace_prefix_pattern(self) -> str:
        return self._safe_workspace_prefix_pattern_for(self._workspace)
