import json
from pathlib import Path

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
    assert "nanobot-webui-business hr business <query|get|analyze|preview|create|preview-update|update|delete>" in combined
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
    assert "公开命令包含 preview/create 和 preview-update/update" in db_ops
    assert "新增记录必须走 `business preview <resource>`" in db_ops
    assert "不要用 `preview-update/update` 创建不存在的记录" in db_ops
    assert "即使员工主档已经存在，也仍然是该子资源的新增" in db_ops
    assert "verification" in db_ops
    assert "不要再调用单独的 verify 命令" in db_ops
    assert "business preview-update employee" in db_ops
    assert "business update employee" in db_ops

    serialized = json.dumps(tenant_runtime, ensure_ascii=False)
    assert "business verify" not in serialized
    assert "business update employee-nickname" not in serialized
    assert "create command performs the database write and internal verification" in serialized
    assert "This is a create workflow for a new performance record, even when the employee already exists" in serialized
    assert "Do not use this workflow to create new employee-related records" in serialized
    assert "business preview-update employee" in serialized
    assert "business update employee" in serialized


def test_hr_write_contract_uses_internal_verification_without_extra_readback() -> None:
    db_ops = (HR_SKILLS / "hr-db-ops" / "SKILL.md").read_text(encoding="utf-8")
    tenant_runtime = json.loads(
        (HR_SKILLS / "hr-db-ops" / "tenant-runtime.json").read_text(encoding="utf-8")
    )
    serialized = json.dumps(tenant_runtime, ensure_ascii=False)

    assert "最后 verify" not in db_ops
    assert "create/update/delete 返回结果已经包含内部 verification" in db_ops
    assert "除非用户明确要求回读" in db_ops
    assert "不要在成功 create/update/delete 后再自动运行 get/query/analyze 做二次验证" in db_ops
    assert "A successful create/update/delete result is sufficient; do not run extra get/query/analyze readback unless the user explicitly asks for it" in serialized


def test_hr_write_contract_requires_cli_preview_before_user_confirmation() -> None:
    db_ops = (HR_SKILLS / "hr-db-ops" / "SKILL.md").read_text(encoding="utf-8")
    tenant_runtime = json.loads(
        (HR_SKILLS / "hr-db-ops" / "tenant-runtime.json").read_text(encoding="utf-8")
    )
    serialized = json.dumps(tenant_runtime, ensure_ascii=False)

    assert "确认前必须已经完成业务 preview" in db_ops
    assert "不要只根据用户原始文本口头列字段就请求确认" in db_ops
    assert "必须把 preview 返回的 records、matched、skipped、diffs 或风险摘要展示给用户确认" in db_ops
    assert "对业务用户不要暴露 `CLI`、`preview`、`预览`、`系统预览` 等内部术语" in db_ops
    assert "写入流程中的任何可见回复都不能说“预览”" in db_ops
    assert "多资源写入或更新也一样适用" in db_ops
    assert "不要说“所有预览都通过了”" in db_ops
    assert "不要用英文暴露内部 preview 过程" in db_ops
    assert "请确认以下拟录入信息" in db_ops
    assert "请确认以下拟更新信息" in db_ops
    assert "员工姓名必须按用户原文完整保留" in db_ops
    assert "不要为了“像姓名”而截断长姓名或测试姓名" in db_ops
    assert "User confirmation must be requested only after the JSON plan has been written and the preview or preview-update command has succeeded" in serialized
    assert "Do not ask for confirmation from the raw user request alone" in serialized
    assert "Show a business confirmation summary derived from the internal preview result" in serialized
    assert "Do not expose CLI, preview, 预览, or 系统预览 in visible replies, including multi-resource workflows" in serialized
    assert "Show the actual CLI preview result" not in serialized


def test_hr_write_contract_provides_single_plan_file_examples() -> None:
    db_ops = (HR_SKILLS / "hr-db-ops" / "SKILL.md").read_text(encoding="utf-8")
    tenant_runtime = json.loads(
        (HR_SKILLS / "hr-db-ops" / "tenant-runtime.json").read_text(encoding="utf-8")
    )
    serialized = json.dumps(tenant_runtime, ensure_ascii=False)

    assert "只写一次 JSON plan 文件" in db_ops
    assert '"name": "张三"' in db_ops
    assert '"employee_name": "张三"' in db_ops
    assert "如果 preview 返回 plan 结构错误，再按错误信息修改同一个文件一次" in db_ops
    assert "Use one flat JSON plan object or a records array; do not try multiple wrapper formats" in serialized


def test_hr_write_contract_prefers_business_schema_fast_path() -> None:
    db_ops = (HR_SKILLS / "hr-db-ops" / "SKILL.md").read_text(encoding="utf-8")
    schema = (HR_SKILLS / "hr-schema" / "SKILL.md").read_text(encoding="utf-8")
    tenant_runtime = json.loads(
        (HR_SKILLS / "hr-db-ops" / "tenant-runtime.json").read_text(encoding="utf-8")
    )
    serialized = json.dumps(tenant_runtime, ensure_ascii=False)

    assert "写入或更新具体资源前，先运行 `business schema <resource> --workflow create|update`" in db_ops
    assert "不要为了写常规 plan 先读取长篇 `hr-schema`" in db_ops
    assert "`hr-schema` 是字段排查兜底" in db_ops
    assert "business schema performance --workflow create" in db_ops
    assert "business schema seal-usage --workflow update" in db_ops
    assert "business schema <resource> --workflow create|update" in serialized
    assert "Prefer business schema over reading long hr-schema docs when drafting normal write plans" in serialized
    assert "兜底" in schema


def test_hr_update_failure_must_not_fallback_to_delete_recreate() -> None:
    db_ops = (HR_SKILLS / "hr-db-ops" / "SKILL.md").read_text(encoding="utf-8")
    tenant_runtime = json.loads(
        (HR_SKILLS / "hr-db-ops" / "tenant-runtime.json").read_text(encoding="utf-8")
    )
    serialized = json.dumps(tenant_runtime, ensure_ascii=False)

    assert "更新失败不能自动改走删除重建" in db_ops
    assert "删除重建必须等待用户单独明确确认" in db_ops
    assert "If update fails, do not delete or recreate the record as a fallback" in serialized
