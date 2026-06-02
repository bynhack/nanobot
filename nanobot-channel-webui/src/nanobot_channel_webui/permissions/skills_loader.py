"""Permission-aware wrapper for Nanobot SkillsLoader."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from .context import get_policy_context
from .skill_view import DynamicSkillViewRenderer
from ..business_modules.registry import is_packaged_managed_skill, iter_packaged_skills, packaged_skill_names
from ..tenant_runtime.skill_contract import load_skill_contract

_PROTECTED_SKILL_NAMES = {"supabase-base"}


class AuthorizingSkillsLoader:
    """Filter skill visibility without modifying Nanobot core."""

    _nanobot_webui_permission_wrapper = True

    def __init__(self, original: Any, *, workspace: Path | None = None) -> None:
        self._original = original
        self._workspace = workspace or getattr(original, "workspace", None)
        self._renderer = DynamicSkillViewRenderer(self._workspace) if self._workspace else None

    def __getattr__(self, name: str) -> Any:
        return getattr(self._original, name)

    def list_skills(self, *args: Any, **kwargs: Any) -> list[dict[str, Any]]:
        skills = [skill for skill in self._original.list_skills(*args, **kwargs) if self._can_use(skill.get("name", ""))]
        seen = {str(skill.get("name", "")) for skill in skills}
        for packaged in iter_packaged_skills():
            if packaged.name not in seen and self._can_use(packaged.name):
                skills.append({"name": packaged.name})
        return skills

    def load_skill(self, name: str) -> str | None:
        if not self._can_use(name):
            return None
        if self._renderer is not None:
            view = self._renderer.render(name, get_policy_context())
            if view is not None:
                return view
        if is_packaged_managed_skill(name):
            return None
        return self._original.load_skill(name)

    def load_skills_for_context(self, skill_names: list[str]) -> str:
        names = [name for name in skill_names if self._can_use(name)]
        if self._renderer is None:
            return self._original.load_skills_for_context(names)
        parts = [f"### Skill: {name}\n\n{markdown}" for name in names if (markdown := self.load_skill(name))]
        return "\n\n---\n\n".join(parts)

    def build_skills_summary(self, exclude: set[str] | None = None) -> str:
        policy = get_policy_context()
        effective_exclude = set(exclude or set())
        if policy is not None and not policy.is_unrestricted:
            for skill in self._original.list_skills(filter_unavailable=False):
                name = str(skill.get("name", ""))
                if name and not policy.can_use_skill(name):
                    effective_exclude.add(name)
        summary = self._original.build_skills_summary(effective_exclude)
        visible_packaged = [
            skill.name
            for skill in iter_packaged_skills()
            if skill.name not in effective_exclude and self._can_use(skill.name)
        ]
        if not visible_packaged:
            return summary
        existing = {item.strip() for item in summary.split(",") if item.strip()}
        additions = [name for name in visible_packaged if name not in existing]
        if not additions:
            return summary
        guidance = self._virtual_skill_guidance(additions)
        if not summary:
            return f"{','.join(additions)}\n\n{guidance}"
        return f"{summary},{','.join(additions)}\n\n{guidance}"

    def get_always_skills(self) -> list[str]:
        return [name for name in self._original.get_always_skills() if self._can_use(name)]

    def get_skill_metadata(self, name: str) -> dict | None:
        if not self._can_use(name):
            return None
        return self._original.get_skill_metadata(name)

    def _can_use(self, name: str) -> bool:
        policy = get_policy_context()
        if policy is None or policy.is_unrestricted:
            return True
        if name in _PROTECTED_SKILL_NAMES:
            return False
        if name in packaged_skill_names():
            return policy.can_use_skill(name)
        if self._is_managed(name):
            return policy.can_use_skill(name)
        return True

    def _is_managed(self, name: str) -> bool:
        if not self._workspace:
            return False
        if is_packaged_managed_skill(name):
            return True
        contract = load_skill_contract(Path(self._workspace) / "skills" / name)
        return bool(contract is not None and contract.managed)

    def _virtual_skill_guidance(self, names: list[str]) -> str:
        if not self._workspace:
            return ""
        hr_names = [name for name in names if name.startswith("hr-")]
        if not hr_names:
            return ""
        router_path = Path(self._workspace) / "skills" / "hr-query-analysis-router" / "SKILL.md"
        listed = ", ".join(f"`{name}`" for name in sorted(hr_names))
        return (
            "Plugin virtual business skills: "
            f"{listed}. These are not physical workspace skill directories. "
            "For HR company, department, employee, contract, performance, insurance, "
            "personnel-change, disciplinary, seal-usage, recruiting, or other business-data "
            f"requests, first read `{router_path}` and follow the dynamic skill view. "
            "Do not scan the workspace or guess `skills/hr-*` shell paths."
        )
