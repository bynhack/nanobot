"""Registry for plugin-packaged business modules and virtual skills."""

from __future__ import annotations

from dataclasses import dataclass
from importlib import resources
from pathlib import Path
from typing import Iterable

from ..tenant_runtime.skill_contract import SkillContract, load_skill_contract


@dataclass(frozen=True, slots=True)
class PackagedSkill:
    name: str
    module: str
    skill_path: Path
    contract: SkillContract


_BUILTIN_MODULES = ("hr",)


def _module_skills_root(module: str) -> Path:
    return Path(str(resources.files(f"nanobot_channel_webui.business_modules.{module}") / "skills"))


def iter_packaged_skills() -> Iterable[PackagedSkill]:
    for module in _BUILTIN_MODULES:
        root = _module_skills_root(module)
        if not root.exists():
            continue
        for skill_dir in sorted(root.iterdir()):
            if not skill_dir.is_dir():
                continue
            contract = load_skill_contract(skill_dir)
            if contract is None:
                continue
            yield PackagedSkill(name=contract.name or skill_dir.name, module=module, skill_path=skill_dir, contract=contract)


def packaged_skill_names() -> set[str]:
    return {skill.name for skill in iter_packaged_skills()}


def get_packaged_skill(name: str) -> PackagedSkill | None:
    for skill in iter_packaged_skills():
        if skill.name == name:
            return skill
    return None


def get_packaged_contract(name: str) -> SkillContract | None:
    skill = get_packaged_skill(name)
    return skill.contract if skill else None


def is_packaged_managed_skill(name: str) -> bool:
    contract = get_packaged_contract(name)
    return bool(contract is not None and contract.managed)
