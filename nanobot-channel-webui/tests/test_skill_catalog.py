from __future__ import annotations

from types import SimpleNamespace

import nanobot_channel_webui.instances.catalog as catalog_module

from nanobot_channel_webui.instances.catalog import discover_skill_catalog


def test_discover_skill_catalog_lists_skill_directories_with_skill_md(tmp_path) -> None:
    root = tmp_path / "skills"
    allowed = root / "hr-reader"
    ignored_without_skill_md = root / "scripts"
    nested_file = allowed / "references"
    nested_file.mkdir(parents=True)
    ignored_without_skill_md.mkdir(parents=True)
    (allowed / "SKILL.md").write_text("HR reader", encoding="utf-8")

    catalog = discover_skill_catalog([root])

    assert catalog == {"hr-reader": allowed}


def test_discover_skill_catalog_later_roots_override_earlier_roots(tmp_path) -> None:
    root_a = tmp_path / "a"
    root_b = tmp_path / "b"
    skill_a = root_a / "hr-reader"
    skill_b = root_b / "hr-reader"
    skill_a.mkdir(parents=True)
    skill_b.mkdir(parents=True)
    (skill_a / "SKILL.md").write_text("old", encoding="utf-8")
    (skill_b / "SKILL.md").write_text("new", encoding="utf-8")

    catalog = discover_skill_catalog([root_a, root_b])

    assert catalog == {"hr-reader": skill_b}


def test_discover_packaged_skill_catalog_uses_business_module_registry(monkeypatch, tmp_path) -> None:
    skill_path = tmp_path / "hr-reader"
    monkeypatch.setattr(
        catalog_module,
        "iter_packaged_skills",
        lambda: [SimpleNamespace(name="hr-reader", skill_path=skill_path)],
    )

    from nanobot_channel_webui.instances.catalog import discover_packaged_skill_catalog

    assert discover_packaged_skill_catalog() == {"hr-reader": skill_path}
