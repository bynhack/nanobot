from __future__ import annotations

import json
import os
from pathlib import Path

import pytest
from nanobot_channel_webui.business_modules.hr import cli
from nanobot_channel_webui.business_modules.hr.runtime import commands
from nanobot_channel_webui.business_modules.hr.runtime.policy import collect_scope_company_names
from nanobot_channel_webui.business_modules.hr.runtime.repository import (
    COMPANY_WRITABLE_FIELDS,
    CONTRACT_WRITABLE_FIELDS,
    DEPARTMENT_WRITABLE_FIELDS,
    DISCIPLINARY_RECORD_WRITABLE_FIELDS,
    EMPLOYEE_WRITABLE_FIELDS,
    INSURANCE_CHANGE_WRITABLE_FIELDS,
    PERFORMANCE_REVIEW_WRITABLE_FIELDS,
    PERSONNEL_CHANGE_WRITABLE_FIELDS,
    SEAL_USAGE_WRITABLE_FIELDS,
    HrRepository,
    disciplinary_record_business_row,
    disciplinary_record_payload,
    disciplinary_record_select,
    generic_payload,
    normalize_contract_seed_record,
    normalize_employee_seed_record,
    normalize_named_employee_record,
    normalize_performance_review_seed_record,
    normalize_personnel_change_record,
    normalize_seal_usage_seed_record,
    seal_usage_select,
)
from nanobot_channel_webui.business_modules.hr.runtime.supabase_client import (
    PostgrestClient,
    load_supabase_config,
)


def write_hr_policy(
    tmp_path: Path,
    *,
    resources: list[str],
    actions: list[str] | None = None,
    companies: list[str] | None = None,
) -> Path:
    policy_file = tmp_path / "policy.json"
    policy_file.write_text(
        json.dumps(
            {
                "role": "user",
                "business_role": "hr_specialist",
                "user_id": "11111111-1111-1111-1111-111111111111",
                "resources": [
                    {
                        "resource": resource,
                        "actions": actions or ["read", "query", "write", "delete"],
                        "scopes": [
                            {
                                "key": "company",
                                "values": companies or ["武汉未来天空音乐文化产业有限公司"],
                            }
                        ],
                    }
                    for resource in resources
                ],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    return policy_file


def test_run_hr_auto_injects_workspace_policy_file(monkeypatch, tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    policy_file = workspace / ".nanobot_channel_webui" / "policies" / "policy.json"
    policy_file.parent.mkdir(parents=True)
    policy_file.write_text("{}", encoding="utf-8")
    captured: dict[str, object] = {}

    def fake_main(argv):
        captured["argv"] = argv
        captured["env"] = dict(os.environ)
        return 0

    monkeypatch.chdir(workspace)
    monkeypatch.setattr(cli.commands, "main", fake_main)
    monkeypatch.delenv("NANOBOT_WEBUI_POLICY_FILE", raising=False)

    assert cli.run_hr(["business", "query", "companies"]) == 0

    env = captured["env"]
    assert isinstance(env, dict)
    assert env["NANOBOT_WEBUI_POLICY_FILE"] == str(policy_file)


def test_run_hr_preserves_explicit_policy_file(monkeypatch, tmp_path: Path) -> None:
    explicit = tmp_path / "explicit-policy.json"
    explicit.write_text("{}", encoding="utf-8")
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    captured: dict[str, object] = {}

    def fake_main(argv):
        captured["env"] = dict(os.environ)
        return 0

    monkeypatch.chdir(workspace)
    monkeypatch.setattr(cli.commands, "main", fake_main)
    monkeypatch.setenv("NANOBOT_WEBUI_POLICY_FILE", str(explicit))

    assert cli.run_hr(["business", "query", "companies"]) == 0

    env = captured["env"]
    assert isinstance(env, dict)
    assert env["NANOBOT_WEBUI_POLICY_FILE"] == str(explicit)
    assert os.environ["NANOBOT_WEBUI_POLICY_FILE"] == str(explicit)


def test_supabase_config_uses_managed_instance_environment(monkeypatch, tmp_path: Path) -> None:
    instance_config = tmp_path / "instance-config.json"
    instance_config.write_text('{"channels": {"websocket": {"enabled": true}}}', encoding="utf-8")

    monkeypatch.setenv("NANOBOT_CONFIG", str(instance_config))
    monkeypatch.setenv("NANOBOT_WEBUI_SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("NANOBOT_WEBUI_SUPABASE_SERVICE_ROLE_KEY", "service-role")

    config = load_supabase_config()

    assert config.url == "https://example.supabase.co"
    assert config.service_key == "service-role"
    assert config.source == instance_config


def test_collect_scope_company_names_ignores_internal_match_company_objects() -> None:
    plan = {
        "records": [
            {
                "company": "武汉赢城集团有限公司",
                "match": {
                    "company": {
                        "status": "matched",
                        "company": {
                            "id": "c1",
                            "name": "武汉赢城集团有限公司",
                        },
                    }
                },
            }
        ]
    }

    assert collect_scope_company_names(plan) == ["武汉赢城集团有限公司"]


def test_hr_cli_business_query_organization_tree_uses_current_scope(tmp_path: Path) -> None:
    policy_file = tmp_path / "policy.json"
    policy_file.write_text(
        json.dumps(
            {
                "role": "user",
                "business_role": "hr_specialist",
                "resources": [
                    {
                        "resource": "hr.organization",
                        "actions": ["read", "query"],
                        "scopes": [
                            {
                                "key": "company",
                                "values": [
                                    "乐潮里科技有限公司",
                                    "武汉未来天空音乐文化产业有限公司",
                                ],
                            }
                        ],
                    },
                    {
                        "resource": "hr.department",
                        "actions": ["read", "query"],
                        "scopes": [
                            {
                                "key": "company",
                                "values": [
                                    "乐潮里科技有限公司",
                                    "武汉未来天空音乐文化产业有限公司",
                                ],
                            }
                        ],
                    },
                ],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    previous = os.environ.get("NANOBOT_WEBUI_POLICY_FILE")
    os.environ["NANOBOT_WEBUI_POLICY_FILE"] = str(policy_file)
    try:
        payload = commands.run(
            ["business", "query", "organization-tree"],
            repo=HrRepository(FakeSupabaseConnector()),
        )
    finally:
        if previous is None:
            os.environ.pop("NANOBOT_WEBUI_POLICY_FILE", None)
        else:
            os.environ["NANOBOT_WEBUI_POLICY_FILE"] = previous

    assert payload[0] == {
        "name": "乐潮里科技有限公司",
        "short_name": None,
        "scoped": True,
        "departments": payload[0]["departments"],
    }
    assert set(payload[0]["departments"]) == {"策划部", "元宇宙"}
    assert payload[1:] == [
        {
            "name": "武汉未来天空音乐文化产业有限公司",
            "short_name": None,
            "scoped": True,
            "departments": ["人力资源部", "行政部"],
        },
    ]


def test_hr_cli_business_query_organization_tree_keeps_single_company_scope(tmp_path: Path) -> None:
    policy_file = tmp_path / "policy.json"
    policy_file.write_text(
        json.dumps(
            {
                "role": "user",
                "business_role": "hr_specialist",
                "resources": [
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
                ],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    previous = os.environ.get("NANOBOT_WEBUI_POLICY_FILE")
    os.environ["NANOBOT_WEBUI_POLICY_FILE"] = str(policy_file)
    try:
        payload = commands.run(
            ["business", "query", "organization-tree"],
            repo=HrRepository(FakeSupabaseConnector()),
        )
    finally:
        if previous is None:
            os.environ.pop("NANOBOT_WEBUI_POLICY_FILE", None)
        else:
            os.environ["NANOBOT_WEBUI_POLICY_FILE"] = previous

    assert payload == [
        {
            "name": "乐潮里科技有限公司",
            "short_name": None,
            "scoped": True,
            "departments": ["元宇宙", "策划部"],
        }
    ]


def test_hr_business_update_organization_supports_all_company_and_department_fields(
    monkeypatch,
    tmp_path: Path,
) -> None:
    actor_id = "11111111-1111-1111-1111-111111111111"
    policy_file = tmp_path / "policy.json"
    policy_file.write_text(
        json.dumps(
            {
                "role": "user",
                "business_role": "hr_specialist",
                "user_id": actor_id,
                "resources": [
                    {
                        "resource": "hr.organization",
                        "actions": ["read", "write"],
                        "scopes": [
                            {
                                "key": "company",
                                "values": ["乐潮里科技有限公司", "武汉未来天空音乐文化产业有限公司"],
                            }
                        ],
                    },
                    {
                        "resource": "hr.department",
                        "actions": ["read", "write"],
                        "scopes": [
                            {
                                "key": "company",
                                "values": ["乐潮里科技有限公司", "武汉未来天空音乐文化产业有限公司"],
                            }
                        ],
                    },
                ],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    plan = tmp_path / "organization-update.json"
    plan.write_text(
        json.dumps(
            {
                "companies": [
                    {
                        "match_name": "乐潮里科技有限公司",
                        "name": "乐潮里科技有限公司",
                        "short_name": "乐潮科技",
                        "departments": [
                            {
                                "match_company": "乐潮里科技有限公司",
                                "match_name": "元宇宙",
                                "name": "创新业务部",
                                "target_company": "武汉未来天空音乐文化产业有限公司",
                            }
                        ],
                    }
                ]
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    monkeypatch.setenv("NANOBOT_WEBUI_POLICY_FILE", str(policy_file))
    repo = HrRepository(FakeSupabaseConnector())

    preview = commands.run(["business", "preview-update", "organization", "--input", str(plan)], repo=repo)
    result = commands.run(["business", "update", "organization", "--input", str(plan)], repo=repo)

    assert preview["companies"][0]["action"] == "would_update"
    assert preview["companies"][0]["diffs"] == [
        {"field": "short_name", "before": None, "after": "乐潮科技"}
    ]
    assert preview["departments"][0]["action"] == "would_update"
    assert preview["departments"][0]["diffs"] == [
        {"field": "name", "before": "元宇宙", "after": "创新业务部"},
        {"field": "company_id", "before": "c1", "after": "c2"},
    ]
    assert result["write"]["companies"] == [
        {
            "name": "乐潮里科技有限公司",
            "action": "updated",
            "fields": ["short_name"],
            "match_count": 1,
            "matched_ids": ["c1"],
        }
    ]
    assert result["write"]["departments"] == [
        {
            "name": "元宇宙",
            "action": "updated",
            "fields": ["name", "company_id"],
            "company": "乐潮里科技有限公司",
            "match_count": 1,
            "matched_ids": ["d1"],
        }
    ]
    assert result["verification"]["ok"] is True
    assert repo.db.rows["companies"][0]["short_name"] == "乐潮科技"
    assert repo.db.rows["departments"][0]["name"] == "创新业务部"
    assert repo.db.rows["departments"][0]["company_id"] == "c2"


def test_hr_business_preview_organization_accepts_records_wrapper(
    monkeypatch,
    tmp_path: Path,
) -> None:
    policy_file = tmp_path / "policy.json"
    policy_file.write_text(
        json.dumps(
            {
                "role": "admin",
                "user_id": "11111111-1111-1111-1111-111111111111",
                "email": "admin@example.com",
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    plan = tmp_path / "organization-records.json"
    plan.write_text(
        json.dumps(
            {
                "records": [
                    {
                        "company": "测试组织公司",
                        "short_name": "测试组织",
                        "departments": ["测试部门"],
                    }
                ]
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    monkeypatch.setenv("NANOBOT_WEBUI_POLICY_FILE", str(policy_file))
    repo = HrRepository(FakeSupabaseConnector())

    preview = commands.run(["business", "preview", "organization", "--input", str(plan)], repo=repo)

    assert preview["companies"] == [{"name": "测试组织公司", "action": "would_create"}]
    assert preview["departments"] == [
        {"company": "测试组织公司", "name": "测试部门", "action": "would_create"}
    ]


def test_hr_business_runtime_is_not_stored_under_skill_package() -> None:
    root = Path(__file__).resolve().parents[1]
    hr_module = root / "src" / "nanobot_channel_webui" / "business_modules" / "hr"

    assert not (hr_module / "skills" / "hr-db-ops" / "scripts").exists()
    assert (hr_module / "runtime" / "commands.py").exists()
    assert (hr_module / "runtime" / "repository.py").exists()
    assert (hr_module / "runtime" / "policy.py").exists()


def test_business_help_keeps_verify_internal() -> None:
    help_payload = commands.business_help()
    serialized = json.dumps(help_payload, ensure_ascii=False)

    assert "<list|get|preview|create|preview-update|update|delete|schema|capabilities>" in help_payload["usage"]
    assert "verify" not in help_payload["usage"]
    assert "business verify" not in serialized
    assert "verification" in serialized
    assert "For new records, run preview <resource> first, then create <resource>" in serialized
    assert "For existing records, run preview-update <resource> first, then update <resource>" in serialized
    assert "business preview-update employee --input <plan.json>" in serialized
    assert "business update employee --input <plan.json>" in serialized


def test_business_help_lists_agent_relevant_read_and_delete_commands() -> None:
    help_payload = commands.business_help()
    serialized = json.dumps(help_payload, ensure_ascii=False)

    assert "business list employee [--company <company>]" in serialized
    assert "business get employee --id <id>" in serialized
    assert "business list performance [--company <company>] [--employee <name>] [--month YYYY-MM] [--year YYYY]" in serialized
    assert "business list insurance [--company <company>] [--employee <name>] [--month YYYY-MM] [--status <status>]" in serialized
    assert "business list personnel-change [--company <company>] [--employee <name>] [--year YYYY] [--reason <reason>]" in serialized
    assert "business list seal-usage [--company <company>] [--applicant <name>] [--from YYYY-MM-DD] [--to YYYY-MM-DD]" in serialized
    assert "business list deleted-records --resource <resource>" in serialized
    assert "business capabilities" in serialized
    assert "business delete contract --input <plan.json>" in serialized
    assert "business delete seal-usage --input <plan.json>" in serialized


def test_business_capabilities_reports_available_commands_and_logical_delete(
    monkeypatch,
    tmp_path: Path,
) -> None:
    policy_file = tmp_path / "policy.json"
    policy_file.write_text(
        json.dumps(
            {
                "role": "admin",
                "user_id": "11111111-1111-1111-1111-111111111111",
                "email": "admin@example.com",
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    monkeypatch.setenv("NANOBOT_WEBUI_POLICY_FILE", str(policy_file))

    result = commands.run(["business", "capabilities"], repo=HrRepository(FakeSupabaseConnector()))

    assert result["logical_delete"]["field"] == "is_deleted"
    assert result["logical_delete"]["default_queries_exclude_deleted"] is True
    assert "business delete contract --input <plan.json>" in result["commands"]["delete"]
    assert "business list deleted-records --resource <resource>" in result["commands"]["audit"]
    assert result["option_contract"]["value_options"]["input"]["value_type"] == "string"
    assert result["option_contract"]["value_options"]["days"]["value_type"] == "integer"
    assert result["option_contract"]["value_options"]["threshold"]["minimum"] == 0
    assert result["option_contract"]["boolean_options"] == ["help"]


def test_business_capabilities_exposes_slim_public_contract_without_legacy_commands(
    monkeypatch,
    tmp_path: Path,
) -> None:
    policy_file = write_hr_policy(
        tmp_path,
        resources=[
            "hr.employee",
            "hr.contract",
            "hr.performance",
            "hr.insurance",
            "hr.personnel_change",
            "hr.disciplinary",
            "hr.seal_usage",
        ],
        actions=["query", "read", "analyze"],
    )
    monkeypatch.setenv("NANOBOT_WEBUI_POLICY_FILE", str(policy_file))

    result = commands.run(["business", "capabilities"], repo=HrRepository(FakeSupabaseConnector()))
    serialized_commands = json.dumps(result["commands"], ensure_ascii=False)
    command_options = result["option_contract"]["command_options"]

    assert "business list employee" in serialized_commands
    assert "business get employee --id <id>" in serialized_commands
    assert "business query" not in serialized_commands
    assert "business analyze roster" in serialized_commands
    assert "business analyze contract-coverage" in serialized_commands
    assert "business analyze contract-expiry" in serialized_commands
    assert "business analyze performance-month" in serialized_commands
    assert "business analyze insurance-month" in serialized_commands
    assert "business analyze personnel-change" in serialized_commands
    assert "business analyze disciplinary" in serialized_commands
    assert "business analyze seal-usage" in serialized_commands
    assert "business analyze employee-profile" in serialized_commands
    assert "employee-timeline" not in serialized_commands
    assert "performance-by-employee" not in serialized_commands
    assert "count-all" not in serialized_commands
    assert "clear-business-data" not in serialized_commands

    assert command_options["list-employees"]["allowed_options"] == [
        "company",
        "department",
        "id-card",
        "limit",
        "name",
        "page",
        "page-size",
        "phone",
        "status",
    ]
    assert command_options["get-employee"] == {
        "allowed_options": ["id"],
        "required_options": ["id"],
    }
    assert "employee-timeline" not in command_options
    assert "analyze-headcount" not in command_options
    assert command_options["analyze-roster"]["allowed_options"] == ["as-of", "company"]
    assert command_options["analyze-contract-coverage"]["allowed_options"] == ["as-of", "company"]
    assert command_options["analyze-contract-expiry"]["allowed_options"] == ["company", "days"]
    assert command_options["analyze-performance-month"]["allowed_options"] == ["company", "month"]
    assert command_options["analyze-insurance-month"]["allowed_options"] == ["company", "month"]
    assert command_options["analyze-personnel-change"]["allowed_options"] == ["company", "year"]
    assert command_options["analyze-disciplinary"]["allowed_options"] == ["company"]
    assert command_options["analyze-seal-usage"]["allowed_options"] == ["company", "from", "to"]
    assert command_options["analyze-employee-profile"]["allowed_options"] == ["as-of", "company"]


def test_business_analyze_roster_returns_stable_consistent_summary(monkeypatch, tmp_path: Path) -> None:
    policy_file = write_hr_policy(
        tmp_path,
        resources=["hr.employee"],
        actions=["query", "read", "analyze"],
    )
    monkeypatch.setenv("NANOBOT_WEBUI_POLICY_FILE", str(policy_file))
    connector = FakeSupabaseConnector()
    connector.rows["employees"].extend(
        [
            {
                "id": "e2",
                "name": "陈雨",
                "company_id": "c2",
                "department_id": "d3",
                "phone": "13900000002",
                "id_card_number": "420100199001010022",
                "status": "试用",
            },
            {
                "id": "e3",
                "name": "周离",
                "company_id": "c2",
                "department_id": "d3",
                "phone": "13900000003",
                "id_card_number": "420100199001010033",
                "status": "离职",
            },
        ]
    )

    result = commands.run(
        ["business", "analyze", "roster", "--company", "武汉未来天空音乐文化产业有限公司"],
        repo=HrRepository(connector),
    )

    assert result["topic"] == "roster"
    assert result["scope"]["company"] == "武汉未来天空音乐文化产业有限公司"
    assert result["summary"]["total_employees"] == 3
    assert result["summary"]["active_employees"] == 2
    assert result["summary"]["inactive_employees"] == 1
    assert (
        sum(item["employee_count"] for item in result["groups"]["by_status"])
        == result["summary"]["total_employees"]
    )
    assert (
        sum(item["employee_count"] for item in result["groups"]["by_company"])
        == result["summary"]["total_employees"]
    )
    assert result["groups"]["by_company"] == [
        {
            "company": "武汉未来天空音乐文化产业有限公司",
            "employee_count": 3,
            "active_employees": 2,
            "inactive_employees": 1,
            "statuses": {"正式": 1, "离职": 1, "试用": 1},
        }
    ]
    assert result["groups"]["by_department"] == [
        {
            "company": "武汉未来天空音乐文化产业有限公司",
            "department": "行政部",
            "employee_count": 1,
            "active_employees": 1,
            "inactive_employees": 0,
            "statuses": {"正式": 1},
        },
        {
            "company": "武汉未来天空音乐文化产业有限公司",
            "department": "人力资源部",
            "employee_count": 2,
            "active_employees": 1,
            "inactive_employees": 1,
            "statuses": {"离职": 1, "试用": 1},
        },
    ]
    assert result["consistency"] == {"checked": True, "passed": True, "errors": []}


def test_business_analyze_contract_coverage_uses_active_roster_denominator(
    monkeypatch,
    tmp_path: Path,
) -> None:
    policy_file = write_hr_policy(
        tmp_path,
        resources=["hr.employee", "hr.contract"],
        actions=["query", "read", "analyze"],
    )
    monkeypatch.setenv("NANOBOT_WEBUI_POLICY_FILE", str(policy_file))
    connector = FakeSupabaseConnector()
    connector.rows["employees"].extend(
        [
            {
                "id": "e2",
                "name": "陈雨",
                "company_id": "c2",
                "department_id": "d3",
                "phone": "13900000002",
                "id_card_number": "420100199001010022",
                "status": "试用",
            },
            {
                "id": "e3",
                "name": "周离",
                "company_id": "c2",
                "department_id": "d3",
                "phone": "13900000003",
                "id_card_number": "420100199001010033",
                "status": "离职",
            },
        ]
    )
    connector.rows["contracts"][0]["expiry_date"] = "2026-05-31"
    connector.rows["contracts"].append(
        {
            "id": "ct2",
            "employee_id": "e3",
            "type": "固定期限劳动合同",
            "sequence": 1,
            "sign_date": "2026-01-01",
            "duration_years": 1,
            "start_date": "2026-01-01",
            "expiry_date": "2027-01-01",
            "is_permanent": False,
            "notes": None,
        }
    )

    roster = commands.run(
        ["business", "analyze", "roster", "--company", "武汉未来天空音乐文化产业有限公司", "--as-of", "2026-06-12"],
        repo=HrRepository(connector),
    )
    coverage = commands.run(
        [
            "business",
            "analyze",
            "contract-coverage",
            "--company",
            "武汉未来天空音乐文化产业有限公司",
            "--as-of",
            "2026-06-12",
        ],
        repo=HrRepository(connector),
    )

    summary = coverage["summary"]
    assert coverage["topic"] == "contract-coverage"
    assert summary["coverage_denominator"] == roster["summary"]["active_employees"] == 2
    assert summary["employees_with_any_contract"] == 1
    assert summary["employees_with_active_contract"] == 0
    assert summary["employees_without_any_contract"] == 1
    assert summary["employees_without_active_contract"] == 2
    assert summary["coverage_rate_any"] == 0.5
    assert summary["coverage_rate_active"] == 0.0
    assert coverage["findings"][0]["kind"] == "missing_any_contract"
    assert coverage["findings"][0]["count"] == 1
    assert coverage["findings"][1]["kind"] == "missing_active_contract"
    assert coverage["findings"][1]["count"] == 1
    assert coverage["consistency"] == {"checked": True, "passed": True, "errors": []}
    contract_query = next(
        query
        for query in connector.rows["_query_log"]
        if query["table"] == "contracts" and "employee_id,type,start_date" in query["select"]
    )
    assert "employees(id,name" in contract_query["select"]


def test_business_analyze_performance_month_returns_stable_summary(monkeypatch, tmp_path: Path) -> None:
    policy_file = write_hr_policy(
        tmp_path,
        resources=["hr.employee", "hr.performance"],
        actions=["query", "read", "analyze"],
    )
    monkeypatch.setenv("NANOBOT_WEBUI_POLICY_FILE", str(policy_file))
    connector = FakeSupabaseConnector()
    connector.rows["employees"].append(
        {
            "id": "e2",
            "name": "陈雨",
            "company_id": "c2",
            "department_id": "d3",
            "phone": "13900000002",
            "id_card_number": "420100199001010022",
            "status": "正式",
        }
    )
    connector.rows["performance_reviews"] = [
        {
            "id": "pr1",
            "employee_id": "e1",
            "review_date": "2026-06-01",
            "self_score": 60,
            "supervisor_score": 50,
            "final_score": 55,
            "performance_ratio": 0.8,
            "performance_salary": 1000,
            "actual_performance_salary": 800,
            "performance_adjustment": -200,
            "notes": "低分",
        }
    ]

    result = commands.run(
        ["business", "analyze", "performance-month", "--month", "2026-06"],
        repo=HrRepository(connector),
    )

    assert result["topic"] == "performance-month"
    assert result["summary"]["coverage_denominator"] == 2
    assert result["summary"]["reviewed_employees"] == 1
    assert result["summary"]["missing_review_employees"] == 1
    assert result["summary"]["low_score_count_below_60"] == 1
    assert result["findings"][0]["kind"] == "missing_performance_review"
    assert result["findings"][0]["count"] == 1
    assert result["findings"][1]["kind"] == "low_performance_score"
    assert result["findings"][1]["count"] == 1
    assert result["consistency"] == {"checked": True, "passed": True, "errors": []}


def test_business_analyze_insurance_month_returns_stable_summary(monkeypatch, tmp_path: Path) -> None:
    policy_file = write_hr_policy(
        tmp_path,
        resources=["hr.employee", "hr.insurance"],
        actions=["query", "read", "analyze"],
    )
    monkeypatch.setenv("NANOBOT_WEBUI_POLICY_FILE", str(policy_file))
    connector = FakeSupabaseConnector()
    connector.rows["insurance_changes"] = [
        {
            "id": "ic1",
            "employee_id": "e1",
            "change_date": "2026-06-02",
            "insurance_add_date": "2026-06-02",
            "insurance_remove_date": None,
            "status": "新增",
            "signed_upload": None,
            "hr_clerk": "张幸",
            "notes": None,
        }
    ]

    result = commands.run(
        ["business", "analyze", "insurance-month", "--month", "2026-06"],
        repo=HrRepository(connector),
    )

    assert result["topic"] == "insurance-month"
    assert result["summary"]["total_changes"] == 1
    assert result["summary"]["add_count"] == 1
    assert result["summary"]["remove_count"] == 0
    assert result["groups"]["by_status"] == [{"status": "新增", "record_count": 1}]
    assert result["findings"][0]["kind"] == "missing_signed_upload"
    assert result["findings"][0]["count"] == 1
    assert result["consistency"] == {"checked": True, "passed": True, "errors": []}


def test_business_analyze_disciplinary_returns_stable_summary(monkeypatch, tmp_path: Path) -> None:
    policy_file = write_hr_policy(
        tmp_path,
        resources=["hr.employee", "hr.disciplinary"],
        actions=["query", "read", "analyze"],
    )
    monkeypatch.setenv("NANOBOT_WEBUI_POLICY_FILE", str(policy_file))

    result = commands.run(["business", "analyze", "disciplinary"], repo=HrRepository(FakeSupabaseConnector()))

    assert result["topic"] == "disciplinary"
    assert result["summary"]["total_records"] == 1
    assert result["summary"]["missing_signed_upload_count"] == 1
    assert result["groups"]["by_penalty_type"] == [{"penalty_type": "警告", "record_count": 1}]
    assert result["findings"][0]["kind"] == "missing_signed_upload"
    assert result["findings"][0]["count"] == 1
    assert result["consistency"] == {"checked": True, "passed": True, "errors": []}


def test_business_analyze_contract_expiry_returns_stable_summary(monkeypatch, tmp_path: Path) -> None:
    policy_file = write_hr_policy(
        tmp_path,
        resources=["hr.employee", "hr.contract"],
        actions=["query", "read", "analyze"],
    )
    monkeypatch.setenv("NANOBOT_WEBUI_POLICY_FILE", str(policy_file))

    result = commands.run(
        ["business", "analyze", "contract-expiry", "--days", "365"],
        repo=HrRepository(FakeSupabaseConnector()),
    )

    assert result["topic"] == "contract-expiry"
    assert result["summary"]["expiring_contracts"] == result["count"]
    assert result["findings"][0]["kind"] == "contract_expiring"
    assert result["findings"][0]["count"] == result["summary"]["expiring_contracts"]
    assert result["consistency"] == {"checked": True, "passed": True, "errors": []}


def test_business_analyze_personnel_change_returns_stable_summary(monkeypatch, tmp_path: Path) -> None:
    policy_file = write_hr_policy(
        tmp_path,
        resources=["hr.employee", "hr.personnel_change"],
        actions=["query", "read", "analyze"],
    )
    monkeypatch.setenv("NANOBOT_WEBUI_POLICY_FILE", str(policy_file))
    connector = FakeSupabaseConnector()
    connector.rows["personnel_changes"] = [
        {
            "id": "pc1",
            "employee_id": "e1",
            "current_department": "行政部",
            "current_position": "助理",
            "new_department": "行政部",
            "new_position": "专员",
            "change_reason": "转正",
            "effective_date": "2026-06-10",
            "procedures_complete": False,
            "signed_upload": None,
            "hr_clerk": "张幸",
        }
    ]

    result = commands.run(
        ["business", "analyze", "personnel-change", "--year", "2026"],
        repo=HrRepository(connector),
    )

    assert result["topic"] == "personnel-change"
    assert result["summary"]["year"] == "2026"
    assert result["summary"]["total_changes"] == 1
    assert result["summary"]["incomplete_procedures_count"] == 1
    assert result["summary"]["missing_signed_upload_count"] == 1
    assert result["groups"]["by_change_reason"] == [{"change_reason": "转正", "record_count": 1}]
    assert [item["kind"] for item in result["findings"]] == [
        "incomplete_personnel_change_procedure",
        "missing_signed_upload",
    ]
    assert result["consistency"] == {"checked": True, "passed": True, "errors": []}


def test_business_analyze_seal_usage_returns_stable_summary(monkeypatch, tmp_path: Path) -> None:
    policy_file = write_hr_policy(
        tmp_path,
        resources=["hr.employee", "hr.seal_usage"],
        actions=["query", "read", "analyze"],
    )
    monkeypatch.setenv("NANOBOT_WEBUI_POLICY_FILE", str(policy_file))
    connector = FakeSupabaseConnector()
    connector.rows["seal_usage"] = [
        {
            "id": "su1",
            "company_id": "c2",
            "usage_date": "2026-06-11",
            "applicant_id": "e1",
            "seal_applicant_id": None,
            "reason": "合同用章",
            "attachments": [],
            "notes": None,
        }
    ]

    result = commands.run(
        ["business", "analyze", "seal-usage", "--from", "2026-06-01", "--to", "2026-06-30"],
        repo=HrRepository(connector),
    )

    assert result["topic"] == "seal-usage"
    assert result["summary"]["total_usages"] == 1
    assert result["summary"]["missing_attachments_count"] == 1
    assert result["summary"]["missing_seal_applicant_count"] == 1
    assert result["groups"]["by_company"] == [{"company": "武汉未来天空音乐文化产业有限公司", "record_count": 1}]
    assert [item["kind"] for item in result["findings"]] == [
        "missing_seal_usage_attachment",
        "missing_seal_applicant",
    ]
    assert result["consistency"] == {"checked": True, "passed": True, "errors": []}


def test_business_analyze_employee_profile_returns_stable_summary(monkeypatch, tmp_path: Path) -> None:
    policy_file = write_hr_policy(
        tmp_path,
        resources=["hr.employee"],
        actions=["query", "read", "analyze"],
    )
    monkeypatch.setenv("NANOBOT_WEBUI_POLICY_FILE", str(policy_file))
    connector = FakeSupabaseConnector()
    connector.rows["employees"].extend(
        [
            {
                "id": "e2",
                "name": "陈雨",
                "company_id": "c2",
                "department_id": None,
                "phone": "18271001313",
                "id_card_number": "",
                "status": "正式",
            }
        ]
    )

    result = commands.run(
        ["business", "analyze", "employee-profile", "--as-of", "2026-06-12"],
        repo=HrRepository(connector),
    )

    assert result["topic"] == "employee-profile"
    assert result["summary"]["total_employees"] == 2
    assert result["summary"]["missing_department_count"] == 1
    assert result["summary"]["missing_id_card_count"] == 1
    assert result["summary"]["duplicate_phone_groups"] == 1
    assert result["groups"]["by_status"] == [{"status": "正式", "employee_count": 2}]
    assert result["groups"]["by_company"] == [
        {
            "company": "武汉未来天空音乐文化产业有限公司",
            "employee_count": 2,
            "active_employees": 2,
            "inactive_employees": 0,
            "statuses": {"正式": 2},
        }
    ]
    assert [item["kind"] for item in result["findings"]] == [
        "missing_department",
        "missing_id_card",
        "duplicate_phone",
    ]
    assert result["consistency"] == {"checked": True, "passed": True, "errors": []}


def test_business_capabilities_exposes_conversational_workflow_recipes(
    monkeypatch,
    tmp_path: Path,
) -> None:
    policy_file = write_hr_policy(tmp_path, resources=["hr.employee"], actions=["query"])
    monkeypatch.setenv("NANOBOT_WEBUI_POLICY_FILE", str(policy_file))

    result = commands.run(["business", "capabilities"], repo=HrRepository(FakeSupabaseConnector()))
    recipes = {item["intent"]: item for item in result["workflow_recipes"]}

    assert set(recipes) >= {"入职", "转正", "续签", "内部调动", "离职"}
    assert recipes["入职"]["command_sequence"] == [
        "business schema employee --workflow create",
        "business preview employee --input <employee-plan.json>",
        "business create employee --input <employee-plan.json>",
    ]
    assert "business preview personnel-change --input <personnel-change-plan.json>" in recipes["转正"]["command_sequence"]
    assert "business preview-update employee --input <employee-update-plan.json>" in recipes["离职"]["command_sequence"]


def test_business_command_rejects_unknown_option_with_suggestion() -> None:
    repo = HrRepository(FakeSupabaseConnector())

    with pytest.raises(RuntimeError) as exc_info:
        commands.run(["business", "query", "employee", "--cmpany", "武汉赢城集团有限公司"], repo=repo)

    message = str(exc_info.value)
    assert "Unknown option --cmpany" in message
    assert "--company" in message


def test_business_command_rejects_missing_value_option() -> None:
    repo = HrRepository(FakeSupabaseConnector())

    with pytest.raises(RuntimeError) as exc_info:
        commands.run(["business", "schema", "employee", "--workflow"], repo=repo)

    assert str(exc_info.value) == "Option --workflow requires a value"


def test_business_command_rejects_invalid_integer_option() -> None:
    repo = HrRepository(FakeSupabaseConnector())

    with pytest.raises(RuntimeError) as exc_info:
        commands.run(["business", "analyze", "contract-expiry", "--days", "abc"], repo=repo)

    assert str(exc_info.value) == "Option --days must be an integer"


def test_business_command_rejects_out_of_range_numeric_option() -> None:
    repo = HrRepository(FakeSupabaseConnector())

    with pytest.raises(RuntimeError) as exc_info:
        commands.run(["business", "analyze", "low-performance", "--threshold", "120"], repo=repo)

    assert str(exc_info.value) == "Option --threshold must be between 0 and 100"


def test_business_command_rejects_option_not_allowed_for_command(monkeypatch, tmp_path: Path) -> None:
    policy_file = write_hr_policy(tmp_path, resources=["hr.employee"], actions=["read"])
    monkeypatch.setenv("NANOBOT_WEBUI_POLICY_FILE", str(policy_file))

    with pytest.raises(RuntimeError) as exc_info:
        commands.run(
            ["business", "get", "employee", "--name", "刘松", "--threshold", "80"],
            repo=HrRepository(FakeSupabaseConnector()),
        )

    assert str(exc_info.value) == "Option --threshold is not supported by command employee-detail"


def test_business_list_employee_paginates_bare_list_and_includes_ids(monkeypatch, tmp_path: Path) -> None:
    policy_file = write_hr_policy(tmp_path, resources=["hr.employee"], actions=["query"])
    monkeypatch.setenv("NANOBOT_WEBUI_POLICY_FILE", str(policy_file))
    connector = FakeSupabaseConnector()
    connector.rows["employees"].extend(
        [
            {
                "id": f"e-extra-{index}",
                "name": f"测试员工{index}",
                "company_id": "c2",
                "department_id": "d4",
                "status": "正式",
            }
            for index in range(104)
        ]
    )

    result = commands.run(
        ["business", "list", "employee", "--page-size", "50"],
        repo=HrRepository(connector),
    )

    assert len(result["records"]) == 50
    assert result["pagination"] == {
        "page": 1,
        "page_size": 50,
        "total": 105,
        "has_next": True,
    }
    assert all(row.get("id") for row in result["records"])


def test_business_list_employee_with_explicit_filter_is_unpaginated_and_rejects_limit(
    monkeypatch,
    tmp_path: Path,
) -> None:
    policy_file = write_hr_policy(tmp_path, resources=["hr.employee"], actions=["query"])
    monkeypatch.setenv("NANOBOT_WEBUI_POLICY_FILE", str(policy_file))
    connector = FakeSupabaseConnector()
    connector.rows["employees"].append(
        {
            "id": "e2",
            "name": "正式员工二",
            "company_id": "c2",
            "department_id": "d4",
            "status": "正式",
        }
    )

    result = commands.run(
        ["business", "list", "employee", "--status", "正式"],
        repo=HrRepository(connector),
    )

    assert "pagination" not in result
    assert {row["id"] for row in result["records"]} == {"e1", "e2"}

    with pytest.raises(RuntimeError) as exc_info:
        commands.run(
            ["business", "list", "employee", "--status", "正式", "--limit", "1"],
            repo=HrRepository(connector),
        )

    assert str(exc_info.value) == "带过滤的 list 返回完整匹配结果，不支持 --limit；请移除 --limit 或改用裸 list 配合 --page-size"


def test_business_list_employee_filtered_result_over_hard_limit_returns_suggestions(
    monkeypatch,
    tmp_path: Path,
) -> None:
    policy_file = write_hr_policy(tmp_path, resources=["hr.employee"], actions=["query"])
    monkeypatch.setenv("NANOBOT_WEBUI_POLICY_FILE", str(policy_file))
    connector = FakeSupabaseConnector()
    connector.rows["employees"] = [
        {
            "id": f"e{index}",
            "name": f"正式员工{index}",
            "company_id": "c2",
            "department_id": "d4",
            "status": "正式",
        }
        for index in range(5001)
    ]

    with pytest.raises(RuntimeError) as exc_info:
        commands.run(
            ["business", "list", "employee", "--status", "正式"],
            repo=HrRepository(connector),
        )

    message = str(exc_info.value)
    assert "结果集超过 5000 行" in message
    assert "--company, --department, --status, --name, --id-card, --phone" in message


def test_business_list_company_for_scoped_user_includes_ids(monkeypatch, tmp_path: Path) -> None:
    policy_file = write_hr_policy(tmp_path, resources=["hr.company"], actions=["read"])
    monkeypatch.setenv("NANOBOT_WEBUI_POLICY_FILE", str(policy_file))

    result = commands.run(["business", "list", "company"], repo=HrRepository(FakeSupabaseConnector()))

    assert result["records"] == [
        {
            "id": "c2",
            "name": "武汉未来天空音乐文化产业有限公司",
            "short_name": None,
            "scoped": True,
        }
    ]


def test_business_get_company_by_id_uses_read_resource_aliases(monkeypatch, tmp_path: Path) -> None:
    policy_file = write_hr_policy(tmp_path, resources=["hr.company"], actions=["read"])
    monkeypatch.setenv("NANOBOT_WEBUI_POLICY_FILE", str(policy_file))
    connector = FakeSupabaseConnector()

    result = commands.run(["business", "get", "company", "--id", "c2"], repo=HrRepository(connector))

    assert result["id"] == "c2"
    assert result["name"] == "武汉未来天空音乐文化产业有限公司"
    assert connector.rows["_query_log"][-2:] == [
        {
            "table": "companies",
            "select": "id,name",
            "filters": [("eq", "id", "c2")],
        },
        {
            "table": "companies",
            "select": "id,name,short_name,is_deleted,updated_by,updated_at",
            "filters": [("eq", "id", "c2")],
        },
    ]


def test_business_get_employee_by_id_returns_authorized_record_and_rejects_cross_scope(
    monkeypatch,
    tmp_path: Path,
) -> None:
    policy_file = write_hr_policy(
        tmp_path,
        resources=["hr.employee"],
        actions=["read"],
        companies=["武汉未来天空音乐文化产业有限公司"],
    )
    monkeypatch.setenv("NANOBOT_WEBUI_POLICY_FILE", str(policy_file))
    connector = FakeSupabaseConnector()
    connector.rows["employees"].append(
        {
            "id": "e-other",
            "name": "其它公司员工",
            "company_id": "c1",
            "department_id": "d1",
            "status": "正式",
        }
    )

    result = commands.run(["business", "get", "employee", "--id", "e1"], repo=HrRepository(connector))

    assert result["id"] == "e1"
    assert result["name"] == "刘松"
    assert result["company"] == "武汉未来天空音乐文化产业有限公司"

    with pytest.raises(RuntimeError) as exc_info:
        connector.rows["_query_log"] = []
        commands.run(["business", "get", "employee", "--id", "e-other"], repo=HrRepository(connector))

    message = str(exc_info.value)
    assert "当前账号无权访问公司数据" in message
    assert "其它公司员工" not in message
    assert connector.rows["_query_log"] == [
        {
            "table": "employees",
            "select": "id,company_id,companies(name)",
            "filters": [("eq", "id", "e-other")],
        }
    ]


def test_employee_timeline_applies_limit_and_reports_truncation(monkeypatch, tmp_path: Path) -> None:
    policy_file = write_hr_policy(tmp_path, resources=["hr.employee"], actions=["read"])
    monkeypatch.setenv("NANOBOT_WEBUI_POLICY_FILE", str(policy_file))
    connector = FakeSupabaseConnector()
    connector.rows["contracts"].extend(
        [
            {
                "id": f"ct-extra-{index}",
                "employee_id": "e1",
                "type": "固定期限劳动合同",
                "sequence": index + 2,
                "start_date": f"202{index}-01-01",
                "expiry_date": f"202{index}-12-31",
                "is_permanent": False,
            }
            for index in range(3)
        ]
    )

    result = commands.run(
        ["business", "query", "employee-timeline", "--name", "刘松", "--limit", "2"],
        repo=HrRepository(connector),
    )

    assert len(result["contracts"]) == 2
    assert result["limits"]["contracts"] == {"count": 4, "limit": 2, "truncated": True}
    assert result["limits"]["performance_reviews"] == {"count": 0, "limit": 2, "truncated": False}


def test_personnel_changes_list_applies_limit_and_reports_truncation(monkeypatch, tmp_path: Path) -> None:
    policy_file = write_hr_policy(tmp_path, resources=["hr.personnel_change"], actions=["query"])
    monkeypatch.setenv("NANOBOT_WEBUI_POLICY_FILE", str(policy_file))
    connector = FakeSupabaseConnector()
    connector.rows["personnel_changes"] = [
        {
            "id": f"pc{index}",
            "employee_id": "e1",
            "change_reason": "转正",
            "effective_date": f"2026-01-0{index + 1}",
            "hr_clerk": "测试 HR",
        }
        for index in range(3)
    ]

    result = commands.run(
        ["business", "query", "personnel-change", "--year", "2026", "--limit", "2"],
        repo=HrRepository(connector),
    )

    assert len(result["records"]) == 2
    assert result["count"] == 3
    assert result["limit"] == 2
    assert result["truncated"] is True


def test_risk_dashboard_limits_recommended_action_rows() -> None:
    connector = FakeSupabaseConnector()
    connector.rows["employees"].extend(
        [
            {
                "id": f"e-extra-{index}",
                "name": f"测试员工{index}",
                "company_id": "c2",
                "department_id": "d4",
                "status": "正式",
            }
            for index in range(4)
        ]
    )
    repo = HrRepository(connector)

    result = repo.analyze_hr_risk_dashboard(limit=2)
    action = next(item for item in result["recommended_actions"] if item["type"] == "missing_contract")

    assert len(action["records"]) == 2
    assert action["count"] == 4
    assert action["limit"] == 2
    assert action["truncated"] is True


def test_business_schema_returns_plan_contract_for_performance_create() -> None:
    result = commands.run(
        ["business", "schema", "performance", "--workflow", "create"],
        repo=HrRepository(FakeSupabaseConnector()),
    )

    assert result["resource"] == "performance"
    assert result["workflow"] == "create"
    assert result["command_sequence"] == [
        "business schema performance --workflow create",
        "business preview performance --input <plan.json>",
        "business create performance --input <same-plan.json>",
    ]
    assert result["accepted_aliases"]["review_month"] == "review_date"
    assert result["accepted_aliases"]["score"] == "final_score"
    assert result["plan_example"] == {
        "company": "武汉赢城集团有限公司",
        "employee_name": "张三",
        "review_month": "2026-06",
        "final_score": 96,
        "performance_salary": 1200,
    }
    assert any(field["name"] == "review_date" for field in result["fields"])
    assert result["notes"][0].startswith("Use this command before writing")


def test_business_schema_returns_old_new_value_contract_for_seal_usage_update() -> None:
    result = commands.run(
        ["business", "schema", "seal-usage", "--workflow", "update"],
        repo=HrRepository(FakeSupabaseConnector()),
    )

    assert result["resource"] == "seal-usage"
    assert result["workflow"] == "update"
    for field in ["company", "usage_date", "reason", "match_reason", "current_reason", "old_reason"]:
        assert field in result["match_fields"]
    assert "new_reason" in result["update_fields"]
    assert result["accepted_aliases"]["current_reason"] == "match_reason"
    assert result["accepted_aliases"]["new_reason"] == "reason"
    assert result["plan_example"] == {
        "match_id": "abc-123-uuid",
        "new_reason": "普通账号更新流程验收",
        "attachments": ["验收复核申请.pdf"],
    }
    assert "Old values identify the existing row; new values are written." in result["workflow_rules"]


def test_business_schema_returns_personnel_change_update_aliases() -> None:
    result = commands.run(
        ["business", "schema", "personnel-change", "--workflow", "update"],
        repo=HrRepository(FakeSupabaseConnector()),
    )

    assert result["accepted_aliases"]["change_date"] == "effective_date"
    assert result["accepted_aliases"]["change_type"] == "match_change_reason"
    assert result["plan_example"] == {
        "match_id": "abc-123-uuid",
        "new_position": "高级人事专员",
        "change_reason": "转正后定岗",
    }


def test_business_schema_covers_all_public_write_resources() -> None:
    resources = [
        "organization",
        "department",
        "employee",
        "contract",
        "performance",
        "insurance",
        "personnel-change",
        "disciplinary",
        "seal-usage",
    ]

    for resource in resources:
        for workflow in ["create", "update"]:
            result = commands.run(
                ["business", "schema", resource, "--workflow", workflow],
                repo=HrRepository(FakeSupabaseConnector()),
            )
            assert result["workflow"] == workflow
            assert result["fields"], resource
            assert result["plan_example"], resource
            assert result["command_sequence"][1].startswith(
                "business preview" if workflow == "create" else "business preview-update"
            )


def test_business_schema_update_exposes_match_id() -> None:
    result = commands.run(
        ["business", "schema", "employee", "--workflow", "update"],
        repo=HrRepository(FakeSupabaseConnector()),
    )

    match_id = next(field for field in result["fields"] if field["name"] == "match_id")
    assert match_id["match_key"] is True
    assert match_id["writable"] is False
    assert "business list/get" in match_id["description"]
    assert result["plan_example"]["match_id"] == "abc-123-uuid"


def test_hr_business_list_employee_returns_full_roster_fields() -> None:
    connector = FakeSupabaseConnector()
    connector.rows["employees"][0].update(
        {
            "gender": "男",
            "birth_date": "2000-06-27",
            "id_card_expiry": "2040-06-27",
            "probation_end_date": "2026-03-01",
            "education": "本科",
            "school": "测试大学",
            "graduation_date": "2022-06-30",
            "major": "测试专业",
            "current_address": "现居住地址",
            "hukou_address": "户籍地址",
            "bank_account": "6222000000000000",
            "bank_name": "测试银行",
            "resignation_date": None,
            "resignation_reason": None,
            "notes": "完整花名册备注",
        }
    )
    repo = HrRepository(connector)

    result = repo.list_employees(company_name="武汉未来天空音乐文化产业有限公司")

    employee = result["records"][0]
    assert employee["birth_date"] == "2000-06-27"
    assert employee["id_card_expiry"] == "2040-06-27"
    assert employee["bank_account"] == "6222000000000000"
    assert employee["notes"] == "完整花名册备注"


def test_hr_business_employee_plan_normalizes_common_natural_language_aliases() -> None:
    connector = FakeSupabaseConnector()
    repo = HrRepository(connector)

    result = repo.preview_employee_seeds(
        plan=[
            {
                "company": "武汉未来天空音乐文化产业有限公司",
                "department": "行政部",
                "name": "自然语言字段员工",
                "id_card": "429004199902025208",
                "household_address": "自然语言户籍地址",
                "remark": "自然语言备注",
            }
        ]
    )

    record = result["records"][0]
    assert record["id_card_number"] == "429004199902025208"
    assert record["hukou_address"] == "自然语言户籍地址"
    assert record["notes"] == "自然语言备注"


def test_hr_business_update_employee_updates_existing_record(
    monkeypatch,
    tmp_path: Path,
) -> None:
    actor_id = "11111111-1111-1111-1111-111111111111"
    policy_file = tmp_path / "policy.json"
    policy_file.write_text(
        json.dumps(
            {
                "role": "user",
                "business_role": "hr_specialist",
                "user_id": actor_id,
                "resources": [
                    {
                        "resource": "hr.employee",
                        "actions": ["read", "write"],
                        "scopes": [{"key": "company", "values": ["武汉未来天空音乐文化产业有限公司"]}],
                    }
                ],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    plan = tmp_path / "employee-update.json"
    plan.write_text(
        json.dumps(
            {
                "records": [
                    {
                        "company": "武汉未来天空音乐文化产业有限公司",
                        "name": "刘松",
                        "id_card_number": "421083200006270914",
                        "id_card_expiry": "2043-08-11",
                    }
                ]
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    monkeypatch.setenv("NANOBOT_WEBUI_POLICY_FILE", str(policy_file))
    repo = HrRepository(FakeSupabaseConnector())

    preview = commands.run(["business", "preview-update", "employee", "--input", str(plan)], repo=repo)
    result = commands.run(["business", "update", "employee", "--input", str(plan)], repo=repo)

    assert preview["records"][0]["action"] == "would_update"
    assert preview["records"][0]["diffs"] == [
        {"field": "id_card_expiry", "before": None, "after": "2043-08-11"}
    ]
    assert result["write"] == [
        {
            "name": "刘松",
            "action": "updated",
            "fields": ["id_card_expiry"],
            "match_count": 1,
            "matched_ids": ["e1"],
        }
    ]
    assert result["verification"]["ok"] is True
    assert repo.db.rows["employees"][0]["id_card_expiry"] == "2043-08-11"
    assert repo.db.rows["employees"][0]["updated_by"] == actor_id


def test_hr_business_update_employee_with_match_id_uses_id_lookup(
    monkeypatch,
    tmp_path: Path,
) -> None:
    actor_id = "11111111-1111-1111-1111-111111111111"
    policy_file = write_hr_policy(
        tmp_path,
        resources=["hr.employee"],
        actions=["read", "query", "write"],
        companies=["武汉未来天空音乐文化产业有限公司"],
    )
    plan = tmp_path / "employee-update-by-id.json"
    plan.write_text(
        json.dumps({"records": [{"match_id": "e1", "position": "高级主管"}]}, ensure_ascii=False),
        encoding="utf-8",
    )
    monkeypatch.setenv("NANOBOT_WEBUI_POLICY_FILE", str(policy_file))
    connector = FakeSupabaseConnector()
    repo = HrRepository(connector)

    preview = commands.run(["business", "preview-update", "employee", "--input", str(plan)], repo=repo)
    result = commands.run(["business", "update", "employee", "--input", str(plan)], repo=repo)

    assert preview["records"][0]["action"] == "would_update"
    assert preview["records"][0]["match_count"] == 1
    assert preview["records"][0]["matched_ids"] == ["e1"]
    assert result["write"][0]["action"] == "updated"
    assert result["write"][0]["fields"] == ["position"]
    assert result["write"][0]["matched_ids"] == ["e1"]
    assert connector.rows["employees"][0]["position"] == "高级主管"
    assert connector.rows["employees"][0]["updated_by"] == actor_id


def test_hr_business_update_with_match_id_rejects_cross_write_scope(
    monkeypatch,
    tmp_path: Path,
) -> None:
    policy_file = write_hr_policy(
        tmp_path,
        resources=["hr.employee"],
        actions=["read", "query", "write"],
        companies=["乐潮里科技有限公司"],
    )
    plan = tmp_path / "employee-update-cross-scope.json"
    plan.write_text(
        json.dumps({"records": [{"match_id": "e1", "position": "高级主管"}]}, ensure_ascii=False),
        encoding="utf-8",
    )
    monkeypatch.setenv("NANOBOT_WEBUI_POLICY_FILE", str(policy_file))

    with pytest.raises(RuntimeError, match="指定 id 不存在、已删除或无权访问"):
        commands.run(
            ["business", "preview-update", "employee", "--input", str(plan)],
            repo=HrRepository(FakeSupabaseConnector()),
        )


def test_hr_business_update_with_match_id_rejects_logically_deleted_row(
    monkeypatch,
    tmp_path: Path,
) -> None:
    policy_file = write_hr_policy(
        tmp_path,
        resources=["hr.employee"],
        actions=["read", "query", "write"],
        companies=["武汉未来天空音乐文化产业有限公司"],
    )
    plan = tmp_path / "employee-update-deleted-id.json"
    plan.write_text(
        json.dumps({"records": [{"match_id": "e1", "position": "高级主管"}]}, ensure_ascii=False),
        encoding="utf-8",
    )
    monkeypatch.setenv("NANOBOT_WEBUI_POLICY_FILE", str(policy_file))
    connector = FakeSupabaseConnector()
    connector.rows["employees"][0]["is_deleted"] = True

    with pytest.raises(RuntimeError, match="指定 id 不存在、已删除或无权访问"):
        commands.run(
            ["business", "preview-update", "employee", "--input", str(plan)],
            repo=HrRepository(connector),
        )


def test_hr_business_update_employee_updates_resignation_date_and_clears_notes(
    monkeypatch,
    tmp_path: Path,
) -> None:
    actor_id = "11111111-1111-1111-1111-111111111111"
    policy_file = tmp_path / "policy.json"
    policy_file.write_text(
        json.dumps(
            {
                "role": "user",
                "business_role": "hr_specialist",
                "user_id": actor_id,
                "resources": [
                    {
                        "resource": "hr.employee",
                        "actions": ["read", "write"],
                        "scopes": [{"key": "company", "values": ["武汉未来天空音乐文化产业有限公司"]}],
                    }
                ],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    plan = tmp_path / "employee-update-null.json"
    plan.write_text(
        json.dumps(
            {
                "records": [
                    {
                        "company": "武汉未来天空音乐文化产业有限公司",
                        "name": "刘松",
                        "id_card_number": "421083200006270914",
                        "resignation_date": "2026-06-10",
                        "notes": None,
                    }
                ]
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    monkeypatch.setenv("NANOBOT_WEBUI_POLICY_FILE", str(policy_file))
    connector = FakeSupabaseConnector()
    connector.rows["employees"][0]["notes"] = "待清空"
    repo = HrRepository(connector)

    preview = commands.run(["business", "preview-update", "employee", "--input", str(plan)], repo=repo)
    result = commands.run(["business", "update", "employee", "--input", str(plan)], repo=repo)

    assert preview["records"][0]["action"] == "would_update"
    assert preview["records"][0]["diffs"] == [
        {"field": "resignation_date", "before": None, "after": "2026-06-10"},
        {"field": "notes", "before": "待清空", "after": None},
    ]
    assert result["write"] == [
        {
            "name": "刘松",
            "action": "updated",
            "fields": ["resignation_date", "notes"],
            "match_count": 1,
            "matched_ids": ["e1"],
        }
    ]
    assert result["verification"]["ok"] is True
    assert repo.db.rows["employees"][0]["resignation_date"] == "2026-06-10"
    assert repo.db.rows["employees"][0]["notes"] is None


def test_hr_business_update_contract_updates_existing_record(
    monkeypatch,
    tmp_path: Path,
) -> None:
    actor_id = "11111111-1111-1111-1111-111111111111"
    policy_file = tmp_path / "policy.json"
    policy_file.write_text(
        json.dumps(
            {
                "role": "user",
                "business_role": "hr_specialist",
                "user_id": actor_id,
                "resources": [
                    {
                        "resource": "hr.contract",
                        "actions": ["read", "write"],
                        "scopes": [{"key": "company", "values": ["武汉未来天空音乐文化产业有限公司"]}],
                    },
                    {
                        "resource": "hr.employee",
                        "actions": ["read", "query"],
                        "scopes": [{"key": "company", "values": ["武汉未来天空音乐文化产业有限公司"]}],
                    },
                ],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    plan = tmp_path / "contract-update.json"
    plan.write_text(
        json.dumps(
            {
                "records": [
                    {
                        "company": "武汉未来天空音乐文化产业有限公司",
                        "employee_name": "刘松",
                        "type": "固定期限劳动合同",
                        "sequence": 1,
                        "start_date": "2026-01-01",
                        "expiry_date": "2028-12-31",
                    }
                ]
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    monkeypatch.setenv("NANOBOT_WEBUI_POLICY_FILE", str(policy_file))
    repo = HrRepository(FakeSupabaseConnector())

    result = commands.run(["business", "update", "contract", "--input", str(plan)], repo=repo)

    assert result["write"] == [
        {
            "name": "刘松",
            "action": "updated",
            "fields": ["expiry_date"],
            "match_count": 1,
            "matched_ids": ["ct1"],
        }
    ]
    assert result["verification"]["ok"] is True
    assert repo.db.rows["contracts"][0]["expiry_date"] == "2028-12-31"
    assert repo.db.rows["contracts"][0]["updated_by"] == actor_id


def test_generic_create_reports_partial_results_on_mid_batch_failure(
    monkeypatch,
    tmp_path: Path,
    capsys,
) -> None:
    policy_file = write_hr_policy(tmp_path, resources=["hr.contract", "hr.employee"], actions=["read", "write"])
    monkeypatch.setenv("NANOBOT_WEBUI_POLICY_FILE", str(policy_file))
    plan = tmp_path / "contract-create-partial.json"
    plan.write_text(
        json.dumps(
            {
                "records": [
                    {
                        "company": "武汉未来天空音乐文化产业有限公司",
                        "employee_name": "刘松",
                        "type": "固定期限劳动合同",
                        "sequence": 2,
                        "start_date": "2027-01-01",
                        "expiry_date": "2027-12-31",
                    },
                    {
                        "company": "武汉未来天空音乐文化产业有限公司",
                        "employee_name": "刘松",
                        "type": "固定期限劳动合同",
                        "sequence": 3,
                        "start_date": "2028-01-01",
                        "expiry_date": "2028-12-31",
                    },
                ]
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    exit_code = commands.main(
        ["business", "create", "contract", "--input", str(plan)],
        repo=HrRepository(FailingContractInsertConnector(fail_sequence=3)),
    )
    stderr = capsys.readouterr().err
    payload = json.loads(stderr)

    assert exit_code == 1
    assert payload["ok"] is False
    assert payload["partial_results"] == [{"name": "刘松", "action": "created"}]
    assert payload["failed"]["index"] == 1
    assert payload["failed"]["name"] == "刘松"
    assert payload["failed"]["error"] == "simulated contract insert failure"


def test_generic_create_existing_result_explains_matched_record(monkeypatch, tmp_path: Path) -> None:
    policy_file = write_hr_policy(tmp_path, resources=["hr.contract", "hr.employee"], actions=["read", "write"])
    monkeypatch.setenv("NANOBOT_WEBUI_POLICY_FILE", str(policy_file))
    plan = tmp_path / "contract-create-existing.json"
    plan.write_text(
        json.dumps(
            {
                "records": [
                    {
                        "company": "武汉未来天空音乐文化产业有限公司",
                        "employee_name": "刘松",
                        "type": "固定期限劳动合同",
                        "sequence": 1,
                        "start_date": "2026-01-01",
                        "expiry_date": "2026-12-31",
                    }
                ]
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    result = commands.run(["business", "create", "contract", "--input", str(plan)], repo=HrRepository(FakeSupabaseConnector()))

    assert result["write"] == [
        {
            "name": "刘松",
            "action": "existing",
            "reason": "contracts already exists",
            "match_count": 1,
            "matched_ids": ["ct1"],
        }
    ]


def test_hr_business_update_contract_can_update_match_field_and_verify_target(
    monkeypatch,
    tmp_path: Path,
) -> None:
    actor_id = "11111111-1111-1111-1111-111111111111"
    policy_file = tmp_path / "policy.json"
    policy_file.write_text(
        json.dumps(
            {
                "role": "user",
                "business_role": "hr_specialist",
                "user_id": actor_id,
                "resources": [
                    {
                        "resource": "hr.contract",
                        "actions": ["read", "write"],
                        "scopes": [{"key": "company", "values": ["武汉未来天空音乐文化产业有限公司"]}],
                    },
                    {
                        "resource": "hr.employee",
                        "actions": ["read", "query"],
                        "scopes": [{"key": "company", "values": ["武汉未来天空音乐文化产业有限公司"]}],
                    },
                ],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    plan = tmp_path / "contract-update-match-field.json"
    plan.write_text(
        json.dumps(
            {
                "records": [
                    {
                        "company": "武汉未来天空音乐文化产业有限公司",
                        "employee_name": "刘松",
                        "match_type": "固定期限劳动合同",
                        "type": "劳动合同",
                        "sequence": 1,
                        "start_date": "2026-01-01",
                    }
                ]
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    monkeypatch.setenv("NANOBOT_WEBUI_POLICY_FILE", str(policy_file))
    repo = HrRepository(FakeSupabaseConnector())

    result = commands.run(["business", "update", "contract", "--input", str(plan)], repo=repo)

    assert result["write"] == [
        {
            "name": "刘松",
            "action": "updated",
            "fields": ["type"],
            "match_count": 1,
            "matched_ids": ["ct1"],
        }
    ]
    assert result["verification"]["ok"] is True
    assert repo.db.rows["contracts"][0]["type"] == "劳动合同"


def test_hr_business_update_personnel_change_matches_change_reason_and_clears_fields(
    monkeypatch,
    tmp_path: Path,
) -> None:
    actor_id = "11111111-1111-1111-1111-111111111111"
    policy_file = tmp_path / "policy.json"
    policy_file.write_text(
        json.dumps(
            {
                "role": "user",
                "business_role": "hr_specialist",
                "user_id": actor_id,
                "resources": [
                    {
                        "resource": "hr.personnel_change",
                        "actions": ["read", "write"],
                        "scopes": [{"key": "company", "values": ["武汉未来天空音乐文化产业有限公司"]}],
                    },
                    {
                        "resource": "hr.employee",
                        "actions": ["read", "query"],
                        "scopes": [{"key": "company", "values": ["武汉未来天空音乐文化产业有限公司"]}],
                    },
                ],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    plan = tmp_path / "personnel-change-update.json"
    plan.write_text(
        json.dumps(
            {
                "records": [
                    {
                        "company": "武汉未来天空音乐文化产业有限公司",
                        "employee_name": "刘松",
                        "effective_date": "2026-06-01",
                        "current_department": "行政部",
                        "current_position": "专员",
                        "change_reason": "调薪",
                        "probation_salary": None,
                        "regular_salary": None,
                        "notes": None,
                    }
                ]
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    monkeypatch.setenv("NANOBOT_WEBUI_POLICY_FILE", str(policy_file))
    connector = FakeSupabaseConnector()
    connector.rows["personnel_changes"] = [
        {
            "id": "pc1",
            "employee_id": "e1",
            "effective_date": "2026-06-01",
            "current_department": "行政部",
            "current_position": "专员",
            "change_reason": "入职",
            "probation_salary": 4000,
            "regular_salary": 5000,
            "notes": "不应更新",
        },
        {
            "id": "pc2",
            "employee_id": "e1",
            "effective_date": "2026-06-01",
            "current_department": "行政部",
            "current_position": "专员",
            "change_reason": "调薪",
            "probation_salary": 4200,
            "regular_salary": 5200,
            "notes": "待清空",
        },
    ]
    repo = HrRepository(connector)

    preview = commands.run(["business", "preview-update", "personnel-change", "--input", str(plan)], repo=repo)
    result = commands.run(["business", "update", "personnel-change", "--input", str(plan)], repo=repo)

    assert preview["records"][0]["action"] == "would_update"
    assert preview["records"][0]["diffs"] == [
        {"field": "probation_salary", "before": 4200, "after": None},
        {"field": "regular_salary", "before": 5200, "after": None},
        {"field": "notes", "before": "待清空", "after": None},
    ]
    assert result["write"] == [
        {
            "name": "刘松",
            "action": "updated",
            "fields": ["probation_salary", "regular_salary", "notes"],
            "match_count": 1,
            "matched_ids": ["pc2"],
        }
    ]
    assert result["verification"]["ok"] is True
    assert connector.rows["personnel_changes"][0]["notes"] == "不应更新"
    assert connector.rows["personnel_changes"][1]["probation_salary"] is None
    assert connector.rows["personnel_changes"][1]["regular_salary"] is None
    assert connector.rows["personnel_changes"][1]["notes"] is None


def test_hr_business_update_insurance_handles_signed_upload_array_diff(
    monkeypatch,
    tmp_path: Path,
) -> None:
    actor_id = "11111111-1111-1111-1111-111111111111"
    policy_file = tmp_path / "policy.json"
    policy_file.write_text(
        json.dumps(
            {
                "role": "user",
                "business_role": "hr_specialist",
                "user_id": actor_id,
                "resources": [
                    {
                        "resource": "hr.insurance",
                        "actions": ["read", "write"],
                        "scopes": [{"key": "company", "values": ["武汉未来天空音乐文化产业有限公司"]}],
                    },
                    {
                        "resource": "hr.employee",
                        "actions": ["read", "query"],
                        "scopes": [{"key": "company", "values": ["武汉未来天空音乐文化产业有限公司"]}],
                    },
                ],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    plan = tmp_path / "insurance-update-array.json"
    plan.write_text(
        json.dumps(
            {
                "records": [
                    {
                        "company": "武汉未来天空音乐文化产业有限公司",
                        "employee_name": "刘松",
                        "change_date": "2026-06-01",
                        "status": "新增",
                        "signed_upload": ["https://example.invalid/new.pdf"],
                    }
                ]
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    monkeypatch.setenv("NANOBOT_WEBUI_POLICY_FILE", str(policy_file))
    connector = FakeSupabaseConnector()
    connector.rows["insurance_changes"] = [
        {
            "id": "ic1",
            "employee_id": "e1",
            "change_date": "2026-06-01",
            "status": "新增",
            "signed_upload": ["https://example.invalid/old.pdf"],
        }
    ]
    repo = HrRepository(connector)

    preview = commands.run(["business", "preview-update", "insurance", "--input", str(plan)], repo=repo)

    assert preview["records"][0]["action"] == "would_update"
    assert preview["records"][0]["diffs"] == [
        {
            "field": "signed_upload",
            "before": ["https://example.invalid/old.pdf"],
            "after": ["https://example.invalid/new.pdf"],
        }
    ]


def test_performance_create_normalizes_natural_language_month_plan(
    monkeypatch,
    tmp_path: Path,
) -> None:
    monkeypatch.setenv(
        "NANOBOT_WEBUI_POLICY_FILE",
        str(write_hr_policy(tmp_path, resources=["hr.performance", "hr.employee"])),
    )
    plan = tmp_path / "performance-create.json"
    plan.write_text(
        json.dumps(
            {
                "company": "武汉未来天空音乐文化产业有限公司",
                "employee_name": "刘松",
                "review_month": "2026-06",
                "final_score": 96,
                "performance_salary": 1200,
                "notes": "普通账号自然语言绩效验收",
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    connector = FakeSupabaseConnector()
    connector.rows["performance_reviews"] = []
    repo = HrRepository(connector)

    preview = commands.run(["business", "preview", "performance", "--input", str(plan)], repo=repo)
    created = commands.run(["business", "create", "performance", "--input", str(plan)], repo=repo)

    assert normalize_performance_review_seed_record({"review_month": "2026-06"})[
        "review_date"
    ] == "2026-06-01"
    assert preview["summary"]["matched"] == 1
    assert created["verification"]["ok"] is True
    assert connector.rows["performance_reviews"][0]["review_date"] == "2026-06-01"
    assert connector.rows["performance_reviews"][0]["self_score"] == 96
    assert connector.rows["performance_reviews"][0]["supervisor_score"] == 96


def test_personnel_change_update_matches_created_record_when_changing_reason(
    monkeypatch,
    tmp_path: Path,
) -> None:
    monkeypatch.setenv(
        "NANOBOT_WEBUI_POLICY_FILE",
        str(write_hr_policy(tmp_path, resources=["hr.personnel_change", "hr.employee"])),
    )
    plan = tmp_path / "personnel-change-update-natural.json"
    plan.write_text(
        json.dumps(
            {
                "company": "武汉未来天空音乐文化产业有限公司",
                "employee_name": "刘松",
                "change_date": "2026-06-11",
                "current_position": "人事助理",
                "change_type": "转正",
                "new_position": "高级人事专员",
                "change_reason": "转正后定岗",
                "notes": "普通账号异动更新验收",
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    connector = FakeSupabaseConnector()
    connector.rows["personnel_changes"] = [
        {
            "id": "pc1",
            "employee_id": "e1",
            "effective_date": "2026-06-11",
            "current_department": None,
            "current_position": "人事助理",
            "new_position": "人事专员",
            "change_reason": "转正",
            "notes": "普通账号异动创建验收",
        }
    ]
    repo = HrRepository(connector)

    preview = commands.run(["business", "preview-update", "personnel-change", "--input", str(plan)], repo=repo)
    updated = commands.run(["business", "update", "personnel-change", "--input", str(plan)], repo=repo)

    assert preview["records"][0]["action"] == "would_update"
    assert {
        "field": "new_position",
        "before": "人事专员",
        "after": "高级人事专员",
    } in preview["records"][0]["diffs"]
    assert {
        "field": "change_reason",
        "before": "转正",
        "after": "转正后定岗",
    } in preview["records"][0]["diffs"]
    assert updated["verification"]["ok"] is True
    assert normalize_personnel_change_record({"change_date": "2026-06-11", "change_type": "转正", "change_reason": "转正后定岗"}) == {
        "effective_date": "2026-06-11",
        "match_change_reason": "转正",
        "change_reason": "转正后定岗",
    }
    assert connector.rows["personnel_changes"][0]["new_position"] == "高级人事专员"
    assert connector.rows["personnel_changes"][0]["change_reason"] == "转正后定岗"


def test_seal_usage_update_supports_new_reason_alias(
    monkeypatch,
    tmp_path: Path,
) -> None:
    monkeypatch.setenv(
        "NANOBOT_WEBUI_POLICY_FILE",
        str(write_hr_policy(tmp_path, resources=["hr.seal_usage", "hr.employee"])),
    )
    plan = tmp_path / "seal-usage-update-natural.json"
    plan.write_text(
        json.dumps(
            {
                "company": "武汉未来天空音乐文化产业有限公司",
                "usage_date": "2026-06-13",
                "current_reason": "普通账号流程验收",
                "new_reason": "普通账号更新流程验收",
                "attachments": ["验收复核申请.pdf"],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    connector = FakeSupabaseConnector()
    connector.rows["seal_usage"] = [
        {
            "id": "su1",
            "company_id": "c2",
            "applicant_id": None,
            "seal_applicant_id": "e1",
            "usage_date": "2026-06-13",
            "reason": "普通账号流程验收",
            "attachments": ["验收申请.pdf"],
            "notes": None,
        }
    ]
    repo = HrRepository(connector)

    preview = commands.run(["business", "preview-update", "seal-usage", "--input", str(plan)], repo=repo)
    updated = commands.run(["business", "update", "seal-usage", "--input", str(plan)], repo=repo)

    assert preview["records"][0]["action"] == "would_update"
    assert {
        "field": "reason",
        "before": "普通账号流程验收",
        "after": "普通账号更新流程验收",
    } in preview["records"][0]["diffs"]
    assert {
        "field": "attachments",
        "before": ["验收申请.pdf"],
        "after": ["验收复核申请.pdf"],
    } in preview["records"][0]["diffs"]
    assert updated["verification"]["ok"] is True
    assert normalize_seal_usage_seed_record({"seal_applicant_name": "刘松"}) == {
        "seal_applicant": "刘松"
    }
    assert connector.rows["seal_usage"][0]["reason"] == "普通账号更新流程验收"
    assert connector.rows["seal_usage"][0]["attachments"] == ["验收复核申请.pdf"]
    assert connector.rows["seal_usage"][0]["seal_applicant_id"] == "e1"


def test_hr_business_query_employee_list_excludes_logically_deleted_records() -> None:
    connector = FakeSupabaseConnector()
    connector.rows["employees"].append(
        {
            "id": "deleted-employee",
            "name": "已删除员工",
            "company_id": "c2",
            "department_id": "d4",
            "status": "正式",
            "phone": "19900000000",
            "id_card_number": "deleted-id-card",
            "is_deleted": True,
        }
    )
    repo = HrRepository(connector)

    result = repo.list_employees(company_name="武汉未来天空音乐文化产业有限公司")

    assert [record["name"] for record in result["records"]] == ["刘松"]


def test_hr_business_query_employee_timeline_excludes_logically_deleted_child_records() -> None:
    connector = FakeSupabaseConnector()
    connector.rows["contracts"].append(
        {
            "id": "deleted-contract",
            "employee_id": "e1",
            "type": "固定期限劳动合同",
            "sequence": 2,
            "sign_date": "2026-12-20",
            "duration_years": 1,
            "start_date": "2027-01-01",
            "expiry_date": "2027-12-31",
            "is_permanent": False,
            "notes": "已逻辑删除合同",
            "is_deleted": True,
        }
    )
    repo = HrRepository(connector)

    result = repo.employee_timeline(name="刘松", company_name="武汉未来天空音乐文化产业有限公司")

    assert [record["sequence"] for record in result["contracts"]] == [1]


def test_hr_business_create_employee_verification_accepts_default_status(
    monkeypatch,
    tmp_path: Path,
) -> None:
    policy_file = tmp_path / "policy.json"
    policy_file.write_text(
        json.dumps(
            {
                "role": "admin",
                "user_id": "11111111-1111-1111-1111-111111111111",
                "email": "admin@example.com",
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    plan = tmp_path / "employee-create.json"
    plan.write_text(
        json.dumps(
            {
                "company": "武汉未来天空音乐文化产业有限公司",
                "name": "默认状态验收员工",
                "department": "行政部",
                "position": "人事专员",
                "phone": "13900001111",
                "hire_date": "2026-06-10",
                "employment_status": "在职",
                "employee_type": "正式",
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    monkeypatch.setenv("NANOBOT_WEBUI_POLICY_FILE", str(policy_file))
    repo = HrRepository(FakeSupabaseConnector())

    result = commands.run(["business", "create", "employee", "--input", str(plan)], repo=repo)

    assert result["write"][0]["action"] == "created"
    assert result["verification"]["ok"] is True
    assert result["verification"]["results"][0]["diffs"] == []


def test_hr_business_delete_employee_marks_logically_deleted_for_audit(
    monkeypatch,
    tmp_path: Path,
) -> None:
    policy_file = tmp_path / "policy.json"
    policy_file.write_text(
        json.dumps(
            {
                "role": "admin",
                "user_id": "11111111-1111-1111-1111-111111111111",
                "email": "admin@example.com",
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    plan = tmp_path / "employee-delete.json"
    plan.write_text(
        json.dumps(
            {
                "records": [
                    {
                        "company": "武汉未来天空音乐文化产业有限公司",
                        "name": "待逻辑删除员工",
                        "id_card_number": "logic-delete-id-card",
                    }
                ]
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    monkeypatch.setenv("NANOBOT_WEBUI_POLICY_FILE", str(policy_file))
    connector = FakeSupabaseConnector()
    connector.rows["employees"].append(
        {
            "id": "logic-delete-employee",
            "name": "待逻辑删除员工",
            "company_id": "c2",
            "department_id": "d4",
            "phone": "19900000001",
            "id_card_number": "logic-delete-id-card",
            "status": "正式",
        }
    )
    repo = HrRepository(connector)

    result = commands.run(["business", "delete", "employee", "--input", str(plan)], repo=repo)
    verification = repo.verify_employee_deletions(plan=json.loads(plan.read_text(encoding="utf-8")))

    assert result == [
        {
            "name": "待逻辑删除员工",
            "action": "deleted",
            "company": "武汉未来天空音乐文化产业有限公司",
            "department": "行政部",
            "child_counts": {
                "contracts": 0,
                "performance_reviews": 0,
                "insurance_changes": 0,
                "personnel_changes": 0,
                "disciplinary_records": 0,
                "overtime_records": 0,
                "work_injuries": 0,
                "seal_usage_applicant": 0,
                "seal_usage_user": 0,
            },
        }
    ]
    deleted = next(row for row in connector.rows["employees"] if row["id"] == "logic-delete-employee")
    assert deleted["is_deleted"] is True
    assert deleted["updated_by"] == "11111111-1111-1111-1111-111111111111"
    assert verification["ok"] is True


def test_hr_business_delete_contract_marks_deleted_and_audit_query_returns_it(
    monkeypatch,
    tmp_path: Path,
) -> None:
    policy_file = tmp_path / "policy.json"
    policy_file.write_text(
        json.dumps(
            {
                "role": "admin",
                "user_id": "11111111-1111-1111-1111-111111111111",
                "email": "admin@example.com",
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    plan = tmp_path / "contract-delete.json"
    plan.write_text(
        json.dumps(
            {
                "records": [
                    {
                        "company": "武汉未来天空音乐文化产业有限公司",
                        "employee_name": "刘松",
                        "type": "固定期限劳动合同",
                        "sequence": 1,
                    }
                ]
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    monkeypatch.setenv("NANOBOT_WEBUI_POLICY_FILE", str(policy_file))
    connector = FakeSupabaseConnector()
    repo = HrRepository(connector)

    result = commands.run(["business", "delete", "contract", "--input", str(plan)], repo=repo)
    contracts = repo.contracts_by_employee(name="刘松", company_name="武汉未来天空音乐文化产业有限公司")
    deleted = commands.run(
        ["business", "query", "deleted-records", "--resource", "contract", "--company", "武汉未来天空音乐文化产业有限公司"],
        repo=repo,
    )

    assert result["records"][0]["action"] == "deleted"
    assert result["records"][0]["match_count"] == 1
    assert result["records"][0]["matched_ids"] == ["ct1"]
    assert connector.rows["contracts"][0]["is_deleted"] is True
    assert connector.rows["contracts"][0]["updated_by"] == "11111111-1111-1111-1111-111111111111"
    assert contracts["records"] == []
    assert deleted["count"] == 1
    assert deleted["records"][0]["type"] == "固定期限劳动合同"
    assert deleted["records"][0]["is_deleted"] is True


def test_hr_business_scoped_user_can_logically_delete_authorized_contract(
    monkeypatch,
    tmp_path: Path,
) -> None:
    actor_id = "22222222-2222-2222-2222-222222222222"
    policy_file = tmp_path / "policy.json"
    policy_file.write_text(
        json.dumps(
            {
                "role": "user",
                "business_role": "hr_specialist",
                "user_id": actor_id,
                "resources": [
                    {
                        "resource": "hr.contract",
                        "actions": ["read", "query", "delete"],
                        "scopes": [{"key": "company", "values": ["武汉未来天空音乐文化产业有限公司"]}],
                    },
                    {
                        "resource": "hr.employee",
                        "actions": ["read", "query"],
                        "scopes": [{"key": "company", "values": ["武汉未来天空音乐文化产业有限公司"]}],
                    },
                ],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    plan = tmp_path / "contract-delete.json"
    plan.write_text(
        json.dumps(
            {
                "records": [
                    {
                        "company": "武汉未来天空音乐文化产业有限公司",
                        "employee_name": "刘松",
                        "type": "固定期限劳动合同",
                        "sequence": 1,
                    }
                ]
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    monkeypatch.setenv("NANOBOT_WEBUI_POLICY_FILE", str(policy_file))
    connector = FakeSupabaseConnector()
    repo = HrRepository(connector)

    result = commands.run(["business", "delete", "contract", "--input", str(plan)], repo=repo)

    assert result["records"] == [
        {
            "name": "刘松",
            "action": "deleted",
            "fields": ["is_deleted"],
            "match_count": 1,
            "matched_ids": ["ct1"],
        }
    ]
    assert connector.rows["contracts"][0]["is_deleted"] is True
    assert connector.rows["contracts"][0]["updated_by"] == actor_id


def test_hr_business_delete_contract_with_match_id_uses_delete_scope(
    monkeypatch,
    tmp_path: Path,
) -> None:
    policy_file = write_hr_policy(
        tmp_path,
        resources=["hr.contract", "hr.employee"],
        actions=["read", "query", "delete"],
        companies=["武汉未来天空音乐文化产业有限公司"],
    )
    plan = tmp_path / "contract-delete-by-id.json"
    plan.write_text(
        json.dumps({"records": [{"match_id": "ct1"}]}, ensure_ascii=False),
        encoding="utf-8",
    )
    monkeypatch.setenv("NANOBOT_WEBUI_POLICY_FILE", str(policy_file))
    connector = FakeSupabaseConnector()
    repo = HrRepository(connector)

    result = commands.run(["business", "delete", "contract", "--input", str(plan)], repo=repo)

    assert result["records"][0]["action"] == "deleted"
    assert result["records"][0]["matched_ids"] == ["ct1"]
    assert connector.rows["contracts"][0]["is_deleted"] is True
    assert connector.rows["contracts"][0]["updated_by"] == "11111111-1111-1111-1111-111111111111"


def test_hr_business_delete_contract_with_match_id_rejects_cross_delete_scope(
    monkeypatch,
    tmp_path: Path,
) -> None:
    policy_file = write_hr_policy(
        tmp_path,
        resources=["hr.contract", "hr.employee"],
        actions=["read", "query", "delete"],
        companies=["乐潮里科技有限公司"],
    )
    plan = tmp_path / "contract-delete-cross-scope.json"
    plan.write_text(
        json.dumps({"records": [{"match_id": "ct1"}]}, ensure_ascii=False),
        encoding="utf-8",
    )
    monkeypatch.setenv("NANOBOT_WEBUI_POLICY_FILE", str(policy_file))

    with pytest.raises(RuntimeError, match="指定 id 不存在、已删除或无权访问"):
        commands.run(
            ["business", "delete", "contract", "--input", str(plan)],
            repo=HrRepository(FakeSupabaseConnector()),
        )


def test_hr_business_scoped_user_cannot_delete_unauthorized_contract(
    monkeypatch,
    tmp_path: Path,
) -> None:
    policy_file = tmp_path / "policy.json"
    policy_file.write_text(
        json.dumps(
            {
                "role": "user",
                "business_role": "hr_specialist",
                "user_id": "22222222-2222-2222-2222-222222222222",
                "resources": [
                    {
                        "resource": "hr.contract",
                        "actions": ["read", "query", "delete"],
                        "scopes": [{"key": "company", "values": ["武汉未来天空音乐文化产业有限公司"]}],
                    },
                    {
                        "resource": "hr.employee",
                        "actions": ["read", "query"],
                        "scopes": [{"key": "company", "values": ["武汉未来天空音乐文化产业有限公司"]}],
                    },
                ],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    plan = tmp_path / "contract-delete.json"
    plan.write_text(
        json.dumps(
            {
                "records": [
                    {
                        "company": "乐潮里科技有限公司",
                        "employee_name": "刘松",
                        "type": "固定期限劳动合同",
                        "sequence": 1,
                    }
                ]
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    monkeypatch.setenv("NANOBOT_WEBUI_POLICY_FILE", str(policy_file))

    with pytest.raises(RuntimeError, match="当前账号无权访问公司数据"):
        commands.run(["business", "delete", "contract", "--input", str(plan)], repo=HrRepository(FakeSupabaseConnector()))


def test_hr_business_update_commands_cover_every_create_resource() -> None:
    aliases = commands.business_command_aliases()
    create_resources = {
        key.split(":", 1)[1]
        for key in aliases
        if key.startswith("create:") and key != "create:disciplinary-attachment"
    }
    update_resources = {key.split(":", 1)[1] for key in aliases if key.startswith("update:")}
    preview_update_resources = {
        key.split(":", 1)[1] for key in aliases if key.startswith("preview-update:")
    }

    assert create_resources <= update_resources
    assert create_resources <= preview_update_resources


def test_hr_business_update_employee_matches_current_record_when_phone_changes(
    monkeypatch,
    tmp_path: Path,
) -> None:
    policy_file = tmp_path / "policy.json"
    policy_file.write_text(
        json.dumps(
            {
                "role": "admin",
                "user_id": "11111111-1111-1111-1111-111111111111",
                "email": "admin@example.com",
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    plan = tmp_path / "employee-update.json"
    plan.write_text(
        json.dumps(
            {
                "company": "武汉未来天空音乐文化产业有限公司",
                "name": "刘松",
                "position": "高级测试专员",
                "phone": "13810153339",
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    monkeypatch.setenv("NANOBOT_WEBUI_POLICY_FILE", str(policy_file))
    connector = FakeSupabaseConnector()
    repo = HrRepository(connector)

    preview = commands.run(["business", "preview-update", "employee", "--input", str(plan)], repo=repo)
    result = commands.run(["business", "update", "employee", "--input", str(plan)], repo=repo)

    employee = next(row for row in connector.rows["employees"] if row["id"] == "e1")
    assert preview["records"][0]["action"] == "would_update"
    assert result["write"] == [
        {
            "name": "刘松",
            "action": "updated",
            "fields": ["position", "phone"],
            "match_count": 1,
            "matched_ids": ["e1"],
        }
    ]
    assert result["verification"]["ok"] is True
    assert employee["position"] == "高级测试专员"
    assert employee["phone"] == "13810153339"


def test_hr_business_update_employee_can_match_by_old_phone(
    monkeypatch,
    tmp_path: Path,
) -> None:
    policy_file = tmp_path / "policy.json"
    policy_file.write_text(
        json.dumps(
            {
                "role": "admin",
                "user_id": "11111111-1111-1111-1111-111111111111",
                "email": "admin@example.com",
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    plan = tmp_path / "employee-update.json"
    plan.write_text(
        json.dumps(
            {
                "company": "武汉未来天空音乐文化产业有限公司",
                "name": "刘松",
                "match_phone": "18271001313",
                "phone": "13810153339",
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    monkeypatch.setenv("NANOBOT_WEBUI_POLICY_FILE", str(policy_file))
    connector = FakeSupabaseConnector()
    repo = HrRepository(connector)

    result = commands.run(["business", "update", "employee", "--input", str(plan)], repo=repo)

    employee = next(row for row in connector.rows["employees"] if row["id"] == "e1")
    assert result["write"] == [
        {
            "name": "刘松",
            "action": "updated",
            "fields": ["phone"],
            "match_count": 1,
            "matched_ids": ["e1"],
        }
    ]
    assert result["verification"]["ok"] is True
    assert employee["phone"] == "13810153339"


def test_hr_business_update_writable_field_sets_cover_supported_table_columns() -> None:
    assert COMPANY_WRITABLE_FIELDS == ["name", "short_name"]
    assert DEPARTMENT_WRITABLE_FIELDS == ["name", "company_id"]
    assert EMPLOYEE_WRITABLE_FIELDS == [
        "name",
        "gender",
        "birth_date",
        "position",
        "hire_date",
        "probation_end_date",
        "status",
        "phone",
        "id_card_number",
        "id_card_expiry",
        "education",
        "school",
        "graduation_date",
        "major",
        "current_address",
        "hukou_address",
        "bank_account",
        "bank_name",
        "resignation_date",
        "resignation_reason",
        "notes",
    ]
    assert CONTRACT_WRITABLE_FIELDS == [
        "type",
        "sequence",
        "sign_date",
        "duration_years",
        "start_date",
        "expiry_date",
        "is_permanent",
        "scan_file_url",
        "notes",
    ]
    assert PERFORMANCE_REVIEW_WRITABLE_FIELDS == [
        "review_date",
        "self_score",
        "supervisor_score",
        "final_score",
        "performance_ratio",
        "performance_salary",
        "actual_performance_salary",
        "performance_adjustment",
        "notes",
    ]
    assert INSURANCE_CHANGE_WRITABLE_FIELDS == [
        "change_date",
        "hire_date",
        "probation_end_date",
        "resignation_date",
        "insurance_add_date",
        "insurance_remove_date",
        "status",
        "signed_upload",
        "hr_clerk",
        "notes",
    ]
    assert PERSONNEL_CHANGE_WRITABLE_FIELDS == [
        "current_department",
        "current_position",
        "probation_salary",
        "regular_salary",
        "new_department",
        "new_position",
        "change_reason",
        "salary_before",
        "salary_after",
        "effective_date",
        "procedures_complete",
        "signed_upload",
        "hr_clerk",
        "notes",
    ]
    assert DISCIPLINARY_RECORD_WRITABLE_FIELDS == [
        "incident_dates",
        "penalty_type",
        "penalty_reason",
        "signed_upload",
        "hr_clerk",
    ]
    assert SEAL_USAGE_WRITABLE_FIELDS == [
        "company_id",
        "usage_date",
        "applicant_id",
        "seal_applicant_id",
        "reason",
        "attachments",
        "notes",
    ]
    assert "company_id" in seal_usage_select()
    assert "applicant_id" in seal_usage_select()
    assert "seal_applicant_id" in seal_usage_select()


def test_hr_disciplinary_business_commands_use_database_incident_dates(
    monkeypatch,
    tmp_path: Path,
) -> None:
    policy_file = tmp_path / "policy.json"
    policy_file.write_text(
        json.dumps(
            {
                "role": "user",
                "business_role": "hr_specialist",
                "resources": [
                    {
                        "resource": "hr.disciplinary",
                        "actions": ["read", "analyze"],
                        "scopes": [
                            {
                                "key": "company",
                                "values": ["武汉未来天空音乐文化产业有限公司"],
                            }
                        ],
                    },
                    {
                        "resource": "hr.employee",
                        "actions": ["read", "query"],
                        "scopes": [
                            {
                                "key": "company",
                                "values": ["武汉未来天空音乐文化产业有限公司"],
                            }
                        ],
                    },
                ],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    monkeypatch.setenv("NANOBOT_WEBUI_POLICY_FILE", str(policy_file))
    repo = HrRepository(FakeSupabaseConnector())

    summary = commands.run(
        ["business", "analyze", "disciplinary", "--company", "武汉未来天空音乐文化产业有限公司"],
        repo=repo,
    )
    detail = commands.run(
        ["business", "query", "disciplinary", "--name", "刘松"],
        repo=repo,
    )

    assert summary["count"] == 1
    assert summary["records"][0]["incident_date"] == ["2026-05-01"]
    assert summary["records"][0]["company"] == "武汉未来天空音乐文化产业有限公司"
    assert detail["records"] == summary["records"]


def test_disciplinary_record_helpers_map_public_incident_date_to_database_column() -> None:
    assert "incident_dates" in disciplinary_record_select()
    assert "incident_date," not in disciplinary_record_select()
    assert disciplinary_record_business_row({"incident_dates": ["2026-05-01"]})["incident_date"] == [
        "2026-05-01"
    ]
    assert disciplinary_record_payload(
        {
            "employee_name": "刘松",
            "company": "武汉未来天空音乐文化产业有限公司",
            "incident_date": "2026-05-01",
            "penalty_type": "警告",
        },
        "e1",
    ) == {"incident_dates": ["2026-05-01"], "penalty_type": "警告", "employee_id": "e1"}


def test_postgrest_query_preserves_multiple_filters_on_same_field(monkeypatch) -> None:
    captured: dict[str, object] = {}

    class FakeHttpResponse:
        content = b"[]"
        headers = {}

        def raise_for_status(self) -> None:
            return None

        def json(self):
            return []

    def fake_request(method, url, **kwargs):
        captured["method"] = method
        captured["url"] = url
        captured["params"] = kwargs["params"]
        return FakeHttpResponse()

    monkeypatch.setattr(
        "nanobot_channel_webui.business_modules.hr.runtime.supabase_client.httpx.request",
        fake_request,
    )

    client = PostgrestClient("https://example.supabase.co", "service-role")
    client.table("contracts").select("*").gte("expiry_date", "2026-06-07").lte(
        "expiry_date",
        "2027-06-07",
    ).execute()

    assert captured["params"] == [
        ("select", "*"),
        ("expiry_date", "gte.2026-06-07"),
        ("expiry_date", "lte.2027-06-07"),
    ]


def test_postgrest_query_serializes_array_filters_as_postgres_literals(monkeypatch) -> None:
    captured: dict[str, object] = {}

    class FakeHttpResponse:
        content = b"[]"
        headers = {}

        def raise_for_status(self) -> None:
            return None

        def json(self):
            return []

    def fake_request(method, url, **kwargs):
        captured["params"] = kwargs["params"]
        return FakeHttpResponse()

    monkeypatch.setattr(
        "nanobot_channel_webui.business_modules.hr.runtime.supabase_client.httpx.request",
        fake_request,
    )

    client = PostgrestClient("https://example.supabase.co", "service-role")
    client.table("disciplinary_records").select("*").eq(
        "incident_dates",
        ["2026-05-09"],
    ).execute()

    assert captured["params"] == [
        ("select", "*"),
        ("incident_dates", "eq.{2026-05-09}"),
    ]


def test_disciplinary_payload_maps_singular_incident_date_to_date_array() -> None:
    payload = disciplinary_record_payload(
        {
            "employee_name": "田魏荣",
            "incident_date": "2026-05-09",
            "penalty_type": "告诫",
            "notes": "处分表没有备注列",
            "department": "财务部",
        },
        "employee-1",
    )

    assert payload["incident_dates"] == ["2026-05-09"]
    assert "incident_date" not in payload
    assert "notes" not in payload
    assert "department" not in payload


def test_hr_business_create_and_update_disciplinary_matches_incident_dates_array(
    monkeypatch,
    tmp_path: Path,
) -> None:
    actor_id = "11111111-1111-1111-1111-111111111111"
    policy_file = tmp_path / "policy.json"
    policy_file.write_text(
        json.dumps(
            {
                "role": "user",
                "business_role": "hr_specialist",
                "user_id": actor_id,
                "resources": [
                    {
                        "resource": "hr.disciplinary",
                        "actions": ["read", "write"],
                        "scopes": [{"key": "company", "values": ["武汉未来天空音乐文化产业有限公司"]}],
                    },
                    {
                        "resource": "hr.employee",
                        "actions": ["read", "query"],
                        "scopes": [{"key": "company", "values": ["武汉未来天空音乐文化产业有限公司"]}],
                    },
                ],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    create_plan = tmp_path / "disciplinary-create.json"
    create_plan.write_text(
        json.dumps(
            {
                "records": [
                    {
                        "company": "武汉未来天空音乐文化产业有限公司",
                        "employee_name": "刘松",
                        "incident_date": "2026-06-10",
                        "penalty_type": "警告",
                        "penalty_reason": "实测创建",
                    }
                ]
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    update_plan = tmp_path / "disciplinary-update.json"
    update_plan.write_text(
        json.dumps(
            {
                "records": [
                    {
                        "company": "武汉未来天空音乐文化产业有限公司",
                        "employee_name": "刘松",
                        "match_incident_date": "2026-06-10",
                        "match_penalty_type": "警告",
                        "incident_date": "2026-06-11",
                        "penalty_type": "通报",
                        "penalty_reason": "实测更新",
                    }
                ]
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    monkeypatch.setenv("NANOBOT_WEBUI_POLICY_FILE", str(policy_file))
    connector = FakeSupabaseConnector()
    connector.rows["disciplinary_records"] = []
    repo = HrRepository(connector)

    created = commands.run(["business", "create", "disciplinary", "--input", str(create_plan)], repo=repo)
    preview = commands.run(["business", "preview-update", "disciplinary", "--input", str(update_plan)], repo=repo)
    updated = commands.run(["business", "update", "disciplinary", "--input", str(update_plan)], repo=repo)

    assert created["verification"]["ok"] is True
    assert preview["records"][0]["action"] == "would_update"
    assert updated["verification"]["ok"] is True
    assert connector.rows["disciplinary_records"][0]["incident_dates"] == ["2026-06-11"]
    assert connector.rows["disciplinary_records"][0]["penalty_type"] == "通报"


def test_generic_child_record_payload_drops_natural_language_match_fields() -> None:
    payload = generic_payload(
        {
            "company": "武汉赢城集团有限公司",
            "company_name": "武汉赢城集团有限公司",
            "department": "财务部",
            "department_name": "财务部",
            "name": "本地自然语言验收员工",
            "employee_name": "本地自然语言验收员工",
            "match": {"employee": {"id": "e1"}},
            "review_date": "2026-06-01",
            "final_score": 95,
            "notes": "本地自然语言发布验收绩效",
        },
        "e1",
    )

    assert payload == {
        "employee_id": "e1",
        "review_date": "2026-06-01",
        "final_score": 95,
        "notes": "本地自然语言发布验收绩效",
    }


def test_normalizers_accept_id_and_match_id_as_match_id_inputs() -> None:
    assert normalize_employee_seed_record({"id": "e1", "name": "刘松"})["_match_id"] == "e1"
    assert normalize_employee_seed_record({"match_id": "e1", "name": "刘松"})["_match_id"] == "e1"
    assert normalize_contract_seed_record({"id": "ct1", "employee_name": "刘松"})["_match_id"] == "ct1"
    assert normalize_contract_seed_record({"match_id": "ct1", "employee_name": "刘松"})["_match_id"] == "ct1"


def test_employee_alias_is_normalized_for_child_record_plans() -> None:
    assert normalize_named_employee_record({"employee": "张三"})["employee_name"] == "张三"
    assert normalize_contract_seed_record({"employee": "张三"})["employee_name"] == "张三"


def test_business_help_lists_create_commands_for_child_resources() -> None:
    help_data = commands.run(["business", "--help"], repo=HrRepository(FakeSupabaseConnector()))
    write_commands = next(
        group["commands"]
        for group in help_data["groups"]
        if group["group"] == "Business writes with confirmation"
    )

    assert "business create contract --input <plan.json>" in write_commands
    assert "business create performance --input <plan.json>" in write_commands
    assert "business create insurance --input <plan.json>" in write_commands
    assert "business create personnel-change --input <plan.json>" in write_commands
    assert "business create disciplinary --input <plan.json>" in write_commands
    assert "business create seal-usage --input <plan.json>" in write_commands


def test_analyze_contract_expiry_uses_current_contract_per_employee() -> None:
    connector = FakeSupabaseConnector()
    connector.rows["employees"].append(
        {
            "id": "e2",
            "name": "余慧娟",
            "company_id": "c1",
            "department_id": "d1",
            "phone": "13349924028",
            "id_card_number": "420104199011172028",
            "status": "正式",
        }
    )
    connector.rows["contracts"].extend(
        [
            {
                "id": "ct2",
                "employee_id": "e2",
                "type": "劳动合同",
                "sequence": 1,
                "sign_date": None,
                "duration_years": 3,
                "start_date": "2023-10-30",
                "expiry_date": "2026-10-29",
                "is_permanent": False,
                "notes": "首次合同",
            },
            {
                "id": "ct3",
                "employee_id": "e2",
                "type": "劳动合同",
                "sequence": 2,
                "sign_date": None,
                "duration_years": 5,
                "start_date": "2024-08-01",
                "expiry_date": "2029-07-31",
                "is_permanent": False,
                "notes": "续签合同",
            },
        ]
    )
    repo = HrRepository(connector)

    result = repo.analyze_contract_expiry(days=365, company_names=["乐潮里科技有限公司"])

    assert [record["employee"] for record in result["records"]] == []


def test_hr_repository_insert_writes_created_and_updated_actor_from_policy(
    monkeypatch,
    tmp_path: Path,
) -> None:
    actor_id = "11111111-1111-1111-1111-111111111111"
    policy_file = tmp_path / "policy.json"
    policy_file.write_text(
        json.dumps({"role": "admin", "user_id": actor_id, "email": "admin@lechaoli.com"}),
        encoding="utf-8",
    )
    monkeypatch.setenv("NANOBOT_WEBUI_POLICY_FILE", str(policy_file))
    connector = FakeSupabaseConnector()
    repo = HrRepository(connector)

    result = repo.ensure_company(name="测试审计公司", short_name="审计")

    assert result["action"] == "created"
    created = connector.rows["companies"][-1]
    assert created["created_by"] == actor_id
    assert created["updated_by"] == actor_id


def test_hr_repository_write_requires_policy_actor_user_id(
    monkeypatch,
    tmp_path: Path,
) -> None:
    policy_file = tmp_path / "policy.json"
    policy_file.write_text(
        json.dumps({"role": "admin", "email": "admin@lechaoli.com"}),
        encoding="utf-8",
    )
    monkeypatch.setenv("NANOBOT_WEBUI_POLICY_FILE", str(policy_file))
    repo = HrRepository(FakeSupabaseConnector())

    with pytest.raises(RuntimeError, match="缺少当前登录用户 ID"):
        repo.ensure_company(name="测试审计公司", short_name="审计")


class FakeSupabaseConnector:
    def __init__(self) -> None:
        self.rows = {
            "companies": [
                {"id": "c1", "name": "乐潮里科技有限公司", "short_name": None},
                {"id": "c2", "name": "武汉未来天空音乐文化产业有限公司", "short_name": None},
                {"id": "c3", "name": "武汉赢城集团有限公司", "short_name": None},
            ],
            "departments": [
                {"id": "d1", "name": "元宇宙", "company_id": "c1"},
                {"id": "d2", "name": "策划部", "company_id": "c1"},
                {"id": "d3", "name": "人力资源部", "company_id": "c2"},
                {"id": "d4", "name": "行政部", "company_id": "c2"},
                {"id": "d5", "name": "财务部", "company_id": "c3"},
            ],
            "employees": [
                {
                    "id": "e1",
                    "name": "刘松",
                    "company_id": "c2",
                    "department_id": "d4",
                    "phone": "18271001313",
                    "id_card_number": "421083200006270914",
                    "status": "正式",
                },
            ],
            "disciplinary_records": [
                {
                    "id": "dr1",
                    "employee_id": "e1",
                    "incident_dates": ["2026-05-01"],
                    "penalty_type": "警告",
                    "penalty_reason": "迟到",
                    "signed_upload": None,
                    "hr_clerk": "张幸",
                },
            ],
            "contracts": [
                {
                    "id": "ct1",
                    "employee_id": "e1",
                    "type": "固定期限劳动合同",
                    "sequence": 1,
                    "sign_date": "2025-12-20",
                    "duration_years": 1,
                    "start_date": "2026-01-01",
                    "expiry_date": "2026-12-31",
                    "is_permanent": False,
                    "notes": None,
                },
            ],
        }

    def table(self, table: str):
        return FakeQuery(self.rows, table)


class FailingContractInsertConnector(FakeSupabaseConnector):
    def __init__(self, *, fail_sequence: int) -> None:
        super().__init__()
        self.fail_sequence = fail_sequence

    def table(self, table: str):
        return FailingContractInsertQuery(self.rows, table, fail_sequence=self.fail_sequence)


class FakeResponse:
    def __init__(self, data, count=None) -> None:
        self.data = data
        self.count = count


class FakeQuery:
    def __init__(self, rows, table: str) -> None:
        self.rows = rows
        self.table = table
        self.filters = []
        self.order_key = ""
        self.select_value = ""
        self.limit_count = None
        self.insert_body = None
        self.update_body = None
        self.want_single = False

    def select(self, *args, **_kwargs):
        self.select_value = args[0] if args else ""
        return self

    def order(self, key: str, **_kwargs):
        self.order_key = key
        return self

    def eq(self, key: str, value):
        self.filters.append(("eq", key, value))
        return self

    def in_(self, key: str, values):
        self.filters.append(("in", key, values))
        return self

    def is_(self, key: str, value):
        self.filters.append(("is", key, value))
        return self

    def gte(self, key: str, value):
        self.filters.append(("gte", key, value))
        return self

    def lte(self, key: str, value):
        self.filters.append(("lte", key, value))
        return self

    def limit(self, count: int):
        self.limit_count = count
        return self

    def insert(self, body):
        self.insert_body = body
        return self

    def update(self, body):
        self.update_body = body
        return self

    def single(self):
        self.want_single = True
        return self

    def execute(self):
        self.rows.setdefault("_query_log", []).append(
            {
                "table": self.table,
                "select": self.select_value,
                "filters": list(self.filters),
            }
        )
        if self.insert_body is not None:
            body = dict(self.insert_body)
            body.setdefault("id", f"{self.table[:1]}{len(self.rows.get(self.table, [])) + 1}")
            self.rows.setdefault(self.table, []).append(body)
            data = [body]
            return FakeResponse(data[0] if self.want_single else data, len(data))
        if self.update_body is not None:
            data = list(self.rows.get(self.table, []))
            for filter_type, key, value in self.filters:
                if filter_type == "eq":
                    data = [row for row in data if row.get(key) == value]
                elif filter_type == "in":
                    data = [row for row in data if row.get(key) in value]
                elif filter_type == "is":
                    data = [row for row in data if row.get(key) is value]
            for row in data:
                row.update(self.update_body)
            return FakeResponse(data[0] if self.want_single and data else data, len(data))
        data = list(self.rows.get(self.table, []))
        for filter_type, key, value in self.filters:
            if filter_type == "eq":
                data = [row for row in data if row.get(key, False) == value] if key == "is_deleted" else [row for row in data if row.get(key) == value]
            elif filter_type == "in":
                data = [row for row in data if row.get(key) in value]
            elif filter_type == "is":
                data = [row for row in data if row.get(key) is value]
            elif filter_type == "gte":
                data = [row for row in data if str(row.get(key) or "") >= str(value)]
            elif filter_type == "lte":
                data = [row for row in data if str(row.get(key) or "") <= str(value)]
        if self.table == "departments":
            companies = self.rows["companies"]
            data = [
                {
                    **row,
                    "companies": {
                        "name": next(
                            (company["name"] for company in companies if company["id"] == row["company_id"]),
                            None,
                        )
                    },
                }
                for row in data
            ]
        if self.table == "employees":
            companies = self.rows["companies"]
            departments = self.rows["departments"]
            data = [
                {
                    **row,
                    "companies": {
                        "name": next(
                            (company["name"] for company in companies if company["id"] == row["company_id"]),
                            None,
                        )
                    },
                    "departments": {
                        "name": next(
                            (department["name"] for department in departments if department["id"] == row["department_id"]),
                            None,
                        )
                    },
                }
                for row in data
            ]
        if self.table == "disciplinary_records":
            assert "incident_date," not in self.select_value
            assert self.order_key != "incident_date"
            employees = self.rows["employees"]
            companies = self.rows["companies"]
            data = [
                {
                    **row,
                    "employees": {
                        **employee,
                        "companies": {
                            "name": next(
                                (company["name"] for company in companies if company["id"] == employee["company_id"]),
                                None,
                            )
                        },
                    },
                }
                for row in data
                for employee in employees
                if employee["id"] == row["employee_id"]
            ]
        if self.table == "contracts":
            employees = self.rows["employees"]
            companies = self.rows["companies"]
            data = [
                {
                    **row,
                    "employees": {
                        **employee,
                        "companies": {
                            "name": next(
                                (company["name"] for company in companies if company["id"] == employee["company_id"]),
                                None,
                            )
                        },
                    },
                }
                for row in data
                for employee in employees
                if employee["id"] == row["employee_id"]
            ]
        if self.table in {
            "performance_reviews",
            "insurance_changes",
            "personnel_changes",
        }:
            employees = self.rows["employees"]
            companies = self.rows["companies"]
            data = [
                {
                    **row,
                    "employees": {
                        **employee,
                        "companies": {
                            "name": next(
                                (company["name"] for company in companies if company["id"] == employee["company_id"]),
                                None,
                            )
                        },
                    },
                }
                for row in data
                for employee in employees
                if employee["id"] == row["employee_id"]
            ]
        if self.table == "seal_usage":
            employees = self.rows["employees"]
            companies = self.rows["companies"]
            data = [
                {
                    **row,
                    "companies": next(
                        (company for company in companies if company["id"] == row.get("company_id")),
                        None,
                    ),
                    "applicant": next(
                        (employee for employee in employees if employee["id"] == row.get("applicant_id")),
                        None,
                    ),
                    "seal_applicant": next(
                        (employee for employee in employees if employee["id"] == row.get("seal_applicant_id")),
                        None,
                    ),
                }
                for row in data
            ]
        if self.order_key:
            data = sorted(data, key=lambda row: str(row.get(self.order_key) or ""))
        total_count = len(data)
        if self.limit_count is not None:
            data = data[: self.limit_count]
        return FakeResponse(data, total_count)


class FailingContractInsertQuery(FakeQuery):
    def __init__(self, rows, table: str, *, fail_sequence: int) -> None:
        super().__init__(rows, table)
        self.fail_sequence = fail_sequence

    def execute(self):
        if (
            self.insert_body is not None
            and self.table == "contracts"
            and self.insert_body.get("sequence") == self.fail_sequence
        ):
            raise RuntimeError("simulated contract insert failure")
        return super().execute()
