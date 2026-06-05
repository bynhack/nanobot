"""Workspace synchronization for managed Nanobot instances."""

from __future__ import annotations

import json
import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass(frozen=True, slots=True)
class SkillBundle:
    """A skill package authorized for one managed instance."""

    name: str
    source: Path


@dataclass(frozen=True, slots=True)
class InstanceWorkspaceSpec:
    """Desired workspace state for one managed instance."""

    workspace: Path
    skill_bundles: list[SkillBundle]
    policy: dict[str, Any]


@dataclass(frozen=True, slots=True)
class InstanceWorkspaceSyncResult:
    """Paths created or updated by a workspace sync."""

    skills_dir: Path
    skill_paths: list[Path]
    policy_path: Path


def sync_instance_workspace(spec: InstanceWorkspaceSpec) -> InstanceWorkspaceSyncResult:
    """Create instance-local skill copies and policy state."""

    workspace = spec.workspace.expanduser()
    skills_dir = workspace / "skills"
    private_dir = workspace / ".nanobot_channel_webui"
    policy_path = private_dir / "policies" / "policy.json"
    manifest_path = private_dir / "managed-skills.json"
    skills_dir.mkdir(parents=True, exist_ok=True)
    policy_path.parent.mkdir(parents=True, exist_ok=True)

    desired_names = {bundle.name for bundle in spec.skill_bundles}
    _remove_stale_managed_skills(skills_dir, manifest_path, desired_names)
    skill_paths = [_sync_skill_bundle(skills_dir, bundle) for bundle in spec.skill_bundles]
    _write_json_atomic(policy_path, spec.policy)
    _write_json_atomic(manifest_path, {"skills": sorted(desired_names)})
    return InstanceWorkspaceSyncResult(
        skills_dir=skills_dir,
        skill_paths=skill_paths,
        policy_path=policy_path,
    )


def refresh_managed_skill_links(
    instances_root: Path,
    skill_catalog: dict[str, Path],
) -> list[Path]:
    """Refresh managed skill copies in existing instance workspaces."""

    root = instances_root.expanduser()
    if not root.exists():
        return []
    refreshed: list[Path] = []
    for manifest_path in root.glob("*/workspace/.nanobot_channel_webui/managed-skills.json"):
        workspace = manifest_path.parents[1]
        skills_dir = workspace / "skills"
        if not skills_dir.exists():
            continue
        try:
            payload = json.loads(manifest_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError, TypeError, ValueError):
            continue
        names = payload.get("skills") if isinstance(payload, dict) else None
        if not isinstance(names, list):
            continue
        for name in names:
            if not isinstance(name, str) or name not in skill_catalog:
                continue
            target = _sync_skill_bundle(
                skills_dir,
                SkillBundle(name=name, source=skill_catalog[name]),
            )
            refreshed.append(target)
    return refreshed


def _sync_skill_bundle(skills_dir: Path, bundle: SkillBundle) -> Path:
    source = bundle.source.expanduser().resolve()
    if not source.is_dir():
        raise FileNotFoundError(f"Skill bundle not found: {source}")
    target = skills_dir / bundle.name
    if target.exists() or target.is_symlink():
        if target.is_dir() and not target.is_symlink():
            shutil.rmtree(target)
        else:
            target.unlink()
    shutil.copytree(source, target, symlinks=False)
    return target


def _write_json_atomic(path: Path, payload: dict[str, Any]) -> None:
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)


def _remove_stale_managed_skills(
    skills_dir: Path,
    manifest_path: Path,
    desired_names: set[str],
) -> None:
    if not manifest_path.exists():
        return
    try:
        payload = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError, TypeError, ValueError):
        return
    previous = payload.get("skills") if isinstance(payload, dict) else None
    if not isinstance(previous, list):
        return
    for name in previous:
        if not isinstance(name, str) or name in desired_names:
            continue
        target = skills_dir / name
        if target.is_symlink():
            target.unlink()
        elif target.is_dir():
            shutil.rmtree(target)
        elif target.exists():
            target.unlink()
