from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any

from nanobot_channel_webui.permissions import PolicyContext, bind_policy_context
from nanobot_channel_webui.permissions.resolver import PolicyResolver
from nanobot_channel_webui.tenant_runtime import TenantContext, bind_tenant_context
from nanobot_channel_webui.tenant_runtime.audit import TenantAuditLogger, normalize_audit_event
from nanobot_channel_webui.tenant_runtime.contracts import TenantPolicy
from nanobot_channel_webui.tenant_runtime.contract_validator import validate_workspace_skill_contracts
from nanobot_channel_webui.tenant_runtime.guard import TenantAccessDenied, TenantGuard
from nanobot_channel_webui.tenant_runtime.memory_gateway import MemoryGateway
from nanobot_channel_webui.tenant_runtime.skill_gateway import SkillGateway
from nanobot_channel_webui.tenant_runtime.skill_contract import load_skill_contract
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


def test_policy_resolver_expands_legacy_hr_umbrella_resource() -> None:
    policy = PolicyResolver().resolve(FakeUser())
    resources = {item["resource"]: item for item in policy.resources}

    for resource in (
        "hr.organization",
        "hr.department",
        "hr.employee",
        "hr.contract",
        "hr.performance",
        "hr.insurance",
        "hr.personnel_change",
        "hr.disciplinary",
        "hr.seal_usage",
    ):
        assert resource in resources
        assert resources[resource]["actions"] == ["read", "query", "analyze", "write"]
        assert resources[resource]["scopes"] == [
            {"key": "company", "values": ["武汉赢城文化传媒有限公司"]}
        ]


def test_policy_resolver_expands_tenant_policy_hr_umbrella_resource() -> None:
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
    assert resources["hr.performance"]["actions"] == ["read", "query", "analyze"]
    assert resources["hr.insurance"]["scopes"] == [
        {"key": "company", "values": ["乐潮里科技有限公司"]}
    ]


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


def test_tool_definitions_are_filtered_for_scoped_user(tmp_path: Path) -> None:
    registry = ToolGateway(FakeRegistry(), audit=TenantAuditLogger(tmp_path), workspace=tmp_path)
    with bind_policy_context(scoped_policy(tmp_path)):
        names = [item["function"]["name"] for item in registry.get_definitions()]

    assert names == ["exec", "read_file"]


def test_non_hr_exec_command_is_denied_for_scoped_user(tmp_path: Path) -> None:
    registry = ToolGateway(FakeRegistry(), audit=TenantAuditLogger(tmp_path), workspace=tmp_path)
    with bind_policy_context(scoped_policy(tmp_path)):
        _tool, _params, error = registry.prepare_call("exec", {"command": "cat skills/supabase-base/.env"})

    assert error is not None
    assert "无权执行" in error


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

    audit.record(policy=scoped, tool="exec", command="cmd1", decision="allow", reason="hr_cli_allowed")
    audit.record(policy=other, tool="exec", command="cmd2", decision="deny", reason="tenant_scope_denied")

    own_events = audit.recent(email="hr@example.com", include_all=False)
    all_events = audit.recent(include_all=True)

    assert len(own_events) == 1
    assert own_events[0]["version"] == "tenant-runtime/audit/v1"
    assert own_events[0]["tenant_policy"]["version"] == "tenant-runtime/v1"
    assert own_events[0]["command"] == "cmd1"
    assert len(all_events) == 2


def test_normalize_legacy_audit_event() -> None:
    event = normalize_audit_event({"email": "legacy@example.com", "decision": "deny"})

    assert event["version"] == "permissions/audit-legacy"
    assert event["email"] == "legacy@example.com"
    assert event["decision"] == "deny"


def test_hr_exec_command_gets_policy_env_for_scoped_user(tmp_path: Path) -> None:
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
        _tool, params, error = registry.prepare_call(
            "exec",
            {"command": "skills/hr-db-ops/scripts/run-hr-cli.sh business analyze headcount"},
        )

    assert error is None
    assert "business analyze headcount" in params["command"]

    with bind_policy_context(scoped_policy(tmp_path)):
        _tool, params, error = registry.prepare_call(
            "exec",
            {"command": 'skills/hr-db-ops/scripts/run-hr-cli.sh "business analyze headcount"'},
        )

    assert error is None
    assert '"business analyze headcount"' in params["command"]

    with bind_policy_context(scoped_policy(tmp_path)):
        _tool, params, error = registry.prepare_call(
            "exec",
            {"command": "skills/hr-db-ops/scripts/run-hr-cli.sh business analyze headcount 2>&1"},
        )

    assert error is None
    assert "business analyze headcount" in params["command"]

    with bind_policy_context(scoped_policy(tmp_path)):
        _tool, params, error = registry.prepare_call(
            "exec",
            {"command": "skills/hr-db-ops/scripts/run-hr-cli.sh business analyze headcount 2>&1 | head -50"},
        )

    assert error is None
    assert "business analyze headcount" in params["command"]

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
    policy = PolicyResolver().resolve(FakeUser())

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


def test_tenant_guard_enforces_split_resource_scope(tmp_path: Path) -> None:
    policy = PolicyResolver().resolve(FakeUser())
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
