from __future__ import annotations

import json

from nanobot.config.schema import Config

from nanobot_channel_webui.instances.builder import (
    InstanceSpecBuilder,
    InstanceSpecBuilderOptions,
)
from nanobot_channel_webui.user_context import CurrentUser


def test_instance_spec_builder_maps_user_policy_to_runtime_spec(tmp_path) -> None:
    catalog = tmp_path / "catalog"
    hr_reader = catalog / "hr-reader"
    office_writer = catalog / "office-writer"
    hr_reader.mkdir(parents=True)
    office_writer.mkdir(parents=True)
    (hr_reader / "SKILL.md").write_text("HR reader", encoding="utf-8")
    (office_writer / "SKILL.md").write_text("Office writer", encoding="utf-8")
    base_config = Config()
    user = CurrentUser(
        id="u 1/测试",
        email="u1@example.com",
        role="user",
        token="token",
        tenant_id="tenant-a",
        business_role="hr_reader",
        skills=["hr-reader"],
        scopes={"company": ["乐潮里科技有限公司"]},
        resources=[
            {
                "resource": "hr.employee",
                "actions": ["read"],
                "scopes": {"company": ["乐潮里科技有限公司"]},
            }
        ],
    )
    builder = InstanceSpecBuilder(
        InstanceSpecBuilderOptions(
            instances_root=tmp_path / "instances",
            skill_catalog={"hr-reader": hr_reader, "office-writer": office_writer},
            port_base=19100,
        )
    )

    spec = builder.build_for_user(user, base_config)

    assert spec.instance_id == "user-u-1"
    assert spec.config is not base_config
    assert spec.config_path == tmp_path / "instances" / "user-u-1" / "config.json"
    assert spec.config.workspace_path == tmp_path / "instances" / "user-u-1" / "workspace"
    assert base_config.workspace_path != spec.config.workspace_path
    assert spec.config.gateway.port == 19100 + builder.port_offset("user-u-1")
    assert getattr(spec.config.channels, "websocket")["enabled"] is True
    assert getattr(spec.config.channels, "websocket")["port"] == spec.config.gateway.port + 1
    assert getattr(spec.config.channels, "websocket")["token"]
    assert getattr(spec.config.channels, "webui_plugin", None) is None
    assert getattr(spec.config.channels, "feishu", None) is None
    assert spec.workspace.workspace == spec.config.workspace_path
    assert [bundle.name for bundle in spec.workspace.skill_bundles] == ["hr-reader"]
    assert spec.workspace.skill_bundles[0].source == hr_reader
    assert spec.workspace.policy["user_id"] == "u 1/测试"
    assert spec.workspace.policy["tenant_id"] == "tenant-a"
    assert spec.workspace.policy["skills"] == ["hr-reader"]
    assert spec.workspace.policy["resources"][0]["resource"] == "hr.employee"
    assert spec.runtime_options.hooks == []


def test_instance_spec_builder_drops_non_websocket_channels_from_base_config(tmp_path) -> None:
    base_config = Config(
        tools={"restrictToWorkspace": False},
        channels={
            "webui_plugin": {"enabled": True, "port": 8081},
            "feishu": {"enabled": True},
        }
    )
    user = CurrentUser(
        id="u1",
        email="u1@example.com",
        role="user",
        token="token",
    )
    builder = InstanceSpecBuilder(
        InstanceSpecBuilderOptions(
            instances_root=tmp_path / "instances",
            skill_catalog={},
        )
    )

    spec = builder.build_for_user(user, base_config)

    assert spec.config_path == tmp_path / "instances" / "user-u1" / "config.json"
    assert spec.config.tools.restrict_to_workspace is True
    assert getattr(spec.config.channels, "websocket")["enabled"] is True
    assert getattr(spec.config.channels, "websocket")["token"]
    assert getattr(spec.config.channels, "webui_plugin", None) is None
    assert getattr(spec.config.channels, "feishu", None) is None


def test_instance_spec_builder_forces_workspace_restriction_for_managed_instances(
    tmp_path,
) -> None:
    base_config = Config(tools={"restrictToWorkspace": False})
    user = CurrentUser(
        id="u1",
        email="u1@example.com",
        role="user",
        token="token",
    )
    builder = InstanceSpecBuilder(
        InstanceSpecBuilderOptions(
            instances_root=tmp_path / "instances",
            skill_catalog={},
        )
    )

    spec = builder.build_for_user(user, base_config)

    assert base_config.tools.restrict_to_workspace is False
    assert spec.config.tools.restrict_to_workspace is True


def test_instance_spec_builder_syncs_to_workspace(tmp_path) -> None:
    catalog = tmp_path / "catalog"
    hr_reader = catalog / "hr-reader"
    hr_reader.mkdir(parents=True)
    (hr_reader / "SKILL.md").write_text("HR reader", encoding="utf-8")
    user = CurrentUser(
        id="u1",
        email="u1@example.com",
        role="user",
        token="token",
        skills=["hr-reader"],
    )
    builder = InstanceSpecBuilder(
        InstanceSpecBuilderOptions(
            instances_root=tmp_path / "instances",
            skill_catalog={"hr-reader": hr_reader},
        )
    )

    result = builder.sync_user_instance(user, Config())

    assert (result.workspace / "skills" / "hr-reader" / "SKILL.md").read_text(
        encoding="utf-8"
    ) == "HR reader"
    policy_path = result.workspace / ".nanobot_channel_webui" / "policies" / "policy.json"
    assert json.loads(policy_path.read_text(encoding="utf-8"))["user_id"] == "u1"


def test_instance_spec_builder_ignores_authorized_skills_missing_from_catalog(tmp_path) -> None:
    catalog = tmp_path / "catalog"
    hr_reader = catalog / "hr-reader"
    hr_reader.mkdir(parents=True)
    (hr_reader / "SKILL.md").write_text("HR reader", encoding="utf-8")
    user = CurrentUser(
        id="u1",
        email="u1@example.com",
        role="user",
        token="token",
        skills=["hr-reader", "missing-skill"],
    )
    builder = InstanceSpecBuilder(
        InstanceSpecBuilderOptions(
            instances_root=tmp_path / "instances",
            skill_catalog={"hr-reader": hr_reader},
        )
    )

    spec = builder.build_for_user(user, Config())

    assert [bundle.name for bundle in spec.workspace.skill_bundles] == ["hr-reader"]
    assert spec.workspace.policy["skills"] == ["hr-reader", "missing-skill"]


def test_instance_spec_builder_expands_admin_wildcard_to_all_catalog_skills(tmp_path) -> None:
    catalog = tmp_path / "catalog"
    hr_reader = catalog / "hr-reader"
    office_writer = catalog / "office-writer"
    hr_reader.mkdir(parents=True)
    office_writer.mkdir(parents=True)
    (hr_reader / "SKILL.md").write_text("HR reader", encoding="utf-8")
    (office_writer / "SKILL.md").write_text("Office writer", encoding="utf-8")
    user = CurrentUser(
        id="admin",
        email="admin@example.com",
        role="admin",
        token="token",
    )
    builder = InstanceSpecBuilder(
        InstanceSpecBuilderOptions(
            instances_root=tmp_path / "instances",
            skill_catalog={"hr-reader": hr_reader, "office-writer": office_writer},
        )
    )

    spec = builder.build_for_user(user, Config())

    assert [bundle.name for bundle in spec.workspace.skill_bundles] == [
        "hr-reader",
        "office-writer",
    ]
    assert spec.workspace.policy["skills"] == ["*"]
