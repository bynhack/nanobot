"""Skill catalog discovery for managed Nanobot instances."""

from __future__ import annotations

from pathlib import Path

from ..business_modules.registry import iter_packaged_skills


def discover_skill_catalog(roots: list[Path]) -> dict[str, Path]:
    """Return skill-name to directory mappings for directories containing SKILL.md."""

    catalog: dict[str, Path] = {}
    for root in roots:
        expanded = root.expanduser()
        if not expanded.is_dir():
            continue
        for child in sorted(expanded.iterdir(), key=lambda path: path.name):
            if not child.is_dir():
                continue
            if not (child / "SKILL.md").is_file():
                continue
            catalog[child.name] = child
    return catalog


def discover_packaged_skill_catalog() -> dict[str, Path]:
    """Return plugin-packaged business skills as an instance skill catalog."""

    return {skill.name: skill.skill_path for skill in iter_packaged_skills()}
