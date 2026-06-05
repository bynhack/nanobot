from pathlib import Path
import json
import yaml


HR_SKILLS = (
    Path(__file__).resolve().parents[1]
    / "src"
    / "nanobot_channel_webui"
    / "business_modules"
    / "hr"
    / "skills"
)


def _skill_description(name: str) -> str:
    content = (HR_SKILLS / name / "SKILL.md").read_text(encoding="utf-8")
    frontmatter = content.split("---", 2)[1]
    return str(yaml.safe_load(frontmatter)["description"])


def test_hr_roster_summary_has_direct_headcount_fast_path() -> None:
    router = (HR_SKILLS / "hr-query-analysis-router" / "SKILL.md").read_text(encoding="utf-8")
    routing_map = (
        HR_SKILLS / "hr-query-analysis-router" / "references" / "query-routing-map.md"
    ).read_text(encoding="utf-8")
    db_ops = (HR_SKILLS / "hr-db-ops" / "SKILL.md").read_text(encoding="utf-8")

    combined = "\n".join([router, routing_map, db_ops])

    assert "花名册汇总" in combined
    assert "按公司、部门和在职状态" in combined
    assert "business analyze headcount" in combined
    assert "不要先运行 `list-employees`" in combined
    assert "不要运行 `which` 或 `find`" in combined


def test_hr_skill_frontmatter_routes_read_only_queries_to_router_only() -> None:
    descriptions = {
        name: _skill_description(name)
        for name in ("hr-query-analysis-router", "hr-db-ops", "hr-policy", "hr-schema")
    }

    assert "只读" in descriptions["hr-query-analysis-router"]
    assert "query" in descriptions["hr-query-analysis-router"]
    assert "analyze" in descriptions["hr-query-analysis-router"]

    assert "query" not in descriptions["hr-db-ops"]
    assert "analyze" not in descriptions["hr-db-ops"]
    assert "只读" not in descriptions["hr-db-ops"]

    assert "reads" not in descriptions["hr-policy"]
    assert "只读" not in descriptions["hr-policy"]
    assert "查询" not in descriptions["hr-policy"]

    assert "querying" not in descriptions["hr-schema"]
    assert "查询" not in descriptions["hr-schema"]
    assert "字段映射" in descriptions["hr-schema"]


def test_hr_skill_docs_route_to_standard_business_cli_only() -> None:
    router = (HR_SKILLS / "hr-query-analysis-router" / "SKILL.md").read_text(encoding="utf-8")
    routing_map = (
        HR_SKILLS / "hr-query-analysis-router" / "references" / "query-routing-map.md"
    ).read_text(encoding="utf-8")
    db_ops = (HR_SKILLS / "hr-db-ops" / "SKILL.md").read_text(encoding="utf-8")
    policy = (HR_SKILLS / "hr-policy" / "SKILL.md").read_text(encoding="utf-8")
    schema = (HR_SKILLS / "hr-schema" / "SKILL.md").read_text(encoding="utf-8")

    combined = "\n".join([router, routing_map, db_ops, policy, schema])

    assert "nanobot-webui-business hr business <query|get|analyze" in combined
    assert "nanobot-webui-business hr business <query|get|analyze|preview|create|delete>" in combined
    assert "默认不要传 `--company`" in combined
    assert "hr-data-entry-workflow" not in combined
    assert "low-level ad-hoc Supabase access" not in combined
    assert "run-hr-cli.sh" not in combined
    assert "business analyze headcount" in combined
    assert "analyze-headcount" not in combined


def test_hr_skill_docs_forbid_runtime_and_policy_file_exploration() -> None:
    router = (HR_SKILLS / "hr-query-analysis-router" / "SKILL.md").read_text(encoding="utf-8")
    routing_map = (
        HR_SKILLS / "hr-query-analysis-router" / "references" / "query-routing-map.md"
    ).read_text(encoding="utf-8")
    db_ops = (HR_SKILLS / "hr-db-ops" / "SKILL.md").read_text(encoding="utf-8")
    policy = (HR_SKILLS / "hr-policy" / "SKILL.md").read_text(encoding="utf-8")
    schema = (HR_SKILLS / "hr-schema" / "SKILL.md").read_text(encoding="utf-8")

    combined = "\n".join([router, routing_map, db_ops, policy, schema])

    assert "不要运行 `which`、`find`、`ls` 或 `cat`" in combined
    assert "不要读取 `runtime/`" in combined
    assert "不要读取 runtime、scripts、tenant-runtime、policy" in combined
    assert "不要使用原始数据库、SQL、Supabase 客户端或未授权脚本" in combined


def test_hr_public_contract_does_not_expose_business_verify() -> None:
    db_ops = (HR_SKILLS / "hr-db-ops" / "SKILL.md").read_text(encoding="utf-8")
    tenant_runtime = json.loads(
        (HR_SKILLS / "hr-db-ops" / "tenant-runtime.json").read_text(encoding="utf-8")
    )

    assert "business verify" not in db_ops
    assert "公开命令只包含 preview 和 create" in db_ops
    assert "verification" in db_ops
    assert "不要再调用单独的 verify 命令" in db_ops

    serialized = json.dumps(tenant_runtime, ensure_ascii=False)
    assert "business verify" not in serialized
    assert "create command performs the database write and internal verification" in serialized
