from __future__ import annotations

from pathlib import Path

from nanobot_channel_webui.management import WebUIManagementService


def test_settings_skill_list_parses_standard_quoted_frontmatter(tmp_path: Path) -> None:
    skill_dir = tmp_path / "skills" / "playwright"
    skill_dir.mkdir(parents=True)
    (skill_dir / "SKILL.md").write_text(
        """---
name: "playwright"
description: "Use when the task requires automating a real browser from the terminal."
---

# Playwright
""",
        encoding="utf-8",
    )

    skills = WebUIManagementService(tmp_path).list_skills()

    assert skills == [
        {
            "name": "playwright",
            "source": "workspace",
            "path": str(skill_dir / "SKILL.md"),
            "updated_at": skills[0]["updated_at"],
            "description": "Use when the task requires automating a real browser from the terminal.",
            "enabled": True,
            "can_toggle": True,
        }
    ]


def test_settings_skill_file_preview_strips_frontmatter(tmp_path: Path) -> None:
    skill_dir = tmp_path / "skills" / "hr-db-ops"
    skill_dir.mkdir(parents=True)
    (skill_dir / "SKILL.md").write_text(
        """---
name: "hr-db-ops"
description: "HR write operations."
---

# HR DB Ops

Body only.
""",
        encoding="utf-8",
    )

    payload = WebUIManagementService(tmp_path).get_skill_file(
        "hr-db-ops",
        str(skill_dir / "SKILL.md"),
        "workspace",
    )

    assert payload is not None
    assert payload["content"].startswith("---\nname:")
    assert payload["preview_content"] == "# HR DB Ops\n\nBody only.\n"


def test_settings_skill_list_parses_legacy_folded_frontmatter(tmp_path: Path) -> None:
    skill_dir = tmp_path / "skills" / "hr-db-ops"
    skill_dir.mkdir(parents=True)
    (skill_dir / "SKILL.md").write_text(
        """---
name: hr-db-ops
description: >
  HR 写入和数据维护操作手册。Use only for preview/create/update/delete/import
  style HR tasks.
---

# HR DB Ops
""",
        encoding="utf-8",
    )

    skills = WebUIManagementService(tmp_path).list_skills()

    assert skills[0]["description"] == (
        "HR 写入和数据维护操作手册。Use only for preview/create/update/delete/import "
        "style HR tasks."
    )
