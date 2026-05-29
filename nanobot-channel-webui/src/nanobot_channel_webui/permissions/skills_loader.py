"""Permission-aware wrapper for Nanobot SkillsLoader."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from .context import get_policy_context
from .skill_view import DynamicSkillViewRenderer


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
        return [skill for skill in self._original.list_skills(*args, **kwargs) if self._can_use(skill.get("name", ""))]

    def load_skill(self, name: str) -> str | None:
        if not self._can_use(name):
            return None
        if self._renderer is not None:
            view = self._renderer.render(name, get_policy_context())
            if view is not None:
                return view
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
        return self._original.build_skills_summary(effective_exclude)

    def get_always_skills(self) -> list[str]:
        return [name for name in self._original.get_always_skills() if self._can_use(name)]

    def get_skill_metadata(self, name: str) -> dict | None:
        if not self._can_use(name):
            return None
        return self._original.get_skill_metadata(name)

    @staticmethod
    def _can_use(name: str) -> bool:
        policy = get_policy_context()
        return policy is None or policy.can_use_skill(name)
