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

    assert "花名册明细" in combined
    assert "business list employee --page-size 100" in combined
    assert "裸 `list` 使用分页" in combined
    assert "带业务过滤条件的 `list` 返回完整匹配结果" in combined
    assert "不要运行 `which` 或 `find`" in combined


def test_hr_skill_frontmatter_routes_read_only_queries_to_router_only() -> None:
    descriptions = {
        name: _skill_description(name)
        for name in ("hr-query-analysis-router", "hr-db-ops", "hr-policy", "hr-schema")
    }

    assert "只读" in descriptions["hr-query-analysis-router"]
    assert "read" in descriptions["hr-query-analysis-router"]
    assert "list" not in descriptions["hr-db-ops"]

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

    assert "nanobot-webui-business hr business <list|get|analyze|preview|create|preview-update|update|delete|schema|capabilities>" in combined
    assert "默认不要传 `--company`" in combined
    assert "hr-data-entry-workflow" not in combined
    assert "low-level ad-hoc Supabase access" not in combined
    assert "run-hr-cli.sh" not in combined
    assert "business list employee" in combined
    assert "business get employee --id" in combined
    assert "business analyze roster" in combined
    assert "business analyze contract-coverage" in combined
    assert "business analyze performance-month" in combined
    assert "business analyze insurance-month" in combined
    assert "business analyze personnel-change" in combined
    assert "business analyze disciplinary" in combined
    assert "business analyze seal-usage" in combined
    assert "business analyze employee-profile" in combined
    assert "analyze-headcount" not in combined


def test_hr_write_docs_require_uploaded_attachment_source_urls() -> None:
    db_ops = (HR_SKILLS / "hr-db-ops" / "SKILL.md").read_text(encoding="utf-8")
    policy = (HR_SKILLS / "hr-policy" / "SKILL.md").read_text(encoding="utf-8")
    combined = "\n".join([db_ops, policy])

    assert "用户上传附件" in combined
    assert "[File: source:" in combined
    assert "Supabase Storage" in combined
    assert "scan_file_url" in combined
    assert "signed_upload" in combined
    assert "attachments" in combined


def test_hr_skill_docs_expose_slim_list_get_contract_without_legacy_read_surface() -> None:
    router = (HR_SKILLS / "hr-query-analysis-router" / "SKILL.md").read_text(encoding="utf-8")
    routing_map = (
        HR_SKILLS / "hr-query-analysis-router" / "references" / "query-routing-map.md"
    ).read_text(encoding="utf-8")
    db_ops = (HR_SKILLS / "hr-db-ops" / "SKILL.md").read_text(encoding="utf-8")
    policy = (HR_SKILLS / "hr-policy" / "SKILL.md").read_text(encoding="utf-8")
    tenant_runtime = json.loads(
        (HR_SKILLS / "hr-db-ops" / "tenant-runtime.json").read_text(encoding="utf-8")
    )
    combined = "\n".join([router, routing_map, db_ops, policy, json.dumps(tenant_runtime, ensure_ascii=False)])

    assert "nanobot-webui-business hr business <list|get|analyze|preview|create|preview-update|update|delete|schema|capabilities>" in combined
    assert "business list employee" in combined
    assert "business get employee --id" in combined
    assert "business list contract --employee" in combined
    assert "business list performance --month" in combined
    assert "裸 list" in combined
    assert "page-size" in combined
    assert "business query" not in combined
    assert "business analyze roster" in combined
    assert "business analyze contract-coverage" in combined
    assert "business analyze performance-month" in combined
    assert "business analyze insurance-month" in combined
    assert "business analyze personnel-change" in combined
    assert "business analyze seal-usage" in combined
    assert "business analyze employee-profile" in combined
    assert "employee-timeline" not in combined
    assert "business list organization-tree" in combined
    assert "business query organization-tree" not in combined
    assert "business preview organization" not in combined
    assert "business create organization" not in combined
    assert "business preview-update organization" not in combined
    assert "business update organization" not in combined


def test_hr_tenant_runtime_metadata_exposes_only_public_read_commands() -> None:
    forbidden = (
        "analyze-headcount",
        "analyze-contract-expiry",
        "analyze-performance",
        "analyze-insurance",
        "analyze-disciplinary",
        "analyze-low",
        "employee-summary",
        "find-employee-like",
        "contracts-by-employee",
        "employee-contracts",
        "YYYY-MM-by-employee",
        "personnel-change-by-employee",
        "business list employee-contracts",
        "business list list-employees",
        "list-seal-usage",
    )
    tenant_runtime_files = (
        HR_SKILLS / "hr-db-ops" / "tenant-runtime.json",
        HR_SKILLS / "hr-query-analysis-router" / "tenant-runtime.json",
    )

    for path in tenant_runtime_files:
        payload = json.loads(path.read_text(encoding="utf-8"))
        serialized = json.dumps(payload, ensure_ascii=False)
        for legacy in forbidden:
            assert legacy not in serialized, f"{path.name} still exposes {legacy}"

        commands = {
            command
            for capability in payload["capabilities"]
            for command in capability.get("commands", [])
        }
        assert "business list employee" in commands
        assert "business analyze roster" in commands
        assert "business analyze contract-coverage" in commands
        assert "business analyze contract-expiry --days 90" in commands
        assert "business analyze performance-month --month YYYY-MM" in commands
        assert "business analyze insurance-month --month YYYY-MM" in commands
        assert "business analyze personnel-change --year YYYY" in commands
        assert "business analyze disciplinary" in commands
        assert "business analyze seal-usage" in commands
        assert "business analyze employee-profile" in commands
        assert "business list contract --employee <name>" in commands
        assert "business list performance --month YYYY-MM --employee <name>" in commands
        assert "business list insurance --month YYYY-MM --employee <name>" in commands
        assert "business list personnel-change --employee <name>" in commands
        assert "business get seal-usage --id <id>" in commands


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


def test_hr_skill_docs_explain_id_boundaries_and_bare_list_fallback() -> None:
    router = (HR_SKILLS / "hr-query-analysis-router" / "SKILL.md").read_text(encoding="utf-8")
    db_ops = (HR_SKILLS / "hr-db-ops" / "SKILL.md").read_text(encoding="utf-8")

    assert "## About `id`" in db_ops
    assert "list / get / update / delete plan 之间统一使用" in db_ops
    assert "preview/create/update/delete" in db_ops
    assert 'match_id: "<id>"' in db_ops
    assert "新增 plan 不需要 `match_id`" in db_ops
    assert "如果已经拿到 id，必须用 `match_id`" in db_ops

    for content in (router, db_ops):
        assert "## When to fall back to bare list" in content
        assert "带过滤 list 返回空" in content
        assert "用户描述模糊" in content
        assert "每页都返回 id" in content
        assert "business get <resource> --id <id>" in content


def test_hr_db_ops_documents_error_recovery_for_common_cli_failures() -> None:
    db_ops = (HR_SKILLS / "hr-db-ops" / "SKILL.md").read_text(encoding="utf-8")

    assert "## Error Recovery" in db_ops
    assert "结果集超过 5000 行" in db_ops
    assert "suggested_filters" in db_ops
    assert "带过滤的 list 不支持 --limit" in db_ops
    assert "当前账号无权访问公司数据" in db_ops
    assert "指定 id 不存在、已删除或无权访问" in db_ops
    assert "<resource> record not found" in db_ops
    assert "Option --page-size must be between 1 and 500" in db_ops
    assert "partial_results" in db_ops
    assert "不要把错误吞掉只回“查询失败”" in db_ops


def test_hr_policy_matches_schema_first_write_contract() -> None:
    policy = (HR_SKILLS / "hr-policy" / "SKILL.md").read_text(encoding="utf-8")

    assert 'hr_business(action="schema", resource="<resource>", workflow="create|update")' in policy
    assert "`match_id`（首选）" in policy
    assert "必须用 `match_id`" in policy
    assert "业务键 fallback" in policy
    assert "读取场景下，先 list 拿候选和 id" in policy


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
    assert "不要在成功 create/update/delete 后再自动运行读取命令做二次验证" in db_ops
    assert "A successful create/update/delete result is sufficient; do not run extra readback unless the user explicitly asks for it" in serialized


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

    assert "只准备一次 JSON plan 内容" in db_ops
    assert "不要查找 runtime-inputs 目录" in db_ops
    assert '"name": "张三"' in db_ops
    assert '"employee_name": "张三"' in db_ops
    assert "如果 preview 返回 plan 结构错误，再按错误信息修改同一份 plan 一次" in db_ops
    assert "Use one flat JSON plan object or a records array; do not try multiple wrapper formats" in serialized
    assert "Pass the same JSON plan directly as the hr_business input string" in serialized


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


def test_hr_skill_contract_keeps_organization_read_only() -> None:
    db_ops = (HR_SKILLS / "hr-db-ops" / "SKILL.md").read_text(encoding="utf-8")
    tenant_runtime = json.loads(
        (HR_SKILLS / "hr-db-ops" / "tenant-runtime.json").read_text(encoding="utf-8")
    )
    serialized = json.dumps(tenant_runtime, ensure_ascii=False)

    assert "business list organization-tree" in serialized
    assert "business preview organization" not in serialized
    assert "business create organization" not in serialized
    assert "business preview-update organization" not in serialized
    assert "business update organization" not in serialized
    assert "| 组织结构 |" in db_ops
    assert "读取/分析" in db_ops
    assert "`business create organization" not in db_ops
    assert "`business update organization" not in db_ops


def test_hr_db_ops_documents_conversational_workflow_recipes() -> None:
    db_ops = (HR_SKILLS / "hr-db-ops" / "SKILL.md").read_text(encoding="utf-8")

    assert "## Conversational Workflow Recipes" in db_ops
    assert "入职" in db_ops
    assert "转正" in db_ops
    assert "续签" in db_ops
    assert "内部调动" in db_ops
    assert "离职" in db_ops
    assert "employee create" in db_ops
    assert "employee update plan 使用 match_id" in db_ops
    assert "list/get employee 拿 id" in db_ops
    assert "contract create" in db_ops
    assert "schema -> preview 或 preview-update -> 用户确认 -> create/update/delete" in db_ops
    assert "organization、employee、contract、performance、insurance、personnel-change、disciplinary" in db_ops
    assert "不要试图把多个资源合并成一个 plan" in db_ops


def test_hr_update_failure_must_not_fallback_to_delete_recreate() -> None:
    db_ops = (HR_SKILLS / "hr-db-ops" / "SKILL.md").read_text(encoding="utf-8")
    tenant_runtime = json.loads(
        (HR_SKILLS / "hr-db-ops" / "tenant-runtime.json").read_text(encoding="utf-8")
    )
    serialized = json.dumps(tenant_runtime, ensure_ascii=False)

    assert "更新失败不能自动改走删除重建" in db_ops
    assert "删除重建必须等待用户单独明确确认" in db_ops
    assert "If update fails, do not delete or recreate the record as a fallback" in serialized
