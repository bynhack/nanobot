"""Command surface for the HR business runtime."""

from __future__ import annotations

import json
import sys
from typing import Any

from .policy import (
    SCOPED_MULTI_COMPANY_COMMANDS,
    authorize_hr_command,
    load_access_policy,
    scoped_company_list,
)
from .repository import (
    HrRepository,
    contract_payload,
    contract_select,
    disciplinary_record_payload,
    disciplinary_record_select,
    generic_payload,
    insurance_change_select,
    normalize_contract_seed_record,
    normalize_named_employee_record,
    normalize_performance_review_seed_record,
    performance_review_select,
    personnel_change_select,
    seal_usage_select,
)

AUTO_SCOPED_COMPANY_COMMANDS = SCOPED_MULTI_COMPANY_COMMANDS


def main(argv: list[str] | None = None, repo: HrRepository | None = None) -> int:
    repo = repo or HrRepository()
    try:
        result = run(argv or sys.argv[1:], repo=repo)
        if result is not None:
            print_json({"ok": True, "data": result})
        return 0
    except Exception as exc:  # noqa: BLE001
        print_json({"ok": False, "error": str(exc)}, stream=sys.stderr)
        return 1


def run(argv: list[str], *, repo: HrRepository) -> Any:
    parsed = parse_args(argv)
    command = parsed["command"]
    options = parsed["options"]
    if command == "business":
        if options.get("help"):
            return business_help(parsed["positionals"])
        command, options = normalize_business_command(parsed)
    if options.get("help") or command in {"help", "--help", "-h", None}:
        return business_help()
    policy = load_access_policy()
    apply_scoped_company_default(command=command, options=options, policy=policy)
    plan = read_json(options.get("input")) if options.get("input") else None
    if command == "list-companies":
        scoped = scoped_company_list(policy)
        if scoped is not None:
            return scoped
    authorize_hr_command(command=command, options=options, plan=plan, policy=policy)
    return dispatch(command, options, plan, repo)


def dispatch(command: str, options: dict[str, Any], plan: Any, repo: HrRepository) -> Any:
    scoped = scoped_company_names(options)
    lookup = employee_lookup_options(options)
    lookup["company_names"] = scoped
    match command:
        case "count-all":
            return repo.count_all_tables()
        case "clear-business-data":
            return repo.clear_business_data(confirm=options.get("confirm"))
        case "list-companies":
            return repo.list_companies()
        case "organization-tree":
            organization_scope = scoped or ([options["company"]] if options.get("company") else None)
            return repo.list_organization_tree(company_names=organization_scope)
        case "find-company":
            return repo.find_company_by_name(options.get("name"))
        case "list-departments":
            return repo.list_departments(company_name=options.get("company"), company_names=scoped)
        case "find-department":
            return repo.find_department(company_name=options.get("company"), department_name=options.get("department"))
        case "find-employee":
            return find_employee(repo, options)
        case "find-employee-like":
            return repo.find_employee_name_like(name=options.get("name"), company_name=options.get("company"), company_names=scoped)
        case "list-employees":
            return repo.list_employees(company_name=options.get("company"), company_names=scoped, status=options.get("status"))
        case "employee-detail":
            return repo.employee_detail(**lookup)
        case "employee-timeline":
            return repo.employee_timeline(**lookup)
        case "contracts-by-employee":
            return repo.contracts_by_employee(**lookup)
        case "performance-by-employee":
            return repo.performance_by_employee(**lookup)
        case "performance-by-month":
            return repo.performance_by_month(month=options.get("month"), company_name=options.get("company"), company_names=scoped)
        case "insurance-by-employee":
            return repo.insurance_changes_by_employee(**lookup)
        case "insurance-by-month":
            return repo.insurance_changes_by_month(month=options.get("month"), company_name=options.get("company"), company_names=scoped)
        case "personnel-changes-by-employee":
            return repo.personnel_changes_by_employee(**lookup)
        case "personnel-changes-list":
            return repo.personnel_changes_list(year=options.get("year"), change_reason=options.get("reason"), company_name=options.get("company"), company_names=scoped)
        case "disciplinary-by-employee":
            return repo.disciplinary_records_by_employee(**lookup)
        case "seal-usage-list":
            return repo.seal_usage_list(company_name=options.get("company"), company_names=scoped, date_from=options.get("from"), date_to=options.get("to"), employee_name=options.get("name"))
        case "pending-review-list":
            return repo.pending_review_list()
        case "data-quality-check":
            return repo.data_quality_check()
        case "analyze-headcount":
            return repo.analyze_headcount(company_name=options.get("company"), company_names=scoped)
        case "analyze-contract-coverage":
            return repo.analyze_contract_coverage(company_name=options.get("company"), company_names=scoped)
        case "analyze-contract-expiry":
            return repo.analyze_contract_expiry(days=options.get("days"), company_name=options.get("company"), company_names=scoped)
        case "analyze-performance-month":
            return repo.analyze_performance_month(month=options.get("month"), company_name=options.get("company"), company_names=scoped)
        case "analyze-low-performance":
            return repo.analyze_low_performance(month=options.get("month"), company_name=options.get("company"), company_names=scoped, threshold=options.get("threshold"))
        case "analyze-insurance-month":
            return repo.analyze_insurance_month(month=options.get("month"), company_name=options.get("company"), company_names=scoped)
        case "analyze-disciplinary":
            return repo.analyze_disciplinary(company_name=options.get("company"), company_names=scoped)
        case "analyze-hr-risk-dashboard":
            return repo.analyze_hr_risk_dashboard()
        case "employee-summary":
            return repo.employee_summary(company_name=options.get("company"), company_names=scoped)
        case "employees-without-contracts":
            return repo.employees_without_contracts()
        case "preview-org-seeds":
            return repo.preview_org_seeds(plan=plan, company_name=options.get("company"))
        case "apply-org-seeds":
            return repo.apply_org_seeds(plan=plan, company_name=options.get("company"), confirm=options.get("confirm"))
        case "verify-org-seeds":
            return repo.verify_org_seeds(plan=plan, company_name=options.get("company"))
        case "delete-empty-departments":
            return repo.delete_empty_departments(plan=plan, confirm=options.get("confirm"))
        case "preview-employees":
            return repo.preview_employee_seeds(plan=plan)
        case "apply-employees":
            return repo.apply_employee_seeds(plan=plan, confirm=options.get("confirm"))
        case "verify-employees":
            return repo.verify_employee_seeds(plan=plan)
        case "delete-employee-records":
            return repo.delete_employee_records(plan=plan, confirm=options.get("confirm"))
        case "verify-employee-deletions":
            return repo.verify_employee_deletions(plan=plan)
        case "preview-contracts":
            return repo.preview_generic_seeds(plan=plan, resource="hr.contract", normalizer=normalize_contract_seed_record, name_field="employee_name")
        case "apply-contracts":
            return repo.apply_generic_seeds(plan=plan, confirm=options.get("confirm"), expected_confirm="导入合同", resource="hr.contract", table="contracts", normalizer=normalize_contract_seed_record, payload_builder=contract_payload, select=contract_select(), existing_finder=repo.find_existing_contract, label="contract")
        case "verify-contracts":
            return repo.verify_generic_seeds(plan=plan, resource="hr.contract", normalizer=normalize_contract_seed_record, fields=["type", "sequence", "sign_date", "duration_years", "start_date", "expiry_date", "is_permanent", "notes"], existing_finder=repo.find_existing_contract, label="contract")
        case "preview-performance-reviews":
            return repo.preview_generic_seeds(plan=plan, resource="hr.performance", normalizer=normalize_performance_review_seed_record, name_field="employee_name")
        case "apply-performance-reviews":
            return repo.apply_generic_seeds(plan=plan, confirm=options.get("confirm"), expected_confirm="导入绩效", resource="hr.performance", table="performance_reviews", normalizer=normalize_performance_review_seed_record, payload_builder=generic_payload, select=performance_review_select(), existing_finder=lambda record: repo.find_existing_by_employee_fields("performance_reviews", performance_review_select(), record, [], ["review_date"]), label="performance_review")
        case "verify-performance-reviews":
            return repo.verify_generic_seeds(plan=plan, resource="hr.performance", normalizer=normalize_performance_review_seed_record, fields=[], existing_finder=lambda record: repo.find_existing_by_employee_fields("performance_reviews", performance_review_select(), record, [], ["review_date"]), label="performance_review")
        case "preview-insurance-changes":
            return repo.preview_generic_seeds(plan=plan, resource="hr.insurance", normalizer=normalize_named_employee_record, name_field="employee_name")
        case "apply-insurance-changes":
            return repo.apply_generic_seeds(plan=plan, confirm=options.get("confirm"), expected_confirm="导入社医保异动", resource="hr.insurance", table="insurance_changes", normalizer=normalize_named_employee_record, payload_builder=generic_payload, select=insurance_change_select(), existing_finder=lambda record: repo.find_existing_by_employee_fields("insurance_changes", insurance_change_select(), record, [], ["change_date", "status"]), label="insurance_change")
        case "verify-insurance-changes":
            return repo.verify_generic_seeds(plan=plan, resource="hr.insurance", normalizer=normalize_named_employee_record, fields=[], existing_finder=lambda record: repo.find_existing_by_employee_fields("insurance_changes", insurance_change_select(), record, [], ["change_date", "status"]), label="insurance_change")
        case "preview-personnel-changes":
            return repo.preview_generic_seeds(plan=plan, resource="hr.personnel_change", normalizer=normalize_named_employee_record, name_field="employee_name")
        case "apply-personnel-changes":
            return repo.apply_generic_seeds(plan=plan, confirm=options.get("confirm"), expected_confirm="导入人事异动", resource="hr.personnel_change", table="personnel_changes", normalizer=normalize_named_employee_record, payload_builder=generic_payload, select=personnel_change_select(), existing_finder=lambda record: repo.find_existing_by_employee_fields("personnel_changes", personnel_change_select(), record, ["change_reason"], ["effective_date", "current_department", "current_position"]), label="personnel_change")
        case "verify-personnel-changes":
            return repo.verify_generic_seeds(plan=plan, resource="hr.personnel_change", normalizer=normalize_named_employee_record, fields=[], existing_finder=lambda record: repo.find_existing_by_employee_fields("personnel_changes", personnel_change_select(), record, ["change_reason"], ["effective_date", "current_department", "current_position"]), label="personnel_change")
        case "preview-disciplinary-records":
            return repo.preview_generic_seeds(plan=plan, resource="hr.disciplinary", normalizer=normalize_named_employee_record, name_field="employee_name")
        case "apply-disciplinary-records":
            return repo.apply_generic_seeds(plan=plan, confirm=options.get("confirm"), expected_confirm="导入奖惩记录", resource="hr.disciplinary", table="disciplinary_records", normalizer=normalize_named_employee_record, payload_builder=disciplinary_record_payload, select=disciplinary_record_select(), existing_finder=lambda record: repo.find_existing_by_employee_fields("disciplinary_records", disciplinary_record_select(), record, ["penalty_type", "penalty_reason"], ["incident_dates"]), label="disciplinary_record")
        case "verify-disciplinary-records":
            return repo.verify_generic_seeds(plan=plan, resource="hr.disciplinary", normalizer=normalize_named_employee_record, fields=[], existing_finder=lambda record: repo.find_existing_by_employee_fields("disciplinary_records", disciplinary_record_select(), record, ["penalty_type", "penalty_reason"], ["incident_dates"]), label="disciplinary_record")
        case "preview-seal-usage":
            return repo.preview_seal_usage_seeds(plan=plan)
        case "apply-seal-usage":
            return repo.apply_seal_usage_seeds(plan=plan, confirm=options.get("confirm"))
        case "verify-seal-usage":
            return repo.verify_seal_usage_seeds(plan=plan)
        case "apply-employee-nickname-cleanup":
            return repo.apply_employee_nickname_cleanup(plan=plan, confirm=options.get("confirm"))
        case "verify-employee-nickname-cleanup":
            return repo.verify_employee_nickname_cleanup(plan=plan)
        case "apply-disciplinary-attachments":
            return repo.apply_disciplinary_attachments(plan=plan, confirm=options.get("confirm"))
        case "verify-disciplinary-attachments":
            return repo.verify_disciplinary_attachments(plan=plan)
        case _:
            raise RuntimeError(f"Unknown command: {command or '(empty)'}. Run \"help\" to list commands.")


def apply_scoped_company_default(command: str | None, options: dict[str, Any], policy: Any) -> None:
    if not command or options.get("company") or policy.unrestricted:
        return
    if command not in AUTO_SCOPED_COMPANY_COMMANDS:
        return
    if len(policy.company_scope) == 1:
        options["company"] = policy.company_scope[0]


def scoped_company_names(options: dict[str, Any]) -> list[str] | None:
    if options.get("company"):
        return None
    policy = load_access_policy()
    if policy.unrestricted:
        return None
    return policy.company_scope


def employee_lookup_options(options: dict[str, Any]) -> dict[str, Any]:
    return {
        "id_card": options.get("id-card"),
        "phone": options.get("phone"),
        "name": options.get("name"),
        "company_name": options.get("company"),
        "department_name": options.get("department"),
    }


def find_employee(repo: HrRepository, options: dict[str, Any]) -> Any:
    company_names = scoped_company_names(options)
    if options.get("id-card"):
        return repo.find_employee_by_id_card(options.get("id-card"), company_name=options.get("company"), company_names=company_names)
    if options.get("phone"):
        return repo.find_employee_by_phone(options.get("phone"), company_name=options.get("company"), company_names=company_names)
    return repo.find_employee_candidates(name=options.get("name"), company_name=options.get("company"), company_names=company_names, department_name=options.get("department"))


def normalize_business_command(parsed: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    action = parsed["positionals"][0] if parsed["positionals"] else ""
    resource = parsed["positionals"][1] if len(parsed["positionals"]) > 1 else ""
    options = dict(parsed["options"])
    aliases = {
        "query:company": "list-companies",
        "query:companies": "list-companies",
        "query:organization-tree": "organization-tree",
        "query:organization": "organization-tree",
        "query:organizations": "organization-tree",
        "query:employee": "list-employees",
        "query:employees": "list-employees",
        "get:employee": "employee-detail",
        "query:employee-contracts": "contracts-by-employee",
        "query:employee-timeline": "employee-timeline",
        "query:departments": "list-departments",
        "get:department": "find-department",
        "query:performance": "performance-by-month",
        "query:performance-by-employee": "performance-by-employee",
        "query:insurance": "insurance-by-month",
        "query:insurance-by-employee": "insurance-by-employee",
        "query:personnel-change": "personnel-changes-list",
        "query:personnel-changes": "personnel-changes-list",
        "query:personnel-change-by-employee": "personnel-changes-by-employee",
        "query:disciplinary": "disciplinary-by-employee" if options.get("name") else "analyze-disciplinary",
        "query:seal-usage": "seal-usage-list",
        "analyze:headcount": "analyze-headcount",
        "analyze:employee-summary": "employee-summary",
        "analyze:contract-coverage": "analyze-contract-coverage",
        "analyze:contract-expiry": "analyze-contract-expiry",
        "analyze:performance": "analyze-performance-month",
        "analyze:low-performance": "analyze-low-performance",
        "analyze:insurance": "analyze-insurance-month",
        "analyze:disciplinary": "analyze-disciplinary",
        "preview:employee": "preview-employees",
        "preview:employees": "preview-employees",
        "create:employee": "apply-employees",
        "create:employees": "apply-employees",
        "verify:employee": "verify-employees",
        "verify:employees": "verify-employees",
        "preview:contract": "preview-contracts",
        "preview:contracts": "preview-contracts",
        "create:contract": "apply-contracts",
        "create:contracts": "apply-contracts",
        "verify:contract": "verify-contracts",
        "verify:contracts": "verify-contracts",
        "preview:performance": "preview-performance-reviews",
        "create:performance": "apply-performance-reviews",
        "verify:performance": "verify-performance-reviews",
        "preview:insurance": "preview-insurance-changes",
        "create:insurance": "apply-insurance-changes",
        "verify:insurance": "verify-insurance-changes",
        "preview:personnel-change": "preview-personnel-changes",
        "create:personnel-change": "apply-personnel-changes",
        "verify:personnel-change": "verify-personnel-changes",
        "preview:disciplinary": "preview-disciplinary-records",
        "create:disciplinary": "apply-disciplinary-records",
        "verify:disciplinary": "verify-disciplinary-records",
        "preview:seal-usage": "preview-seal-usage",
        "create:seal-usage": "apply-seal-usage",
        "verify:seal-usage": "verify-seal-usage",
        "preview:organization": "preview-org-seeds",
        "preview:department": "preview-org-seeds",
        "preview:departments": "preview-org-seeds",
        "create:organization": "apply-org-seeds",
        "create:department": "apply-org-seeds",
        "create:departments": "apply-org-seeds",
        "verify:organization": "verify-org-seeds",
        "verify:department": "verify-org-seeds",
        "verify:departments": "verify-org-seeds",
        "delete:employee": "delete-employee-records",
        "delete:employees": "delete-employee-records",
    }
    key = f"{action}:{resource}"
    command = aliases.get(key)
    if not command:
        raise RuntimeError(f"Unknown business command: business {' '.join(parsed['positionals'])}")
    if action in {"create", "update", "delete"}:
        options["confirm"] = options.get("confirm") or business_confirmation_for(command)
    return command, options


def business_confirmation_for(command: str) -> str | None:
    return {
        "apply-org-seeds": "创建公司和部门",
        "apply-employees": "导入员工主档",
        "apply-contracts": "导入合同",
        "apply-performance-reviews": "导入绩效",
        "apply-insurance-changes": "导入社医保异动",
        "apply-personnel-changes": "导入人事异动",
        "apply-disciplinary-records": "导入奖惩记录",
        "apply-seal-usage": "导入用章记录",
        "delete-employee-records": "删除员工记录",
    }.get(command)


def business_help(positionals: list[str] | None = None) -> dict[str, Any]:
    groups = [
        {
            "group": "Business query",
            "commands": [
                "business query companies",
                "business query organization-tree",
                "business query employee [--company <company>] [--status <status>]",
                "business get employee --name <name> [--company <company>]",
                "business query employee-contracts --name <name> [--company <company>]",
                "business query departments [--company <company>]",
            ],
        },
        {
            "group": "Business analysis",
            "commands": [
                "business analyze headcount",
                "business analyze employee-summary",
                "business analyze contract-coverage",
                "business analyze contract-expiry [--days 180]",
                "business analyze performance --month YYYY-MM [--company <company>]",
                "business analyze insurance --month YYYY-MM [--company <company>]",
                "business analyze disciplinary [--company <company>]",
            ],
        },
        {
            "group": "Business writes with confirmation",
            "commands": [
                "business preview employee --input <plan.json>",
                "business create employee --input <plan.json>",
                "business preview organization --input <plan.json>",
                "business create organization --input <plan.json>",
                "business delete employee --input <plan.json>",
            ],
        },
    ]
    filter_value = " ".join(positionals or []).strip()
    if filter_value:
        groups = [
            {**group, "commands": [command for command in group["commands"] if f"business {filter_value}" in command]}
            for group in groups
        ]
        groups = [group for group in groups if group["commands"]]
    return {
        "usage": "nanobot-webui-business hr business <query|get|analyze|preview|create|delete> <resource|topic> [options]",
        "rules": [
            "This is the scoped business command surface for WebUI tenant sessions.",
            "Run from workspace root: cd <workspace> && nanobot-webui-business hr business ...",
            "Omit --company to use the current account's authorized company scope automatically.",
            "For writes, run preview first; create performs the write and returns internal verification.",
        ],
        "groups": groups,
    }


def parse_args(argv: list[str]) -> dict[str, Any]:
    normalized = normalize_quoted_business_argv(argv)
    command = normalized[0] if normalized else None
    rest = normalized[1:] if normalized else []
    options: dict[str, Any] = {}
    positionals: list[str] = []
    index = 0
    while index < len(rest):
        token = rest[index]
        if not token.startswith("--"):
            positionals.append(token)
            index += 1
            continue
        key = token[2:]
        next_value = rest[index + 1] if index + 1 < len(rest) else None
        if not next_value or next_value.startswith("--"):
            options[key] = True
            index += 1
        else:
            options[key] = next_value
            index += 2
    return {"command": command, "positionals": positionals, "options": options}


def normalize_quoted_business_argv(argv: list[str]) -> list[str]:
    if argv and argv[0].startswith("business "):
        return [*argv[0].split(), *argv[1:]]
    return argv


def read_json(file_path: str | None) -> Any:
    if not file_path:
        raise RuntimeError("--input is required")
    with open(file_path, encoding="utf-8") as file:
        return json.load(file)


def print_json(payload: dict[str, Any], *, stream: Any = sys.stdout) -> None:
    print(json.dumps(payload, ensure_ascii=False, indent=2), file=stream)
