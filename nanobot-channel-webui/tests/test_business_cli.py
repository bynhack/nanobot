from __future__ import annotations

import os
import json
from pathlib import Path

from nanobot_channel_webui.business_modules.hr import cli
from nanobot_channel_webui.business_modules.hr.runtime import commands
from nanobot_channel_webui.business_modules.hr.runtime.supabase_client import load_supabase_config
from nanobot_channel_webui.business_modules.hr.runtime.repository import HrRepository
from nanobot_channel_webui.business_modules.hr.runtime.repository import (
    disciplinary_record_business_row,
    disciplinary_record_payload,
    disciplinary_record_select,
)


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

    assert "<query|get|analyze|preview|create|delete>" in help_payload["usage"]
    assert "verify" not in help_payload["usage"]
    assert "business verify" not in serialized
    assert "verification" in serialized


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
    ) == {"incident_dates": "2026-05-01", "penalty_type": "警告", "employee_id": "e1"}


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
        }

    def table(self, table: str):
        return FakeQuery(self.rows, table)


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
        self.limit_count = None

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

    def limit(self, count: int):
        self.limit_count = count
        return self

    def execute(self):
        data = list(self.rows.get(self.table, []))
        for filter_type, key, value in self.filters:
            if filter_type == "eq":
                data = [row for row in data if row.get(key) == value]
            elif filter_type == "in":
                data = [row for row in data if row.get(key) in value]
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
        if self.order_key:
            data = sorted(data, key=lambda row: str(row.get(self.order_key) or ""))
        if self.limit_count is not None:
            data = data[: self.limit_count]
        return FakeResponse(data, len(data))
