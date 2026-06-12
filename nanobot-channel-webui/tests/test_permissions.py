from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path
from typing import Any

from nanobot_channel_webui.permissions import PolicyContext, bind_policy_context
from nanobot_channel_webui.permissions.resolver import PolicyResolver
from nanobot_channel_webui.tenant_runtime import TenantContext, bind_tenant_context
from nanobot_channel_webui.tenant_runtime.audit import TenantAuditLogger, normalize_audit_event
from nanobot_channel_webui.tenant_runtime.contract_validator import (
    validate_workspace_skill_contracts,
)
from nanobot_channel_webui.tenant_runtime.contracts import TenantPolicy
from nanobot_channel_webui.tenant_runtime.guard import TenantAccessDenied, TenantGuard
from nanobot_channel_webui.tenant_runtime.memory_gateway import MemoryGateway
from nanobot_channel_webui.tenant_runtime.skill_contract import load_skill_contract
from nanobot_channel_webui.tenant_runtime.skill_gateway import SkillGateway
from nanobot_channel_webui.tenant_runtime.tool_gateway import ToolGateway


class FakeTool:
    name = "exec"

    def cast_params(self, params: dict[str, Any]) -> dict[str, Any]:
        return params

    def validate_params(self, params: dict[str, Any]) -> list[str]:
        return []

    async def execute(self, **kwargs: Any) -> str:
        return kwargs.get("command", "")


class FakeRegistry:
    tool_names = ["exec", "read_file", "write_file"]

    def get_definitions(self):
        return [
            {"type": "function", "function": {"name": "exec"}},
            {"type": "function", "function": {"name": "read_file"}},
            {"type": "function", "function": {"name": "write_file"}},
        ]

    def prepare_call(self, name: str, params: dict[str, Any]):
        return FakeTool(), params, None

    async def execute(self, name: str, params: dict[str, Any]):
        return params

    def get(self, name: str):
        return FakeTool()

    def has(self, name: str) -> bool:
        return name in self.tool_names

    def __len__(self):
        return len(self.tool_names)

    def __contains__(self, name: str) -> bool:
        return name in self.tool_names


class FakeGeneralRegistry(FakeRegistry):
    tool_names = [
        "exec",
        "read_file",
        "write_file",
        "list_dir",
        "grep",
        "edit_file",
        "spawn",
        "my",
        "web_search",
        "create_docx",
    ]

    def get_definitions(self):
        return [{"type": "function", "function": {"name": name}} for name in self.tool_names]


class FakeSkills:
    def list_skills(self, *args: Any, **kwargs: Any):
        return [{"name": "hr-db-ops"}, {"name": "supabase-base"}]

    def load_skill(self, name: str):
        return f"skill:{name}\n\nHidden full implementation command: count-all"

    def load_skills_for_context(self, names: list[str]):
        return ",".join(names)

    def build_skills_summary(self, exclude=None):
        excluded = set(exclude or set())
        return ",".join(item["name"] for item in self.list_skills() if item["name"] not in excluded)

    def get_always_skills(self):
        return ["hr-db-ops", "supabase-base"]

    def get_skill_metadata(self, name: str):
        return {"name": name}


class FakeMemory:
    def get_memory_context(self):
        return "global memory"

    def read_unprocessed_history(self, *args: Any, **kwargs: Any):
        return [{"timestamp": "2026-05-28", "content": "global history"}]


class FakeUser:
    id = "u1"
    email = "hr@example.com"
    role = "user"
    is_admin = False
    business_role = "hr_specialist"
    tenant_id = "tenant-a"
    skills = ["hr-db-ops"]
    scopes = {"company": ["武汉赢城文化传媒有限公司"]}

    def __init__(self, tenant_policy: dict[str, Any] | None = None) -> None:
        self.tenant_policy = tenant_policy
        self.resources = [
            {
                "resource": "hr.employee",
                "actions": ["read", "query", "analyze", "write"],
                "scopes": [{"key": "company", "values": ["武汉赢城文化传媒有限公司"]}],
            },
        ]


class FakeAdminUser(FakeUser):
    email = "admin@example.com"
    role = "admin"
    is_admin = True
    business_role = "admin"
    skills = []
    scopes = {}


def scoped_policy(tmp_path: Path) -> PolicyContext:
    policy = PolicyContext(
        user_id="u1",
        email="hr@example.com",
        role="user",
        business_role="hr_specialist",
        scopes={"company": ("武汉赢城文化传媒有限公司",)},
        resources=(
            {
                "resource": "hr.company",
                "actions": ["read", "query"],
                "scopes": [{"key": "company", "values": ["武汉赢城文化传媒有限公司"]}],
            },
            {
                "resource": "hr.employee",
                "actions": ["read", "query", "analyze", "write"],
                "scopes": [{"key": "company", "values": ["武汉赢城文化传媒有限公司"]}],
            },
        ),
        skill_allowlist=frozenset({"hr-db-ops"}),
        exec_mode="deny_by_default",
        chat_id="chat-1",
        policy_file=str(tmp_path / "policy.json"),
    )
    Path(policy.policy_file).write_text("{}", encoding="utf-8")
    return policy


def scoped_policy_without_file() -> PolicyContext:
    return PolicyContext(
        user_id="u1",
        email="hr@example.com",
        role="user",
        business_role="hr_specialist",
        scopes={"company": ("武汉赢城文化传媒有限公司",)},
        resources=(
            {
                "resource": "hr.employee",
                "actions": ["read", "query", "analyze", "write"],
                "scopes": [{"key": "company", "values": ["武汉赢城文化传媒有限公司"]}],
            },
        ),
        skill_allowlist=frozenset({"hr-db-ops"}),
        exec_mode="deny_by_default",
        chat_id="chat-1",
    )


class FakeSplitResourceUser(FakeUser):
    def __init__(self, tenant_policy: dict[str, Any] | None = None) -> None:
        super().__init__(tenant_policy)
        self.resources = [
            {
                "resource": resource,
                "actions": ["read", "query", "analyze", "write"],
                "scopes": [{"key": "company", "values": ["武汉赢城文化传媒有限公司"]}],
            }
            for resource in (
                "hr.company",
                "hr.organization",
                "hr.department",
                "hr.employee",
                "hr.contract",
                "hr.performance",
                "hr.insurance",
                "hr.personnel_change",
                "hr.disciplinary",
                "hr.seal_usage",
            )
        ]


def test_policy_resolver_requires_explicit_hr_resources() -> None:
    policy = PolicyResolver().resolve(FakeUser())
    resources = {item["resource"]: item for item in policy.resources}

    assert set(resources) == {"hr.employee"}
    assert "hr.contract" not in resources
    assert "hr.performance" not in resources
    assert "hr.insurance" not in resources
    assert "hr-data-entry-workflow" not in policy.skill_allowlist


def test_policy_context_defaults_are_fail_closed() -> None:
    policy = PolicyContext()
    tenant_policy = TenantPolicy.from_payload({})

    assert not policy.is_unrestricted
    assert not tenant_policy.is_unrestricted
    assert not tenant_policy.allows("hr.employee", "query", scope_key="company", scope_value="任意公司")


def test_policy_resolver_missing_user_is_not_admin() -> None:
    policy = PolicyResolver().resolve(None)

    assert not policy.is_unrestricted
    assert policy.resources == ()


def test_policy_resolver_admin_is_unrestricted() -> None:
    policy = PolicyResolver().resolve(FakeAdminUser())

    assert policy.is_unrestricted
    assert policy.role == "admin"
    assert policy.business_role == "admin"
    assert policy.skill_allowlist == frozenset({"*"})
    assert policy.exec_mode == "allow"


def test_policy_resolver_keeps_tenant_policy_resources_explicit() -> None:
    policy = PolicyResolver().resolve(
        FakeUser(
            {
                "resources": [
                    {
                        "resource": "hr.employee",
                        "actions": ["read", "query", "analyze"],
                        "scopes": [{"key": "company", "values": ["乐潮里科技有限公司"]}],
                    },
                    {
                        "resource": "hr.contract",
                        "actions": ["read"],
                        "scopes": [{"key": "company", "values": ["乐潮里科技有限公司"]}],
                    },
                ],
                "skills": ["hr-db-ops"],
            }
        )
    )
    resources = {item["resource"]: item for item in policy.resources}

    assert resources["hr.contract"]["actions"] == ["read"]
    assert "hr.performance" not in resources
    assert "hr.insurance" not in resources
    assert "hr-data-entry-workflow" not in policy.skill_allowlist


def write_skill_contract(
    workspace: Path,
    *,
    name: str = "hr-db-ops",
    command: str = "skills/hr-db-ops/scripts/run-hr-cli.sh",
) -> None:
    skill_dir = workspace / "skills" / name
    skill_dir.mkdir(parents=True)
    (skill_dir / "tenant-runtime.json").write_text(
        f"""{{
  "name": "{name}",
  "resources": [
    {{ "resource": "hr.company", "actions": ["read", "query"], "scope_key": "company" }},
    {{ "resource": "hr.employee", "actions": ["read", "query", "analyze", "write"], "scope_key": "company" }}
  ],
  "commands": ["{command}"],
  "denied_commands": ["clear-business-data", "delete-employee-records", "count-all"]
}}
""",
        encoding="utf-8",
    )


def write_capability_skill_contract(workspace: Path) -> None:
    skill_dir = workspace / "skills" / "hr-db-ops"
    skill_dir.mkdir(parents=True)
    (skill_dir / "tenant-runtime.json").write_text(
        """{
  "name": "hr-db-ops",
  "resources": [
    { "resource": "hr.company", "actions": ["read", "query"], "scope_key": "company" },
    { "resource": "hr.employee", "actions": ["read", "query", "analyze"], "scope_key": "company" }
  ],
  "commands": ["skills/hr-db-ops/scripts/run-hr-cli.sh"],
  "denied_commands": ["count-all"],
  "capabilities": [
    {
      "id": "hr.employee.overview",
      "kind": "analysis",
      "commands": ["employee-summary", "analyze-headcount"],
      "resources": [{ "resource": "hr.employee", "actions": ["analyze"], "scope_key": "company" }]
    }
  ]
}
""",
        encoding="utf-8",
    )


def write_organization_tree_skill_contract(workspace: Path) -> None:
    skill_dir = workspace / "skills" / "hr-db-ops"
    skill_dir.mkdir(parents=True)
    (skill_dir / "tenant-runtime.json").write_text(
        """{
  "name": "hr-db-ops",
  "resources": [
    { "resource": "hr.organization", "actions": ["read", "query"], "scope_key": "company" },
    { "resource": "hr.department", "actions": ["read", "query"], "scope_key": "company" }
  ],
  "commands": ["nanobot-webui-business hr"],
  "capabilities": [
    {
      "id": "hr.organization.tree",
      "kind": "query",
      "commands": ["business list department"],
      "resources": [
        { "resource": "hr.organization", "actions": ["query"], "scope_key": "company" },
        { "resource": "hr.department", "actions": ["query"], "scope_key": "company" }
      ]
    }
  ]
}
""",
        encoding="utf-8",
    )


def write_split_resource_skill_contract(workspace: Path) -> None:
    skill_dir = workspace / "skills" / "hr-db-ops"
    skill_dir.mkdir(parents=True)
    (skill_dir / "tenant-runtime.json").write_text(
        """{
  "name": "hr-db-ops",
  "resources": [
    { "resource": "hr.company", "actions": ["read", "query"], "scope_key": "company" },
    { "resource": "hr.employee", "actions": ["read", "query", "analyze"], "scope_key": "company" },
    { "resource": "hr.contract", "actions": ["read", "query", "analyze"], "scope_key": "company" },
    { "resource": "hr.performance", "actions": ["read", "query", "analyze"], "scope_key": "company" },
    { "resource": "hr.insurance", "actions": ["read", "query", "analyze"], "scope_key": "company" }
  ],
  "commands": ["skills/hr-db-ops/scripts/run-hr-cli.sh"],
  "capabilities": [
    {
      "id": "hr.contract.analysis",
      "kind": "analysis",
      "commands": ["business analyze contract-coverage"],
      "resources": [{ "resource": "hr.contract", "actions": ["analyze"], "scope_key": "company" }]
    },
    {
      "id": "hr.performance.analysis",
      "kind": "analysis",
      "commands": ["business analyze performance"],
      "resources": [{ "resource": "hr.performance", "actions": ["query", "analyze"], "scope_key": "company" }]
    },
    {
      "id": "hr.insurance.analysis",
      "kind": "analysis",
      "commands": ["business analyze insurance"],
      "resources": [{ "resource": "hr.insurance", "actions": ["query", "analyze"], "scope_key": "company" }]
    }
  ]
}
""",
        encoding="utf-8",
    )


def test_tool_definitions_keep_general_tools_for_scoped_user(tmp_path: Path) -> None:
    registry = ToolGateway(FakeGeneralRegistry(), audit=TenantAuditLogger(tmp_path), workspace=tmp_path)
    with bind_policy_context(scoped_policy(tmp_path)):
        names = [item["function"]["name"] for item in registry.get_definitions()]

    assert names == ["exec", "read_file", "write_file", "list_dir", "web_search", "create_docx"]


def test_sensitive_runtime_tools_are_hidden_for_scoped_user(tmp_path: Path) -> None:
    registry = ToolGateway(FakeGeneralRegistry(), audit=TenantAuditLogger(tmp_path), workspace=tmp_path)
    with bind_policy_context(scoped_policy(tmp_path)):
        names = {item["function"]["name"] for item in registry.get_definitions()}

    assert "grep" not in names
    assert "edit_file" not in names
    assert "spawn" not in names
    assert "my" not in names


def test_sensitive_runtime_tool_call_is_denied_for_scoped_user(tmp_path: Path) -> None:
    registry = ToolGateway(FakeGeneralRegistry(), audit=TenantAuditLogger(tmp_path), workspace=tmp_path)
    with bind_policy_context(scoped_policy(tmp_path)):
        _tool, _params, error = registry.prepare_call("grep", {"pattern": "secret", "path": str(tmp_path)})

    assert error is not None
    assert "scoped_tool_hidden" in error


def test_general_non_exec_tool_passthrough_for_scoped_user(tmp_path: Path) -> None:
    registry = ToolGateway(FakeGeneralRegistry(), audit=TenantAuditLogger(tmp_path), workspace=tmp_path)

    with bind_policy_context(scoped_policy(tmp_path)):
        _tool, params, error = registry.prepare_call("create_docx", {"title": "授权员工花名册"})

    assert error is None
    assert params == {"title": "授权员工花名册"}


def test_non_hr_exec_command_is_denied_for_scoped_user(tmp_path: Path) -> None:
    registry = ToolGateway(FakeRegistry(), audit=TenantAuditLogger(tmp_path), workspace=tmp_path)
    with bind_policy_context(scoped_policy(tmp_path)):
        _tool, _params, error = registry.prepare_call("exec", {"command": "cat skills/supabase-base/.env"})

    assert error is not None
    assert "无权执行" in error


def test_scoped_user_cannot_read_sensitive_runtime_files(tmp_path: Path) -> None:
    registry = ToolGateway(FakeRegistry(), audit=TenantAuditLogger(tmp_path), workspace=tmp_path)
    sensitive_paths = [
        Path.home() / ".nanobot" / "config.json",
        tmp_path / "sessions" / "webui_plugin_chat-1.jsonl",
        tmp_path / ".nanobot_channel_webui" / "audit" / "permissions.jsonl",
        tmp_path / ".nanobot_channel_webui" / "policies" / "chat-1.json",
        tmp_path / ".nanobot_channel_webui" / "private" / "supabase-runtime" / "connector.mjs",
    ]

    with bind_policy_context(scoped_policy(tmp_path)):
        for path in sensitive_paths:
            _tool, _params, error = registry.prepare_call("read_file", {"path": str(path)})
            assert error is not None
            assert "无权读取" in error


def test_scoped_user_cannot_list_sensitive_or_workspace_root_dirs(tmp_path: Path) -> None:
    registry = ToolGateway(FakeRegistry(), audit=TenantAuditLogger(tmp_path), workspace=tmp_path)

    with bind_policy_context(scoped_policy(tmp_path)):
        for path in [tmp_path, tmp_path / "sessions", tmp_path / ".nanobot_channel_webui" / "audit"]:
            _tool, _params, error = registry.prepare_call("list_dir", {"path": str(path)})
            assert error is not None
            assert "无权列出" in error


def test_scoped_user_can_list_own_artifact_dir(tmp_path: Path) -> None:
    registry = ToolGateway(FakeRegistry(), audit=TenantAuditLogger(tmp_path), workspace=tmp_path)
    artifact_dir = tmp_path / ".nanobot_channel_webui" / "artifacts" / "chat-1"

    with bind_policy_context(scoped_policy(tmp_path)):
        _tool, params, error = registry.prepare_call("list_dir", {"path": str(artifact_dir)})

    assert error is None
    assert params["path"] == str(artifact_dir)


def test_audit_logger_writes_structured_events_and_filters_by_user(tmp_path: Path) -> None:
    audit = TenantAuditLogger(tmp_path)
    scoped = scoped_policy(tmp_path)
    other = PolicyContext(
        user_id="u2",
        email="other@example.com",
        role="user",
        business_role="hr_specialist",
        scopes={"company": ("乐潮里科技有限公司",)},
        resources=(
            {
                "resource": "hr.company",
                "actions": ["read", "query"],
                "scopes": [{"key": "company", "values": ["乐潮里科技有限公司"]}],
            },
            {
                "resource": "hr.employee",
                "actions": ["read", "query", "analyze", "write"],
                "scopes": [{"key": "company", "values": ["乐潮里科技有限公司"]}],
            },
        ),
        skill_allowlist=frozenset({"hr-db-ops"}),
        exec_mode="deny_by_default",
        chat_id="chat-2",
    )

    audit.record(
        policy=scoped,
        tool="exec",
        command="cmd1",
        decision="allow",
        reason="hr_cli_allowed",
        metadata={"persisted": True},
    )
    audit.record(policy=other, tool="exec", command="cmd2", decision="deny", reason="tenant_scope_denied")

    own_events = audit.recent(email="hr@example.com", include_all=False)
    all_events = audit.recent(include_all=True)

    assert len(own_events) == 1
    assert own_events[0]["version"] == "tenant-runtime/audit/v1"
    assert own_events[0]["tenant_policy"]["version"] == "tenant-runtime/v1"
    assert own_events[0]["command"] == "cmd1"
    assert own_events[0]["metadata"] == {"persisted": True}
    assert len(all_events) == 2


def test_normalize_legacy_audit_event() -> None:
    event = normalize_audit_event({"email": "legacy@example.com", "decision": "deny"})

    assert event["version"] == "permissions/audit-legacy"
    assert event["email"] == "legacy@example.com"
    assert event["decision"] == "deny"


def test_hr_exec_business_cli_is_denied_for_scoped_user(tmp_path: Path) -> None:
    write_skill_contract(tmp_path)
    registry = ToolGateway(FakeRegistry(), audit=TenantAuditLogger(tmp_path), workspace=tmp_path)
    with bind_policy_context(scoped_policy(tmp_path)):
        _tool, params, error = registry.prepare_call(
            "exec",
            {"command": "skills/hr-db-ops/scripts/run-hr-cli.sh employee-detail --name 张三 --company 武汉赢城文化传媒有限公司"},
    )

    assert error is None
    assert params["command"].startswith("NANOBOT_WEBUI_POLICY_FILE=")
    assert "run-hr-cli.sh employee-detail" in params["command"]


def test_hr_exec_command_requires_policy_file_for_scoped_user(tmp_path: Path) -> None:
    write_skill_contract(tmp_path)
    registry = ToolGateway(FakeRegistry(), audit=TenantAuditLogger(tmp_path), workspace=tmp_path)
    with bind_policy_context(scoped_policy_without_file()):
        _tool, _params, error = registry.prepare_call(
            "exec",
            {"command": "skills/hr-db-ops/scripts/run-hr-cli.sh employee-detail --name 张三"},
        )

    assert error is not None
    assert "policy_file_required" in error


def test_hr_exec_command_allows_common_stderr_merge_suffix(tmp_path: Path) -> None:
    write_skill_contract(tmp_path)
    registry = ToolGateway(FakeRegistry(), audit=TenantAuditLogger(tmp_path), workspace=tmp_path)
    with bind_policy_context(scoped_policy(tmp_path)):
        _tool, params, error = registry.prepare_call(
            "exec",
            {"command": "skills/hr-db-ops/scripts/run-hr-cli.sh analyze-headcount 2>&1"},
        )

    assert error is None
    assert params["command"].startswith("NANOBOT_WEBUI_POLICY_FILE=")
    assert params["command"].endswith("run-hr-cli.sh analyze-headcount 2>&1")


def test_hr_exec_command_allows_safe_cd_workspace_prefix(tmp_path: Path) -> None:
    write_skill_contract(tmp_path)
    registry = ToolGateway(FakeRegistry(), audit=TenantAuditLogger(tmp_path), workspace=tmp_path)
    with bind_policy_context(scoped_policy(tmp_path)):
        _tool, params, error = registry.prepare_call(
            "exec",
            {"command": f"cd {tmp_path} && bash skills/hr-db-ops/scripts/run-hr-cli.sh analyze-headcount"},
        )

    assert error is None
    assert params["command"].startswith(f"cd {tmp_path} && ")
    assert "cd " in params["command"]
    assert "&& NANOBOT_WEBUI_POLICY_FILE=" in params["command"]


def test_organization_tree_business_command_gets_policy_env(tmp_path: Path) -> None:
    write_organization_tree_skill_contract(tmp_path)
    policy_file = tmp_path / "policy.json"
    policy_file.write_text("{}", encoding="utf-8")
    policy = PolicyContext(
        user_id="u1",
        email="hr@example.com",
        role="user",
        business_role="hr_specialist",
        scopes={"company": ("乐潮里科技有限公司",)},
        resources=(
            {
                "resource": "hr.organization",
                "actions": ["read", "query"],
                "scopes": [{"key": "company", "values": ["乐潮里科技有限公司"]}],
            },
            {
                "resource": "hr.department",
                "actions": ["read", "query"],
                "scopes": [{"key": "company", "values": ["乐潮里科技有限公司"]}],
            },
        ),
        skill_allowlist=frozenset({"hr-db-ops"}),
        exec_mode="deny_by_default",
        chat_id="chat-1",
        policy_file=str(policy_file),
    )
    registry = ToolGateway(FakeRegistry(), audit=TenantAuditLogger(tmp_path), workspace=tmp_path)

    with bind_policy_context(policy):
        _tool, _params, error = registry.prepare_call(
            "exec",
            {"command": "nanobot-webui-business hr business list department"},
        )

    assert error is not None
    assert "hr_business_cli_requires_tool" in error


def test_scoped_user_can_write_json_runtime_input_file(tmp_path: Path) -> None:
    registry = ToolGateway(FakeRegistry(), audit=TenantAuditLogger(tmp_path), workspace=tmp_path)
    target = tmp_path / ".nanobot_channel_webui" / "runtime-inputs" / "chat-1" / "employee-plan.json"

    with bind_policy_context(scoped_policy(tmp_path)):
        _tool, params, error = registry.prepare_call(
            "write_file",
            {"path": str(target), "content": '{"records":[{"name":"韩琳"}]}'},
        )

    assert error is None
    assert params["path"] == str(target)
    assert target.parent.exists()


def test_scoped_user_relocates_json_written_outside_runtime_input_dir(tmp_path: Path) -> None:
    registry = ToolGateway(FakeRegistry(), audit=TenantAuditLogger(tmp_path), workspace=tmp_path)

    with bind_policy_context(scoped_policy(tmp_path)):
        result = asyncio.run(
            registry.execute(
                "write_file",
                {"path": str(tmp_path / "plan.json"), "content": '{"records":[]}'},
            )
        )

    relocated = tmp_path / ".nanobot_channel_webui" / "runtime-inputs" / "chat-1" / "plan.json"
    assert relocated.read_text(encoding="utf-8") == '{"records":[]}'
    assert str(relocated) in result
    assert "--input" in result


def test_scoped_user_cannot_write_non_json_runtime_input(tmp_path: Path) -> None:
    registry = ToolGateway(FakeRegistry(), audit=TenantAuditLogger(tmp_path), workspace=tmp_path)
    target = tmp_path / ".nanobot_channel_webui" / "runtime-inputs" / "chat-1" / "employee-plan.txt"

    with bind_policy_context(scoped_policy(tmp_path)):
        _tool, _params, error = registry.prepare_call(
            "write_file",
            {"path": str(target), "content": '{"records":[]}'},
        )

    assert error is not None
    assert "runtime_input_must_be_json" in error


def test_hr_count_all_is_denied_for_scoped_user(tmp_path: Path) -> None:
    write_skill_contract(tmp_path)
    registry = ToolGateway(FakeRegistry(), audit=TenantAuditLogger(tmp_path), workspace=tmp_path)
    with bind_policy_context(scoped_policy(tmp_path)):
        _tool, _params, error = registry.prepare_call(
            "exec",
            {"command": "skills/hr-db-ops/scripts/run-hr-cli.sh count-all"},
        )

    assert error is not None
    assert "tenant_contract_command_denied" in error


def test_hr_cli_count_all_is_denied_by_python_policy_for_scoped_user(tmp_path: Path) -> None:
    from nanobot_channel_webui.business_modules.hr.runtime import commands

    policy_file = tmp_path / "policy.json"
    policy_file.write_text(
        json.dumps(
            {
                "subject": {
                    "user_id": "u1",
                    "email": "hr@example.com",
                    "role": "user",
                    "business_role": "hr_specialist",
                },
                "resources": [
                    {
                        "resource": "hr.employee",
                        "actions": ["read", "query", "analyze"],
                        "scopes": [{"key": "company", "values": ["武汉赢城文化传媒有限公司"]}],
                    }
                ],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    class FailingRepository:
        def count_all_tables(self):
            raise AssertionError("database should not be reached")

    previous = os.environ.get("NANOBOT_WEBUI_POLICY_FILE")
    os.environ["NANOBOT_WEBUI_POLICY_FILE"] = str(policy_file)
    try:
        result = commands.main(["count-all"], repo=FailingRepository())
    finally:
        if previous is None:
            os.environ.pop("NANOBOT_WEBUI_POLICY_FILE", None)
        else:
            os.environ["NANOBOT_WEBUI_POLICY_FILE"] = previous

    assert result == 1


def test_capability_contract_limits_scoped_user_to_declared_business_actions(tmp_path: Path) -> None:
    write_capability_skill_contract(tmp_path)
    registry = ToolGateway(FakeRegistry(), audit=TenantAuditLogger(tmp_path), workspace=tmp_path)

    with bind_policy_context(scoped_policy(tmp_path)):
        _tool, params, error = registry.prepare_call(
            "exec",
            {"command": "skills/hr-db-ops/scripts/run-hr-cli.sh employee-summary"},
        )

    assert error is None
    assert params["command"].startswith("NANOBOT_WEBUI_POLICY_FILE=")

    with bind_policy_context(scoped_policy(tmp_path)):
        _tool, _params, error = registry.prepare_call(
            "exec",
            {"command": "skills/hr-db-ops/scripts/run-hr-cli.sh employee-detail --name 张三"},
        )

    assert error is not None
    assert "capability_not_allowed" in error


def test_capability_contract_allows_declared_standard_business_command(tmp_path: Path) -> None:
    skill_dir = tmp_path / "skills" / "hr-db-ops"
    skill_dir.mkdir(parents=True)
    (skill_dir / "tenant-runtime.json").write_text(
        """{
  "name": "hr-db-ops",
  "resources": [
    { "resource": "hr.employee", "actions": ["read", "query", "analyze"], "scope_key": "company" }
  ],
  "commands": ["skills/hr-db-ops/scripts/run-hr-cli.sh"],
  "capabilities": [
    {
      "id": "hr.employee.overview",
      "kind": "analysis",
      "commands": ["business analyze headcount"],
      "resources": [{ "resource": "hr.employee", "actions": ["analyze"], "scope_key": "company" }]
    }
  ]
}
""",
        encoding="utf-8",
    )
    registry = ToolGateway(FakeRegistry(), audit=TenantAuditLogger(tmp_path), workspace=tmp_path)

    with bind_policy_context(scoped_policy(tmp_path)):
        _tool, _params, error = registry.prepare_call(
            "exec",
            {"command": "skills/hr-db-ops/scripts/run-hr-cli.sh business analyze headcount"},
        )

    assert error is not None
    assert "hr_business_cli_requires_tool" in error

    with bind_policy_context(scoped_policy(tmp_path)):
        _tool, _params, error = registry.prepare_call(
            "exec",
            {"command": 'skills/hr-db-ops/scripts/run-hr-cli.sh "business analyze headcount"'},
        )

    assert error is not None
    assert "hr_business_cli_requires_tool" in error

    with bind_policy_context(scoped_policy(tmp_path)):
        _tool, _params, error = registry.prepare_call(
            "exec",
            {"command": "skills/hr-db-ops/scripts/run-hr-cli.sh business analyze headcount 2>&1"},
        )

    assert error is not None
    assert "hr_business_cli_requires_tool" in error

    with bind_policy_context(scoped_policy(tmp_path)):
        _tool, _params, error = registry.prepare_call(
            "exec",
            {"command": "skills/hr-db-ops/scripts/run-hr-cli.sh business analyze headcount 2>&1 | head -50"},
        )

    assert error is not None
    assert "hr_business_cli_requires_tool" in error

    with bind_policy_context(scoped_policy(tmp_path)):
        _tool, params, error = registry.prepare_call(
            "exec",
            {"command": "skills/hr-db-ops/scripts/run-hr-cli.sh help"},
        )

    assert error is None
    assert "run-hr-cli.sh help" in params["command"]


def test_dynamic_skill_view_exposes_split_business_resources(tmp_path: Path) -> None:
    write_split_resource_skill_contract(tmp_path)
    loader = SkillGateway(FakeSkills(), workspace=tmp_path)
    policy = PolicyResolver().resolve(FakeSplitResourceUser())

    with bind_policy_context(policy):
        content = loader.load_skill("hr-db-ops")

    assert content is not None
    assert "Dynamic Skill View" in content
    assert "hr.contract.analysis" in content
    assert "hr.performance.analysis" in content
    assert "hr.insurance.analysis" in content
    assert "Resources: hr.contract:analyze scoped by `company`" in content
    assert "Resources: hr.performance:query,analyze scoped by `company`" in content
    assert "Resources: hr.insurance:query,analyze scoped by `company`" in content
    assert "hr_business" in content
    assert "Always run HR business CLI" not in content
    assert ".nanobot_channel_webui/runtime-inputs/" in content
    assert "write_file" in content
    assert "Never create input plans with shell redirects" in content


def test_tenant_guard_enforces_split_resource_scope(tmp_path: Path) -> None:
    policy = PolicyResolver().resolve(FakeSplitResourceUser())
    guard = TenantGuard(policy.to_tenant_policy())

    guard.require(
        "hr.contract",
        "analyze",
        scope_key="company",
        scope_value="武汉赢城文化传媒有限公司",
    )
    guard.require(
        "hr.performance",
        "query",
        scope_key="company",
        scope_value="武汉赢城文化传媒有限公司",
    )
    guard.require(
        "hr.insurance",
        "query",
        scope_key="company",
        scope_value="武汉赢城文化传媒有限公司",
    )

    try:
        guard.require(
            "hr.contract",
            "analyze",
            scope_key="company",
            scope_value="乐潮里科技有限公司",
        )
    except TenantAccessDenied as exc:
        assert str(exc) == "tenant_scope_denied"
    else:
        raise AssertionError("unauthorized company should be denied for split resources")


def test_exec_command_is_allowed_by_generic_skill_contract(tmp_path: Path) -> None:
    write_skill_contract(tmp_path, name="payroll-ops", command="skills/payroll-ops/scripts/run-payroll.sh")
    policy = PolicyContext(
        user_id="u1",
        email="payroll@example.com",
        role="user",
        business_role="payroll_specialist",
        scopes={"company": ("武汉赢城文化传媒有限公司",)},
        resources=(
            {
                "resource": "hr.company",
                "actions": ["read", "query"],
                "scopes": [{"key": "company", "values": ["武汉赢城文化传媒有限公司"]}],
            },
            {
                "resource": "hr.employee",
                "actions": ["read", "query", "analyze", "write"],
                "scopes": [{"key": "company", "values": ["武汉赢城文化传媒有限公司"]}],
            },
        ),
        skill_allowlist=frozenset({"payroll-ops"}),
        exec_mode="deny_by_default",
        chat_id="chat-1",
        policy_file=str(tmp_path / "policy.json"),
    )
    Path(policy.policy_file).write_text("{}", encoding="utf-8")
    registry = ToolGateway(FakeRegistry(), audit=TenantAuditLogger(tmp_path), workspace=tmp_path)

    with bind_policy_context(policy):
        _tool, params, error = registry.prepare_call(
            "exec",
            {"command": "bash skills/payroll-ops/scripts/run-payroll.sh summarize --company 武汉赢城文化传媒有限公司"},
        )

    assert error is None
    assert params["command"].startswith("NANOBOT_WEBUI_POLICY_FILE=")
    assert "run-payroll.sh summarize" in params["command"]


def test_exec_command_declared_by_unauthorized_skill_is_denied(tmp_path: Path) -> None:
    write_skill_contract(tmp_path, name="finance-ops", command="skills/finance-ops/scripts/run-finance.sh")
    registry = ToolGateway(FakeRegistry(), audit=TenantAuditLogger(tmp_path), workspace=tmp_path)

    with bind_policy_context(scoped_policy(tmp_path)):
        _tool, _params, error = registry.prepare_call(
            "exec",
            {"command": "skills/finance-ops/scripts/run-finance.sh summarize"},
        )

    assert error is not None
    assert "skill_not_allowed" in error


def test_unmanaged_exec_command_uses_framework_logic_for_scoped_user(tmp_path: Path) -> None:
    registry = ToolGateway(FakeRegistry(), audit=TenantAuditLogger(tmp_path), workspace=tmp_path)

    with bind_policy_context(scoped_policy(tmp_path)):
        _tool, params, error = registry.prepare_call(
            "exec",
            {"command": "python3 -c 'print(123)' | cat"},
        )

    assert error is None
    assert params["command"] == "python3 -c 'print(123)' | cat"


def test_unmanaged_exec_still_blocks_protected_resources(tmp_path: Path) -> None:
    registry = ToolGateway(FakeRegistry(), audit=TenantAuditLogger(tmp_path), workspace=tmp_path)

    with bind_policy_context(scoped_policy(tmp_path)):
        _tool, _params, error = registry.prepare_call(
            "exec",
            {"command": "cat skills/supabase-base/.env"},
        )

    assert error is not None
    assert "blocked_sensitive_database_access" in error


def test_unmanaged_exec_blocks_sensitive_runtime_paths(tmp_path: Path) -> None:
    registry = ToolGateway(FakeRegistry(), audit=TenantAuditLogger(tmp_path), workspace=tmp_path)

    with bind_policy_context(scoped_policy(tmp_path)):
        _tool, _params, error = registry.prepare_call(
            "exec",
            {"command": f"cat {tmp_path}/sessions/webui_plugin_chat-1.jsonl"},
        )

    assert error is not None
    assert "blocked_sensitive" in error


def test_exec_denied_command_from_contract_is_denied(tmp_path: Path) -> None:
    write_skill_contract(tmp_path)
    registry = ToolGateway(FakeRegistry(), audit=TenantAuditLogger(tmp_path), workspace=tmp_path)

    with bind_policy_context(scoped_policy(tmp_path)):
        _tool, _params, error = registry.prepare_call(
            "exec",
            {"command": "skills/hr-db-ops/scripts/run-hr-cli.sh clear-business-data --confirm 清空人事业务数据"},
        )

    assert error is not None
    assert "tenant_contract_command_denied" in error


def test_managed_skill_uncontracted_script_is_denied(tmp_path: Path) -> None:
    write_skill_contract(tmp_path)
    registry = ToolGateway(FakeRegistry(), audit=TenantAuditLogger(tmp_path), workspace=tmp_path)

    with bind_policy_context(scoped_policy(tmp_path)):
        _tool, _params, error = registry.prepare_call(
            "exec",
            {"command": "bash skills/hr-db-ops/scripts/hidden-maintenance.sh"},
        )

    assert error is not None
    assert "managed_skill_command_not_declared" in error


def test_skills_loader_filters_unauthorized_skills(tmp_path: Path) -> None:
    loader = SkillGateway(FakeSkills())
    with bind_policy_context(scoped_policy(tmp_path)):
        assert loader.list_skills() == [{"name": "hr-db-ops"}]
        assert loader.load_skill("supabase-base") is None
        assert loader.build_skills_summary() == "hr-db-ops"


def test_skills_loader_renders_dynamic_capability_view_for_scoped_user(tmp_path: Path) -> None:
    write_capability_skill_contract(tmp_path)
    loader = SkillGateway(FakeSkills(), workspace=tmp_path)

    with bind_policy_context(scoped_policy(tmp_path)):
        content = loader.load_skill("hr-db-ops")
        context = loader.load_skills_for_context(["hr-db-ops", "supabase-base"])

    assert content is not None
    assert "Dynamic Skill View" in content
    assert "hr.employee.overview" in content
    assert "employee-summary" in content
    assert "武汉赢城文化传媒有限公司" in content
    assert "Hidden full implementation command" not in content
    assert "supabase-base" not in context


def test_reading_skill_markdown_returns_dynamic_view_for_scoped_user(tmp_path: Path) -> None:
    write_capability_skill_contract(tmp_path)
    skill_file = tmp_path / "skills" / "hr-db-ops" / "SKILL.md"
    skill_file.write_text("Hidden full implementation command: count-all", encoding="utf-8")
    registry = ToolGateway(FakeRegistry(), audit=TenantAuditLogger(tmp_path), workspace=tmp_path)

    with bind_policy_context(scoped_policy(tmp_path)):
        content = asyncio.run(registry.execute("read_file", {"path": str(skill_file)}))

    assert "Dynamic Skill View" in content
    assert "hr.employee.overview" in content
    assert "Hidden full implementation command" not in content


def test_memory_store_hides_global_memory_for_scoped_user(tmp_path: Path) -> None:
    memory = MemoryGateway(FakeMemory())
    with bind_policy_context(scoped_policy(tmp_path)):
        assert memory.get_memory_context() == ""
        assert memory.read_unprocessed_history() == []


def test_tenant_context_keeps_policy_context_compatibility(tmp_path: Path) -> None:
    policy = scoped_policy(tmp_path)

    assert isinstance(policy, TenantContext)

    with bind_tenant_context(policy):
        memory = MemoryGateway(FakeMemory())
        assert memory.get_memory_context() == ""


def test_policy_context_exports_standard_tenant_policy(tmp_path: Path) -> None:
    policy = scoped_policy(tmp_path)
    payload = policy.to_policy_payload()
    tenant_policy = TenantPolicy.from_payload(payload)

    assert payload["version"] == "tenant-runtime/v1"
    assert tenant_policy.subject.email == "hr@example.com"
    assert tenant_policy.allows(
        "hr.employee",
        "query",
        scope_key="company",
        scope_value="武汉赢城文化传媒有限公司",
    )
    assert tenant_policy.allows(
        "hr.employee",
        "analyze",
        scope_key="company",
        scope_value="武汉赢城文化传媒有限公司",
    )
    assert not tenant_policy.allows(
        "hr.employee",
        "query",
        scope_key="company",
        scope_value="乐潮里科技有限公司",
    )
    assert tenant_policy.scope_values("hr.employee", "company") == ("武汉赢城文化传媒有限公司",)


def test_policy_context_exports_generic_tenant_policy() -> None:
    policy = PolicyContext(
        user_id="u1",
        email="biz@example.com",
        role="user",
        business_role="biz_specialist",
        tenant_id="tenant-a",
        skill_allowlist=frozenset({"example-business-ops"}),
        scopes={"project": ("project-a",)},
        resources=(
            {
                "resource": "example.record",
                "actions": ["read", "query"],
                "scopes": [{"key": "project", "values": ["project-a"]}],
            },
        ),
    )
    payload = policy.to_policy_payload()
    tenant_policy = TenantPolicy.from_payload(payload)

    assert payload["tenant_id"] == "tenant-a"
    assert payload["scopes"] == {"project": ["project-a"]}
    assert tenant_policy.allows("example.record", "query", scope_key="project", scope_value="project-a")
    assert not tenant_policy.allows("example.record", "query", scope_key="project", scope_value="project-b")


def test_admin_tenant_policy_allows_any_resource_scope() -> None:
    tenant_policy = TenantPolicy.from_payload({"role": "admin", "business_role": "admin"})

    assert tenant_policy.allows("finance.invoice", "delete", scope_key="company", scope_value="任意公司")
    assert tenant_policy.scope_values("finance.invoice", "company") == ("*",)


def test_tenant_guard_loads_policy_file_and_filters_scope(tmp_path: Path) -> None:
    policy = scoped_policy(tmp_path).write_policy_file(tmp_path)
    guard = TenantGuard.from_file(policy.policy_file)

    assert guard.filter_scope_values(
        "hr.employee",
        "query",
        ["武汉赢城文化传媒有限公司", "乐潮里科技有限公司"],
        scope_key="company",
    ) == ["武汉赢城文化传媒有限公司"]
    assert guard.allowed_scope_values("hr.employee", "company") == ("武汉赢城文化传媒有限公司",)
    assert guard.scope_rows(
        "hr.employee",
        "query",
        [
            {"name": "A", "company": "武汉赢城文化传媒有限公司"},
            {"name": "B", "company": "乐潮里科技有限公司"},
        ],
        scope_key="company",
    ) == [{"name": "A", "company": "武汉赢城文化传媒有限公司"}]

    guard.require(
        "hr.employee",
        "query",
        scope_key="company",
        scope_value="武汉赢城文化传媒有限公司",
    )
    try:
        guard.require("hr.employee", "query", scope_key="company", scope_value="乐潮里科技有限公司")
    except TenantAccessDenied as exc:
        assert str(exc) == "tenant_scope_denied"
    else:
        raise AssertionError("unauthorized company should be denied")


def test_tenant_guard_environment_without_policy_file_is_fail_closed() -> None:
    guard = TenantGuard.from_environment({})

    assert not guard.is_unrestricted
    assert guard.filter_scope_values("hr.employee", "query", ["任意公司"], scope_key="company") == []


def test_skill_contract_loads_sidecar_and_markdown_block(tmp_path: Path) -> None:
    sidecar_skill = tmp_path / "sidecar"
    sidecar_skill.mkdir()
    (sidecar_skill / "tenant-runtime.json").write_text(
        """{
  "name": "hr-db-ops",
  "resources": [{"resource": "hr.employee", "actions": ["query"], "scope_key": "company"}],
  "commands": ["skills/hr-db-ops/scripts/run-hr-cli.sh"],
  "denied_commands": ["clear-business-data"],
  "capabilities": [
    {
      "id": "hr.employee.lookup",
      "commands": ["employee-detail"],
      "triggers": ["查员工", "employee lookup"],
      "related_capabilities": ["hr.company.list"],
      "recipe": ["Use the business getter only."],
      "resources": [{"resource": "hr.employee", "actions": ["read"], "scope_key": "company"}]
    }
  ]
}
""",
        encoding="utf-8",
    )
    sidecar_contract = load_skill_contract(sidecar_skill)

    assert sidecar_contract is not None
    assert sidecar_contract.name == "hr-db-ops"
    assert sidecar_contract.resources[0].scope_key == "company"
    assert sidecar_contract.denied_commands == ("clear-business-data",)
    assert sidecar_contract.capabilities[0].id == "hr.employee.lookup"
    assert sidecar_contract.capabilities[0].commands == ("employee-detail",)
    assert sidecar_contract.capabilities[0].triggers == ("查员工", "employee lookup")
    assert sidecar_contract.capabilities[0].related_capabilities == ("hr.company.list",)
    assert sidecar_contract.capabilities[0].recipe == ("Use the business getter only.",)

    markdown_skill = tmp_path / "markdown"
    markdown_skill.mkdir()
    (markdown_skill / "SKILL.md").write_text(
        """# HR Skill

```tenant-runtime-contract
{"name":"hr-query-analysis-router","resources":[{"resource":"hr.company","actions":"read,query","scopeKey":"company"}],"requiresConfirmation":true}
```
""",
        encoding="utf-8",
    )
    markdown_contract = load_skill_contract(markdown_skill)

    assert markdown_contract is not None
    assert markdown_contract.requires_confirmation
    assert markdown_contract.resources[0].actions == ("read", "query")


def test_skill_contract_support_kind_does_not_require_commands_or_resources(tmp_path: Path) -> None:
    skill = tmp_path / "skills" / "tenant-runtime-guard"
    skill.mkdir(parents=True)
    (skill / "SKILL.md").write_text("# Guard\n", encoding="utf-8")
    (skill / "tenant-runtime.json").write_text(
        '{"name":"tenant-runtime-guard","kind":"support","resources":[],"commands":[]}',
        encoding="utf-8",
    )

    snapshot = validate_workspace_skill_contracts(tmp_path)

    assert snapshot["summary"]["ok"] == 1
    assert snapshot["contracts"][0]["status"] == "ok"


def test_workspace_skill_contract_validator_reports_errors_and_warnings(tmp_path: Path) -> None:
    write_skill_contract(tmp_path)
    command_path = tmp_path / "skills" / "hr-db-ops" / "scripts" / "run-hr-cli.sh"
    command_path.parent.mkdir(parents=True)
    command_path.write_text("#!/usr/bin/env bash\n", encoding="utf-8")
    (tmp_path / "skills" / "hr-db-ops" / "SKILL.md").write_text("# HR DB Ops\n", encoding="utf-8")

    missing_contract = tmp_path / "skills" / "missing-contract"
    missing_contract.mkdir(parents=True)
    (missing_contract / "SKILL.md").write_text("# Missing Contract\n", encoding="utf-8")

    broken = tmp_path / "skills" / "broken-ops"
    broken.mkdir(parents=True)
    (broken / "SKILL.md").write_text("# Broken Ops\n", encoding="utf-8")
    (broken / "tenant-runtime.json").write_text(
        """{
  "name": "broken-ops",
  "resources": [{"resource": "broken.record", "actions": ["query"], "scope_key": "company"}],
  "commands": ["skills/broken-ops/scripts/missing.sh"],
  "denied_commands": ["clear-data"]
}
""",
        encoding="utf-8",
    )

    snapshot = validate_workspace_skill_contracts(tmp_path)
    by_name = {item["name"]: item for item in snapshot["contracts"]}

    assert snapshot["summary"]["total"] == 3
    assert by_name["hr-db-ops"]["status"] == "ok"
    assert by_name["missing-contract"]["status"] == "warning"
    assert by_name["missing-contract"]["issues"][0]["code"] == "missing_contract"
    assert by_name["broken-ops"]["status"] == "error"
    assert by_name["broken-ops"]["issues"][0]["code"] == "command_not_found"


def test_workspace_skill_contract_validator_accepts_cli_command_prefix(
    tmp_path: Path,
    monkeypatch,
) -> None:
    write_skill_contract(tmp_path, command="nanobot-webui-business hr")
    (tmp_path / "skills" / "hr-db-ops" / "SKILL.md").write_text("# HR DB Ops\n", encoding="utf-8")

    def fake_which(command: str) -> str | None:
        if command == "nanobot-webui-business":
            return "/usr/local/bin/nanobot-webui-business"
        return None

    monkeypatch.setattr("shutil.which", fake_which)

    snapshot = validate_workspace_skill_contracts(tmp_path)

    assert snapshot["summary"]["ok"] == 1
    assert snapshot["contracts"][0]["issues"] == []


def test_dynamic_skill_view_renders_contract_declared_recipe(tmp_path: Path) -> None:
    skill_dir = tmp_path / "skills" / "hr-db-ops"
    skill_dir.mkdir(parents=True)
    (skill_dir / "tenant-runtime.json").write_text(
        """{
  "name": "hr-db-ops",
  "resources": [
    { "resource": "hr.employee", "actions": ["read", "query", "analyze", "write"], "scope_key": "company" }
  ],
  "commands": ["skills/hr-db-ops/scripts/run-hr-cli.sh"],
  "capabilities": [
    {
      "id": "hr.employee.create",
      "kind": "create",
      "commands": ["business create employee"],
      "requires_confirmation": true,
      "triggers": ["入职", "录入员工", "create employee"],
      "related_capabilities": ["hr.employee.roster"],
      "recipe": [
        "Preview first, wait for explicit user confirmation, then write exactly one JSON plan with the write_file tool.",
        "Required JSON shape contains top-level records with plan_status direct_import.",
        "After confirmation run business create employee --input <plan.json> --confirm 导入员工主档.",
        "Use the create result verification as the final evidence."
      ],
      "resources": [{ "resource": "hr.employee", "actions": ["write"], "scope_key": "company" }]
    }
  ]
}
""",
        encoding="utf-8",
    )

    from nanobot_channel_webui.permissions.skill_view import DynamicSkillViewRenderer

    rendered = DynamicSkillViewRenderer(tmp_path).render("hr-db-ops", scoped_policy(tmp_path))

    assert rendered is not None
    assert "## Capability recipes" in rendered
    assert "### `hr.employee.create`" in rendered
    assert "top-level records" in rendered
    assert "Tool call: `hr_business(action=\"create\", resource=\"employee\")`" in rendered
    assert "Human/debug CLI fallback" in rendered
    assert "business create employee --input <plan.json> --confirm 导入员工主档" in rendered


def test_scoped_user_can_read_own_persisted_tool_result(tmp_path: Path) -> None:
    registry = ToolGateway(FakeRegistry(), audit=TenantAuditLogger(tmp_path), workspace=tmp_path)
    result_file = (
        tmp_path
        / ".nanobot"
        / "tool-results"
        / "webui_plugin_chat-1"
        / "call_dynamic_skill_view.txt"
    )
    result_file.parent.mkdir(parents=True)
    result_file.write_text("persisted dynamic skill view", encoding="utf-8")

    with bind_policy_context(scoped_policy(tmp_path)):
        _tool, params, error = registry.prepare_call("read_file", {"path": str(result_file)})

    assert error is None
    assert params["path"] == str(result_file)


def test_scoped_user_can_write_and_read_authorized_artifact(tmp_path: Path) -> None:
    registry = ToolGateway(FakeRegistry(), audit=TenantAuditLogger(tmp_path), workspace=tmp_path)
    artifact = tmp_path / ".nanobot_channel_webui" / "artifacts" / "chat-1" / "employee-report.md"

    with bind_policy_context(scoped_policy(tmp_path)):
        _tool, params, error = registry.prepare_call(
            "write_file",
            {"path": str(artifact), "content": "# 授权员工数据\n"},
        )

    assert error is None
    assert params["path"] == str(artifact)
    assert artifact.parent.exists()

    with bind_policy_context(scoped_policy(tmp_path)):
        _tool, params, error = registry.prepare_call("read_file", {"path": str(artifact)})

    assert error is None
    assert params["path"] == str(artifact)


def test_scoped_user_cannot_read_other_chat_artifact(tmp_path: Path) -> None:
    registry = ToolGateway(FakeRegistry(), audit=TenantAuditLogger(tmp_path), workspace=tmp_path)
    artifact = tmp_path / ".nanobot_channel_webui" / "artifacts" / "other-chat" / "employee-report.md"

    with bind_policy_context(scoped_policy(tmp_path)):
        _tool, _params, error = registry.prepare_call("read_file", {"path": str(artifact)})

    assert error is not None
    assert "无权读取" in error


def test_dynamic_recipe_is_before_capability_catalog(tmp_path: Path) -> None:
    skill_dir = tmp_path / "skills" / "hr-db-ops"
    skill_dir.mkdir(parents=True)
    (skill_dir / "tenant-runtime.json").write_text(
        """{
  "name": "hr-db-ops",
  "resources": [
    { "resource": "hr.employee", "actions": ["read", "query", "analyze", "write"], "scope_key": "company" }
  ],
  "commands": ["skills/hr-db-ops/scripts/run-hr-cli.sh"],
  "capabilities": [
    {
      "id": "hr.employee.create",
      "kind": "create",
      "commands": ["business create employee"],
      "requires_confirmation": true,
      "recipe": ["Preview first, then create; create returns verification."],
      "resources": [{ "resource": "hr.employee", "actions": ["write"], "scope_key": "company" }]
    },
    {
      "id": "hr.employee.roster",
      "kind": "query",
      "commands": ["business query employees"],
      "resources": [{ "resource": "hr.employee", "actions": ["query"], "scope_key": "company" }]
    }
  ]
}
""",
        encoding="utf-8",
    )

    from nanobot_channel_webui.permissions.skill_view import DynamicSkillViewRenderer

    rendered = DynamicSkillViewRenderer(tmp_path).render("hr-db-ops", scoped_policy(tmp_path))

    assert rendered is not None
    assert rendered.index("## Capability recipes") < rendered.index("## Available business capabilities")


def test_unmanaged_workflow_skill_is_not_rewritten_by_dynamic_renderer(tmp_path: Path) -> None:
    skill_dir = tmp_path / "skills" / "hr-data-entry-workflow"
    skill_dir.mkdir(parents=True)
    (skill_dir / "SKILL.md").write_text("hidden workflow details", encoding="utf-8")

    from nanobot_channel_webui.permissions.skill_view import DynamicSkillViewRenderer

    rendered = DynamicSkillViewRenderer(tmp_path).render("hr-data-entry-workflow", scoped_policy(tmp_path))

    assert rendered is None


def test_scoped_user_preserves_runtime_input_shape_for_skill_cli(tmp_path: Path) -> None:
    registry = ToolGateway(FakeRegistry(), audit=TenantAuditLogger(tmp_path), workspace=tmp_path)
    target = tmp_path / ".nanobot_channel_webui" / "runtime-inputs" / "chat-1" / "employee-plan.json"

    with bind_policy_context(scoped_policy(tmp_path)):
        _tool, params, error = registry.prepare_call(
            "write_file",
            {
                "path": str(target),
                "content": '{"company":"乐潮里科技有限公司","department":"设计部","name":"韩琳","id_card_number":"321201198504010026","status":"试用"}',
            },
        )

    assert error is None
    data = json.loads(params["content"])
    assert data["name"] == "韩琳"
    assert "summary" not in data
    assert "records" not in data


def test_scoped_user_preserves_employees_array_runtime_input_for_skill_cli(tmp_path: Path) -> None:
    registry = ToolGateway(FakeRegistry(), audit=TenantAuditLogger(tmp_path), workspace=tmp_path)
    target = tmp_path / ".nanobot_channel_webui" / "runtime-inputs" / "chat-1" / "employee-plan.json"

    with bind_policy_context(scoped_policy(tmp_path)):
        _tool, params, error = registry.prepare_call(
            "write_file",
            {
                "path": str(target),
                "content": '{"company":"乐潮里科技有限公司","employees":[{"department":"设计部","name":"韩琳","id_card_number":"321201198504010026"}]}',
            },
        )

    assert error is None
    data = json.loads(params["content"])
    assert "employees" in data
    assert data["employees"][0]["name"] == "韩琳"


def test_employee_create_confirm_is_not_rewritten_by_plugin(tmp_path: Path) -> None:
    write_skill_contract(tmp_path)
    registry = ToolGateway(FakeRegistry(), audit=TenantAuditLogger(tmp_path), workspace=tmp_path)

    with bind_policy_context(scoped_policy(tmp_path)):
        _tool, _params, error = registry.prepare_call(
            "exec",
            {
                "command": "skills/hr-db-ops/scripts/run-hr-cli.sh business create employee --input plan.json --confirm \"确认录入\"",
            },
        )

    assert error is not None
    assert "hr_business_cli_requires_tool" in error


def test_hr_db_ops_dynamic_view_focuses_employee_create_capabilities(tmp_path: Path, monkeypatch) -> None:
    skill_dir = tmp_path / "skills" / "hr-db-ops"
    skill_dir.mkdir(parents=True)
    (skill_dir / "tenant-runtime.json").write_text(
        """{
  "name": "hr-db-ops",
  "resources": [
    { "resource": "hr.company", "actions": ["read", "query"], "scope_key": "company" },
    { "resource": "hr.department", "actions": ["read", "query"], "scope_key": "company" },
    { "resource": "hr.employee", "actions": ["read", "query", "analyze", "write"], "scope_key": "company" },
    { "resource": "hr.contract", "actions": ["read", "query", "analyze", "write"], "scope_key": "company" },
    { "resource": "hr.performance", "actions": ["read", "query", "analyze"], "scope_key": "company" }
  ],
  "commands": ["skills/hr-db-ops/scripts/run-hr-cli.sh"],
  "capabilities": [
    { "id": "hr.company.list", "kind": "query", "commands": ["business query companies"], "resources": [{ "resource": "hr.company", "actions": ["read"], "scope_key": "company" }] },
    { "id": "hr.department.query", "kind": "query", "commands": ["business query departments"], "resources": [{ "resource": "hr.department", "actions": ["query"], "scope_key": "company" }] },
    { "id": "hr.employee.roster", "kind": "query", "commands": ["business query employee"], "resources": [{ "resource": "hr.employee", "actions": ["query"], "scope_key": "company" }] },
    { "id": "hr.employee.create", "kind": "create", "commands": ["business create employee"], "requires_confirmation": true, "triggers": ["入职", "新员工", "录入员工"], "related_capabilities": ["hr.company.list", "hr.department.query", "hr.employee.roster"], "resources": [{ "resource": "hr.employee", "actions": ["write"], "scope_key": "company" }] },
    { "id": "hr.contract.analysis", "kind": "analysis", "commands": ["business analyze contract-coverage"], "resources": [{ "resource": "hr.contract", "actions": ["analyze"], "scope_key": "company" }] },
    { "id": "hr.performance.analysis", "kind": "analysis", "commands": ["business analyze performance"], "resources": [{ "resource": "hr.performance", "actions": ["analyze"], "scope_key": "company" }] }
  ]
}
""",
        encoding="utf-8",
    )

    class _Message:
        content = "今天有个新员工入职，帮我录入员工信息"

    class _Route:
        message = _Message()

    import nanobot_channel_webui.permissions.skill_view as skill_view

    monkeypatch.setattr(skill_view, "_current_route_context", lambda: _Route())

    rendered = skill_view.DynamicSkillViewRenderer(tmp_path).render("hr-db-ops", scoped_policy(tmp_path))

    assert rendered is not None
    assert "hr.employee.create" in rendered
    assert "hr.contract.analysis" not in rendered
    assert "hr.performance.analysis" not in rendered
