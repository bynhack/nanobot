"""Dynamic skill views for scoped WebUI users."""

from __future__ import annotations

import shutil
import sys
from pathlib import Path

from .context import PolicyContext
from ..business_modules.registry import get_packaged_contract
from ..tenant_runtime.skill_contract import SkillCapability, SkillContract, load_skill_contract

_ARTIFACT_DIR = ".nanobot_channel_webui/artifacts"


class DynamicSkillViewRenderer:
    """Render the allowed subset of a business skill for one policy context."""

    def __init__(self, workspace: Path) -> None:
        self._workspace = workspace

    def render(self, skill_name: str, policy: PolicyContext | None) -> str | None:
        if policy is None or policy.is_unrestricted:
            return None
        contract = load_skill_contract(self._workspace / "skills" / skill_name) or get_packaged_contract(skill_name)
        if contract is None or not contract.managed:
            return None
        if not policy.can_use_skill(skill_name):
            return None
        if not contract.capabilities:
            return None

        capabilities = [item for item in contract.capabilities if self._capability_allowed(item, contract, policy)]
        capabilities = self._focus_capabilities(capabilities)
        if not capabilities:
            return _empty_view(skill_name, policy)

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

        recipe_lines = self._recipe_lines(capabilities)
        if recipe_lines:
            lines.extend(["", "## Capability recipes"])
            lines.extend(recipe_lines)

        lines.extend(["", "## Available business capabilities"])
        for capability in capabilities:
            lines.extend(self._capability_lines(capability, contract, self._workspace))

        lines.extend(
            [
                "",
                "## Execution rules",
                "- Prefer `business query`, `business get`, and `business analyze` commands when available.",
                f"- Always run HR business CLI commands from the workspace root with the absolute plugin entrypoint shown in each capability example; do not use workspace `skills/hr-*` paths, bare `nanobot-webui-business`, or `~` in the command.",
                "- Treat phrases like `我负责`, `我能看`, `我管辖`, and `权限范围` as the current account's authorized data scope; do not inspect memory, user files, or hidden commands to infer a separate identity.",
                "- This view is already task-focused when possible. Do not read other HR skill files, schema files, policy files, or raw implementation files for the same request.",
                "- For create/update/delete capabilities, first write one JSON plan, then present a business preview and wait for explicit user confirmation. Use the `business create ... --input <same-plan.json>` command only after the user confirms the preview.",
                f"- For commands that require `--input <plan.json>`, first call the `write_file` tool with a valid JSON payload under `{self._workspace}/.nanobot_channel_webui/runtime-inputs/{policy.chat_id or '<chat_id>'}/`, then pass that `.json` file path to `--input`.",
                f"- Put authorized reusable outputs for Word, Excel, browser, chart, or report skills under `{self._workspace}/{_ARTIFACT_DIR}/{policy.chat_id or '<chat_id>'}/`; other skills may consume those authorized artifacts without knowing this business skill's internals.",
                "- Never create input plans with shell redirects, heredocs, process substitution, `echo >`, pipes, `/tmp` files, or inline JSON inside an `exec` command; those are blocked by the runtime permission boundary.",
                "- Confirmed `business create ...` commands perform verification against the same JSON plan and return the verification result; do not run a separate verify command unless troubleshooting a failed create result.",
                "- Omit company filters unless the user asks for one specific authorized company; the CLI applies the current account scope automatically.",
                "- If a needed action is not listed above, explain that the current account does not have that business capability instead of probing hidden commands.",
            ]
        )
        return "\n".join(lines)

    @staticmethod
    def _focus_capabilities(capabilities: list[SkillCapability]) -> list[SkillCapability]:
        route = _current_route_context()
        text = ""
        if route is not None:
            text = str(getattr(route.message, "content", "") or "").lower()
        if not text:
            return capabilities

        selected_ids: set[str] = set()
        for capability in capabilities:
            if _capability_matches_text(capability, text):
                selected_ids.add(capability.id)
                selected_ids.update(capability.related_capabilities)
        selected = [item for item in capabilities if item.id in selected_ids]
        return selected or capabilities

    @staticmethod
    def _recipe_lines(capabilities: list[SkillCapability]) -> list[str]:
        lines: list[str] = []
        for capability in capabilities:
            if not capability.recipe:
                continue
            lines.append(f"### `{capability.id}`")
            lines.extend(f"- {item}" for item in capability.recipe)
            lines.append("")
        if lines and lines[-1] == "":
            lines.pop()
        return lines

    @staticmethod
    def _capability_lines(capability: SkillCapability, contract: SkillContract, workspace: Path) -> list[str]:
        title = capability.title or capability.id
        lines = [f"- `{capability.id}` ({capability.kind}): {title}"]
        if capability.requires_confirmation:
            lines.append("  Requires explicit user confirmation before execution.")
        if capability.triggers:
            lines.append(f"  Triggers: {', '.join(f'`{item}`' for item in capability.triggers)}")
        if capability.commands:
            lines.append(f"  Commands: {', '.join(f'`{item}`' for item in capability.commands)}")
            if contract.commands:
                executable = _resolve_command(contract.commands[0])
                examples = [f"`cd {workspace} && {executable} {item}`" for item in capability.commands]
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


def _current_route_context():
    from ..compat.runtime import current_route_context

    return current_route_context()


def _resolve_command(command: str) -> str:
    if command.startswith("nanobot-webui-business "):
        executable = shutil.which("nanobot-webui-business")
        if executable is None:
            candidate = Path(sys.executable).parent / "nanobot-webui-business"
            executable = str(candidate) if candidate.exists() else "nanobot-webui-business"
        return command.replace("nanobot-webui-business", executable, 1)
    return command


def _capability_matches_text(capability: SkillCapability, text: str) -> bool:
    write_words = ("新增", "添加", "创建", "新建", "录入", "导入", "create", "add")
    terms = {
        capability.id,
        capability.title or "",
        *(capability.commands or ()),
        *(capability.triggers or ()),
        *(capability.focus_terms or ()),
    }
    for requirement in capability.resources:
        terms.add(requirement.resource)
        resource_name = requirement.resource.split(".", 1)[-1]
        terms.add(resource_name.replace("_", "-"))
        terms.add(resource_name.replace("_", ""))
    if capability.kind in {"create", "update", "delete"} and any(word in text for word in write_words):
        return any(term and term.lower() in text for term in terms)
    return any(term and term.lower() in text for term in terms)


def _empty_view(skill_name: str, policy: PolicyContext) -> str:
    return "\n".join(
        [
            f"# {skill_name} Dynamic Skill View",
            "",
            f"The current account `{policy.email}` can use this skill name, but no declared business capability is allowed by its resource policy.",
            "Do not call hidden commands from this skill.",
        ]
    )
