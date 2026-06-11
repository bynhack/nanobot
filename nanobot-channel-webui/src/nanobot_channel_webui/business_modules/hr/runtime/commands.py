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
    CONTRACT_WRITABLE_FIELDS,
    DISCIPLINARY_RECORD_WRITABLE_FIELDS,
    INSURANCE_CHANGE_WRITABLE_FIELDS,
    PERFORMANCE_REVIEW_WRITABLE_FIELDS,
    PERSONNEL_CHANGE_WRITABLE_FIELDS,
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
    normalize_personnel_change_record,
    performance_review_select,
    personnel_change_select,
)

AUTO_SCOPED_COMPANY_COMMANDS = SCOPED_MULTI_COMPANY_COMMANDS

UPDATE_CONFIRMATIONS = {
    "update-org-seeds": "更新公司和部门",
    "update-employees": "更新员工主档",
    "update-contracts": "更新合同",
    "update-performance-reviews": "更新绩效",
    "update-insurance-changes": "更新社医保异动",
    "update-personnel-changes": "更新人事异动",
    "update-disciplinary-records": "更新奖惩记录",
    "update-seal-usage": "更新用章记录",
}


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
        case "business-capabilities":
            return business_capabilities()
        case "business-plan-schema":
            return business_plan_schema(resource=options.get("resource"), workflow=options.get("workflow"))
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
        case "deleted-records":
            return repo.deleted_records(resource=options.get("resource"), company_name=options.get("company"), company_names=scoped, limit=options.get("limit"))
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
        case "preview-update-org-seeds":
            return repo.preview_org_updates(plan=plan, company_name=options.get("company"))
        case "update-org-seeds":
            return repo.apply_org_updates(plan=plan, company_name=options.get("company"), confirm=options.get("confirm"))
        case "delete-empty-departments":
            return repo.delete_empty_departments(plan=plan, confirm=options.get("confirm"))
        case "preview-employees":
            return repo.preview_employee_seeds(plan=plan)
        case "apply-employees":
            return repo.apply_employee_seeds(plan=plan, confirm=options.get("confirm"))
        case "verify-employees":
            return repo.verify_employee_seeds(plan=plan)
        case "preview-update-employees":
            return repo.preview_employee_updates(plan=plan)
        case "update-employees":
            return repo.apply_employee_updates(plan=plan, confirm=options.get("confirm"))
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
        case "preview-update-contracts":
            return repo.preview_generic_updates(plan=plan, resource="hr.contract", table="contracts", normalizer=normalize_contract_seed_record, payload_builder=contract_payload, select=contract_select(), record_finder=repo.find_update_contract, label="contract", update_fields=CONTRACT_WRITABLE_FIELDS, key_fields=["type", "sequence", "start_date"])
        case "update-contracts":
            return repo.apply_generic_updates(plan=plan, confirm=options.get("confirm"), expected_confirm="更新合同", resource="hr.contract", table="contracts", normalizer=normalize_contract_seed_record, payload_builder=contract_payload, select=contract_select(), record_finder=repo.find_update_contract, label="contract", update_fields=CONTRACT_WRITABLE_FIELDS, key_fields=["type", "sequence", "start_date"])
        case "delete-contracts":
            return repo.delete_generic_employee_records(plan=plan, confirm=options.get("confirm"), expected_confirm="删除合同", resource="hr.contract", table="contracts", normalizer=normalize_contract_seed_record, record_finder=repo.find_update_contract, label="contract")
        case "preview-performance-reviews":
            return repo.preview_generic_seeds(plan=plan, resource="hr.performance", normalizer=normalize_performance_review_seed_record, name_field="employee_name")
        case "apply-performance-reviews":
            return repo.apply_generic_seeds(plan=plan, confirm=options.get("confirm"), expected_confirm="导入绩效", resource="hr.performance", table="performance_reviews", normalizer=normalize_performance_review_seed_record, payload_builder=generic_payload, select=performance_review_select(), existing_finder=lambda record: repo.find_existing_by_employee_fields("performance_reviews", performance_review_select(), record, [], ["review_date"]), label="performance_review")
        case "verify-performance-reviews":
            return repo.verify_generic_seeds(plan=plan, resource="hr.performance", normalizer=normalize_performance_review_seed_record, fields=[], existing_finder=lambda record: repo.find_existing_by_employee_fields("performance_reviews", performance_review_select(), record, [], ["review_date"]), label="performance_review")
        case "preview-update-performance-reviews":
            return repo.preview_generic_updates(plan=plan, resource="hr.performance", table="performance_reviews", normalizer=normalize_performance_review_seed_record, payload_builder=generic_payload, select=performance_review_select(), record_finder=lambda record: repo.find_update_by_employee_fields("performance_reviews", performance_review_select(), record, ["review_date"]), label="performance_review", update_fields=PERFORMANCE_REVIEW_WRITABLE_FIELDS, key_fields=["review_date"])
        case "update-performance-reviews":
            return repo.apply_generic_updates(plan=plan, confirm=options.get("confirm"), expected_confirm="更新绩效", resource="hr.performance", table="performance_reviews", normalizer=normalize_performance_review_seed_record, payload_builder=generic_payload, select=performance_review_select(), record_finder=lambda record: repo.find_update_by_employee_fields("performance_reviews", performance_review_select(), record, ["review_date"]), label="performance_review", update_fields=PERFORMANCE_REVIEW_WRITABLE_FIELDS, key_fields=["review_date"])
        case "delete-performance-reviews":
            return repo.delete_generic_employee_records(plan=plan, confirm=options.get("confirm"), expected_confirm="删除绩效", resource="hr.performance", table="performance_reviews", normalizer=normalize_performance_review_seed_record, record_finder=lambda record: repo.find_update_by_employee_fields("performance_reviews", performance_review_select(), record, ["review_date"]), label="performance_review")
        case "preview-insurance-changes":
            return repo.preview_generic_seeds(plan=plan, resource="hr.insurance", normalizer=normalize_named_employee_record, name_field="employee_name")
        case "apply-insurance-changes":
            return repo.apply_generic_seeds(plan=plan, confirm=options.get("confirm"), expected_confirm="导入社医保异动", resource="hr.insurance", table="insurance_changes", normalizer=normalize_named_employee_record, payload_builder=generic_payload, select=insurance_change_select(), existing_finder=lambda record: repo.find_existing_by_employee_fields("insurance_changes", insurance_change_select(), record, [], ["change_date", "status"]), label="insurance_change")
        case "verify-insurance-changes":
            return repo.verify_generic_seeds(plan=plan, resource="hr.insurance", normalizer=normalize_named_employee_record, fields=[], existing_finder=lambda record: repo.find_existing_by_employee_fields("insurance_changes", insurance_change_select(), record, [], ["change_date", "status"]), label="insurance_change")
        case "preview-update-insurance-changes":
            return repo.preview_generic_updates(plan=plan, resource="hr.insurance", table="insurance_changes", normalizer=normalize_named_employee_record, payload_builder=generic_payload, select=insurance_change_select(), record_finder=lambda record: repo.find_update_by_employee_fields("insurance_changes", insurance_change_select(), record, ["change_date", "status"]), label="insurance_change", update_fields=INSURANCE_CHANGE_WRITABLE_FIELDS, key_fields=["change_date", "status"])
        case "update-insurance-changes":
            return repo.apply_generic_updates(plan=plan, confirm=options.get("confirm"), expected_confirm="更新社医保异动", resource="hr.insurance", table="insurance_changes", normalizer=normalize_named_employee_record, payload_builder=generic_payload, select=insurance_change_select(), record_finder=lambda record: repo.find_update_by_employee_fields("insurance_changes", insurance_change_select(), record, ["change_date", "status"]), label="insurance_change", update_fields=INSURANCE_CHANGE_WRITABLE_FIELDS, key_fields=["change_date", "status"])
        case "delete-insurance-changes":
            return repo.delete_generic_employee_records(plan=plan, confirm=options.get("confirm"), expected_confirm="删除社医保异动", resource="hr.insurance", table="insurance_changes", normalizer=normalize_named_employee_record, record_finder=lambda record: repo.find_update_by_employee_fields("insurance_changes", insurance_change_select(), record, ["change_date", "status"]), label="insurance_change")
        case "preview-personnel-changes":
            return repo.preview_generic_seeds(plan=plan, resource="hr.personnel_change", normalizer=normalize_personnel_change_record, name_field="employee_name")
        case "apply-personnel-changes":
            return repo.apply_generic_seeds(plan=plan, confirm=options.get("confirm"), expected_confirm="导入人事异动", resource="hr.personnel_change", table="personnel_changes", normalizer=normalize_personnel_change_record, payload_builder=generic_payload, select=personnel_change_select(), existing_finder=lambda record: repo.find_existing_by_employee_fields("personnel_changes", personnel_change_select(), record, ["change_reason"], ["effective_date", "current_department", "current_position"]), label="personnel_change")
        case "verify-personnel-changes":
            return repo.verify_generic_seeds(plan=plan, resource="hr.personnel_change", normalizer=normalize_personnel_change_record, fields=[], existing_finder=lambda record: repo.find_existing_by_employee_fields("personnel_changes", personnel_change_select(), record, ["change_reason"], ["effective_date", "current_department", "current_position"]), label="personnel_change")
        case "preview-update-personnel-changes":
            return repo.preview_generic_updates(plan=plan, resource="hr.personnel_change", table="personnel_changes", normalizer=normalize_personnel_change_record, payload_builder=generic_payload, select=personnel_change_select(), record_finder=repo.find_update_personnel_change, label="personnel_change", update_fields=PERSONNEL_CHANGE_WRITABLE_FIELDS, key_fields=["effective_date", "current_department", "current_position", "change_reason"])
        case "update-personnel-changes":
            return repo.apply_generic_updates(plan=plan, confirm=options.get("confirm"), expected_confirm="更新人事异动", resource="hr.personnel_change", table="personnel_changes", normalizer=normalize_personnel_change_record, payload_builder=generic_payload, select=personnel_change_select(), record_finder=repo.find_update_personnel_change, label="personnel_change", update_fields=PERSONNEL_CHANGE_WRITABLE_FIELDS, key_fields=["effective_date", "current_department", "current_position", "change_reason"])
        case "delete-personnel-changes":
            return repo.delete_generic_employee_records(plan=plan, confirm=options.get("confirm"), expected_confirm="删除人事异动", resource="hr.personnel_change", table="personnel_changes", normalizer=normalize_personnel_change_record, record_finder=repo.find_update_personnel_change, label="personnel_change")
        case "preview-disciplinary-records":
            return repo.preview_generic_seeds(plan=plan, resource="hr.disciplinary", normalizer=normalize_named_employee_record, name_field="employee_name")
        case "apply-disciplinary-records":
            return repo.apply_generic_seeds(plan=plan, confirm=options.get("confirm"), expected_confirm="导入奖惩记录", resource="hr.disciplinary", table="disciplinary_records", normalizer=normalize_named_employee_record, payload_builder=disciplinary_record_payload, select=disciplinary_record_select(), existing_finder=lambda record: repo.find_existing_by_employee_fields("disciplinary_records", disciplinary_record_select(), record, ["penalty_type", "penalty_reason"], ["incident_dates"]), label="disciplinary_record")
        case "verify-disciplinary-records":
            return repo.verify_generic_seeds(plan=plan, resource="hr.disciplinary", normalizer=normalize_named_employee_record, fields=[], existing_finder=lambda record: repo.find_existing_by_employee_fields("disciplinary_records", disciplinary_record_select(), record, ["penalty_type", "penalty_reason"], ["incident_dates"]), label="disciplinary_record")
        case "preview-update-disciplinary-records":
            return repo.preview_generic_updates(plan=plan, resource="hr.disciplinary", table="disciplinary_records", normalizer=normalize_named_employee_record, payload_builder=disciplinary_record_payload, select=disciplinary_record_select(), record_finder=lambda record: repo.find_update_by_employee_fields("disciplinary_records", disciplinary_record_select(), repo.normalize_disciplinary_update_record(record), ["incident_dates", "penalty_type"]), label="disciplinary_record", update_fields=DISCIPLINARY_RECORD_WRITABLE_FIELDS, key_fields=["incident_date", "incident_dates", "penalty_type"])
        case "update-disciplinary-records":
            return repo.apply_generic_updates(plan=plan, confirm=options.get("confirm"), expected_confirm="更新奖惩记录", resource="hr.disciplinary", table="disciplinary_records", normalizer=normalize_named_employee_record, payload_builder=disciplinary_record_payload, select=disciplinary_record_select(), record_finder=lambda record: repo.find_update_by_employee_fields("disciplinary_records", disciplinary_record_select(), repo.normalize_disciplinary_update_record(record), ["incident_dates", "penalty_type"]), label="disciplinary_record", update_fields=DISCIPLINARY_RECORD_WRITABLE_FIELDS, key_fields=["incident_date", "incident_dates", "penalty_type"])
        case "delete-disciplinary-records":
            return repo.delete_generic_employee_records(plan=plan, confirm=options.get("confirm"), expected_confirm="删除奖惩记录", resource="hr.disciplinary", table="disciplinary_records", normalizer=normalize_named_employee_record, record_finder=lambda record: repo.find_update_by_employee_fields("disciplinary_records", disciplinary_record_select(), repo.normalize_disciplinary_update_record(record), ["incident_dates", "penalty_type"]), label="disciplinary_record")
        case "preview-seal-usage":
            return repo.preview_seal_usage_seeds(plan=plan)
        case "apply-seal-usage":
            return repo.apply_seal_usage_seeds(plan=plan, confirm=options.get("confirm"))
        case "verify-seal-usage":
            return repo.verify_seal_usage_seeds(plan=plan)
        case "preview-update-seal-usage":
            return repo.preview_seal_usage_updates(plan=plan)
        case "update-seal-usage":
            return repo.apply_seal_usage_updates(plan=plan, confirm=options.get("confirm"))
        case "delete-seal-usage":
            return repo.delete_seal_usage_records(plan=plan, confirm=options.get("confirm"))
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
    if action == "schema" and resource:
        options["resource"] = resource
        return "business-plan-schema", options
    aliases = business_command_aliases(options)
    key = f"{action}:{resource}"
    command = aliases.get(key)
    if not command:
        raise RuntimeError(f"Unknown business command: business {' '.join(parsed['positionals'])}")
    if action in {"create", "update", "delete"}:
        options["confirm"] = options.get("confirm") or business_confirmation_for(command)
    return command, options


def business_command_aliases(options: dict[str, Any] | None = None) -> dict[str, str]:
    options = options or {}
    return {
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
        "query:deleted-records": "deleted-records",
        "capabilities:": "business-capabilities",
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
        "preview-update:employee": "preview-update-employees",
        "preview-update:employees": "preview-update-employees",
        "update:employee": "update-employees",
        "update:employees": "update-employees",
        "preview:contract": "preview-contracts",
        "preview:contracts": "preview-contracts",
        "create:contract": "apply-contracts",
        "create:contracts": "apply-contracts",
        "verify:contract": "verify-contracts",
        "verify:contracts": "verify-contracts",
        "preview-update:contract": "preview-update-contracts",
        "preview-update:contracts": "preview-update-contracts",
        "update:contract": "update-contracts",
        "update:contracts": "update-contracts",
        "preview:performance": "preview-performance-reviews",
        "create:performance": "apply-performance-reviews",
        "verify:performance": "verify-performance-reviews",
        "preview-update:performance": "preview-update-performance-reviews",
        "update:performance": "update-performance-reviews",
        "preview:insurance": "preview-insurance-changes",
        "create:insurance": "apply-insurance-changes",
        "verify:insurance": "verify-insurance-changes",
        "preview-update:insurance": "preview-update-insurance-changes",
        "update:insurance": "update-insurance-changes",
        "preview:personnel-change": "preview-personnel-changes",
        "create:personnel-change": "apply-personnel-changes",
        "verify:personnel-change": "verify-personnel-changes",
        "preview-update:personnel-change": "preview-update-personnel-changes",
        "update:personnel-change": "update-personnel-changes",
        "preview:disciplinary": "preview-disciplinary-records",
        "create:disciplinary": "apply-disciplinary-records",
        "verify:disciplinary": "verify-disciplinary-records",
        "preview-update:disciplinary": "preview-update-disciplinary-records",
        "update:disciplinary": "update-disciplinary-records",
        "preview:seal-usage": "preview-seal-usage",
        "create:seal-usage": "apply-seal-usage",
        "verify:seal-usage": "verify-seal-usage",
        "preview-update:seal-usage": "preview-update-seal-usage",
        "update:seal-usage": "update-seal-usage",
        "preview:organization": "preview-org-seeds",
        "preview:department": "preview-org-seeds",
        "preview:departments": "preview-org-seeds",
        "create:organization": "apply-org-seeds",
        "create:department": "apply-org-seeds",
        "create:departments": "apply-org-seeds",
        "verify:organization": "verify-org-seeds",
        "verify:department": "verify-org-seeds",
        "verify:departments": "verify-org-seeds",
        "preview-update:organization": "preview-update-org-seeds",
        "preview-update:department": "preview-update-org-seeds",
        "preview-update:departments": "preview-update-org-seeds",
        "update:organization": "update-org-seeds",
        "update:department": "update-org-seeds",
        "update:departments": "update-org-seeds",
        "delete:employee": "delete-employee-records",
        "delete:employees": "delete-employee-records",
        "delete:contract": "delete-contracts",
        "delete:contracts": "delete-contracts",
        "delete:performance": "delete-performance-reviews",
        "delete:performance-review": "delete-performance-reviews",
        "delete:performance-reviews": "delete-performance-reviews",
        "delete:insurance": "delete-insurance-changes",
        "delete:insurance-change": "delete-insurance-changes",
        "delete:insurance-changes": "delete-insurance-changes",
        "delete:personnel-change": "delete-personnel-changes",
        "delete:personnel-changes": "delete-personnel-changes",
        "delete:disciplinary": "delete-disciplinary-records",
        "delete:disciplinary-record": "delete-disciplinary-records",
        "delete:disciplinary-records": "delete-disciplinary-records",
        "delete:seal-usage": "delete-seal-usage",
    }


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
        "delete-contracts": "删除合同",
        "delete-performance-reviews": "删除绩效",
        "delete-insurance-changes": "删除社医保异动",
        "delete-personnel-changes": "删除人事异动",
        "delete-disciplinary-records": "删除奖惩记录",
        "delete-seal-usage": "删除用章记录",
        **UPDATE_CONFIRMATIONS,
    }.get(command)


def plan_field(name: str, description: str, *, required_for_create: bool = False, match_key: bool = False, writable: bool = True) -> dict[str, Any]:
    return {
        "name": name,
        "description": description,
        "required_for_create": required_for_create,
        "match_key": match_key,
        "writable": writable,
    }


PLAN_SCHEMA_CONTRACTS: dict[str, dict[str, Any]] = {
    "organization": {
        "table": "companies/departments",
        "fields": [
            plan_field("company", "公司全称；创建部门时用于定位所属公司。", required_for_create=True, match_key=True),
            plan_field("short_name", "公司简称。"),
            plan_field("department", "部门名称；创建或更新部门时使用。", match_key=True),
            plan_field("new_department", "更新部门名称时的新部门名称。"),
            plan_field("notes", "备注。"),
        ],
        "aliases": {"company_name": "company", "department_name": "department", "new_name": "new_department"},
        "create_example": {"company": "武汉赢城集团有限公司", "department": "行政部"},
        "update_example": {"company": "武汉赢城集团有限公司", "department": "行政部", "new_department": "人力行政部"},
    },
    "department": {
        "alias_of": "organization",
    },
    "employee": {
        "table": "employees",
        "fields": [
            plan_field("company", "公司全称，用于权限、公司匹配和员工匹配。", required_for_create=True, match_key=True),
            plan_field("name", "员工姓名；必须按用户原文完整保留。", required_for_create=True, match_key=True),
            plan_field("department", "部门名称。", required_for_create=True),
            plan_field("position", "岗位。"),
            plan_field("phone", "手机号；更新手机号时表示新手机号，旧手机号可用 match_phone。", match_key=True),
            plan_field("match_phone", "旧手机号，仅用于更新时匹配既有员工。", match_key=True, writable=False),
            plan_field("id_card_number", "身份证号；更新身份证号时表示新证件号，旧证件号可用 match_id_card_number。", match_key=True),
            plan_field("match_id_card_number", "旧身份证号，仅用于更新时匹配既有员工。", match_key=True, writable=False),
            plan_field("hire_date", "入职日期，格式 YYYY-MM-DD。"),
            plan_field("status", "员工状态，例如 正式、试用、离职。"),
            plan_field("notes", "备注。"),
        ],
        "aliases": {"employee_name": "name", "employee": "name", "id_card": "id_card_number", "household_address": "hukou_address", "remark": "notes", "employment_status": "status"},
        "create_example": {"company": "武汉赢城集团有限公司", "name": "张三", "department": "行政部", "position": "人事专员", "phone": "13800000000", "hire_date": "2026-06-10", "status": "正式"},
        "update_example": {"company": "武汉赢城集团有限公司", "name": "张三", "match_phone": "13800000000", "phone": "13900000000", "position": "高级人事专员"},
    },
    "contract": {
        "table": "contracts",
        "fields": [
            plan_field("company", "公司全称，用于权限和员工匹配。", required_for_create=True, match_key=True),
            plan_field("employee_name", "员工姓名，用于匹配员工主档。", required_for_create=True, match_key=True),
            plan_field("type", "合同类型。", required_for_create=True, match_key=True),
            plan_field("sequence", "合同序号；用于区分同员工多份合同。", match_key=True),
            plan_field("start_date", "合同开始日期，格式 YYYY-MM-DD。", required_for_create=True, match_key=True),
            plan_field("expiry_date", "合同到期日期，格式 YYYY-MM-DD。"),
            plan_field("sign_date", "签订日期，格式 YYYY-MM-DD。"),
            plan_field("duration_years", "合同期限年数。"),
            plan_field("notes", "备注。"),
        ],
        "aliases": {"name": "employee_name", "employee": "employee_name", "contract_type": "type", "contract_start": "start_date", "contract_end": "expiry_date", "end_date": "expiry_date", "remark": "notes"},
        "create_example": {"company": "武汉赢城集团有限公司", "employee_name": "张三", "type": "固定期限劳动合同", "sequence": 1, "start_date": "2026-06-10", "expiry_date": "2029-06-09"},
        "update_example": {"company": "武汉赢城集团有限公司", "employee_name": "张三", "type": "固定期限劳动合同", "sequence": 1, "expiry_date": "2029-12-31"},
    },
    "performance": {
        "table": "performance_reviews",
        "fields": [
            plan_field("company", "公司全称，用于权限和员工匹配。", required_for_create=True, match_key=True),
            plan_field("employee_name", "员工姓名，用于匹配员工主档。", required_for_create=True, match_key=True),
            plan_field("review_date", "考核日期，格式 YYYY-MM-DD；用户只说月份时可用 review_month。", required_for_create=True, match_key=True),
            plan_field("review_month", "自然语言月份别名，格式 YYYY-MM，会归一化为 review_date 的月初。", match_key=True, writable=False),
            plan_field("self_score", "自评分；若只提供 final_score，CLI 会补齐。"),
            plan_field("supervisor_score", "主管评分；若只提供 final_score，CLI 会补齐。"),
            plan_field("final_score", "最终绩效得分。"),
            plan_field("performance_salary", "绩效工资。"),
            plan_field("notes", "备注。"),
        ],
        "aliases": {"name": "employee_name", "employee": "employee_name", "month": "review_date", "review_month": "review_date", "score": "final_score", "remark": "notes"},
        "create_example": {"company": "武汉赢城集团有限公司", "employee_name": "张三", "review_month": "2026-06", "final_score": 96, "performance_salary": 1200},
        "update_example": {"company": "武汉赢城集团有限公司", "employee_name": "张三", "review_month": "2026-06", "final_score": 98, "performance_salary": 1500},
    },
    "insurance": {
        "table": "insurance_changes",
        "fields": [
            plan_field("company", "公司全称，用于权限和员工匹配。", required_for_create=True, match_key=True),
            plan_field("employee_name", "员工姓名，用于匹配员工主档。", required_for_create=True, match_key=True),
            plan_field("change_date", "社医保异动日期，格式 YYYY-MM-DD。", required_for_create=True, match_key=True),
            plan_field("status", "异动状态，例如 新增、停缴。", required_for_create=True, match_key=True),
            plan_field("signed_upload", "签字附件列表。"),
            plan_field("hr_clerk", "经办 HR。"),
            plan_field("notes", "备注。"),
        ],
        "aliases": {"name": "employee_name", "employee": "employee_name", "remark": "notes"},
        "create_example": {"company": "武汉赢城集团有限公司", "employee_name": "张三", "change_date": "2026-06-10", "status": "新增", "signed_upload": ["社保确认单.pdf"]},
        "update_example": {"company": "武汉赢城集团有限公司", "employee_name": "张三", "change_date": "2026-06-10", "status": "新增", "signed_upload": ["社保复核单.pdf"]},
    },
    "personnel-change": {
        "table": "personnel_changes",
        "fields": [
            plan_field("company", "公司全称，用于权限和员工匹配。", required_for_create=True, match_key=True),
            plan_field("employee_name", "员工姓名，用于匹配员工主档。", required_for_create=True, match_key=True),
            plan_field("effective_date", "异动生效日期，格式 YYYY-MM-DD。", required_for_create=True, match_key=True),
            plan_field("change_date", "自然语言别名，会归一化为 effective_date。", match_key=True, writable=False),
            plan_field("current_position", "原岗位；可用于匹配旧记录。", match_key=True),
            plan_field("new_position", "新岗位；更新时表示要写入的新值，旧新岗位请用 match_new_position。"),
            plan_field("match_new_position", "旧的新岗位，仅用于更新时匹配既有异动记录。", match_key=True, writable=False),
            plan_field("change_reason", "异动原因；更新时表示要写入的新原因。", required_for_create=True),
            plan_field("match_change_reason", "旧异动原因，仅用于更新时匹配。", match_key=True, writable=False),
            plan_field("change_type", "自然语言旧异动原因别名，更新时会归一化为 match_change_reason。", match_key=True, writable=False),
            plan_field("notes", "备注。"),
        ],
        "aliases": {"name": "employee_name", "employee": "employee_name", "change_date": "effective_date", "change_type": "match_change_reason", "old_reason": "match_change_reason", "current_reason": "match_change_reason", "remark": "notes"},
        "create_example": {"company": "武汉赢城集团有限公司", "employee_name": "张三", "change_date": "2026-06-11", "current_position": "人事助理", "new_position": "人事专员", "change_reason": "转正"},
        "update_example": {"company": "武汉赢城集团有限公司", "employee_name": "张三", "change_date": "2026-06-11", "current_position": "人事助理", "change_type": "转正", "new_position": "高级人事专员", "change_reason": "转正后定岗"},
    },
    "disciplinary": {
        "table": "disciplinary_records",
        "fields": [
            plan_field("company", "公司全称，用于权限和员工匹配。", required_for_create=True, match_key=True),
            plan_field("employee_name", "员工姓名，用于匹配员工主档。", required_for_create=True, match_key=True),
            plan_field("incident_date", "奖惩发生日期，格式 YYYY-MM-DD；会写入数据库 incident_dates 数组。", required_for_create=True, match_key=True),
            plan_field("match_incident_date", "旧发生日期，仅用于更新时匹配。", match_key=True, writable=False),
            plan_field("penalty_type", "奖惩类型。", required_for_create=True, match_key=True),
            plan_field("penalty_reason", "奖惩原因。", required_for_create=True, match_key=True),
            plan_field("signed_upload", "签字附件列表。"),
            plan_field("hr_clerk", "经办 HR。"),
        ],
        "aliases": {"name": "employee_name", "employee": "employee_name", "incident_dates": "incident_date"},
        "create_example": {"company": "武汉赢城集团有限公司", "employee_name": "张三", "incident_date": "2026-06-10", "penalty_type": "警告", "penalty_reason": "迟到"},
        "update_example": {"company": "武汉赢城集团有限公司", "employee_name": "张三", "match_incident_date": "2026-06-10", "incident_date": "2026-06-11", "penalty_type": "通报", "penalty_reason": "实测更新"},
    },
    "seal-usage": {
        "table": "seal_usage",
        "fields": [
            plan_field("company", "公司全称，用于权限和用章记录匹配。", required_for_create=True, match_key=True),
            plan_field("usage_date", "用章日期，格式 YYYY-MM-DD。", required_for_create=True, match_key=True),
            plan_field("reason", "用章事由；create 时是新事由，update 时可作为旧事由匹配。", required_for_create=True, match_key=True),
            plan_field("match_reason", "旧用章事由，仅用于更新时匹配。", match_key=True, writable=False),
            plan_field("current_reason", "旧用章事由别名，会归一化为 match_reason。", match_key=True, writable=False),
            plan_field("old_reason", "旧用章事由别名，会归一化为 match_reason。", match_key=True, writable=False),
            plan_field("new_reason", "新用章事由，更新时会写入 reason。"),
            plan_field("seal_applicant", "用章人姓名。", match_key=True),
            plan_field("seal_applicant_name", "用章人姓名别名，会归一化为 seal_applicant。", match_key=True, writable=False),
            plan_field("applicant", "申请人姓名。", match_key=True),
            plan_field("attachments", "附件列表。"),
            plan_field("notes", "备注。"),
        ],
        "aliases": {"current_reason": "match_reason", "old_reason": "match_reason", "new_reason": "reason", "seal_applicant_name": "seal_applicant", "applicant_name": "applicant", "remark": "notes"},
        "create_example": {"company": "武汉赢城集团有限公司", "usage_date": "2026-06-13", "seal_applicant_name": "张三", "reason": "合同盖章", "attachments": ["用章申请.pdf"]},
        "update_example": {"company": "武汉赢城集团有限公司", "usage_date": "2026-06-13", "current_reason": "普通账号流程验收", "new_reason": "普通账号更新流程验收", "attachments": ["验收复核申请.pdf"]},
    },
}


def resolve_plan_schema_resource(resource: str | None) -> str:
    normalized = (resource or "").strip()
    aliases = {
        "employees": "employee",
        "contracts": "contract",
        "performance-review": "performance",
        "performance-reviews": "performance",
        "insurance-change": "insurance",
        "insurance-changes": "insurance",
        "personnel-changes": "personnel-change",
        "disciplinary-record": "disciplinary",
        "disciplinary-records": "disciplinary",
        "seal_usage": "seal-usage",
        "departments": "department",
        "organization-tree": "organization",
    }
    normalized = aliases.get(normalized, normalized)
    definition = PLAN_SCHEMA_CONTRACTS.get(normalized)
    if definition and definition.get("alias_of"):
        return str(definition["alias_of"])
    return normalized


def business_plan_schema(*, resource: str | None, workflow: Any = None) -> dict[str, Any]:
    resolved = resolve_plan_schema_resource(resource)
    definition = PLAN_SCHEMA_CONTRACTS.get(resolved)
    if not definition:
        supported = sorted(name for name, item in PLAN_SCHEMA_CONTRACTS.items() if not item.get("alias_of"))
        raise RuntimeError(f"Unknown HR plan schema resource: {resource}. Supported: {', '.join(supported)}")
    workflow_name = str(workflow or "create").strip()
    if workflow_name not in {"create", "update"}:
        raise RuntimeError("business schema --workflow must be create or update")
    plan_example = definition[f"{workflow_name}_example"]
    write_command = "create" if workflow_name == "create" else "update"
    preview_command = "preview" if workflow_name == "create" else "preview-update"
    fields = definition["fields"]
    required_fields = [field["name"] for field in fields if field.get("required_for_create")]
    match_fields = [field["name"] for field in fields if field.get("match_key")]
    update_fields = [field["name"] for field in fields if field.get("writable")]
    return {
        "resource": resolved,
        "table": definition["table"],
        "workflow": workflow_name,
        "command_sequence": [
            f"business schema {resolved} --workflow {workflow_name}",
            f"business {preview_command} {resolved} --input <plan.json>",
            f"business {write_command} {resolved} --input <same-plan.json>",
        ],
        "fields": fields,
        "required_fields": required_fields,
        "match_fields": match_fields,
        "update_fields": update_fields,
        "accepted_aliases": definition["aliases"],
        "plan_example": plan_example,
        "workflow_rules": [
            "Write exactly one JSON plan using this schema contract before preview.",
            "Run preview or preview-update before asking the user to confirm.",
            "Use the same JSON plan for create or update after confirmation.",
            "Old values identify the existing row; new values are written.",
            "If matching is ambiguous or skipped, ask the user for a unique business key instead of trying delete/create.",
        ],
        "notes": [
            "Use this command before writing normal HR create/update plans.",
            "Prefer this business schema response over reading long hr-schema docs for routine plan drafting.",
            "hr-schema remains the fallback for unusual database field investigation, constraints, migrations, or cross-table mapping.",
        ],
    }


def business_command_catalog() -> dict[str, list[str]]:
    return {
        "query": [
            "business query companies",
            "business query organization-tree",
            "business query employee [--company <company>] [--status <status>]",
            "business get employee --name <name> [--company <company>]",
            "business query employee-timeline --name <name> [--company <company>]",
            "business query employee-contracts --name <name> [--company <company>]",
            "business query performance-by-employee --name <name> [--company <company>]",
            "business query performance --month YYYY-MM [--company <company>]",
            "business query insurance-by-employee --name <name> [--company <company>]",
            "business query insurance --month YYYY-MM [--company <company>]",
            "business query personnel-change-by-employee --name <name> [--company <company>]",
            "business query personnel-change [--company <company>] [--year YYYY]",
            "business query disciplinary --name <name> [--company <company>]",
            "business query seal-usage [--company <company>]",
            "business query departments [--company <company>]",
        ],
        "analysis": [
            "business analyze headcount",
            "business analyze employee-summary",
            "business analyze contract-coverage",
            "business analyze contract-expiry [--days 180]",
            "business analyze performance --month YYYY-MM [--company <company>]",
            "business analyze insurance --month YYYY-MM [--company <company>]",
            "business analyze disciplinary [--company <company>]",
        ],
        "write": [
            "business preview employee --input <plan.json>",
            "business create employee --input <plan.json>",
            "business preview-update employee --input <plan.json>",
            "business update employee --input <plan.json>",
            "business preview contract --input <plan.json>",
            "business create contract --input <plan.json>",
            "business preview-update contract --input <plan.json>",
            "business update contract --input <plan.json>",
            "business preview performance --input <plan.json>",
            "business create performance --input <plan.json>",
            "business preview-update performance --input <plan.json>",
            "business update performance --input <plan.json>",
            "business preview insurance --input <plan.json>",
            "business create insurance --input <plan.json>",
            "business preview-update insurance --input <plan.json>",
            "business update insurance --input <plan.json>",
            "business preview personnel-change --input <plan.json>",
            "business create personnel-change --input <plan.json>",
            "business preview-update personnel-change --input <plan.json>",
            "business update personnel-change --input <plan.json>",
            "business preview disciplinary --input <plan.json>",
            "business create disciplinary --input <plan.json>",
            "business preview-update disciplinary --input <plan.json>",
            "business update disciplinary --input <plan.json>",
            "business preview seal-usage --input <plan.json>",
            "business create seal-usage --input <plan.json>",
            "business preview-update seal-usage --input <plan.json>",
            "business update seal-usage --input <plan.json>",
            "business preview organization --input <plan.json>",
            "business create organization --input <plan.json>",
            "business preview-update organization --input <plan.json>",
            "business update organization --input <plan.json>",
        ],
        "delete": [
            "business delete employee --input <plan.json>",
            "business delete contract --input <plan.json>",
            "business delete performance --input <plan.json>",
            "business delete insurance --input <plan.json>",
            "business delete personnel-change --input <plan.json>",
            "business delete disciplinary --input <plan.json>",
            "business delete seal-usage --input <plan.json>",
        ],
        "audit": [
            "business query deleted-records --resource <resource>",
        ],
        "meta": [
            "business capabilities",
            "business schema <resource> --workflow create|update",
        ],
    }


def business_capabilities() -> dict[str, Any]:
    return {
        "usage": "nanobot-webui-business hr business <query|get|analyze|preview|create|preview-update|update|delete|schema|capabilities> <resource|topic> [options]",
        "commands": business_command_catalog(),
        "logical_delete": {
            "field": "is_deleted",
            "default_queries_exclude_deleted": True,
            "delete_sets_is_deleted": True,
            "audit_query": "business query deleted-records --resource <resource>",
        },
        "deleted_record_resources": [
            "employee",
            "contract",
            "performance",
            "insurance",
            "personnel-change",
            "disciplinary",
            "seal-usage",
        ],
        "notes": [
            "business query employee returns full employee roster fields to avoid one-by-one detail lookups.",
            "Before drafting normal create/update JSON plans, call business schema <resource> --workflow create|update for field definitions and examples.",
            "Create new HR records with preview -> create; do not use preview-update/update for records that do not already exist.",
            "Modify existing HR records with preview-update -> update; preview-update requires one existing match.",
            "Logical delete commands require resource delete permission and authorized company scope.",
        ],
    }


def business_help(positionals: list[str] | None = None) -> dict[str, Any]:
    catalog = business_command_catalog()
    groups = [
        {
            "group": "Business query",
            "commands": catalog["query"] + catalog["audit"] + catalog["meta"],
        },
        {
            "group": "Business analysis",
            "commands": catalog["analysis"],
        },
        {
            "group": "Business writes with confirmation",
            "commands": catalog["write"] + catalog["delete"],
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
        "usage": "nanobot-webui-business hr business <query|get|analyze|preview|create|preview-update|update|delete|schema> <resource|topic> [options]",
        "rules": [
            "This is the scoped business command surface for WebUI tenant sessions.",
            "Run from workspace root: cd <workspace> && nanobot-webui-business hr business ...",
            "Omit --company to use the current account's authorized company scope automatically.",
            "For new records, run preview <resource> first, then create <resource> after user confirmation.",
            "For existing records, run preview-update <resource> first, then update <resource> after user confirmation.",
            "Before writing a normal create/update plan, run schema <resource> --workflow create|update for the resource-specific plan contract.",
            "Create/update performs the write and returns internal verification.",
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
