from __future__ import annotations

import json
from pathlib import Path

import pytest

from nanobot_channel_webui.permissions import PolicyContext, bind_policy_context
from nanobot_channel_webui.tools import hr_business
from nanobot_channel_webui.tools.hr_business import HrBusinessTool


def _policy(tmp_path: Path, *resources: str) -> PolicyContext:
    policy_file = tmp_path / "policy.json"
    payload = {
        "subject": {
            "user_id": "u1",
            "email": "hr@example.com",
            "role": "user",
            "business_role": "hr_specialist",
        },
        "resources": [
            {
                "resource": resource,
                "actions": ["read", "query", "analyze", "write", "delete"],
                "scopes": [{"key": "company", "values": ["武汉赢城文化传媒有限公司"]}],
            }
            for resource in resources
        ],
        "skills": ["hr-db-ops"],
        "chat_id": "chat-1",
        "policy_file": str(policy_file),
    }
    policy_file.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    return PolicyContext.from_payload(payload)


def test_hr_business_builds_argv_with_option_aliases(tmp_path: Path) -> None:
    tool = HrBusinessTool(workspace=tmp_path)

    argv = tool._build_argv(
        "analyze",
        "seal-usage",
        {
            "action": "analyze",
            "resource": "seal-usage",
            "from_date": "2026-01-01",
            "to_date": "2026-01-31",
        },
        "chat-1",
    )

    assert "--from" in argv
    assert "--to" in argv
    assert "--from-date" not in argv
    assert "--to-date" not in argv
    command, options = tool._resolve_command(argv)
    assert command == "analyze-seal-usage"
    assert options["from"] == "2026-01-01"
    assert options["to"] == "2026-01-31"


def test_hr_business_missing_required_id_comes_from_option_contract(tmp_path: Path) -> None:
    tool = HrBusinessTool(workspace=tmp_path)

    with pytest.raises(RuntimeError, match="requires option --id"):
        tool._build_argv("get", "employee", {"action": "get", "resource": "employee"}, "chat-1")


def test_hr_business_schema_permission_uses_requested_resource(tmp_path: Path) -> None:
    policy = _policy(tmp_path, "hr.employee")

    with bind_policy_context(policy), pytest.raises(RuntimeError, match="hr.contract:read"):
        HrBusinessTool._authorize_registry_layer(
            policy=policy,
            action="schema",
            resource="contract",
            command="business-plan-schema",
        )


def test_hr_business_analyze_aliases_resolve_to_hr_command_rules(tmp_path: Path) -> None:
    tool = HrBusinessTool(workspace=tmp_path)

    for resource, command in {
        "employee-profile": "analyze-employee-profile",
        "insurance": "analyze-insurance-month",
        "personnel-changes": "analyze-personnel-change",
    }.items():
        argv = tool._build_argv("analyze", resource, {"action": "analyze", "resource": resource}, "chat-1")
        resolved, _options = tool._resolve_command(argv)
        assert resolved == command


def test_hr_business_rejects_input_outside_runtime_input_dir(tmp_path: Path) -> None:
    tool = HrBusinessTool(workspace=tmp_path)

    with pytest.raises(RuntimeError, match="input 路径越界"):
        tool._build_argv(
            "preview",
            "employee",
            {"action": "preview", "resource": "employee", "input": "../../etc/passwd"},
            "chat-1",
        )


@pytest.mark.asyncio
async def test_hr_business_persists_large_results(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    tool = HrBusinessTool(workspace=tmp_path)
    policy = _policy(tmp_path, "hr.employee")

    def fake_run_business_command(_argv, *, context=None):
        return {"ok": True, "data": {"records": [{"name": "张三", "bio": "x" * 6000}]}}

    monkeypatch.setattr(hr_business, "run_business_command", fake_run_business_command)
    with bind_policy_context(policy):
        result = json.loads(await tool.execute(action="list", resource="employee"))

    assert result["ok"] is True
    assert result["persisted"] is True
    output_path = Path(result["full_output_path"])
    assert output_path.exists()
    assert "webui_plugin_chat-1" in str(output_path)
