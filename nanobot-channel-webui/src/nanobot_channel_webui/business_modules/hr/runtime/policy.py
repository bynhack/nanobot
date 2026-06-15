"""Permission policy enforcement for the HR business CLI."""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

COMPANY_KEYS = {"company", "companyName", "company_name", "company_full_name"}
HR_SCOPE_RESOURCES = [
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
]

HR_COMMAND_RULES: dict[str, tuple[str, str, str | None]] = {
    "list-companies": ("hr.company", "read", None),
    "get-company": ("hr.company", "read", None),
    "organization-tree": ("hr.organization", "query", None),
    "find-company": ("hr.company", "read", "name"),
    "list-departments": ("hr.department", "query", None),
    "get-department": ("hr.department", "read", None),
    "find-department": ("hr.department", "read", None),
    "find-employee": ("hr.employee", "query", None),
    "find-employee-like": ("hr.employee", "query", None),
    "list-employees": ("hr.employee", "query", None),
    "get-employee": ("hr.employee", "read", None),
    "employee-detail": ("hr.employee", "read", None),
    "employee-timeline": ("hr.employee", "read", None),
    "list-contracts": ("hr.contract", "query", None),
    "get-contract": ("hr.contract", "read", None),
    "contracts-by-employee": ("hr.contract", "read", None),
    "list-performance-reviews": ("hr.performance", "query", None),
    "get-performance-review": ("hr.performance", "read", None),
    "performance-by-employee": ("hr.performance", "read", None),
    "performance-by-month": ("hr.performance", "query", None),
    "list-insurance-changes": ("hr.insurance", "query", None),
    "get-insurance-change": ("hr.insurance", "read", None),
    "insurance-by-employee": ("hr.insurance", "read", None),
    "insurance-by-month": ("hr.insurance", "query", None),
    "list-personnel-changes": ("hr.personnel_change", "query", None),
    "get-personnel-change": ("hr.personnel_change", "read", None),
    "personnel-changes-by-employee": ("hr.personnel_change", "read", None),
    "personnel-changes-list": ("hr.personnel_change", "query", None),
    "list-disciplinary-records": ("hr.disciplinary", "query", None),
    "get-disciplinary-record": ("hr.disciplinary", "read", None),
    "disciplinary-by-employee": ("hr.disciplinary", "read", None),
    "list-seal-usage": ("hr.seal_usage", "query", None),
    "get-seal-usage": ("hr.seal_usage", "read", None),
    "seal-usage-list": ("hr.seal_usage", "query", None),
    "deleted-records": ("hr.employee", "read", None),
    "business-capabilities": ("hr.employee", "query", None),
    "business-plan-schema": ("hr.employee", "query", None),
    "analyze-roster": ("hr.employee", "analyze", None),
    "analyze-headcount": ("hr.employee", "analyze", None),
    "analyze-contract-coverage": ("hr.contract", "analyze", None),
    "analyze-contract-expiry": ("hr.contract", "analyze", None),
    "analyze-performance-month": ("hr.performance", "analyze", None),
    "analyze-low-performance": ("hr.performance", "analyze", None),
    "analyze-insurance-month": ("hr.insurance", "analyze", None),
    "analyze-personnel-change": ("hr.personnel_change", "analyze", None),
    "analyze-disciplinary": ("hr.disciplinary", "analyze", None),
    "analyze-seal-usage": ("hr.seal_usage", "analyze", None),
    "analyze-employee-profile": ("hr.employee", "analyze", None),
    "employee-summary": ("hr.employee", "analyze", None),
    "preview-org-seeds": ("hr.department", "write", None),
    "apply-org-seeds": ("hr.department", "write", None),
    "verify-org-seeds": ("hr.department", "read", None),
    "preview-update-org-seeds": ("hr.department", "write", None),
    "update-org-seeds": ("hr.department", "write", None),
    "delete-empty-departments": ("hr.department", "write", None),
    "preview-employees": ("hr.employee", "write", None),
    "apply-employees": ("hr.employee", "write", None),
    "verify-employees": ("hr.employee", "read", None),
    "preview-update-employees": ("hr.employee", "write", None),
    "update-employees": ("hr.employee", "write", None),
    "verify-employee-deletions": ("hr.employee", "read", None),
    "preview-contracts": ("hr.contract", "write", None),
    "apply-contracts": ("hr.contract", "write", None),
    "verify-contracts": ("hr.contract", "read", None),
    "preview-update-contracts": ("hr.contract", "write", None),
    "update-contracts": ("hr.contract", "write", None),
    "delete-contracts": ("hr.contract", "delete", None),
    "preview-performance-reviews": ("hr.performance", "write", None),
    "apply-performance-reviews": ("hr.performance", "write", None),
    "verify-performance-reviews": ("hr.performance", "read", None),
    "preview-update-performance-reviews": ("hr.performance", "write", None),
    "update-performance-reviews": ("hr.performance", "write", None),
    "delete-performance-reviews": ("hr.performance", "delete", None),
    "preview-insurance-changes": ("hr.insurance", "write", None),
    "apply-insurance-changes": ("hr.insurance", "write", None),
    "verify-insurance-changes": ("hr.insurance", "read", None),
    "preview-update-insurance-changes": ("hr.insurance", "write", None),
    "update-insurance-changes": ("hr.insurance", "write", None),
    "delete-insurance-changes": ("hr.insurance", "delete", None),
    "preview-personnel-changes": ("hr.personnel_change", "write", None),
    "apply-personnel-changes": ("hr.personnel_change", "write", None),
    "verify-personnel-changes": ("hr.personnel_change", "read", None),
    "preview-update-personnel-changes": ("hr.personnel_change", "write", None),
    "update-personnel-changes": ("hr.personnel_change", "write", None),
    "delete-personnel-changes": ("hr.personnel_change", "delete", None),
    "apply-employee-nickname-cleanup": ("hr.employee", "write", None),
    "verify-employee-nickname-cleanup": ("hr.employee", "read", None),
    "preview-disciplinary-records": ("hr.disciplinary", "write", None),
    "apply-disciplinary-records": ("hr.disciplinary", "write", None),
    "verify-disciplinary-records": ("hr.disciplinary", "read", None),
    "preview-update-disciplinary-records": ("hr.disciplinary", "write", None),
    "update-disciplinary-records": ("hr.disciplinary", "write", None),
    "delete-disciplinary-records": ("hr.disciplinary", "delete", None),
    "apply-disciplinary-attachments": ("hr.disciplinary", "write", None),
    "verify-disciplinary-attachments": ("hr.disciplinary", "read", None),
    "preview-seal-usage": ("hr.seal_usage", "write", None),
    "apply-seal-usage": ("hr.seal_usage", "write", None),
    "verify-seal-usage": ("hr.seal_usage", "read", None),
    "preview-update-seal-usage": ("hr.seal_usage", "write", None),
    "update-seal-usage": ("hr.seal_usage", "write", None),
    "delete-seal-usage": ("hr.seal_usage", "delete", None),
}

DANGEROUS_DELETE_COMMANDS = {
    "clear-business-data",
}

SCOPED_GLOBAL_DENY_COMMANDS = {
    "count-all",
    "pending-review-list",
    "data-quality-check",
    "analyze-hr-risk-dashboard",
    "employees-without-contracts",
}

SCOPED_MULTI_COMPANY_COMMANDS = {
    "list-companies",
    "find-employee",
    "find-employee-like",
    "organization-tree",
    "list-departments",
    "list-employees",
    "list-contracts",
    "list-performance-reviews",
    "list-insurance-changes",
    "list-personnel-changes",
    "list-disciplinary-records",
    "list-seal-usage",
    "employee-detail",
    "employee-timeline",
    "contracts-by-employee",
    "performance-by-employee",
    "insurance-by-employee",
    "performance-by-month",
    "insurance-by-month",
    "personnel-changes-by-employee",
    "personnel-changes-list",
    "disciplinary-by-employee",
    "seal-usage-list",
    "deleted-records",
    "business-capabilities",
    "business-plan-schema",
    "analyze-roster",
    "analyze-headcount",
    "analyze-contract-coverage",
    "analyze-contract-expiry",
    "analyze-performance-month",
    "analyze-low-performance",
    "analyze-insurance-month",
    "analyze-personnel-change",
    "analyze-disciplinary",
    "analyze-seal-usage",
    "analyze-employee-profile",
    "employee-summary",
}


@dataclass(frozen=True)
class AccessPolicy:
    unrestricted: bool
    missing_policy_file: bool
    user_id: str
    email: str
    role: str
    business_role: str
    company_scope: list[str]
    resources: list[dict[str, Any]]
    version: str = ""


def load_access_policy() -> AccessPolicy:
    file = os.environ.get("NANOBOT_WEBUI_POLICY_FILE")
    if not file:
        return AccessPolicy(False, True, "", "", "", "", [], [])
    try:
        payload = json.loads(Path(file).read_text(encoding="utf-8"))
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError(f"读取 WebUI 权限文件失败: {exc}") from exc

    subject = payload.get("subject") if isinstance(payload.get("subject"), dict) else payload
    resources = payload.get("resources") if isinstance(payload.get("resources"), list) else []
    scope = scope_values_for_resources(resources, HR_SCOPE_RESOURCES, "company") or []
    role = str(subject.get("role") or "")
    business_role = str(subject.get("business_role") or "")
    return AccessPolicy(
        unrestricted=role == "admin" or business_role == "admin" or "*" in scope,
        missing_policy_file=False,
        user_id=str(subject.get("user_id") or ""),
        email=str(subject.get("email") or ""),
        role=role,
        business_role=business_role,
        company_scope=scope,
        resources=resources,
        version=str(payload.get("version") or ""),
    )


def authorize_hr_command(
    *,
    command: str | None,
    options: dict[str, Any] | None = None,
    plan: Any = None,
    policy: AccessPolicy | None = None,
) -> None:
    policy = policy or load_access_policy()
    options = options or {}
    if policy.unrestricted or command in {None, "help", "--help", "-h", "business-plan-schema"}:
        return
    if policy.missing_policy_file:
        raise RuntimeError("当前账号缺少 WebUI 权限文件，拒绝执行 HR 业务命令")
    if not policy.company_scope:
        raise RuntimeError("当前账号未配置可访问公司范围，请联系管理员配置 HR 数据权限")
    if command in DANGEROUS_DELETE_COMMANDS:
        raise RuntimeError("当前账号无权执行危险 HR 命令")
    if command in SCOPED_GLOBAL_DENY_COMMANDS:
        raise RuntimeError(f"当前账号无权执行全局 HR 命令: {command}")

    resource, action, option_key = HR_COMMAND_RULES.get(command or "", ("hr.employee", "query", None))
    assert_tenant_resource_allowed(policy, resource, action)
    if command and command.startswith("get-"):
        return
    company = clean(options.get("company")) or clean(options.get(option_key or ""))
    if company:
        assert_tenant_scope_allowed(policy, resource, action, "company", company)
        return
    companies_from_plan = collect_scope_company_names(plan) if plan is not None else []
    if companies_from_plan:
        for item in companies_from_plan:
            assert_tenant_scope_allowed(policy, resource, action, "company", item)
        return
    if plan_has_match_id(plan) and command and (
        command.startswith("preview-update-")
        or command.startswith("update-")
        or command.startswith("delete-")
    ):
        return
    if command in SCOPED_MULTI_COMPANY_COMMANDS:
        return
    raise RuntimeError(f"当前账号执行 {command} 时必须指定 --company，或提供包含公司字段的导入计划")


def scoped_company_list(policy: AccessPolicy | None = None) -> list[dict[str, Any]] | None:
    policy = policy or load_access_policy()
    if policy.missing_policy_file:
        raise RuntimeError("当前账号缺少 WebUI 权限文件，拒绝读取 HR 公司范围")
    if policy.unrestricted:
        return None
    return [{"name": item, "short_name": "", "scoped": True} for item in policy.company_scope]


def allowed_company_names(
    policy: AccessPolicy | None = None,
    resource: str = "hr.employee",
    action: str = "query",
) -> list[str] | None:
    policy = policy or load_access_policy()
    if policy.missing_policy_file:
        raise RuntimeError("当前账号缺少 WebUI 权限文件，拒绝读取 HR 公司范围")
    if policy.unrestricted:
        return None
    assert_tenant_resource_allowed(policy, resource, action)
    return policy.company_scope


def assert_tenant_resource_allowed(policy: AccessPolicy, resource: str, action: str) -> None:
    if policy.unrestricted:
        return
    permission = resource_permission(policy, resource)
    if not permission or not allows_action(permission, action):
        raise RuntimeError(f"当前账号无权执行 HR 资源动作: {resource}:{action}")


def assert_tenant_scope_allowed(
    policy: AccessPolicy,
    resource: str,
    action: str,
    scope_key: str,
    scope_value: str,
) -> None:
    assert_tenant_resource_allowed(policy, resource, action)
    if policy.unrestricted or "*" in policy.company_scope:
        return
    permission = resource_permission(policy, resource)
    values = scope_values_for_permission(permission, scope_key) or policy.company_scope
    if scope_value not in values:
        raise RuntimeError(f"当前账号无权访问公司数据: {scope_value}")


def resource_permission(policy: AccessPolicy, resource: str) -> dict[str, Any] | None:
    return next((item for item in policy.resources if item.get("resource") == resource), None)


def allows_action(permission: dict[str, Any], action: str) -> bool:
    actions = permission.get("actions") if isinstance(permission.get("actions"), list) else []
    return "*" in actions or action in actions


def scope_values_for_resources(
    resources: list[dict[str, Any]],
    resource_names: list[str],
    key: str,
) -> list[str] | None:
    values: list[str] = []
    for resource in resource_names:
        permission = next((item for item in resources if item.get("resource") == resource), None)
        scoped = scope_values_for_permission(permission, key)
        if scoped:
            values.extend(scoped)
    unique = list(dict.fromkeys(values))
    return unique or None


def scope_values_for_permission(permission: dict[str, Any] | None, key: str) -> list[str] | None:
    scopes = permission.get("scopes") if isinstance(permission, dict) else None
    if not isinstance(scopes, list):
        return None
    scope = next((item for item in scopes if item.get("key") == key), None)
    values = scope.get("values") if isinstance(scope, dict) else None
    if not isinstance(values, list):
        return None
    return [str(item).strip() for item in values if str(item).strip()]


def collect_scope_company_names(value: Any, fallback_company_name: str | None = None) -> list[str]:
    results: list[str] = []
    fallback = clean(fallback_company_name)
    if fallback:
        results.append(fallback)
    _collect_scope_company_names_into(value, "", results)
    return list(dict.fromkeys(results))


def plan_has_match_id(value: Any) -> bool:
    if isinstance(value, list):
        return any(plan_has_match_id(item) for item in value)
    if not isinstance(value, dict):
        return False
    if clean(value.get("match_id")) or clean(value.get("id")):
        return True
    return any(plan_has_match_id(child) for child in value.values())


def _collect_scope_company_names_into(value: Any, parent_key: str, results: list[str]) -> None:
    if isinstance(value, list):
        for item in value:
            _collect_scope_company_names_into(item, parent_key, results)
        return
    if not isinstance(value, dict):
        return
    if parent_key == "companies" and clean_scalar(value.get("name")):
        results.append(clean(value.get("name")))
    for key, child in value.items():
        if key in COMPANY_KEYS and clean_scalar(child):
            results.append(clean(child))
            continue
        _collect_scope_company_names_into(child, key, results)


def clean_scalar(value: Any) -> str:
    if isinstance(value, dict | list):
        return ""
    return clean(value)


def clean(value: Any) -> str:
    return str(value).strip() if value is not None else ""
