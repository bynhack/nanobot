from __future__ import annotations

import json

from nanobot_channel_webui.instances.workspace import (
    InstanceWorkspaceSpec,
    SkillBundle,
    refresh_managed_skill_links,
    sync_instance_workspace,
)


def test_sync_instance_workspace_copies_authorized_skills_and_writes_policy(tmp_path) -> None:
    catalog = tmp_path / "catalog"
    hr_reader = catalog / "hr-reader"
    office_writer = catalog / "office-writer"
    hr_reader.mkdir(parents=True)
    office_writer.mkdir(parents=True)
    (hr_reader / "SKILL.md").write_text("HR reader", encoding="utf-8")
    (office_writer / "SKILL.md").write_text("Office writer", encoding="utf-8")

    workspace = tmp_path / "instances" / "u1" / "workspace"
    policy = {
        "user_id": "u1",
        "resources": [
            {
                "resource": "hr.employee",
                "actions": ["read"],
                "scopes": {"company": ["乐潮里科技有限公司"]},
            }
        ],
    }
    spec = InstanceWorkspaceSpec(
        workspace=workspace,
        skill_bundles=[
            SkillBundle(name="hr-reader", source=hr_reader),
            SkillBundle(name="office-writer", source=office_writer),
        ],
        policy=policy,
    )

    result = sync_instance_workspace(spec)

    assert result.skills_dir == workspace / "skills"
    assert result.policy_path == workspace / ".nanobot_channel_webui" / "policies" / "policy.json"
    assert sorted(path.name for path in result.skill_paths) == ["hr-reader", "office-writer"]
    assert not (workspace / "skills" / "hr-reader").is_symlink()
    assert (workspace / "skills" / "hr-reader").resolve().is_relative_to(workspace.resolve())
    assert (workspace / "skills" / "hr-reader" / "SKILL.md").read_text(encoding="utf-8") == "HR reader"
    assert (workspace / "skills" / "office-writer" / "SKILL.md").read_text(
        encoding="utf-8"
    ) == "Office writer"
    assert json.loads(result.policy_path.read_text(encoding="utf-8")) == policy


def test_sync_instance_workspace_removes_stale_managed_skills_but_keeps_unmanaged(
    tmp_path,
) -> None:
    catalog = tmp_path / "catalog"
    hr_reader = catalog / "hr-reader"
    office_writer = catalog / "office-writer"
    hr_reader.mkdir(parents=True)
    office_writer.mkdir(parents=True)
    (hr_reader / "SKILL.md").write_text("HR reader", encoding="utf-8")
    (office_writer / "SKILL.md").write_text("Office writer", encoding="utf-8")
    workspace = tmp_path / "instances" / "u1" / "workspace"

    sync_instance_workspace(
        InstanceWorkspaceSpec(
            workspace=workspace,
            skill_bundles=[
                SkillBundle(name="hr-reader", source=hr_reader),
                SkillBundle(name="office-writer", source=office_writer),
            ],
            policy={"user_id": "u1"},
        )
    )
    unmanaged = workspace / "skills" / "handwritten"
    unmanaged.mkdir()
    (unmanaged / "SKILL.md").write_text("manual", encoding="utf-8")

    sync_instance_workspace(
        InstanceWorkspaceSpec(
            workspace=workspace,
            skill_bundles=[SkillBundle(name="hr-reader", source=hr_reader)],
            policy={"user_id": "u1"},
        )
    )

    assert (workspace / "skills" / "hr-reader").exists()
    assert not (workspace / "skills" / "office-writer").exists()
    assert (workspace / "skills" / "handwritten" / "SKILL.md").read_text(
        encoding="utf-8"
    ) == "manual"


def test_refresh_managed_skill_links_replaces_existing_symlinks_with_local_copies(
    tmp_path,
) -> None:
    old_catalog = tmp_path / "old-catalog"
    new_catalog = tmp_path / "new-catalog"
    old_skill = old_catalog / "hr-db-ops"
    new_skill = new_catalog / "hr-db-ops"
    old_skill.mkdir(parents=True)
    new_skill.mkdir(parents=True)
    (old_skill / "SKILL.md").write_text("old", encoding="utf-8")
    (new_skill / "SKILL.md").write_text("new", encoding="utf-8")
    workspace = tmp_path / "instances" / "u1" / "workspace"
    skills_dir = workspace / "skills"
    private_dir = workspace / ".nanobot_channel_webui"
    skills_dir.mkdir(parents=True)
    private_dir.mkdir(parents=True)
    (private_dir / "managed-skills.json").write_text(
        json.dumps({"skills": ["hr-db-ops"]}),
        encoding="utf-8",
    )
    (skills_dir / "hr-db-ops").symlink_to(old_skill, target_is_directory=True)
    unmanaged = skills_dir / "handwritten"
    unmanaged.mkdir()
    (unmanaged / "SKILL.md").write_text("manual", encoding="utf-8")

    refreshed = refresh_managed_skill_links(
        tmp_path / "instances",
        {"hr-db-ops": new_skill},
    )

    assert refreshed == [skills_dir / "hr-db-ops"]
    assert not (skills_dir / "hr-db-ops").is_symlink()
    assert (skills_dir / "hr-db-ops").resolve().is_relative_to(workspace.resolve())
    assert (skills_dir / "hr-db-ops" / "SKILL.md").read_text(encoding="utf-8") == "new"
    assert (unmanaged / "SKILL.md").read_text(encoding="utf-8") == "manual"
