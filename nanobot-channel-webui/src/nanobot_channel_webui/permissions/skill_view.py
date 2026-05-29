"""Dynamic skill views for scoped WebUI users."""

from __future__ import annotations

from pathlib import Path

from .context import PolicyContext
from ..tenant_runtime.skill_contract import SkillCapability, SkillContract, load_skill_contract


class DynamicSkillViewRenderer:
    """Render the allowed subset of a business skill for one policy context."""

    def __init__(self, workspace: Path) -> None:
        self._workspace = workspace

    def render(self, skill_name: str, policy: PolicyContext | None) -> str | None:
        if policy is None or policy.is_unrestricted:
            return None
        if not policy.can_use_skill(skill_name):
            return None

        contract = load_skill_contract(self._workspace / "skills" / skill_name)
        if contract is None or not contract.capabilities:
            return None

        capabilities = [item for item in contract.capabilities if self._capability_allowed(item, contract, policy)]
        if not capabilities:
            return self._empty_view(skill_name, policy)

        lines = [
            f"# {skill_name} Dynamic Skill View",
            "",
            "This is a permission-scoped runtime view. Use only the capabilities and commands listed here.",
            "Do not read or infer hidden commands from the full skill implementation.",
            "",
            "## Current data scope",
        ]
        for key, values in policy.effective_scopes.items():
            lines.append(f"- `{key}`: {', '.join(values)}")
        if not policy.effective_scopes:
            lines.append("- No resource scope is configured for this user.")

        lines.extend(["", "## Available business capabilities"])
        for capability in capabilities:
            lines.extend(self._capability_lines(capability, contract, self._workspace))

        lines.extend(
            [
                "",
                "## Execution rules",
                "- Prefer `business query`, `business get`, and `business analyze` commands when available.",
                f"- Always run CLI commands from the workspace root with `cd {self._workspace} && bash skills/<skill>/scripts/<runner>.sh ...`; do not `cd` into a skill directory and do not use `~` in the command.",
                "- Omit company filters unless the user asks for one specific authorized company; the CLI applies the current account scope automatically.",
                "- If a needed action is not listed above, explain that the current account does not have that business capability instead of probing hidden commands.",
            ]
        )
        return "\n".join(lines)

    @staticmethod
    def _capability_lines(capability: SkillCapability, contract: SkillContract, workspace: Path) -> list[str]:
        title = capability.title or capability.id
        lines = [f"- `{capability.id}` ({capability.kind}): {title}"]
        if capability.requires_confirmation:
            lines.append("  Requires explicit user confirmation before execution.")
        if capability.commands:
            lines.append(f"  Commands: {', '.join(f'`{item}`' for item in capability.commands)}")
            if contract.commands:
                executable = contract.commands[0]
                examples = [f"`cd {workspace} && bash {executable} {item}`" for item in capability.commands]
                lines.append(f"  Run from workspace root: {', '.join(examples)}")
        if capability.resources:
            resources = []
            for requirement in capability.resources:
                actions = ",".join(requirement.actions or ("read",))
                scope = f" scoped by `{requirement.scope_key}`" if requirement.scope_key else ""
                resources.append(f"{requirement.resource}:{actions}{scope}")
            lines.append(f"  Resources: {', '.join(resources)}")
        return lines

    @staticmethod
    def _capability_allowed(
        capability: SkillCapability,
        contract: SkillContract,
        policy: PolicyContext,
    ) -> bool:
        requirements = capability.resources if capability.resources else contract.resources
        if not requirements:
            return True

        tenant_policy = policy.to_tenant_policy()
        for requirement in requirements:
            for action in requirement.actions or ("read",):
                if not tenant_policy.allows(requirement.resource, action):
                    continue
                if requirement.scope_key and not tenant_policy.scope_values(
                    requirement.resource,
                    requirement.scope_key,
                ):
                    continue
                return True
        return False

    @staticmethod
    def _empty_view(skill_name: str, policy: PolicyContext) -> str:
        return "\n".join(
            [
                f"# {skill_name} Dynamic Skill View",
                "",
                f"The current account `{policy.email}` can use this skill name, but no declared business capability is allowed by its resource policy.",
                "Do not call hidden commands from this skill.",
            ]
        )
