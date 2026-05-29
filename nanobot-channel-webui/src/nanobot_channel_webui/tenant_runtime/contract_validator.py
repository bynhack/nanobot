"""Validate tenant-runtime skill contracts in a workspace."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from .skill_contract import SkillContract, load_skill_contract


def _command_path(workspace: Path, skill_dir: Path, command: str) -> Path:
    value = command.strip()
    if not value:
        return skill_dir
    path = Path(value)
    if path.is_absolute():
        return path
    if value.startswith("skills/"):
        return workspace / value
    return skill_dir / value


def _issue(code: str, severity: str, message: str) -> dict[str, str]:
    return {"code": code, "severity": severity, "message": message}


def validate_skill_contract(skill_dir: Path, *, workspace: Path) -> dict[str, Any]:
    """Validate one workspace skill directory."""

    skill_file = skill_dir / "SKILL.md"
    disabled_file = skill_dir / "SKILL.disabled.md"
    contract_file = skill_dir / "tenant-runtime.json"
    contract = load_skill_contract(skill_dir)
    issues: list[dict[str, str]] = []

    if not skill_file.exists() and not disabled_file.exists():
        issues.append(_issue("missing_skill_file", "error", "技能目录缺少 SKILL.md。"))

    if contract is None:
        issues.append(_issue("missing_contract", "warning", "技能没有声明 tenant-runtime.json 或 tenant-runtime-contract。"))
        return {
            "name": skill_dir.name,
            "path": str(skill_dir),
            "contract_path": "",
            "enabled": skill_file.exists(),
            "commands": [],
            "resources": [],
            "denied_commands": [],
            "issues": issues,
            "status": "warning",
        }

    if not contract.name:
        issues.append(_issue("missing_name", "error", "契约缺少 name。"))
    elif contract.name != skill_dir.name:
        issues.append(_issue("name_mismatch", "error", f"契约 name `{contract.name}` 与技能目录名 `{skill_dir.name}` 不一致。"))

    support_only = contract.kind in {"support", "docs", "reference"}

    if not contract.commands and not support_only:
        issues.append(_issue("missing_commands", "warning", "契约没有声明 commands；如果这是纯文档或公共辅助技能，可以接受。"))
    for command in contract.commands:
        path = _command_path(workspace, skill_dir, command)
        if not path.exists():
            issues.append(_issue("command_not_found", "error", f"命令入口不存在：{command}"))

    if not contract.resources and not support_only:
        issues.append(_issue("missing_resources", "warning", "契约没有声明 resources，无法校验资源动作覆盖关系。"))
    for resource in contract.resources:
        if not resource.resource:
            issues.append(_issue("resource_missing_name", "error", "资源声明缺少 resource。"))
        if not resource.actions:
            issues.append(_issue("resource_missing_actions", "warning", f"资源 `{resource.resource}` 没有声明 actions。"))
        if not resource.scope_key:
            issues.append(_issue("resource_missing_scope", "warning", f"资源 `{resource.resource}` 没有声明 scope_key。"))

    if contract.commands and not contract.denied_commands:
        issues.append(_issue("missing_denied_commands", "warning", "契约没有声明 denied_commands，请确认是否存在清库、删除、批量覆盖等高风险子命令。"))

    for capability in contract.capabilities:
        if not capability.id:
            issues.append(_issue("capability_missing_id", "error", "业务能力缺少 id。"))
        if not capability.commands:
            issues.append(_issue("capability_missing_commands", "warning", f"业务能力 `{capability.id}` 没有声明 commands。"))
        for command in capability.commands:
            if command in contract.denied_commands:
                issues.append(_issue("capability_denied_command", "error", f"业务能力 `{capability.id}` 引用了被拒绝的命令：{command}"))
        if not capability.resources and not support_only:
            issues.append(_issue("capability_missing_resources", "warning", f"业务能力 `{capability.id}` 没有声明 resources。"))

    has_error = any(item["severity"] == "error" for item in issues)
    has_warning = any(item["severity"] == "warning" for item in issues)
    return {
        "name": contract.name or skill_dir.name,
        "path": str(skill_dir),
        "contract_path": str(contract_file) if contract_file.exists() else str(skill_file),
        "enabled": skill_file.exists(),
        "commands": list(contract.commands),
        "kind": contract.kind,
        "resources": [item.to_payload() for item in contract.resources],
        "denied_commands": list(contract.denied_commands),
        "capabilities": [item.to_payload() for item in contract.capabilities],
        "issues": issues,
        "status": "error" if has_error else "warning" if has_warning else "ok",
    }


def validate_workspace_skill_contracts(workspace: Path) -> dict[str, Any]:
    """Validate all workspace skills and return a settings-page snapshot."""

    skills_root = workspace / "skills"
    contracts: list[dict[str, Any]] = []
    if skills_root.exists():
        for skill_dir in sorted(skills_root.iterdir()):
            if skill_dir.is_dir():
                contracts.append(validate_skill_contract(skill_dir, workspace=workspace))

    error_count = sum(1 for item in contracts if item["status"] == "error")
    warning_count = sum(1 for item in contracts if item["status"] == "warning")
    ok_count = sum(1 for item in contracts if item["status"] == "ok")
    return {
        "workspace": str(workspace),
        "skills_root": str(skills_root),
        "summary": {
            "total": len(contracts),
            "ok": ok_count,
            "warning": warning_count,
            "error": error_count,
        },
        "contracts": contracts,
    }
