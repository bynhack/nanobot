"""HR business repository implemented in Python."""

from __future__ import annotations

import mimetypes
from collections import defaultdict
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any, Callable

from .policy import allowed_company_names, collect_scope_company_names, load_access_policy
from .registry import DEFAULT_RESULT_LIMIT, MAX_RESULT_LIMIT
from .supabase_client import SupabaseConnector, execute, execute_one

BUSINESS_TABLES = [
    {"table": "companies", "label": "公司"},
    {"table": "departments", "label": "部门"},
    {"table": "employees", "label": "员工"},
    {"table": "contracts", "label": "合同"},
    {"table": "performance_reviews", "label": "绩效"},
    {"table": "insurance_changes", "label": "社医保"},
    {"table": "personnel_changes", "label": "人事异动"},
    {"table": "disciplinary_records", "label": "奖惩"},
    {"table": "seal_usage", "label": "用章"},
    {"table": "overtime_records", "label": "加班"},
    {"table": "work_injuries", "label": "工伤"},
    {"table": "job_postings", "label": "招聘岗位"},
    {"table": "interview_records", "label": "面试"},
    {"table": "training_records", "label": "培训"},
]

CLEAR_ORDER = [
    {"table": "interview_records", "label": "面试"},
    {"table": "job_postings", "label": "招聘岗位"},
    {"table": "training_records", "label": "培训"},
    {"table": "seal_usage", "label": "用章"},
    {"table": "work_injuries", "label": "工伤"},
    {"table": "overtime_records", "label": "加班"},
    {"table": "disciplinary_records", "label": "奖惩"},
    {"table": "personnel_changes", "label": "人事异动"},
    {"table": "insurance_changes", "label": "社医保"},
    {"table": "performance_reviews", "label": "绩效"},
    {"table": "contracts", "label": "合同"},
    {"table": "employees", "label": "员工"},
    {"table": "departments", "label": "部门"},
    {"table": "companies", "label": "公司"},
]

LOGICALLY_DELETED_TABLES = {item["table"] for item in BUSINESS_TABLES}

ZERO_UUID = "00000000-0000-0000-0000-000000000000"
DISCIPLINARY_DATE_FIELD = "incident_dates"


class PartialFailureError(RuntimeError):
    def __init__(self, message: str, *, partial_results: list[dict[str, Any]], failed: dict[str, Any]) -> None:
        super().__init__(message)
        self.partial_results = partial_results
        self.failed = failed

EMPLOYEE_WRITABLE_FIELDS = [
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
COMPANY_WRITABLE_FIELDS = ["name", "short_name"]
DEPARTMENT_WRITABLE_FIELDS = ["name", "company_id"]
CONTRACT_WRITABLE_FIELDS = [
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
PERFORMANCE_REVIEW_WRITABLE_FIELDS = [
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
INSURANCE_CHANGE_WRITABLE_FIELDS = [
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
PERSONNEL_CHANGE_WRITABLE_FIELDS = [
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
DISCIPLINARY_RECORD_WRITABLE_FIELDS = [
    DISCIPLINARY_DATE_FIELD,
    "penalty_type",
    "penalty_reason",
    "signed_upload",
    "hr_clerk",
]
SEAL_USAGE_WRITABLE_FIELDS = [
    "company_id",
    "usage_date",
    "applicant_id",
    "seal_applicant_id",
    "reason",
    "attachments",
    "notes",
]

MATCH_ID_NOT_FOUND_ERROR = "指定 id 不存在、已删除或无权访问"
HR_RESOURCE_TO_READ_RESOURCE = {
    "hr.company": "company",
    "hr.organization": "organization",
    "hr.department": "department",
    "hr.employee": "employee",
    "hr.contract": "contract",
    "hr.performance": "performance",
    "hr.insurance": "insurance",
    "hr.personnel_change": "personnel-change",
    "hr.disciplinary": "disciplinary",
    "hr.seal_usage": "seal-usage",
}

ATTACHMENT_FIELD_SPECS = {
    "hr.contract": {
        "scan_file_url": {"bucket": "hr-documents", "prefix": "contracts", "array": False},
    },
    "hr.insurance": {
        "signed_upload": {"bucket": "hr-documents", "prefix": "insurance", "array": True},
    },
    "hr.personnel_change": {
        "signed_upload": {"bucket": "hr-documents", "prefix": "personnel-change", "array": True},
    },
    "hr.disciplinary": {
        "signed_upload": {"bucket": "hr-documents", "prefix": "disciplinary", "array": True},
    },
    "hr.seal_usage": {
        "attachments": {"bucket": "hr-documents", "prefix": "seal-usage", "array": True},
    },
}


class ActiveRecordTable:
    def __init__(self, table: Any, *, filter_active: bool) -> None:
        self._table = table
        self._filter_active = filter_active

    def select(self, *args: Any, **kwargs: Any) -> Any:
        query = self._table.select(*args, **kwargs)
        if self._filter_active:
            return query.eq("is_deleted", False)
        return query

    def __getattr__(self, name: str) -> Any:
        return getattr(self._table, name)


class HrRepository:
    def __init__(self, connector: SupabaseConnector | None = None) -> None:
        self.db = connector or SupabaseConnector()

    def actor_user_id(self) -> str:
        return load_access_policy().user_id.strip()

    def require_actor_user_id(self) -> str:
        actor = self.actor_user_id()
        if not actor:
            raise RuntimeError("当前写入操作缺少当前登录用户 ID，无法填写 created_by/updated_by")
        return actor

    def audit_insert(self, payload: dict[str, Any]) -> dict[str, Any]:
        actor = self.require_actor_user_id()
        return {**payload, "created_by": actor, "updated_by": actor}

    def audit_update(self, payload: dict[str, Any]) -> dict[str, Any]:
        actor = self.require_actor_user_id()
        return {**payload, "updated_by": actor}

    def assert_plan_company_scope(
        self,
        *,
        plan: Any,
        company_name: str | None = None,
        resource: str,
        action: str = "write",
    ) -> None:
        allowed = repository_allowed_company_names(resource, action)
        if not allowed or "*" in allowed:
            return
        companies = collect_scope_company_names(plan, company_name)
        for company in companies:
            if company not in allowed:
                raise RuntimeError(f"当前账号无权写入或验证公司数据: {company}")

    def table(self, name: str) -> Any:
        return ActiveRecordTable(self.db.table(name), filter_active=name in LOGICALLY_DELETED_TABLES)

    def table_including_deleted(self, name: str) -> Any:
        return self.db.table(name)

    def resolve_attachment_fields(
        self,
        record: dict[str, Any],
        *,
        resource: str,
        owner_id: str | None,
    ) -> dict[str, Any]:
        specs = ATTACHMENT_FIELD_SPECS.get(resource)
        if not specs:
            return record
        resolved = dict(record)
        for field, spec in specs.items():
            if field not in resolved:
                continue
            if spec["array"]:
                values = clean_text_array(resolved.get(field))
                resolved[field] = [
                    self.resolve_attachment_value(
                        value,
                        bucket=str(spec["bucket"]),
                        prefix=str(spec["prefix"]),
                        owner_id=owner_id,
                    )
                    for value in values
                ]
            else:
                value = clean_optional(resolved.get(field))
                resolved[field] = (
                    self.resolve_attachment_value(
                        value,
                        bucket=str(spec["bucket"]),
                        prefix=str(spec["prefix"]),
                        owner_id=owner_id,
                    )
                    if value
                    else value
                )
        return resolved

    def resolve_attachment_value(
        self,
        value: str,
        *,
        bucket: str,
        prefix: str,
        owner_id: str | None,
    ) -> str:
        normalized = normalize_required(value, "attachment")
        if normalized.startswith(("http://", "https://")):
            return normalized
        path = Path(normalized).expanduser()
        if not path.is_file():
            raise RuntimeError("附件字段必须是可访问 URL 或服务端已上传文件路径")
        owner = (owner_id or "unmatched").strip() or "unmatched"
        object_path = f"{prefix.strip('/')}/{owner}/{path.name}"
        content_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        return self.db.upload_file(
            bucket=bucket,
            object_path=object_path,
            content=path.read_bytes(),
            content_type=content_type,
        )

    def count_table(self, table: str) -> int:
        _data, count = execute(self.table(table).select("*", count="exact", head=True))
        return int(count or 0)

    def count_all_tables(self) -> list[dict[str, Any]]:
        return [{**item, "count": self.count_table(item["table"])} for item in BUSINESS_TABLES]

    def list_companies(
        self,
        *,
        name: str | None = None,
        company_names: list[str] | None = None,
        scoped: bool = False,
    ) -> list[dict[str, Any]]:
        query = self.table("companies").select("id,name,short_name").order("name")
        normalized_name = clean_optional(name)
        if normalized_name:
            query = query.eq("name", normalized_name)
        normalized_names = [item for item in map(clean_optional, company_names or []) if item]
        if normalized_names:
            query = query.in_("name", normalized_names)
        data, _count = execute(query)
        if scoped:
            return [{**row, "scoped": True} for row in data]
        return data

    def find_company_by_name(self, name: str | None) -> list[dict[str, Any]]:
        company = normalize_required(name, "company name")
        data, _count = execute(
            self.table("companies").select("id,name,short_name").eq("name", company).limit(2)
        )
        return data

    def unique_company(self, company_name: str | None) -> dict[str, Any] | None:
        matches = self.find_company_by_name(company_name)
        return matches[0] if len(matches) == 1 else None

    def company_ids_by_names(self, company_names: list[str]) -> list[str]:
        ids: list[str] = []
        for name in company_names:
            company = self.unique_company(name)
            if company:
                ids.append(company["id"])
        return ids

    def scoped_company_ids(
        self,
        *,
        company_name: str | None = None,
        company_names: list[str] | None = None,
    ) -> list[str] | None:
        normalized_company = clean_optional(company_name)
        normalized_companies = [item for item in map(clean_optional, company_names or []) if item]
        if not normalized_company and not normalized_companies:
            return None
        return self.company_ids_by_names([normalized_company] if normalized_company else normalized_companies)

    def scoped_employee_ids(
        self,
        *,
        company_name: str | None = None,
        company_names: list[str] | None = None,
    ) -> list[str] | None:
        company_ids = self.scoped_company_ids(company_name=company_name, company_names=company_names)
        if company_ids is None:
            return None
        if not company_ids:
            return []
        data, _count = execute(self.table("employees").select("id").in_("company_id", company_ids))
        return [row["id"] for row in data]

    def list_organization_tree(self, *, company_names: list[str] | None = None) -> list[dict[str, Any]]:
        scoped_names = [item for item in map(clean_optional, company_names or []) if item] or None
        departments_result = self.list_departments(company_names=scoped_names or [])
        companies = departments_result["companyMatches"] if scoped_names else self.list_companies()
        department_map: dict[str, list[str]] = defaultdict(list)
        for row in departments_result["departments"]:
            company_name = deep_get(row, "companies.name") or ""
            if company_name:
                department_map[company_name].append(row.get("name"))
        return [
            {
                "name": company.get("name"),
                "short_name": company.get("short_name"),
                "scoped": scoped_names is not None,
                "departments": department_map.get(company.get("name"), []),
            }
            for company in companies
        ]

    def list_departments(
        self,
        *,
        company_name: str | None = None,
        company_names: list[str] | None = None,
    ) -> dict[str, Any]:
        company_ids = self.scoped_company_ids(company_name=company_name, company_names=company_names)
        company_matches: list[dict[str, Any]] = []
        query = self.table("departments").select("id,name,company_id,companies(name)").order("name")
        if company_ids is not None:
            if not company_ids:
                return {"companyMatches": [], "departments": []}
            query = query.in_("company_id", company_ids)
            company_matches, _count = execute(
                self.table("companies").select("id,name,short_name").in_("id", company_ids)
            )
        departments, _count = execute(query)
        return {"companyMatches": company_matches, "departments": departments}

    def find_department(self, *, company_name: str | None, department_name: str | None) -> dict[str, Any]:
        department = normalize_required(department_name, "department name")
        lookup = self.list_departments(company_name=company_name)
        if len(lookup["companyMatches"]) != 1:
            return {"companyMatches": lookup["companyMatches"], "departmentMatches": []}
        return {
            "companyMatches": lookup["companyMatches"],
            "departmentMatches": [row for row in lookup["departments"] if row.get("name") == department],
        }

    def ensure_company(self, *, name: str | None, short_name: str | None = None) -> dict[str, Any]:
        company_name = normalize_required(name, "company name")
        matches = self.find_company_by_name(company_name)
        if len(matches) > 1:
            raise RuntimeError(f"multiple companies matched: {company_name}")
        if len(matches) == 1:
            return {"action": "existing", "record": matches[0]}
        row = execute_one(
            self.table("companies")
            .insert(self.audit_insert({"name": company_name, "short_name": clean_optional(short_name)}))
            .select("id,name,short_name")
            .single()
        )
        return {"action": "created", "record": row}

    def ensure_department(self, *, company_name: str | None, department_name: str | None) -> dict[str, Any]:
        department = normalize_required(department_name, "department name")
        company_result = self.ensure_company(name=company_name)
        company = company_result["record"]
        existing, _count = execute(
            self.table("departments")
            .select("id,name,company_id")
            .eq("company_id", company["id"])
            .eq("name", department)
            .limit(2)
        )
        if len(existing) > 1:
            raise RuntimeError(f"multiple departments matched: {company['name']} / {department}")
        if len(existing) == 1:
            return {"action": "existing", "record": existing[0], "company": company}
        row = execute_one(
            self.table("departments")
            .insert(self.audit_insert({"company_id": company["id"], "name": department}))
            .select("id,name,company_id")
            .single()
        )
        return {"action": "created", "record": row, "company": company}

    def existing_company_for_department_write(self, company_name: str | None) -> dict[str, Any]:
        company = normalize_required(company_name, "company name")
        matches = self.find_company_by_name(company)
        if len(matches) != 1:
            raise RuntimeError(f"部门写入不自动创建公司，请先确认公司存在: {company}")
        return matches[0]

    def ensure_company_for_department_create(self, company_name: str | None) -> dict[str, Any]:
        company = normalize_required(company_name, "company name")
        self.assert_plan_company_scope(
            plan={"company": company},
            company_name=company,
            resource="hr.department",
            action="write",
        )
        return self.ensure_company(name=company)["record"]

    def ensure_department_for_existing_company(
        self,
        *,
        company_name: str | None,
        department_name: str | None,
    ) -> dict[str, Any]:
        department = normalize_required(department_name, "department name")
        company = self.existing_company_for_department_write(company_name)
        existing, _count = execute(
            self.table("departments")
            .select("id,name,company_id")
            .eq("company_id", company["id"])
            .eq("name", department)
            .limit(2)
        )
        if len(existing) > 1:
            raise RuntimeError(f"multiple departments matched: {company['name']} / {department}")
        if len(existing) == 1:
            return {"action": "existing", "record": existing[0], "company": company}
        row = execute_one(
            self.table("departments")
            .insert(self.audit_insert({"company_id": company["id"], "name": department}))
            .select("id,name,company_id")
            .single()
        )
        return {"action": "created", "record": row, "company": company}

    def list_employees(
        self,
        *,
        company_name: str | None = None,
        company_names: list[str] | None = None,
        status: str | None = None,
        department_name: str | None = None,
        name: str | None = None,
        id_card: str | None = None,
        phone: str | None = None,
    ) -> dict[str, Any]:
        query = self.table("employees").select(employee_detail_select()).order("name")
        company_ids = self.scoped_company_ids(company_name=company_name, company_names=company_names)
        if company_ids is not None:
            if not company_ids:
                return {
                    "company": scope_label(company_name, company_names),
                    "match_status": "company_not_found",
                    "records": [],
                }
            query = query.in_("company_id", company_ids)
        normalized_status = clean_optional(status)
        if normalized_status:
            query = query.eq("status", normalized_status)
        normalized_name = clean_optional(name)
        if normalized_name:
            query = query.eq("name", normalized_name)
        normalized_id_card = clean_optional(id_card)
        if normalized_id_card:
            query = query.eq("id_card_number", normalized_id_card)
        normalized_phone = clean_optional(phone)
        if normalized_phone:
            query = query.eq("phone", normalized_phone)
        normalized_department = clean_optional(department_name)
        if normalized_department:
            departments = self.list_departments(company_name=company_name, company_names=company_names)[
                "departments"
            ]
            department_ids = [row["id"] for row in departments if row.get("name") == normalized_department]
            if not department_ids:
                return {
                    "total": 0,
                    "company": scope_label(company_name, company_names),
                    "status": normalized_status,
                    "records": [],
                }
            query = query.in_("department_id", department_ids)
        data, _count = execute(query)
        return {
            "total": len(data),
            "company": scope_label(company_name, company_names),
            "status": normalized_status,
            "records": [employee_detail_business_row(row) for row in data],
        }

    def list_resource_records(
        self,
        resource: str,
        *,
        company_name: str | None = None,
        company_names: list[str] | None = None,
        **filters: Any,
    ) -> list[dict[str, Any]]:
        config = resource_read_config(resource)
        query = self.table(config["table"]).select(config["select"]).order(config["order"])
        query = self.apply_resource_company_scope(
            query,
            config=config,
            company_name=company_name,
            company_names=company_names,
        )
        for key, value in resource_filter_specs(resource, filters):
            normalized = clean_optional(value)
            if normalized:
                query = query.eq(key, normalized)
        data, _count = execute(query)
        employee_name = clean_optional(filters.get("employee_name"))
        applicant = clean_optional(filters.get("applicant"))
        date_from = clean_optional(filters.get("date_from"))
        date_to = clean_optional(filters.get("date_to"))
        expiry_before = clean_optional(filters.get("expiry_before"))
        expiry_after = clean_optional(filters.get("expiry_after"))
        year = clean_optional(filters.get("year"))
        month = clean_optional(filters.get("month"))
        threshold = filters.get("threshold")
        records = [config["mapper"](row) for row in data]
        if employee_name:
            records = [row for row in records if row.get("employee") == employee_name]
        if applicant:
            records = [
                row
                for row in records
                if row.get("applicant") == applicant or row.get("seal_applicant") == applicant
            ]
        if date_from:
            records = [row for row in records if str(row.get("usage_date") or "") >= date_from]
        if date_to:
            records = [row for row in records if str(row.get("usage_date") or "") <= date_to]
        if expiry_before:
            records = [row for row in records if str(row.get("expiry_date") or "") <= expiry_before]
        if expiry_after:
            records = [row for row in records if str(row.get("expiry_date") or "") >= expiry_after]
        if year:
            records = [
                row for row in records if any(str(row.get(field) or "").startswith(year) for field in config["date_fields"])
            ]
        if month:
            records = [
                row for row in records if any(str(row.get(field) or "").startswith(month) for field in config["date_fields"])
            ]
        if threshold is not None:
            records = [row for row in records if (clean_numeric(row.get("final_score")) or 0) <= float(threshold)]
        return records

    def get_resource_by_id(self, resource: str, record_id: str | None) -> dict[str, Any]:
        value = normalize_required(record_id, "id")
        config = resource_read_config(resource)
        allowed = repository_allowed_company_names(config["resource"], "read")
        if allowed and "*" not in allowed:
            scope_row = execute_one(
                self.table_including_deleted(config["table"])
                .select(config["scope_select"])
                .eq("id", value)
                .single()
            )
            if not scope_row:
                raise RuntimeError(f"{config['name']} record not found")
            self.assert_row_scope(config=config, row=scope_row, action="read")
        row = execute_one(
            self.table_including_deleted(config["table"])
            .select(audit_select(config["select"]))
            .eq("id", value)
            .single()
        )
        if not row:
            raise RuntimeError(f"{config['name']} record not found")
        self.assert_row_scope(config=config, row=row, action="read")
        return audit_business_row(row, config["mapper"])

    def assert_read_row_scope(self, *, config: dict[str, Any], row: dict[str, Any]) -> None:
        self.assert_row_scope(config=config, row=row, action="read")

    def assert_row_scope(self, *, config: dict[str, Any], row: dict[str, Any], action: str) -> None:
        allowed = repository_allowed_company_names(config["resource"], action)
        if not allowed or "*" in allowed:
            return
        company_name = read_row_company(row, config)
        if company_name not in allowed:
            raise RuntimeError("当前账号无权访问公司数据")

    def find_active_by_match_id(self, resource: str, record: dict[str, Any], *, action: str) -> list[dict[str, Any]] | None:
        match_id = clean_optional(record.get("_match_id"))
        if not match_id:
            return None
        read_resource = HR_RESOURCE_TO_READ_RESOURCE.get(resource, resource)
        config = resource_read_config(read_resource)
        row = execute_one(
            self.table(config["table"])
            .select(config["select"])
            .eq("id", match_id)
            .single()
        )
        if not row:
            raise RuntimeError(MATCH_ID_NOT_FOUND_ERROR)
        try:
            self.assert_row_scope(config=config, row=row, action=action)
        except RuntimeError as exc:
            if str(exc) == "当前账号无权访问公司数据":
                raise RuntimeError(MATCH_ID_NOT_FOUND_ERROR) from exc
            raise
        return [row]

    def apply_resource_company_scope(
        self,
        query: Any,
        *,
        config: dict[str, Any],
        company_name: str | None = None,
        company_names: list[str] | None = None,
    ) -> Any:
        if config["scope"] == "company_id":
            return self.apply_company_scope(query, company_name=company_name, company_names=company_names)
        if config["scope"] == "employee_id":
            employee_ids = self.scoped_employee_ids(company_name=company_name, company_names=company_names)
            if employee_ids is None:
                return query
            if not employee_ids:
                return query.in_("employee_id", ["__no_employee__"])
            return query.in_("employee_id", employee_ids)
        return query

    def find_employee_by_id_card(
        self,
        id_card_number: str | None,
        *,
        company_name: str | None = None,
        company_names: list[str] | None = None,
    ) -> list[dict[str, Any]]:
        value = normalize_required(id_card_number, "id card number")
        query = self.table("employees").select(employee_select()).eq("id_card_number", value)
        query = self.apply_company_scope(query, company_name=company_name, company_names=company_names)
        data, _count = execute(query.limit(5))
        return data

    def find_employee_by_phone(
        self,
        phone: str | None,
        *,
        company_name: str | None = None,
        company_names: list[str] | None = None,
    ) -> list[dict[str, Any]]:
        value = normalize_required(phone, "phone")
        query = self.table("employees").select(employee_select()).eq("phone", value)
        query = self.apply_company_scope(query, company_name=company_name, company_names=company_names)
        data, _count = execute(query.limit(5))
        return data

    def apply_company_scope(
        self,
        query: Any,
        *,
        company_name: str | None = None,
        company_names: list[str] | None = None,
    ) -> Any:
        company_ids = self.scoped_company_ids(company_name=company_name, company_names=company_names)
        if company_ids is None:
            return query
        if not company_ids:
            return query.in_("company_id", ["__no_company__"])
        return query.in_("company_id", company_ids)

    def find_employee_candidates(
        self,
        *,
        name: str | None = None,
        company_name: str | None = None,
        company_names: list[str] | None = None,
        department_name: str | None = None,
    ) -> dict[str, Any]:
        employee_name = normalize_required(name, "employee name")
        query = self.table("employees").select(employee_select()).eq("name", employee_name).order("name")
        query = self.apply_company_scope(query, company_name=company_name, company_names=company_names)
        department = clean_optional(department_name)
        if department:
            departments = self.list_departments(company_name=company_name, company_names=company_names)[
                "departments"
            ]
            department_ids = [row["id"] for row in departments if row.get("name") == department]
            if not department_ids:
                return {"candidates": [], "department_status": "department_not_found"}
            query = query.in_("department_id", department_ids)
        data, _count = execute(query.limit(20))
        return {"candidates": data, "count": len(data)}

    def find_employee_name_like(
        self,
        *,
        name: str | None,
        company_name: str | None = None,
        company_names: list[str] | None = None,
    ) -> dict[str, Any]:
        value = normalize_required(name, "employee name")
        query = self.table("employees").select(employee_select()).ilike("name", f"%{value}%").order("name")
        query = self.apply_company_scope(query, company_name=company_name, company_names=company_names)
        data, _count = execute(query.limit(20))
        return {"records": [employee_business_row(row) for row in data], "count": len(data)}

    def resolve_employee_lookup(self, **options: Any) -> dict[str, Any]:
        if clean_optional(options.get("id_card")):
            rows = self.find_employee_by_id_card(
                options.get("id_card"),
                company_name=options.get("company_name"),
                company_names=options.get("company_names"),
            )
            return {"strategy": "id_card", "candidates": rows, "count": len(rows)}
        if clean_optional(options.get("phone")):
            rows = self.find_employee_by_phone(
                options.get("phone"),
                company_name=options.get("company_name"),
                company_names=options.get("company_names"),
            )
            return {"strategy": "phone", "candidates": rows, "count": len(rows)}
        result = self.find_employee_candidates(
            name=options.get("name"),
            company_name=options.get("company_name"),
            company_names=options.get("company_names"),
            department_name=options.get("department_name"),
        )
        result["strategy"] = "name"
        return result

    def require_unique_employee(self, **options: Any) -> dict[str, Any]:
        result = self.resolve_employee_lookup(**options)
        candidates = result.get("candidates") or []
        if len(candidates) != 1:
            raise RuntimeError(f"employee lookup expected one match, got {len(candidates)}")
        return candidates[0]

    def employee_detail(self, **options: Any) -> dict[str, Any]:
        employee = self.require_unique_employee(**options)
        row = execute_one(
            self.table("employees").select(employee_detail_select()).eq("id", employee["id"]).single()
        )
        return employee_detail_business_row(row or employee)

    def employee_timeline(self, **options: Any) -> dict[str, Any]:
        employee = self.require_unique_employee(**options)
        employee_id = employee["id"]
        limit = bounded_result_limit(options.get("limit"))
        contracts, contracts_meta = self.contracts_by_employee_id_limited(employee_id, limit=limit)
        performance, performance_meta = self.performance_by_employee_id_limited(employee_id, limit=limit)
        insurance, insurance_meta = self.insurance_changes_by_employee_id_limited(employee_id, limit=limit)
        personnel, personnel_meta = self.personnel_changes_by_employee_id_limited(employee_id, limit=limit)
        disciplinary, disciplinary_meta = self.disciplinary_records_by_employee_id_limited(employee_id, limit=limit)
        return {
            "employee": employee_detail_business_row(employee),
            "contracts": contracts,
            "performance_reviews": performance,
            "insurance_changes": insurance,
            "personnel_changes": personnel,
            "disciplinary_records": disciplinary,
            "limits": {
                "contracts": contracts_meta,
                "performance_reviews": performance_meta,
                "insurance_changes": insurance_meta,
                "personnel_changes": personnel_meta,
                "disciplinary_records": disciplinary_meta,
            },
        }

    def contracts_by_employee(self, **options: Any) -> dict[str, Any]:
        employee = self.require_unique_employee(**options)
        return {"employee": employee_business_row(employee), "records": self.contracts_by_employee_id(employee["id"])}

    def performance_by_employee(self, **options: Any) -> dict[str, Any]:
        employee = self.require_unique_employee(**options)
        return {
            "employee": employee_business_row(employee),
            "records": self.performance_by_employee_id(employee["id"]),
        }

    def insurance_changes_by_employee(self, **options: Any) -> dict[str, Any]:
        employee = self.require_unique_employee(**options)
        return {
            "employee": employee_business_row(employee),
            "records": self.insurance_changes_by_employee_id(employee["id"]),
        }

    def personnel_changes_by_employee(self, **options: Any) -> dict[str, Any]:
        employee = self.require_unique_employee(**options)
        return {
            "employee": employee_business_row(employee),
            "records": self.personnel_changes_by_employee_id(employee["id"]),
        }

    def disciplinary_records_by_employee(self, **options: Any) -> dict[str, Any]:
        employee = self.require_unique_employee(**options)
        return {
            "employee": employee_business_row(employee),
            "records": self.disciplinary_records_by_employee_id(employee["id"]),
        }

    def contracts_by_employee_id(self, employee_id: str) -> list[dict[str, Any]]:
        records, _meta = self.contracts_by_employee_id_limited(employee_id, limit=None)
        return records

    def contracts_by_employee_id_limited(self, employee_id: str, *, limit: int | None) -> tuple[list[dict[str, Any]], dict[str, Any]]:
        return self.records_by_employee_id_limited(
            table="contracts",
            select=contract_select(),
            employee_id=employee_id,
            order_key="start_date",
            mapper=contract_business_row,
            limit=limit,
        )

    def performance_by_employee_id(self, employee_id: str) -> list[dict[str, Any]]:
        records, _meta = self.performance_by_employee_id_limited(employee_id, limit=None)
        return records

    def performance_by_employee_id_limited(self, employee_id: str, *, limit: int | None) -> tuple[list[dict[str, Any]], dict[str, Any]]:
        return self.records_by_employee_id_limited(
            table="performance_reviews",
            select=performance_review_select(),
            employee_id=employee_id,
            order_key="review_date",
            mapper=performance_business_row,
            limit=limit,
        )

    def insurance_changes_by_employee_id(self, employee_id: str) -> list[dict[str, Any]]:
        records, _meta = self.insurance_changes_by_employee_id_limited(employee_id, limit=None)
        return records

    def insurance_changes_by_employee_id_limited(self, employee_id: str, *, limit: int | None) -> tuple[list[dict[str, Any]], dict[str, Any]]:
        return self.records_by_employee_id_limited(
            table="insurance_changes",
            select=insurance_change_select(),
            employee_id=employee_id,
            order_key="change_date",
            mapper=insurance_change_business_row,
            limit=limit,
        )

    def personnel_changes_by_employee_id(self, employee_id: str) -> list[dict[str, Any]]:
        records, _meta = self.personnel_changes_by_employee_id_limited(employee_id, limit=None)
        return records

    def personnel_changes_by_employee_id_limited(self, employee_id: str, *, limit: int | None) -> tuple[list[dict[str, Any]], dict[str, Any]]:
        return self.records_by_employee_id_limited(
            table="personnel_changes",
            select=personnel_change_select(),
            employee_id=employee_id,
            order_key="effective_date",
            mapper=personnel_change_business_row,
            limit=limit,
        )

    def disciplinary_records_by_employee_id(self, employee_id: str) -> list[dict[str, Any]]:
        records, _meta = self.disciplinary_records_by_employee_id_limited(employee_id, limit=None)
        return records

    def disciplinary_records_by_employee_id_limited(self, employee_id: str, *, limit: int | None) -> tuple[list[dict[str, Any]], dict[str, Any]]:
        return self.records_by_employee_id_limited(
            table="disciplinary_records",
            select=disciplinary_record_select(),
            employee_id=employee_id,
            order_key=DISCIPLINARY_DATE_FIELD,
            mapper=disciplinary_record_business_row,
            limit=limit,
        )

    def records_by_employee_id_limited(
        self,
        *,
        table: str,
        select: str,
        employee_id: str,
        order_key: str,
        mapper: Callable[[dict[str, Any]], dict[str, Any]],
        limit: int | None,
    ) -> tuple[list[dict[str, Any]], dict[str, Any]]:
        query = (
            self.table(table)
            .select(select, count="exact")
            .eq("employee_id", employee_id)
            .order(order_key, desc=True)
        )
        if limit is not None:
            query = query.limit(limit)
        data, _count = execute(
            query
        )
        records = [mapper(row) for row in data]
        return records, result_limit_meta(_count, len(records), limit)

    def performance_by_month(
        self,
        *,
        month: str | None,
        company_name: str | None = None,
        company_names: list[str] | None = None,
    ) -> dict[str, Any]:
        range_ = month_range(month)
        query = (
            self.table("performance_reviews")
            .select(performance_review_select())
            .gte("review_date", range_["from"])
            .lte("review_date", range_["to"])
            .order("review_date", desc=True)
        )
        employee_ids = self.scoped_employee_ids(company_name=company_name, company_names=company_names)
        if employee_ids is not None:
            if not employee_ids:
                return {"month": range_["label"], "company": scope_label(company_name, company_names), "records": []}
            query = query.in_("employee_id", employee_ids)
        data, _count = execute(query)
        return {
            "month": range_["label"],
            "company": scope_label(company_name, company_names),
            "records": [performance_business_row(row) for row in data],
        }

    def insurance_changes_by_month(
        self,
        *,
        month: str | None,
        company_name: str | None = None,
        company_names: list[str] | None = None,
    ) -> dict[str, Any]:
        range_ = month_range(month)
        query = (
            self.table("insurance_changes")
            .select(insurance_change_select())
            .gte("change_date", range_["from"])
            .lte("change_date", range_["to"])
            .order("change_date", desc=True)
        )
        employee_ids = self.scoped_employee_ids(company_name=company_name, company_names=company_names)
        if employee_ids is not None:
            if not employee_ids:
                return {"month": range_["label"], "company": scope_label(company_name, company_names), "records": []}
            query = query.in_("employee_id", employee_ids)
        data, _count = execute(query)
        return {
            "month": range_["label"],
            "company": scope_label(company_name, company_names),
            "records": [insurance_change_business_row(row) for row in data],
        }

    def personnel_changes_list(
        self,
        *,
        year: str | None = None,
        change_reason: str | None = None,
        company_name: str | None = None,
        company_names: list[str] | None = None,
        limit: int | None = None,
    ) -> dict[str, Any]:
        range_ = year_range(year)
        effective_limit = bounded_result_limit(limit)
        query = (
            self.table("personnel_changes")
            .select(personnel_change_select(), count="exact")
            .gte("effective_date", range_["from"])
            .lte("effective_date", range_["to"])
            .order("effective_date", desc=True)
        )
        if clean_optional(change_reason):
            query = query.eq("change_reason", clean_optional(change_reason))
        employee_ids = self.scoped_employee_ids(company_name=company_name, company_names=company_names)
        if employee_ids is not None:
            if not employee_ids:
                return {"year": range_["label"], "company": scope_label(company_name, company_names), "records": [], **result_limit_meta(0, 0, effective_limit)}
            query = query.in_("employee_id", employee_ids)
        data, _count = execute(query.limit(effective_limit))
        records = [personnel_change_business_row(row) for row in data]
        return {
            "year": range_["label"],
            "company": scope_label(company_name, company_names),
            "reason": clean_optional(change_reason),
            "records": records,
            **result_limit_meta(_count, len(records), effective_limit),
        }

    def seal_usage_list(
        self,
        *,
        company_name: str | None = None,
        company_names: list[str] | None = None,
        date_from: str | None = None,
        date_to: str | None = None,
        employee_name: str | None = None,
    ) -> dict[str, Any]:
        query = self.table("seal_usage").select(seal_usage_select()).order("usage_date", desc=True)
        company_ids = self.scoped_company_ids(company_name=company_name, company_names=company_names)
        if company_ids is not None:
            if not company_ids:
                return {"company": scope_label(company_name, company_names), "records": []}
            query = query.in_("company_id", company_ids)
        if clean_optional(date_from):
            query = query.gte("usage_date", clean_optional(date_from))
        if clean_optional(date_to):
            query = query.lte("usage_date", clean_optional(date_to))
        data, _count = execute(query)
        records = [seal_usage_business_row(row) for row in data]
        name = clean_optional(employee_name)
        if name:
            records = [
                row
                for row in records
                if row.get("applicant") == name or row.get("seal_applicant") == name
            ]
        return {"company": scope_label(company_name, company_names), "records": records, "count": len(records)}

    def employee_summary(
        self,
        *,
        company_name: str | None = None,
        company_names: list[str] | None = None,
    ) -> dict[str, Any]:
        query = self.table("employees").select(
            "id,name,status,id_card_number,phone,companies(name),departments(name)"
        ).order("name")
        company_ids = self.scoped_company_ids(company_name=company_name, company_names=company_names)
        if company_ids is not None:
            if not company_ids:
                return empty_employee_summary(company_name, company_names, "no_company_matched")
            query = query.in_("company_id", company_ids)
        rows, _count = execute(query)
        by_company: dict[str, dict[str, Any]] = {}
        by_department: dict[str, dict[str, Any]] = {}
        by_id_card: dict[str, list[dict[str, Any]]] = defaultdict(list)
        by_phone: dict[str, list[dict[str, Any]]] = defaultdict(list)
        empty_department: list[dict[str, Any]] = []
        empty_id_card: list[dict[str, Any]] = []
        for row in rows:
            company = deep_get(row, "companies.name") or "(未归属公司)"
            department = deep_get(row, "departments.name")
            status = row.get("status") or "(空状态)"
            company_item = summary_item(by_company, company)
            company_item["total"] += 1
            company_item["statuses"][status] = company_item["statuses"].get(status, 0) + 1
            department_key = f"{company} / {department or '(空部门)'}"
            department_item = summary_item(
                by_department,
                department_key,
                {"company": company, "department": department},
            )
            department_item["total"] += 1
            department_item["statuses"][status] = department_item["statuses"].get(status, 0) + 1
            business_row = {
                "name": row.get("name"),
                "company": company,
                "department": department,
                "status": status,
                "id_card_number": row.get("id_card_number"),
                "phone": row.get("phone"),
            }
            if not department:
                empty_department.append(business_row)
            if not clean_optional(row.get("id_card_number")):
                empty_id_card.append(business_row)
            if clean_optional(row.get("id_card_number")):
                by_id_card[clean_optional(row.get("id_card_number"))].append(business_row)
            if clean_optional(row.get("phone")):
                by_phone[clean_optional(row.get("phone"))].append(business_row)
        return {
            "total": len(rows),
            "company": clean_optional(company_name),
            "company_scope": [item for item in map(clean_optional, company_names or []) if item] or None,
            "byCompany": [
                {"company": company, "total": item["total"], "statuses": sort_object(item["statuses"])}
                for company, item in by_company.items()
            ],
            "byDepartment": [
                {
                    "company": item["company"],
                    "department": item["department"],
                    "total": item["total"],
                    "statuses": sort_object(item["statuses"]),
                }
                for item in by_department.values()
            ],
            "checks": {
                "emptyDepartment": empty_department,
                "emptyIdCard": empty_id_card,
                "duplicateIdCards": duplicate_groups(by_id_card),
                "duplicatePhones": duplicate_groups(by_phone),
            },
        }

    def analyze_headcount(
        self,
        *,
        company_name: str | None = None,
        company_names: list[str] | None = None,
    ) -> dict[str, Any]:
        summary = self.employee_summary(company_name=company_name, company_names=company_names)
        active_statuses = {"正式", "试用", "合作协议", "实习"}
        by_company = []
        for item in summary["byCompany"]:
            active = sum(count for status, count in item["statuses"].items() if status in active_statuses)
            resigned = item["statuses"].get("离职", 0)
            by_company.append({**item, "active": active, "resigned": resigned})
        return {
            "total": summary["total"],
            "company": summary.get("company"),
            "active": sum(row["active"] for row in by_company),
            "resigned": sum(row["resigned"] for row in by_company),
            "by_company": by_company,
            "by_department": summary["byDepartment"],
            "quality_flags": {
                "empty_department_count": len(summary["checks"]["emptyDepartment"]),
                "empty_id_card_count": len(summary["checks"]["emptyIdCard"]),
                "duplicate_id_card_groups": len(summary["checks"]["duplicateIdCards"]),
                "duplicate_phone_groups": len(summary["checks"]["duplicatePhones"]),
            },
        }

    def active_employee_rows(
        self,
        *,
        company_name: str | None = None,
        company_names: list[str] | None = None,
    ) -> list[dict[str, Any]]:
        query = self.table("employees").select(
            "id,name,status,phone,id_card_number,position,hire_date,companies(name),departments(name)"
        ).order("name")
        company_ids = self.scoped_company_ids(company_name=company_name, company_names=company_names)
        if company_ids is not None:
            if not company_ids:
                return []
            query = query.in_("company_id", company_ids)
        rows, _count = execute(query)
        return [row for row in rows if employee_status_is_active(row.get("status"))]

    def analyze_roster(
        self,
        *,
        company_name: str | None = None,
        company_names: list[str] | None = None,
        as_of: str | None = None,
    ) -> dict[str, Any]:
        analysis_date = parse_analysis_date(as_of)
        summary = self.employee_summary(company_name=company_name, company_names=company_names)
        status_counts: dict[str, int] = defaultdict(int)
        active_employees = 0
        inactive_employees = 0
        for company in summary["byCompany"]:
            for status, count in company["statuses"].items():
                status_counts[status] += count
                if employee_status_is_active(status):
                    active_employees += count
                else:
                    inactive_employees += count
        result = {
            "topic": "roster",
            "as_of": analysis_date.isoformat(),
            "scope": analysis_scope(company_name, company_names),
            "summary": {
                "total_employees": summary["total"],
                "active_employees": active_employees,
                "inactive_employees": inactive_employees,
                "companies": len(summary["byCompany"]),
                "departments": len(summary["byDepartment"]),
            },
            "groups": {
                "by_status": [
                    {"status": status, "employee_count": count}
                    for status, count in sort_object(status_counts).items()
                ],
                "by_company": [
                    employee_summary_analysis_group(item, ["company"]) for item in summary["byCompany"]
                ],
                "by_department": [
                    employee_summary_analysis_group(item, ["company", "department"])
                    for item in summary["byDepartment"]
                ],
            },
            "findings": roster_quality_findings(summary),
        }
        return with_analytics_consistency(
            result,
            [
                (
                    "roster.total_equals_status_groups",
                    summary["total"] == sum(item["employee_count"] for item in result["groups"]["by_status"]),
                ),
                (
                    "roster.total_equals_company_groups",
                    summary["total"] == sum(item["employee_count"] for item in result["groups"]["by_company"]),
                ),
                (
                    "roster.active_plus_inactive_equals_total",
                    active_employees + inactive_employees == summary["total"],
                ),
                (
                    "roster.company_groups_active_inactive_partition",
                    all(
                        item["active_employees"] + item["inactive_employees"] == item["employee_count"]
                        for item in result["groups"]["by_company"]
                    ),
                ),
                (
                    "roster.department_groups_active_inactive_partition",
                    all(
                        item["active_employees"] + item["inactive_employees"] == item["employee_count"]
                        for item in result["groups"]["by_department"]
                    ),
                ),
            ],
        )

    def analyze_contract_coverage(
        self,
        *,
        company_name: str | None = None,
        company_names: list[str] | None = None,
        as_of: str | None = None,
    ) -> dict[str, Any]:
        analysis_date = parse_analysis_date(as_of)
        employee_ids = self.scoped_employee_ids(company_name=company_name, company_names=company_names)
        employee_query = self.table("employees").select(
            "id,name,status,phone,id_card_number,companies(name),departments(name)"
        ).order("name")
        if employee_ids is not None:
            if not employee_ids:
                return empty_contract_coverage_analysis(company_name, company_names, analysis_date)
            employee_query = employee_query.in_("id", employee_ids)
        employees, _count = execute(employee_query)
        contract_query = self.table("contracts").select(
            "id,employee_id,type,start_date,expiry_date,is_permanent,"
            "employees(id,name,phone,id_card_number,status,companies(name),departments(name))"
        )
        if employee_ids is not None:
            contract_query = contract_query.in_("employee_id", employee_ids)
        contracts, _count = execute(contract_query)
        active_employees = [row for row in employees if employee_status_is_active(row.get("status"))]
        active_employee_ids = {row.get("id") for row in active_employees}
        contract_employee_ids = {row.get("employee_id") for row in contracts}
        active_contracts = [
            row
            for row in contracts
            if row.get("employee_id") in active_employee_ids
            and contract_is_active(row, as_of=analysis_date)
        ]
        active_contract_employee_ids = {row.get("employee_id") for row in active_contracts}
        without_any_contract = [
            employee_business_row(row)
            for row in active_employees
            if row.get("id") not in contract_employee_ids
        ]
        without_active_contract = [
            employee_business_row(row)
            for row in active_employees
            if row.get("id") in contract_employee_ids and row.get("id") not in active_contract_employee_ids
        ]
        denominator = len(active_employees)
        with_any_contract = denominator - len(without_any_contract)
        with_active_contract = denominator - len(without_any_contract) - len(without_active_contract)
        expiring_contracts = [
            contract_business_row_for_analysis(row)
            for row in active_contracts
            if contract_expires_within(row, as_of=analysis_date, days=30)
        ]
        overlap_employees = overlapping_contract_employee_rows(contracts, active_employee_ids)
        result = {
            "topic": "contract-coverage",
            "as_of": analysis_date.isoformat(),
            "scope": analysis_scope(company_name, company_names),
            "summary": {
                "total_employees": len(employees),
                "coverage_denominator": denominator,
                "active_employees": denominator,
                "contract_records": len(contracts),
                "active_contract_records": len(active_contracts),
                "employees_with_any_contract": with_any_contract,
                "employees_without_any_contract": len(without_any_contract),
                "employees_with_active_contract": with_active_contract,
                "employees_without_active_contract": len(without_any_contract) + len(without_active_contract),
                "coverage_rate_any": round(with_any_contract / denominator, 4) if denominator else None,
                "coverage_rate_active": round(with_active_contract / denominator, 4) if denominator else None,
            },
            "groups": {
                "by_contract_type": [
                    {"type": key, "contract_count": value}
                    for key, value in count_by(contracts, "type").items()
                ],
            },
            "findings": contract_coverage_findings(
                without_any_contract=without_any_contract,
                without_active_contract=without_active_contract,
                expiring_contracts=expiring_contracts,
                overlap_employees=overlap_employees,
            ),
            "legacy": {
                "employees_total": len(employees),
                "active_employees": denominator,
                "contract_records": len(contracts),
                "active_with_contracts": with_any_contract,
                "active_without_contracts": len(without_any_contract),
                "active_contract_coverage_rate": round(with_any_contract / denominator, 4) if denominator else None,
                "contract_type_distribution": count_by(contracts, "type"),
                "active_without_contract_records": without_any_contract,
            },
        }
        result.update(result["legacy"])
        return with_analytics_consistency(
            result,
            [
                (
                    "contract_coverage.any_contract_partition",
                    with_any_contract + len(without_any_contract) == denominator,
                ),
                (
                    "contract_coverage.active_contract_partition",
                    with_active_contract + len(without_any_contract) + len(without_active_contract)
                    == denominator,
                ),
                (
                    "contract_coverage.active_not_greater_than_any",
                    with_active_contract <= with_any_contract,
                ),
            ],
        )

    def analyze_contract_expiry(
        self,
        *,
        days: str | int | None = None,
        company_name: str | None = None,
        company_names: list[str] | None = None,
    ) -> dict[str, Any]:
        range_days = int(clean_optional(days) or 90)
        if range_days < 0:
            raise RuntimeError(f"days must be a positive number: {days}")
        today = date.today()
        end = today + timedelta(days=range_days)
        query = self.table("contracts").select(contract_select())
        employee_ids = self.scoped_employee_ids(company_name=company_name, company_names=company_names)
        if employee_ids is not None:
            if not employee_ids:
                return {"days": range_days, "from": today.isoformat(), "to": end.isoformat(), "count": 0, "records": []}
            query = query.in_("employee_id", employee_ids)
        data, _count = execute(query)
        current_by_employee: dict[str, dict[str, Any]] = {}
        for row in data:
            employee_id = str(row.get("employee_id") or deep_get(row, "employees.id") or "")
            if not employee_id:
                continue
            current = current_by_employee.get(employee_id)
            if current is None or contract_recency_key(row) > contract_recency_key(current):
                current_by_employee[employee_id] = row
        records = [
            contract_business_row(row)
            for row in current_by_employee.values()
            if not row.get("is_permanent")
            and (expiry := parse_date_value(row.get("expiry_date"))) is not None
            and today <= expiry <= end
        ]
        records.sort(key=lambda row: str(row.get("expiry_date") or ""))
        result = {
            "topic": "contract-expiry",
            "as_of": today.isoformat(),
            "scope": analysis_scope(company_name, company_names),
            "summary": {
                "days": range_days,
                "from": today.isoformat(),
                "to": end.isoformat(),
                "expiring_contracts": len(records),
            },
            "groups": {
                "by_company": count_records_group(records, "company", "company"),
                "by_contract_type": count_records_group(records, "type", "type"),
            },
            "findings": [
                analytics_finding(
                    kind="contract_expiring",
                    severity="medium",
                    basis=f"current contract expiry date between {today.isoformat()} and {end.isoformat()}",
                    records=records,
                )
            ]
            if records
            else [],
            "days": range_days,
            "from": today.isoformat(),
            "to": end.isoformat(),
            "count": len(records),
            "records": records,
        }
        return with_analytics_consistency(
            result,
            [
                ("contract_expiry.count_matches_records", len(records) == result["summary"]["expiring_contracts"]),
                *finding_consistency_checks(result["findings"]),
            ],
        )

    def analyze_performance_month(self, **options: Any) -> dict[str, Any]:
        result = self.performance_by_month(**options)
        records = result["records"]
        scores = [float(row["final_score"]) for row in records if is_number(row.get("final_score"))]
        active_employees = self.active_employee_rows(
            company_name=options.get("company_name"),
            company_names=options.get("company_names"),
        )
        reviewed_employee_ids = {row.get("employee_id") for row in records if row.get("employee_id")}
        reviewed_employee_names = {row.get("employee") for row in records if row.get("employee")}
        missing_reviews = [
            employee_business_row(row)
            for row in active_employees
            if row.get("id") not in reviewed_employee_ids and row.get("name") not in reviewed_employee_names
        ]
        low_scores = sorted(
            [row for row in records if to_float(row.get("final_score")) < 60],
            key=lambda row: to_float(row.get("final_score")),
        )
        findings = []
        if missing_reviews:
            findings.append(
                analytics_finding(
                    kind="missing_performance_review",
                    severity="medium",
                    basis=f"active employee without performance review in {result['month']}",
                    records=missing_reviews,
                )
            )
        if low_scores:
            findings.append(
                analytics_finding(
                    kind="low_performance_score",
                    severity="medium",
                    basis=f"final_score below 60 in {result['month']}",
                    records=low_scores,
                )
            )
        data = {
            "topic": "performance-month",
            "as_of": date.today().isoformat(),
            "month": result["month"],
            "scope": analysis_scope(options.get("company_name"), options.get("company_names")),
            "summary": {
                "month": result["month"],
                "coverage_denominator": len(active_employees),
                "review_records": len(records),
                "reviewed_employees": len(reviewed_employee_ids or reviewed_employee_names),
                "missing_review_employees": len(missing_reviews),
                "average_final_score": average(scores),
                "min_final_score": min(scores) if scores else None,
                "max_final_score": max(scores) if scores else None,
                "low_score_count_below_60": len(low_scores),
                "performance_salary_total": sum_numeric(records, "performance_salary"),
                "actual_performance_salary_total": sum_numeric(records, "actual_performance_salary"),
                "performance_adjustment_total": sum_numeric(records, "performance_adjustment"),
            },
            "groups": {
                "by_company": performance_summary_groups(records),
                "by_score_band": score_band_groups(records),
            },
            "findings": findings,
            "company": result["company"],
            "count": len(records),
            "average_final_score": average(scores),
            "min_final_score": min(scores) if scores else None,
            "max_final_score": max(scores) if scores else None,
            "low_score_count_below_60": len(low_scores),
            "performance_salary_total": sum_numeric(records, "performance_salary"),
            "actual_performance_salary_total": sum_numeric(records, "actual_performance_salary"),
            "performance_adjustment_total": sum_numeric(records, "performance_adjustment"),
            "by_company": summarize_performance_by(records, "company"),
            "records": records,
        }
        return with_analytics_consistency(
            data,
            [
                (
                    "performance_month.reviewed_plus_missing_matches_denominator",
                    data["summary"]["reviewed_employees"] + data["summary"]["missing_review_employees"]
                    == data["summary"]["coverage_denominator"],
                ),
                *finding_consistency_checks(findings),
            ],
        )

    def analyze_low_performance(self, *, threshold: str | int | None = None, **options: Any) -> dict[str, Any]:
        limit = float(clean_optional(threshold) or 60)
        result = self.performance_by_month(**options)
        records = sorted(
            [row for row in result["records"] if to_float(row.get("final_score")) < limit],
            key=lambda row: to_float(row.get("final_score")),
        )
        return {"month": result["month"], "company": result["company"], "threshold": limit, "count": len(records), "records": records}

    def analyze_insurance_month(self, **options: Any) -> dict[str, Any]:
        result = self.insurance_changes_by_month(**options)
        records = result["records"]
        missing_signed = [row for row in records if not clean_optional(row.get("signed_upload"))]
        findings = [
            analytics_finding(
                kind="missing_signed_upload",
                severity="medium",
                basis=f"insurance change in {result['month']} without signed upload",
                records=missing_signed,
            )
        ] if missing_signed else []
        data = {
            "topic": "insurance-month",
            "as_of": date.today().isoformat(),
            "month": result["month"],
            "scope": analysis_scope(options.get("company_name"), options.get("company_names")),
            "summary": {
                "month": result["month"],
                "total_changes": len(records),
                "add_count": len([row for row in records if clean_optional(row.get("insurance_add_date"))]),
                "remove_count": len([row for row in records if clean_optional(row.get("insurance_remove_date"))]),
                "missing_signed_upload_count": len(missing_signed),
            },
            "groups": {
                "by_status": count_records_group(records, "status", "status"),
                "by_company": count_records_group(records, "company", "company"),
            },
            "findings": findings,
            "company": result["company"],
            "count": len(records),
            "by_status": count_by(records, "status"),
            "by_company": count_by(records, "company"),
            "add_count": len([row for row in records if clean_optional(row.get("insurance_add_date"))]),
            "remove_count": len([row for row in records if clean_optional(row.get("insurance_remove_date"))]),
            "records": records,
        }
        return with_analytics_consistency(
            data,
            [
                (
                    "insurance_month.total_matches_status_groups",
                    len(records) == sum(item["record_count"] for item in data["groups"]["by_status"]),
                ),
                *finding_consistency_checks(findings),
            ],
        )

    def analyze_personnel_change(
        self,
        *,
        year: str | int | None = None,
        company_name: str | None = None,
        company_names: list[str] | None = None,
    ) -> dict[str, Any]:
        range_ = year_range(str(year) if year is not None else None)
        query = (
            self.table("personnel_changes")
            .select(personnel_change_select())
            .gte("effective_date", range_["from"])
            .lte("effective_date", range_["to"])
            .order("effective_date", desc=True)
        )
        employee_ids = self.scoped_employee_ids(company_name=company_name, company_names=company_names)
        if employee_ids is not None:
            if not employee_ids:
                records: list[dict[str, Any]] = []
            else:
                query = query.in_("employee_id", employee_ids)
                data, _count = execute(query)
                records = [personnel_change_business_row(row) for row in data]
        else:
            data, _count = execute(query)
            records = [personnel_change_business_row(row) for row in data]
        incomplete = [row for row in records if row.get("procedures_complete") is not True]
        missing_signed = [row for row in records if not clean_optional(row.get("signed_upload"))]
        findings = []
        if incomplete:
            findings.append(
                analytics_finding(
                    kind="incomplete_personnel_change_procedure",
                    severity="medium",
                    basis=f"personnel change in {range_['label']} with incomplete procedure",
                    records=incomplete,
                )
            )
        if missing_signed:
            findings.append(
                analytics_finding(
                    kind="missing_signed_upload",
                    severity="medium",
                    basis=f"personnel change in {range_['label']} without signed upload",
                    records=missing_signed,
                )
            )
        result = {
            "topic": "personnel-change",
            "as_of": date.today().isoformat(),
            "scope": analysis_scope(company_name, company_names),
            "summary": {
                "year": range_["label"],
                "from": range_["from"],
                "to": range_["to"],
                "total_changes": len(records),
                "incomplete_procedures_count": len(incomplete),
                "missing_signed_upload_count": len(missing_signed),
            },
            "groups": {
                "by_company": count_records_group(records, "company", "company"),
                "by_change_reason": count_records_group(records, "change_reason", "change_reason"),
            },
            "findings": findings,
            "year": range_["label"],
            "company": scope_label(company_name, company_names),
            "count": len(records),
            "by_company": count_by(records, "company"),
            "by_change_reason": count_by(records, "change_reason"),
            "records": records,
        }
        return with_analytics_consistency(
            result,
            [
                (
                    "personnel_change.total_matches_reason_groups",
                    len(records) == sum(item["record_count"] for item in result["groups"]["by_change_reason"]),
                ),
                *finding_consistency_checks(findings),
            ],
        )

    def analyze_disciplinary(
        self,
        *,
        company_name: str | None = None,
        company_names: list[str] | None = None,
    ) -> dict[str, Any]:
        query = self.table("disciplinary_records").select(disciplinary_record_select()).order(DISCIPLINARY_DATE_FIELD, desc=True)
        employee_ids = self.scoped_employee_ids(company_name=company_name, company_names=company_names)
        if employee_ids is not None:
            if not employee_ids:
                return {"company": scope_label(company_name, company_names), "count": 0, "records": []}
            query = query.in_("employee_id", employee_ids)
        data, _count = execute(query)
        records = [disciplinary_record_business_row(row) for row in data]
        missing_signed = [row for row in records if not row.get("signed_upload")]
        findings = [
            analytics_finding(
                kind="missing_signed_upload",
                severity="medium",
                basis="disciplinary record without signed upload",
                records=missing_signed,
            )
        ] if missing_signed else []
        result = {
            "topic": "disciplinary",
            "as_of": date.today().isoformat(),
            "scope": analysis_scope(company_name, company_names),
            "summary": {
                "total_records": len(records),
                "missing_signed_upload_count": len(missing_signed),
            },
            "groups": {
                "by_company": count_records_group(records, "company", "company"),
                "by_penalty_type": count_records_group(records, "penalty_type", "penalty_type"),
            },
            "findings": findings,
            "company": scope_label(company_name, company_names),
            "count": len(records),
            "by_company": count_by(records, "company"),
            "by_penalty_type": count_by(records, "penalty_type"),
            "missing_signed_upload_count": len(missing_signed),
            "records": records,
        }
        return with_analytics_consistency(
            result,
            [
                (
                    "disciplinary.total_matches_penalty_groups",
                    len(records) == sum(item["record_count"] for item in result["groups"]["by_penalty_type"]),
                ),
                *finding_consistency_checks(findings),
            ],
        )

    def analyze_seal_usage(
        self,
        *,
        company_name: str | None = None,
        company_names: list[str] | None = None,
        date_from: str | None = None,
        date_to: str | None = None,
    ) -> dict[str, Any]:
        result = self.seal_usage_list(
            company_name=company_name,
            company_names=company_names,
            date_from=date_from,
            date_to=date_to,
        )
        records = result["records"]
        missing_attachments = [
            row for row in records if not row.get("attachments")
        ]
        missing_seal_applicant = [
            row for row in records if not clean_optional(row.get("seal_applicant"))
        ]
        findings = []
        if missing_attachments:
            findings.append(
                analytics_finding(
                    kind="missing_seal_usage_attachment",
                    severity="medium",
                    basis="seal usage without attachment",
                    records=missing_attachments,
                )
            )
        if missing_seal_applicant:
            findings.append(
                analytics_finding(
                    kind="missing_seal_applicant",
                    severity="medium",
                    basis="seal usage without seal applicant",
                    records=missing_seal_applicant,
                )
            )
        data = {
            "topic": "seal-usage",
            "as_of": date.today().isoformat(),
            "scope": analysis_scope(company_name, company_names),
            "summary": {
                "from": clean_optional(date_from),
                "to": clean_optional(date_to),
                "total_usages": len(records),
                "missing_attachments_count": len(missing_attachments),
                "missing_seal_applicant_count": len(missing_seal_applicant),
            },
            "groups": {
                "by_company": count_records_group(records, "company", "company"),
                "by_applicant": count_records_group(records, "applicant", "applicant"),
            },
            "findings": findings,
            "company": result["company"],
            "count": len(records),
            "by_company": count_by(records, "company"),
            "records": records,
        }
        return with_analytics_consistency(
            data,
            [
                (
                    "seal_usage.total_matches_company_groups",
                    len(records) == sum(item["record_count"] for item in data["groups"]["by_company"]),
                ),
                *finding_consistency_checks(findings),
            ],
        )

    def analyze_employee_profile(
        self,
        *,
        company_name: str | None = None,
        company_names: list[str] | None = None,
        as_of: str | None = None,
    ) -> dict[str, Any]:
        analysis_date = parse_analysis_date(as_of)
        summary = self.employee_summary(company_name=company_name, company_names=company_names)
        status_counts: dict[str, int] = defaultdict(int)
        for company in summary["byCompany"]:
            for status, count in company["statuses"].items():
                status_counts[status] += count
        checks = summary["checks"]
        result = {
            "topic": "employee-profile",
            "as_of": analysis_date.isoformat(),
            "scope": analysis_scope(company_name, company_names),
            "summary": {
                "total_employees": summary["total"],
                "missing_department_count": len(checks["emptyDepartment"]),
                "missing_id_card_count": len(checks["emptyIdCard"]),
                "duplicate_id_card_groups": len(checks["duplicateIdCards"]),
                "duplicate_phone_groups": len(checks["duplicatePhones"]),
            },
            "groups": {
                "by_status": [
                    {"status": status, "employee_count": count}
                    for status, count in sort_object(status_counts).items()
                ],
                "by_company": [
                    employee_summary_analysis_group(item, ["company"]) for item in summary["byCompany"]
                ],
            },
            "findings": roster_quality_findings(summary),
        }
        return with_analytics_consistency(
            result,
            [
                (
                    "employee_profile.total_matches_status_groups",
                    summary["total"] == sum(item["employee_count"] for item in result["groups"]["by_status"]),
                ),
                (
                    "employee_profile.total_matches_company_groups",
                    summary["total"] == sum(item["employee_count"] for item in result["groups"]["by_company"]),
                ),
                (
                    "employee_profile.company_groups_active_inactive_partition",
                    all(
                        item["active_employees"] + item["inactive_employees"] == item["employee_count"]
                        for item in result["groups"]["by_company"]
                    ),
                ),
            ],
        )

    def pending_review_list(self) -> list[dict[str, Any]]:
        modules = [
            ("performance_reviews", "绩效"),
            ("insurance_changes", "社医保"),
            ("personnel_changes", "人事异动"),
            ("disciplinary_records", "奖惩"),
            ("seal_usage", "用章"),
        ]
        results: list[dict[str, Any]] = []
        for table, label in modules:
            try:
                data, _count = execute(self.table(table).select("*").limit(500))
            except Exception:
                data = []
            rows = [pending_review_business_row(row) for row in data if row_needs_review(row)]
            results.append({"module": label, "source": table, "count": len(rows), "rows": rows})
        return results

    def data_quality_check(self) -> dict[str, Any]:
        employee_summary = self.employee_summary()
        return {
            "employee_checks": employee_summary["checks"],
            "employees_without_contracts": self.employees_without_contracts(),
            "pending_reviews": [
                {"module": item["module"], "count": item["count"], "source": item["source"]}
                for item in self.pending_review_list()
            ],
        }

    def analyze_hr_risk_dashboard(self, *, limit: int | None = None) -> dict[str, Any]:
        effective_limit = bounded_result_limit(limit)
        headcount = self.analyze_headcount()
        coverage = self.analyze_contract_coverage()
        expiry = self.analyze_contract_expiry(days=90)
        pending = self.pending_review_list()
        disciplinary = self.analyze_disciplinary()
        return {
            "counts": self.count_all_tables(),
            "headcount_summary": {
                "total": headcount["total"],
                "active": headcount["active"],
                "resigned": headcount["resigned"],
                "quality_flags": headcount["quality_flags"],
            },
            "contract_summary": {
                "active_contract_coverage_rate": coverage["active_contract_coverage_rate"],
                "active_without_contracts": coverage["active_without_contracts"],
                "expiring_in_90_days": expiry["count"],
            },
            "disciplinary_summary": {
                "total": disciplinary["count"],
                "missing_signed_upload_count": disciplinary["missing_signed_upload_count"],
                "by_penalty_type": disciplinary["by_penalty_type"],
            },
            "pending_reviews": [
                {"module": item["module"], "count": item["count"], "source": item["source"]}
                for item in pending
            ],
            "recommended_actions": hr_risk_recommended_actions(headcount, coverage, expiry, disciplinary, pending, limit=effective_limit),
        }

    def employees_without_contracts(self) -> dict[str, Any]:
        employees, _count = execute(
            self.table("employees")
            .select("id,name,status,phone,id_card_number,companies(name),departments(name)")
            .order("name")
        )
        contracts, _count = execute(self.table("contracts").select("employee_id"))
        with_contracts = {row.get("employee_id") for row in contracts}
        rows = [
            {
                "name": row.get("name"),
                "company": deep_get(row, "companies.name"),
                "department": deep_get(row, "departments.name"),
                "status": row.get("status"),
                "phone": row.get("phone"),
                "id_card_number": row.get("id_card_number"),
            }
            for row in employees
            if row.get("id") not in with_contracts
        ]
        by_company: dict[str, dict[str, Any]] = {}
        for row in rows:
            item = summary_item(by_company, row.get("company") or "(未归属公司)")
            item["total"] += 1
            status = row.get("status") or "(空状态)"
            item["statuses"][status] = item["statuses"].get(status, 0) + 1
        return {
            "total": len(rows),
            "byCompany": [
                {"company": company, "total": item["total"], "statuses": sort_object(item["statuses"])}
                for company, item in by_company.items()
            ],
            "rows": rows,
        }

    def preview_org_seeds(self, *, plan: Any, company_name: str | None = None) -> dict[str, Any]:
        # FIXME: FIX-069 internal org-seeds naming now represents department writes.
        plan = normalize_org_plan(plan, company_name)
        assert_non_empty_org_plan(plan)
        self.assert_plan_company_scope(plan=plan, company_name=company_name, resource="hr.department", action="write")
        departments = []
        for company in plan.get("companies", []):
            name = normalize_required(company.get("name"), "company name")
            self.ensure_company_for_department_create(name)
            for department in company.get("departments", []):
                department_name = department if isinstance(department, str) else department.get("name")
                if not clean_optional(department_name):
                    continue
                lookup = self.find_department(company_name=name, department_name=department_name)
                departments.append(
                    {
                        "company": name,
                        "name": department_name,
                        "action": "would_create" if not lookup["departmentMatches"] else "existing",
                    }
                )
        return {"companies": [], "departments": departments}

    def apply_org_seeds(self, *, plan: Any, confirm: str | None, company_name: str | None = None) -> dict[str, Any]:
        # FIXME: FIX-069 internal org-seeds naming now represents department writes.
        if confirm != "创建部门":
            raise RuntimeError("applyOrgSeeds requires confirm: 创建部门")
        plan = normalize_org_plan(plan, company_name)
        assert_non_empty_org_plan(plan)
        self.assert_plan_company_scope(plan=plan, company_name=company_name, resource="hr.department", action="write")
        results = {"companies": [], "departments": []}
        for company in plan.get("companies", []):
            record = self.ensure_company_for_department_create(company.get("name"))
            for department in company.get("departments", []):
                department_name = department if isinstance(department, str) else department.get("name")
                if not clean_optional(department_name):
                    continue
                department_result = self.ensure_department_for_existing_company(
                    company_name=record["name"],
                    department_name=department_name,
                )
                results["departments"].append(
                    {
                        "company": record["name"],
                        "name": department_result["record"]["name"],
                        "action": department_result["action"],
                    }
                )
        return {"write": results, "verification": self.verify_org_seeds(plan=plan)}

    def verify_org_seeds(self, *, plan: Any, company_name: str | None = None) -> dict[str, Any]:
        # FIXME: FIX-069 internal org-seeds naming now represents department writes.
        plan = normalize_org_plan(plan, company_name)
        self.assert_plan_company_scope(plan=plan, company_name=company_name, resource="hr.department", action="read")
        results = []
        for company in plan.get("companies", []):
            company_name_value = normalize_required(company.get("name"), "company name")
            self.existing_company_for_department_write(company_name_value)
            for department in company.get("departments", []):
                department_name = department if isinstance(department, str) else department.get("name")
                if not clean_optional(department_name):
                    continue
                lookup = self.find_department(company_name=company_name_value, department_name=department_name)
                results.append(
                    {
                        "type": "department",
                        "company": company_name_value,
                        "name": department_name,
                        "ok": len(lookup["departmentMatches"]) == 1,
                        "match_count": len(lookup["departmentMatches"]),
                    }
                )
        return {"ok": all(item["ok"] for item in results), "results": results}

    def preview_org_updates(self, *, plan: Any, company_name: str | None = None) -> dict[str, Any]:
        # FIXME: FIX-069 internal org-seeds naming now represents department writes.
        plan = normalize_org_plan(plan, company_name)
        assert_non_empty_org_plan(plan)
        self.assert_plan_company_scope(plan=plan, company_name=company_name, resource="hr.department", action="write")
        departments = []
        for company in plan.get("companies", []):
            company_identifier = clean_optional(
                company.get("name") or company.get("match_name") or company.get("match_company")
            )
            if company_identifier:
                self.existing_company_for_department_write(company_identifier)
            for department in company.get("departments", []):
                if not isinstance(department, dict):
                    department_name = clean_optional(department)
                    if not department_name:
                        continue
                    department = {"name": department_name}
                department_name = organization_department_match_name(department)
                if not clean_optional(department_name) and not clean_optional(department.get("_match_id")):
                    continue
                matches = self.find_organization_department_matches(company, department, action="write")
                payload = self.organization_department_update_payload(department)
                departments.append(update_preview_item(name=department_name or department.get("_match_id"), matches=matches, payload=payload, extra={"company": clean_optional(department.get("match_company") or company.get("name"))}))
        return {"companies": [], "departments": departments}

    def apply_org_updates(self, *, plan: Any, confirm: str | None, company_name: str | None = None) -> dict[str, Any]:
        # FIXME: FIX-069 internal org-seeds naming now represents department writes.
        if confirm != "更新部门":
            raise RuntimeError("applyOrgUpdates requires confirm: 更新部门")
        plan = normalize_org_plan(plan, company_name)
        assert_non_empty_org_plan(plan)
        self.assert_plan_company_scope(plan=plan, company_name=company_name, resource="hr.department", action="write")
        results = {"companies": [], "departments": []}
        for company in plan.get("companies", []):
            company_identifier = clean_optional(
                company.get("name") or company.get("match_name") or company.get("match_company")
            )
            if company_identifier:
                self.existing_company_for_department_write(company_identifier)
            department_updates = []
            for department in company.get("departments", []):
                if not isinstance(department, dict):
                    department_name = clean_optional(department)
                    if not department_name:
                        continue
                    department = {"name": department_name}
                department_name = organization_department_match_name(department)
                if not clean_optional(department_name) and not clean_optional(department.get("_match_id")):
                    continue
                match_company = clean_optional(department.get("match_company") or company.get("name")) or ""
                department_updates.append(
                    {
                        "match_company": match_company,
                        "department_name": department_name or department.get("_match_id"),
                        "matches": self.find_organization_department_matches(company, department, action="write"),
                        "payload": self.organization_department_update_payload(department),
                    }
                )
            for item in department_updates:
                result = apply_update_to_matches(repo=self, table="departments", matches=item["matches"], payload=item["payload"], label=item["department_name"])
                results["departments"].append({**result, "company": item["match_company"]})
        return {"write": results, "verification": self.verify_org_updates(plan=plan, company_name=company_name)}

    def verify_org_updates(self, *, plan: Any, company_name: str | None = None) -> dict[str, Any]:
        # FIXME: FIX-069 internal org-seeds naming now represents department writes.
        plan = normalize_org_plan(plan, company_name)
        self.assert_plan_company_scope(plan=plan, company_name=company_name, resource="hr.department", action="read")
        departments = []
        for company in plan.get("companies", []):
            company_identifier = clean_optional(
                company.get("name") or company.get("match_name") or company.get("match_company")
            )
            if company_identifier:
                self.existing_company_for_department_write(company_identifier)
            for department in company.get("departments", []):
                if not isinstance(department, dict):
                    department_name = clean_optional(department)
                    if not department_name:
                        continue
                    department = {"name": department_name}
                expected_company = clean_optional(department.get("target_company") or department.get("new_company") or company.get("name")) or ""
                expected_name = clean_optional(department.get("new_name") or department.get("name")) or organization_department_match_name(department) or department.get("_match_id")
                matches = self.find_organization_department_matches(company, department, action="read") if department.get("_match_id") else self.find_department(company_name=expected_company, department_name=expected_name)["departmentMatches"]
                departments.append(verify_update_matches(name=expected_name, matches=matches, payload=self.organization_department_update_payload(department), label="department") | {"company": expected_company})
        items = departments
        return {"ok": all(item["ok"] for item in items), "results": items}

    def organization_department_update_payload(self, department: dict[str, Any]) -> dict[str, Any]:
        payload: dict[str, Any] = {}
        if "new_name" in department or "new_department" in department:
            payload["name"] = clean_optional(department.get("new_name") or department.get("new_department"))
        elif "name" in department and (
            "match_name" in department
            or "match_department" in department
            or "target_company" in department
            or "new_company" in department
        ):
            payload["name"] = clean_optional(department.get("name"))
        target_company = clean_optional(department.get("target_company") or department.get("new_company"))
        if target_company:
            company_matches = self.find_company_by_name(target_company)
            if len(company_matches) == 1:
                payload["company_id"] = company_matches[0]["id"]
        return {key: value for key, value in payload.items() if key in DEPARTMENT_WRITABLE_FIELDS}

    def find_organization_company_matches(self, company: dict[str, Any], *, action: str) -> list[dict[str, Any]]:
        match = self.find_active_by_match_id("company", company, action=action)
        if match is not None:
            return match
        return self.find_company_by_name(organization_match_name(company))

    def find_organization_department_matches(self, company: dict[str, Any], department: dict[str, Any], *, action: str) -> list[dict[str, Any]]:
        match = self.find_active_by_match_id("department", department, action=action)
        if match is not None:
            return match
        return self.find_department(
            company_name=organization_department_match_company(company, department),
            department_name=organization_department_match_name(department),
        )["departmentMatches"]

    def delete_empty_departments(self, *, plan: Any, confirm: str | None) -> list[dict[str, Any]]:
        self.assert_plan_company_scope(plan=plan, resource="hr.department", action="write")
        if confirm != "删除空部门":
            raise RuntimeError("deleteEmptyDepartments requires confirm: 删除空部门")
        results = []
        for record in normalize_records_plan(plan).get("records", []):
            lookup = self.find_department(company_name=record.get("company"), department_name=record.get("department") or record.get("name"))
            if len(lookup["departmentMatches"]) != 1:
                results.append({"department": record.get("department") or record.get("name"), "action": "skipped", "reason": "department not uniquely matched"})
                continue
            department = lookup["departmentMatches"][0]
            employees, count = execute(self.table("employees").select("*", count="exact", head=True).eq("department_id", department["id"]))
            if count:
                results.append({"department": department["name"], "action": "skipped", "reason": "department has employees", "employee_count": count})
                continue
            execute(self.table("departments").delete().eq("id", department["id"]))
            results.append({"department": department["name"], "action": "deleted"})
        return results

    def preview_employee_seeds(self, *, plan: Any) -> dict[str, Any]:
        self.assert_plan_company_scope(plan=plan, resource="hr.employee", action="write")
        plan = normalize_records_plan(plan, normalize_employee_seed_record)
        records = []
        for record in plan["records"]:
            preview = dict(record)
            preview["match"] = {
                "company": self.find_company_by_name(record.get("company")),
                "department": self.find_department(company_name=record.get("company"), department_name=record.get("department")) if record.get("department") else None,
                "existing_employee_count": len(self.find_existing_employee(record)),
            }
            records.append(preview)
        return {"summary": {"records": len(records), "with_existing_employee": len([row for row in records if row["match"]["existing_employee_count"] > 0]), "by_company": count_by(records, "company")}, "records": records}

    def apply_employee_seeds(self, *, plan: Any, confirm: str | None) -> dict[str, Any]:
        self.assert_plan_company_scope(plan=plan, resource="hr.employee", action="write")
        if confirm != "导入员工主档":
            raise RuntimeError("applyEmployeeSeeds requires confirm: 导入员工主档")
        plan = normalize_records_plan(plan, normalize_employee_seed_record)
        results = []
        for record in plan["records"]:
            company_matches = self.find_company_by_name(record.get("company"))
            if len(company_matches) != 1:
                results.append({"name": record.get("name"), "action": "skipped", "reason": "company not uniquely matched"})
                continue
            department = None
            if clean_optional(record.get("department")):
                department_lookup = self.find_department(company_name=record.get("company"), department_name=record.get("department"))
                if len(department_lookup["departmentMatches"]) != 1:
                    results.append({"name": record.get("name"), "action": "skipped", "reason": "department not uniquely matched", "department": record.get("department")})
                    continue
                department = department_lookup["departmentMatches"][0]
            existing = self.find_existing_employee(record)
            if existing:
                results.append({"name": record.get("name"), "action": "existing", "reason": "employee already exists"})
                continue
            payload = employee_payload(record, company_matches[0]["id"], department.get("id") if department else None)
            data = execute_one(self.table("employees").insert(self.audit_insert(payload)).select(employee_select()).single())
            results.append({"name": data.get("name"), "action": "created", "status": data.get("status"), "department": department.get("name") if department else None})
        return {"write": results, "verification": self.verify_employee_seeds(plan=plan)}

    def verify_employee_seeds(self, *, plan: Any) -> dict[str, Any]:
        self.assert_plan_company_scope(plan=plan, resource="hr.employee", action="read")
        plan = normalize_records_plan(plan, normalize_employee_seed_record)
        fields = ["name", "gender", "birth_date", "position", "hire_date", "probation_end_date", "status", "phone", "id_card_number", "id_card_expiry", "education", "school", "graduation_date", "major", "current_address", "hukou_address", "bank_account", "bank_name", "resignation_date", "resignation_reason", "notes"]
        results = []
        for record in plan["records"]:
            matches = self.find_existing_employee(record)
            if len(matches) != 1:
                results.append({"name": record.get("name"), "id_card_number": clean_optional(record.get("id_card_number")), "ok": False, "diffs": [{"field": "employee", "expected": "unique match", "actual": f"{len(matches)} matches"}]})
                continue
            data = execute_one(self.table("employees").select("*,companies(name),departments(name)").eq("id", matches[0]["id"]).single())
            diffs: list[dict[str, Any]] = []
            compare_field(diffs, "company", record.get("company"), deep_get(data, "companies.name"))
            compare_field(diffs, "department", record.get("department"), deep_get(data, "departments.name"))
            expected = employee_payload(record, data.get("company_id"), data.get("department_id"))
            for field in fields:
                compare_field(diffs, field, expected.get(field), data.get(field))
            results.append({"name": record.get("name"), "id_card_number": clean_optional(record.get("id_card_number")), "ok": not diffs, "diffs": diffs})
        return {"ok": all(item["ok"] for item in results), "results": results}

    def preview_employee_updates(self, *, plan: Any) -> dict[str, Any]:
        self.assert_plan_company_scope(plan=plan, resource="hr.employee", action="write")
        plan = normalize_records_plan(plan, normalize_employee_seed_record)
        records = []
        for record in plan["records"]:
            matches = self.find_update_employee_details(record)
            payload = self.employee_update_payload(record)
            records.append(update_preview_item(name=record.get("name"), matches=matches, payload=payload))
        return {"summary": update_summary(records), "records": records}

    def apply_employee_updates(self, *, plan: Any, confirm: str | None) -> dict[str, Any]:
        self.assert_plan_company_scope(plan=plan, resource="hr.employee", action="write")
        if confirm != "更新员工主档":
            raise RuntimeError("applyEmployeeUpdates requires confirm: 更新员工主档")
        plan = normalize_records_plan(plan, normalize_employee_seed_record)
        results = []
        for record in plan["records"]:
            matches = self.find_update_employee_details(record)
            payload = self.employee_update_payload(record)
            results.append(apply_update_to_matches(repo=self, table="employees", matches=matches, payload=payload, label=record.get("name")))
        return {"write": results, "verification": self.verify_employee_updates(plan=plan)}

    def verify_employee_updates(self, *, plan: Any) -> dict[str, Any]:
        self.assert_plan_company_scope(plan=plan, resource="hr.employee", action="read")
        plan = normalize_records_plan(plan, normalize_employee_seed_record)
        results = []
        for record in plan["records"]:
            matches = self.find_update_employee_details(target_match_record(record))
            payload = self.employee_update_payload(record)
            results.append(verify_update_matches(name=record.get("name"), matches=matches, payload=payload, label="employee"))
        return {"ok": all(item["ok"] for item in results), "results": results}

    def employee_update_payload(self, record: dict[str, Any]) -> dict[str, Any]:
        payload = {
            field: clean_optional(record.get(field))
            for field in EMPLOYEE_WRITABLE_FIELDS
            if field in record
        }
        new_company = clean_optional(record.get("new_company") or record.get("target_company"))
        if new_company:
            company_matches = self.find_company_by_name(new_company)
            if len(company_matches) == 1:
                payload["company_id"] = company_matches[0]["id"]
        new_department = clean_optional(record.get("new_department") or record.get("target_department"))
        if new_department:
            lookup = self.find_department(company_name=new_company or record.get("company"), department_name=new_department)
            if len(lookup["departmentMatches"]) == 1:
                payload["department_id"] = lookup["departmentMatches"][0]["id"]
        return payload

    def find_existing_employee(self, record: dict[str, Any]) -> list[dict[str, Any]]:
        if record.get("allow_duplicate_identity") is True:
            return self.find_employee_candidates(name=record.get("name"), company_name=record.get("company"), department_name=record.get("department")).get("candidates", [])
        if clean_optional(record.get("id_card_number")):
            return self.find_employee_by_id_card(record.get("id_card_number"))
        if clean_optional(record.get("phone")):
            return self.find_employee_by_phone(record.get("phone"))
        return self.find_employee_candidates(name=record.get("name"), company_name=record.get("company"), department_name=record.get("department")).get("candidates", [])

    def find_existing_employee_details(self, record: dict[str, Any]) -> list[dict[str, Any]]:
        matches = self.find_existing_employee(record)
        if len(matches) != 1:
            return matches
        data = execute_one(
            self.table("employees").select(employee_detail_select()).eq("id", matches[0]["id"]).single()
        )
        return [data or matches[0]]

    def find_update_employee(self, record: dict[str, Any]) -> list[dict[str, Any]]:
        match = self.find_active_by_match_id("employee", record, action="write")
        if match is not None:
            return match
        match_id_card = clean_optional(match_field_value(record, "id_card_number"))
        if match_id_card and "match_id_card_number" in record:
            return self.find_employee_by_id_card(match_id_card)
        match_phone = clean_optional(match_field_value(record, "phone"))
        if match_phone and "match_phone" in record:
            return self.find_employee_by_phone(match_phone)
        return self.find_employee_candidates(
            name=match_field_value(record, "name"),
            company_name=match_field_value(record, "company"),
            department_name=match_field_value(record, "department"),
        ).get("candidates", [])

    def find_update_employee_details(self, record: dict[str, Any]) -> list[dict[str, Any]]:
        matches = self.find_update_employee(record)
        if len(matches) != 1:
            return matches
        data = execute_one(
            self.table("employees").select(employee_detail_select()).eq("id", matches[0]["id"]).single()
        )
        return [data or matches[0]]

    def delete_employee_records(self, *, plan: Any, confirm: str | None) -> list[dict[str, Any]]:
        self.assert_plan_company_scope(plan=plan, resource="hr.employee", action="delete")
        if confirm != "删除员工记录":
            raise RuntimeError("deleteEmployeeRecords requires confirm: 删除员工记录")
        results = []
        for record in normalize_records_plan(plan, normalize_employee_seed_record).get("records", []):
            matches = self.find_active_by_match_id("employee", record, action="delete")
            if matches is None:
                matches = [row for row in self.find_existing_employee(record) if employee_matches_expected(row, record)]
            if len(matches) != 1:
                results.append({"name": record.get("name"), "action": "skipped", "reason": f"expected one exact employee match, found {len(matches)}"})
                continue
            employee = matches[0]
            child_counts = self.employee_child_record_counts(employee["id"])
            non_zero = {key: value for key, value in child_counts.items() if value > 0}
            if non_zero and record.get("allow_child_delete") is not True:
                results.append({"name": employee.get("name"), "action": "skipped", "reason": "employee has child records", "child_counts": non_zero})
                continue
            execute(
                self.table("employees")
                .update(self.audit_update({"is_deleted": True}))
                .eq("id", employee["id"])
            )
            results.append({"name": employee.get("name"), "action": "deleted", "company": deep_get(employee, "companies.name"), "department": deep_get(employee, "departments.name"), "child_counts": child_counts})
        return results

    def deleted_records(
        self,
        *,
        resource: str | None,
        company_name: str | None = None,
        company_names: list[str] | None = None,
        limit: Any = 100,
    ) -> dict[str, Any]:
        config = deleted_record_config(resource)
        self.assert_plan_company_scope(plan=None, company_name=company_name, resource=config["resource"], action="read")
        query = self.table_including_deleted(config["table"]).select(audit_select(config["select"])).eq("is_deleted", True)
        scope_kind = config["scope"]
        if scope_kind == "company":
            company_ids = self.scoped_company_ids(company_name=company_name, company_names=company_names)
            if company_ids is not None:
                if not company_ids:
                    return {"resource": config["name"], "count": 0, "records": []}
                query = query.in_("company_id", company_ids)
        elif scope_kind == "employee":
            employee_ids = self.scoped_employee_ids(company_name=company_name, company_names=company_names)
            if employee_ids is not None:
                if not employee_ids:
                    return {"resource": config["name"], "count": 0, "records": []}
                query = query.in_("employee_id", employee_ids)
        rows, _count = execute(query.limit(clean_integer(limit) or 100))
        mapper = config["mapper"]
        return {
            "resource": config["name"],
            "count": len(rows),
            "records": [audit_business_row(row, mapper) for row in rows],
        }

    def verify_employee_deletions(self, *, plan: Any) -> dict[str, Any]:
        self.assert_plan_company_scope(plan=plan, resource="hr.employee", action="read")
        results = []
        for record in normalize_records_plan(plan).get("records", []):
            matches = [row for row in self.find_existing_employee(record) if employee_matches_expected(row, record)]
            results.append({"name": record.get("name"), "ok": len(matches) == 0, "remaining_matches": [employee_business_row(row) for row in matches]})
        return {"ok": all(item["ok"] for item in results), "results": results}

    def employee_child_record_counts(self, employee_id: str) -> dict[str, int]:
        counts: dict[str, int] = {}
        for table in ["contracts", "performance_reviews", "insurance_changes", "personnel_changes", "disciplinary_records", "overtime_records", "work_injuries"]:
            _rows, count = execute(self.table(table).select("*", count="exact", head=True).eq("employee_id", employee_id))
            counts[table] = int(count or 0)
        for label, column in {"seal_usage_applicant": "applicant_id", "seal_usage_user": "seal_applicant_id"}.items():
            _rows, count = execute(self.table("seal_usage").select("*", count="exact", head=True).eq(column, employee_id))
            counts[label] = int(count or 0)
        return counts

    def clear_business_data(self, *, confirm: str | None) -> list[dict[str, Any]]:
        if confirm != "清空人事业务数据":
            raise RuntimeError("clearBusinessData requires confirm: 清空人事业务数据")
        results = []
        for item in CLEAR_ORDER:
            before = self.count_table(item["table"])
            execute(self.table(item["table"]).delete().neq("id", ZERO_UUID))
            after = self.count_table(item["table"])
            results.append({**item, "before": before, "after": after})
        return results

    def apply_employee_nickname_cleanup(self, *, plan: Any, confirm: str | None) -> list[dict[str, Any]]:
        self.assert_plan_company_scope(plan=plan, resource="hr.employee", action="write")
        if confirm != "清理员工姓名花名":
            raise RuntimeError("applyEmployeeNicknameCleanup requires confirm: 清理员工姓名花名")
        results = []
        for record in normalize_records_plan(plan).get("records", []):
            employee_id = normalize_required(record.get("id"), "employee id")
            new_name = normalize_required(record.get("new_name"), "new employee name")
            new_notes = clean_optional(record.get("new_notes"))
            current = execute_one(
                self.table("employees")
                .select("id,name,notes,companies(name),departments(name)")
                .eq("id", employee_id)
                .single()
            )
            if current and current.get("name") == new_name and normalize_comparable(current.get("notes")) == normalize_comparable(new_notes):
                results.append({"name": new_name, "action": "unchanged"})
                continue
            data = execute_one(
                self.table("employees")
                .update(self.audit_update({"name": new_name, "notes": new_notes}))
                .eq("id", employee_id)
                .select("id,name,notes,companies(name),departments(name)")
                .single()
            )
            results.append(
                {
                    "old_name": record.get("old_name"),
                    "name": data.get("name"),
                    "action": "updated",
                    "company": deep_get(data, "companies.name"),
                    "department": deep_get(data, "departments.name"),
                }
            )
        return results

    def verify_employee_nickname_cleanup(self, *, plan: Any) -> dict[str, Any]:
        self.assert_plan_company_scope(plan=plan, resource="hr.employee", action="read")
        results = []
        for record in normalize_records_plan(plan).get("records", []):
            employee_id = normalize_required(record.get("id"), "employee id")
            data = execute_one(
                self.table("employees")
                .select("id,name,notes,companies(name),departments(name)")
                .eq("id", employee_id)
                .single()
            )
            diffs: list[dict[str, Any]] = []
            compare_field(diffs, "name", record.get("new_name"), data.get("name") if data else None)
            compare_field(diffs, "notes", record.get("new_notes"), data.get("notes") if data else None)
            results.append(
                {
                    "old_name": record.get("old_name"),
                    "name": record.get("new_name"),
                    "ok": not diffs,
                    "diffs": diffs,
                }
            )
        return {"ok": all(item["ok"] for item in results), "results": results}

    def preview_generic_seeds(self, *, plan: Any, resource: str, normalizer: Callable[[dict[str, Any]], dict[str, Any]], name_field: str = "employee_name") -> dict[str, Any]:
        self.assert_plan_company_scope(plan=plan, resource=resource, action="write")
        plan = self.prepare_generic_employee_plan(plan, normalizer)
        return {"summary": preview_summary(plan["records"], name_field), "records": plan["records"]}

    def apply_generic_seeds(self, *, plan: Any, confirm: str | None, expected_confirm: str, resource: str, table: str, normalizer: Callable[[dict[str, Any]], dict[str, Any]], payload_builder: Callable[[dict[str, Any], str], dict[str, Any]], select: str, existing_finder: Callable[[dict[str, Any]], list[dict[str, Any]]], label: str, name_field: str = "employee_name") -> dict[str, Any]:
        self.assert_plan_company_scope(plan=plan, resource=resource, action="write")
        if confirm != expected_confirm:
            raise RuntimeError(f"{label} requires confirm: {expected_confirm}")
        plan = self.prepare_generic_employee_plan(plan, normalizer)
        results = []
        for index, record in enumerate(plan["records"]):
            try:
                employee = deep_get(record, "match.employee")
                if not employee:
                    results.append({"name": record.get(name_field), "action": "skipped", "reason": "employee not matched"})
                    continue
                existing = existing_finder(record)
                if existing:
                    results.append(
                        {
                            "name": record.get(name_field),
                            "action": "existing",
                            "reason": f"{table} already exists",
                            **matched_records_summary(existing),
                        }
                    )
                    continue
                record = self.resolve_attachment_fields(
                    record,
                    resource=resource,
                    owner_id=employee["id"],
                )
                data = execute_one(
                    self.table(table)
                    .insert(self.audit_insert(payload_builder(record, employee["id"])))
                    .select(select)
                    .single()
                )
                results.append({"name": deep_get(data, "employees.name") or record.get(name_field), "action": "created"})
            except Exception as exc:  # noqa: BLE001
                raise PartialFailureError(
                    f"{label} failed at record {index + 1}: {exc}",
                    partial_results=results,
                    failed={
                        "index": index,
                        "name": record.get(name_field),
                        "error": str(exc),
                    },
                ) from exc
        return {"write": results, "verification": self.verify_generic_seeds(plan=plan, resource=resource, normalizer=normalizer, fields=[], existing_finder=existing_finder, label=label)}

    def verify_generic_seeds(self, *, plan: Any, resource: str, normalizer: Callable[[dict[str, Any]], dict[str, Any]], fields: list[str], existing_finder: Callable[[dict[str, Any]], list[dict[str, Any]]], label: str) -> dict[str, Any]:
        self.assert_plan_company_scope(plan=plan, resource=resource, action="read")
        plan = self.prepare_generic_employee_plan(plan, normalizer)
        results = []
        for record in plan["records"]:
            matches = existing_finder(record)
            diffs: list[dict[str, Any]] = []
            if len(matches) != 1:
                diffs.append({"field": label, "expected": "unique match", "actual": f"{len(matches)} matches"})
            else:
                compare_field(diffs, "employee", deep_get(record, "match.employee.name"), deep_get(matches[0], "employees.name"))
                for field in fields:
                    compare_field(diffs, field, record.get(field), matches[0].get(field))
            results.append({"name": record.get("employee_name"), "ok": not diffs, "diffs": diffs})
        return {"ok": all(item["ok"] for item in results), "results": results}

    def preview_generic_updates(
        self,
        *,
        plan: Any,
        resource: str,
        table: str,
        normalizer: Callable[[dict[str, Any]], dict[str, Any]],
        payload_builder: Callable[[dict[str, Any], str], dict[str, Any]],
        select: str,
        record_finder: Callable[[dict[str, Any]], list[dict[str, Any]]],
        label: str,
        update_fields: list[str],
        key_fields: list[str],
    ) -> dict[str, Any]:
        del table, select, label
        self.assert_plan_company_scope(plan=plan, resource=resource, action="write")
        plan = self.prepare_generic_employee_plan(plan, normalizer)
        records = []
        for record in plan["records"]:
            employee = deep_get(record, "match.employee")
            payload = generic_update_payload(record, employee, payload_builder, update_fields)
            matches = record_finder(record)
            records.append(update_preview_item(name=record.get("employee_name"), matches=matches, payload=payload))
        return {"summary": update_summary(records), "records": records}

    def apply_generic_updates(
        self,
        *,
        plan: Any,
        confirm: str | None,
        expected_confirm: str,
        resource: str,
        table: str,
        normalizer: Callable[[dict[str, Any]], dict[str, Any]],
        payload_builder: Callable[[dict[str, Any], str], dict[str, Any]],
        select: str,
        record_finder: Callable[[dict[str, Any]], list[dict[str, Any]]],
        label: str,
        update_fields: list[str],
        key_fields: list[str],
    ) -> dict[str, Any]:
        del select, label
        self.assert_plan_company_scope(plan=plan, resource=resource, action="write")
        if confirm != expected_confirm:
            raise RuntimeError(f"generic update requires confirm: {expected_confirm}")
        plan = self.prepare_generic_employee_plan(plan, normalizer)
        results = []
        resolved_records = []
        for record in plan["records"]:
            employee = deep_get(record, "match.employee")
            record = self.resolve_attachment_fields(
                record,
                resource=resource,
                owner_id=employee.get("id") if employee else None,
            )
            resolved_records.append(record)
            payload = generic_update_payload(record, employee, payload_builder, update_fields)
            matches = record_finder(record)
            results.append(apply_update_to_matches(repo=self, table=table, matches=matches, payload=payload, label=record.get("employee_name")))
        resolved_plan = {**plan, "records": resolved_records}
        return {
            "write": results,
            "verification": self.verify_generic_updates(plan=resolved_plan, resource=resource, normalizer=normalizer, payload_builder=payload_builder, record_finder=record_finder, update_fields=update_fields, key_fields=key_fields),
        }

    def delete_generic_employee_records(
        self,
        *,
        plan: Any,
        confirm: str | None,
        expected_confirm: str,
        resource: str,
        table: str,
        normalizer: Callable[[dict[str, Any]], dict[str, Any]],
        record_finder: Callable[[dict[str, Any]], list[dict[str, Any]]],
        label: str,
    ) -> dict[str, Any]:
        self.assert_plan_company_scope(plan=plan, resource=resource, action="delete")
        if confirm != expected_confirm:
            raise RuntimeError(f"{label} delete requires confirm: {expected_confirm}")
        plan = self.prepare_generic_employee_plan(plan, normalizer)
        results = []
        for record in plan["records"]:
            matches = self.find_active_by_match_id(resource, record, action="delete")
            if matches is None:
                matches = record_finder(record)
            results.append(
                self.soft_delete_single_match(
                    table=table,
                    matches=matches,
                    label=label,
                    name=record.get("employee_name"),
                )
            )
        return {"records": results}

    def verify_generic_updates(
        self,
        *,
        plan: Any,
        resource: str,
        normalizer: Callable[[dict[str, Any]], dict[str, Any]],
        payload_builder: Callable[[dict[str, Any], str], dict[str, Any]],
        record_finder: Callable[[dict[str, Any]], list[dict[str, Any]]],
        update_fields: list[str],
        key_fields: list[str],
    ) -> dict[str, Any]:
        self.assert_plan_company_scope(plan=plan, resource=resource, action="read")
        plan = self.prepare_generic_employee_plan(plan, normalizer)
        results = []
        for record in plan["records"]:
            employee = deep_get(record, "match.employee")
            payload = generic_update_payload(record, employee, payload_builder, update_fields)
            matches = record_finder(target_match_record(record))
            results.append(verify_update_matches(name=record.get("employee_name"), matches=matches, payload=payload, label=resource))
        return {"ok": all(item["ok"] for item in results), "results": results}

    def prepare_generic_employee_plan(self, plan: Any, normalizer: Callable[[dict[str, Any]], dict[str, Any]]) -> dict[str, Any]:
        plan = normalize_records_plan(plan, normalizer)
        records = []
        for record in plan["records"]:
            prepared = dict(record)
            prepared.setdefault("match", {})
            prepared["match"].setdefault("employee", self.match_employee_by_name_and_company(prepared.get("employee_name"), prepared.get("company")))
            records.append(prepared)
        return {**plan, "records": records}

    def match_employee_by_name_and_company(self, name: str | None, company: str | None) -> dict[str, Any] | None:
        if not clean_optional(name):
            return None
        result = self.find_employee_candidates(name=name, company_name=company)
        candidates = result.get("candidates") or []
        return insurance_employee(candidates[0]) if len(candidates) == 1 else None

    def find_existing_contract(self, record: dict[str, Any]) -> list[dict[str, Any]]:
        employee = deep_get(record, "match.employee")
        if not employee:
            return []
        query = self.table("contracts").select(contract_select()).eq("employee_id", employee["id"]).eq("type", normalize_required(record.get("type"), "contract type"))
        for field in ["start_date", "expiry_date", "sequence"]:
            value = clean_optional(record_field_value(record, field))
            query = query.eq(field, int(value) if field == "sequence" and value else value) if value else query.is_(field, None)
        data, _count = execute(query.limit(5))
        return data

    def find_update_contract(self, record: dict[str, Any]) -> list[dict[str, Any]]:
        match = self.find_active_by_match_id("contract", record, action="write")
        if match is not None:
            return match
        employee = deep_get(record, "match.employee")
        if not employee:
            return []
        query = self.table("contracts").select(contract_select()).eq("employee_id", employee["id"]).eq("type", normalize_required(match_field_value(record, "type"), "contract type"))
        sequence = clean_optional(match_field_value(record, "sequence"))
        start_date = clean_optional(match_field_value(record, "start_date"))
        if sequence:
            query = query.eq("sequence", int(sequence))
        elif start_date:
            query = query.eq("start_date", start_date)
        data, _count = execute(query.limit(5))
        return data

    def find_update_by_employee_fields(self, table: str, select: str, record: dict[str, Any], key_fields: list[str]) -> list[dict[str, Any]]:
        resource_by_table = {
            "performance_reviews": "performance",
            "insurance_changes": "insurance",
            "disciplinary_records": "disciplinary",
        }
        match = self.find_active_by_match_id(resource_by_table.get(table, table), record, action="write")
        if match is not None:
            return match
        employee = deep_get(record, "match.employee")
        if not employee:
            return []
        query = self.table(table).select(select).eq("employee_id", employee["id"])
        for field in key_fields:
            value = query_field_value(record, field, use_match=True)
            query = query.eq(field, value) if query_value_present(value) else query.is_(field, None)
        data, _count = execute(query.limit(5))
        return data

    def find_update_personnel_change(self, record: dict[str, Any]) -> list[dict[str, Any]]:
        match = self.find_active_by_match_id("personnel-change", record, action="write")
        if match is not None:
            return match
        employee = deep_get(record, "match.employee")
        if not employee:
            return []
        def query_with(fields: list[str]) -> list[dict[str, Any]]:
            query = (
                self.table("personnel_changes")
                .select(personnel_change_select())
                .eq("employee_id", employee["id"])
            )
            for field in fields:
                value = query_field_value(record, field, use_match=True)
                if query_value_present(value):
                    query = query.eq(field, value)
            data, _count = execute(query.limit(5))
            return data

        stable_fields = ["effective_date", "current_department", "current_position"]
        matches = query_with([*stable_fields, "new_position", "change_reason"])
        if matches:
            return matches
        explicit_fields = list(stable_fields)
        if clean_optional(record.get("match_new_position")):
            explicit_fields.append("new_position")
        if clean_optional(record.get("match_change_reason")):
            explicit_fields.append("change_reason")
        return query_with(explicit_fields)

    def normalize_disciplinary_update_record(self, record: dict[str, Any]) -> dict[str, Any]:
        if record.get(DISCIPLINARY_DATE_FIELD):
            return {**record, DISCIPLINARY_DATE_FIELD: normalize_date_array(record.get(DISCIPLINARY_DATE_FIELD))}
        if record.get("incident_date"):
            return {**record, DISCIPLINARY_DATE_FIELD: normalize_date_array(record.get("incident_date"))}
        return record

    def find_existing_by_employee_fields(self, table: str, select: str, record: dict[str, Any], required_fields: list[str], nullable_fields: list[str]) -> list[dict[str, Any]]:
        employee = deep_get(record, "match.employee")
        if not employee:
            return []
        query = self.table(table).select(select).eq("employee_id", employee["id"])
        for field in required_fields:
            query = query.eq(field, normalize_required(record.get(field), field))
        for field in nullable_fields:
            value = query_field_value(record, field, use_match=False)
            query = query.eq(field, value) if query_value_present(value) else query.is_(field, None)
        data, _count = execute(query.limit(5))
        return data

    def apply_disciplinary_attachments(self, *, plan: Any, confirm: str | None) -> list[dict[str, Any]]:
        self.assert_plan_company_scope(plan=plan, resource="hr.disciplinary", action="write")
        if confirm != "回填奖惩附件":
            raise RuntimeError("applyDisciplinaryAttachments requires confirm: 回填奖惩附件")
        storage = getattr(getattr(self.db, "client", None), "storage", None)
        if storage is None:
            raise RuntimeError("当前 Python PostgREST adapter 不支持 Storage 上传，请改用已公开 URL 写入 signed_upload")
        bucket = "hr-documents"
        results = []
        for record in normalize_records_plan(plan, normalize_named_employee_record).get("records", []):
            local_file = normalize_required(record.get("local_file"), "local attachment file")
            storage_path = normalize_required(record.get("storage_path"), "storage path")
            prepared = self.prepare_generic_employee_plan([record], normalize_named_employee_record)["records"][0]
            matches = self.find_existing_by_employee_fields(
                "disciplinary_records",
                disciplinary_record_select(),
                prepared,
                ["penalty_type", "penalty_reason"],
                [DISCIPLINARY_DATE_FIELD],
            )
            if len(matches) != 1:
                results.append({"name": record.get("employee_name"), "action": "skipped", "reason": f"{len(matches)} matching disciplinary records"})
                continue
            content = Path(local_file).read_bytes()
            upload = storage.from_(bucket).upload(storage_path, content, {"upsert": True})
            error = getattr(upload, "error", None) or (upload.get("error") if isinstance(upload, dict) else None)
            if error:
                raise RuntimeError(f"upload disciplinary attachment failed ({record.get('employee_name')}): {error}")
            public = storage.from_(bucket).get_public_url(storage_path)
            public_url = deep_get(public, "data.publicUrl") if isinstance(public, dict) else getattr(getattr(public, "data", None), "publicUrl", None)
            execute(
                self.table("disciplinary_records")
                .update(self.audit_update({"signed_upload": [public_url]}))
                .eq("id", matches[0]["id"])
            )
            results.append(
                {
                    "name": record.get("employee_name"),
                    "action": "uploaded",
                    "incident_date": record.get("incident_date"),
                    "penalty_type": record.get("penalty_type"),
                    "storage_path": storage_path,
                    "public_url": public_url,
                }
            )
        return results

    def verify_disciplinary_attachments(self, *, plan: Any) -> dict[str, Any]:
        self.assert_plan_company_scope(plan=plan, resource="hr.disciplinary", action="read")
        results = []
        for record in normalize_records_plan(plan, normalize_named_employee_record).get("records", []):
            prepared = self.prepare_generic_employee_plan([record], normalize_named_employee_record)["records"][0]
            matches = self.find_existing_by_employee_fields(
                "disciplinary_records",
                disciplinary_record_select(),
                prepared,
                ["penalty_type", "penalty_reason"],
                [DISCIPLINARY_DATE_FIELD],
            )
            diffs: list[dict[str, Any]] = []
            if len(matches) != 1:
                diffs.append({"field": "disciplinary_record", "expected": "unique match", "actual": f"{len(matches)} matches"})
            elif record.get("public_url"):
                compare_field(diffs, "signed_upload", [record.get("public_url")], matches[0].get("signed_upload"))
            results.append(
                {
                    "name": record.get("employee_name"),
                    "incident_date": record.get("incident_date"),
                    "penalty_type": record.get("penalty_type"),
                    "ok": not diffs,
                    "diffs": diffs,
                }
            )
        return {"ok": all(item["ok"] for item in results), "results": results}

    def preview_seal_usage_seeds(self, *, plan: Any) -> dict[str, Any]:
        self.assert_plan_company_scope(plan=plan, resource="hr.seal_usage", action="write")
        plan = self.prepare_seal_usage_plan(plan)
        return {
            "summary": {
                "records": len(plan["records"]),
                "matched_companies": len([row for row in plan["records"] if deep_get(row, "match.company.company")]),
            },
            "records": plan["records"],
        }

    def apply_seal_usage_seeds(self, *, plan: Any, confirm: str | None) -> dict[str, Any]:
        self.assert_plan_company_scope(plan=plan, resource="hr.seal_usage", action="write")
        if confirm != "导入用章记录":
            raise RuntimeError("applySealUsageSeeds requires confirm: 导入用章记录")
        plan = self.prepare_seal_usage_plan(plan)
        results = []
        for record in plan["records"]:
            company = deep_get(record, "match.company.company")
            if not company:
                results.append({"reason": record.get("reason"), "action": "skipped", "detail": "company not matched"})
                continue
            existing = self.find_existing_seal_usage(record)
            if existing:
                results.append({"reason": record.get("reason"), "action": "existing", "usage_date": record.get("usage_date")})
                continue
            record = self.resolve_attachment_fields(
                record,
                resource="hr.seal_usage",
                owner_id=company["id"],
            )
            data = execute_one(
                self.table("seal_usage")
                .insert(self.audit_insert(seal_usage_payload(record, company["id"])))
                .select(seal_usage_select())
                .single()
            )
            results.append(
                {
                    "reason": data.get("reason"),
                    "action": "created",
                    "usage_date": data.get("usage_date"),
                    "seal_applicant": deep_get(data, "seal_applicant.name"),
                }
            )
        return {"write": results, "verification": self.verify_seal_usage_seeds(plan=plan)}

    def verify_seal_usage_seeds(self, *, plan: Any) -> dict[str, Any]:
        self.assert_plan_company_scope(plan=plan, resource="hr.seal_usage", action="read")
        plan = self.prepare_seal_usage_plan(plan)
        results = []
        for record in plan["records"]:
            matches = self.find_existing_seal_usage(record)
            diffs: list[dict[str, Any]] = []
            if len(matches) != 1:
                diffs.append({"field": "seal_usage", "expected": "unique match", "actual": f"{len(matches)} matches"})
            else:
                data = matches[0]
                compare_field(diffs, "company", record.get("company"), deep_get(data, "companies.name"))
                compare_field(diffs, "applicant", deep_get(record, "match.applicant.employee.name"), deep_get(data, "applicant.name"))
                compare_field(diffs, "seal_applicant", deep_get(record, "match.seal_applicant.employee.name"), deep_get(data, "seal_applicant.name"))
                for field in ["usage_date", "reason", "attachments", "notes"]:
                    compare_field(diffs, field, record.get(field), data.get(field))
            results.append({"reason": record.get("reason"), "usage_date": record.get("usage_date"), "ok": not diffs, "diffs": diffs})
        return {"ok": all(item["ok"] for item in results), "results": results}

    def preview_seal_usage_updates(self, *, plan: Any) -> dict[str, Any]:
        self.assert_plan_company_scope(plan=plan, resource="hr.seal_usage", action="write")
        plan = self.prepare_seal_usage_plan(plan)
        records = []
        for record in plan["records"]:
            payload = seal_usage_update_payload(record)
            records.append(update_preview_item(name=record.get("reason"), matches=self.find_update_seal_usage(record, action="write"), payload=payload))
        return {"summary": update_summary(records), "records": records}

    def apply_seal_usage_updates(self, *, plan: Any, confirm: str | None) -> dict[str, Any]:
        self.assert_plan_company_scope(plan=plan, resource="hr.seal_usage", action="write")
        if confirm != "更新用章记录":
            raise RuntimeError("applySealUsageUpdates requires confirm: 更新用章记录")
        plan = self.prepare_seal_usage_plan(plan)
        results = []
        for record in plan["records"]:
            company = deep_get(record, "match.target_company.company") or deep_get(record, "match.company.company")
            record = self.resolve_attachment_fields(
                record,
                resource="hr.seal_usage",
                owner_id=company.get("id") if company else None,
            )
            payload = seal_usage_update_payload(record)
            results.append(apply_update_to_matches(repo=self, table="seal_usage", matches=self.find_update_seal_usage(record, action="write"), payload=payload, label=record.get("reason")))
        return {"write": results, "verification": self.verify_seal_usage_updates(plan=plan)}

    def delete_seal_usage_records(self, *, plan: Any, confirm: str | None) -> dict[str, Any]:
        self.assert_plan_company_scope(plan=plan, resource="hr.seal_usage", action="delete")
        if confirm != "删除用章记录":
            raise RuntimeError("deleteSealUsageRecords requires confirm: 删除用章记录")
        plan = self.prepare_seal_usage_plan(plan)
        results = []
        for record in plan["records"]:
            matches = self.find_update_seal_usage(record, action="delete")
            results.append(
                self.soft_delete_single_match(
                    table="seal_usage",
                    matches=matches,
                    label="seal_usage",
                    name=record.get("reason"),
                )
            )
        return {"records": results}

    def verify_seal_usage_updates(self, *, plan: Any) -> dict[str, Any]:
        self.assert_plan_company_scope(plan=plan, resource="hr.seal_usage", action="read")
        plan = self.prepare_seal_usage_plan(plan)
        results = []
        for record in plan["records"]:
            payload = seal_usage_update_payload(record)
            results.append(verify_update_matches(name=record.get("reason"), matches=self.find_update_seal_usage(seal_usage_target_match_record(record), action="read"), payload=payload, label="seal_usage"))
        return {"ok": all(item["ok"] for item in results), "results": results}

    def prepare_seal_usage_plan(self, plan: Any) -> dict[str, Any]:
        plan = normalize_records_plan(plan, normalize_seal_usage_seed_record)
        records = []
        for record in plan["records"]:
            prepared = dict(record)
            company_matches = self.find_company_by_name(prepared.get("match_company") or prepared.get("company"))
            target_company_matches = self.find_company_by_name(prepared.get("company")) if "company" in prepared else company_matches
            prepared.setdefault("match", {})
            prepared["match"].setdefault(
                "company",
                {
                    "status": "matched" if len(company_matches) == 1 else "ambiguous" if len(company_matches) > 1 else "unmatched",
                    "company": company_matches[0] if len(company_matches) == 1 else None,
                },
            )
            prepared["match"].setdefault(
                "target_company",
                {
                    "status": "matched" if len(target_company_matches) == 1 else "ambiguous" if len(target_company_matches) > 1 else "unmatched",
                    "company": target_company_matches[0] if len(target_company_matches) == 1 else None,
                },
            )
            if prepared.get("match_applicant") or prepared.get("applicant"):
                prepared["match"].setdefault(
                    "applicant",
                    {
                        "employee": self.match_employee_by_name_and_company(
                            prepared.get("match_applicant") or prepared.get("applicant"),
                            prepared.get("match_company") or prepared.get("company"),
                        )
                    },
                )
            if prepared.get("applicant"):
                prepared["match"].setdefault(
                    "target_applicant",
                    {"employee": self.match_employee_by_name_and_company(prepared.get("applicant"), prepared.get("company"))},
                )
            if prepared.get("match_seal_applicant") or prepared.get("seal_applicant"):
                prepared["match"].setdefault(
                    "seal_applicant",
                    {
                        "employee": self.match_employee_by_name_and_company(
                            prepared.get("match_seal_applicant") or prepared.get("seal_applicant"),
                            prepared.get("match_company") or prepared.get("company"),
                        )
                    },
                )
            if prepared.get("seal_applicant"):
                prepared["match"].setdefault(
                    "target_seal_applicant",
                    {"employee": self.match_employee_by_name_and_company(prepared.get("seal_applicant"), prepared.get("company"))},
                )
            records.append(prepared)
        return {**plan, "records": records}

    def find_existing_seal_usage(self, record: dict[str, Any], *, strict_people: bool = True) -> list[dict[str, Any]]:
        company = deep_get(record, "match.company.company")
        if not company:
            return []
        query = self.table("seal_usage").select(seal_usage_select()).eq("company_id", company["id"]).eq("reason", normalize_required(match_field_value(record, "reason"), "seal usage reason"))
        usage_date = clean_optional(match_field_value(record, "usage_date"))
        query = query.eq("usage_date", usage_date) if usage_date else query.is_("usage_date", None)
        applicant = deep_get(record, "match.applicant.employee")
        if applicant:
            query = query.eq("applicant_id", applicant["id"])
        elif strict_people:
            query = query.is_("applicant_id", None)
        seal_applicant = deep_get(record, "match.seal_applicant.employee")
        if seal_applicant:
            query = query.eq("seal_applicant_id", seal_applicant["id"])
        elif strict_people:
            query = query.is_("seal_applicant_id", None)
        data, _count = execute(query.limit(5))
        return data

    def find_update_seal_usage(self, record: dict[str, Any], *, action: str) -> list[dict[str, Any]]:
        match = self.find_active_by_match_id("seal-usage", record, action=action)
        if match is not None:
            return match
        return self.find_existing_seal_usage(record, strict_people=False)

    def soft_delete_single_match(
        self,
        *,
        table: str,
        matches: list[dict[str, Any]],
        label: str,
        name: Any,
    ) -> dict[str, Any]:
        if len(matches) != 1:
            return {
                "name": name,
                "action": "skipped",
                "reason": f"expected one exact {label} match, found {len(matches)}",
                **matched_records_summary(matches),
            }
        execute(
            self.table_including_deleted(table)
            .update(self.audit_update({"is_deleted": True}))
            .eq("id", matches[0]["id"])
        )
        return {
            "name": name,
            "action": "deleted",
            "fields": ["is_deleted"],
            **matched_records_summary(matches),
        }


def employee_select() -> str:
    return "id,name,gender,phone,id_card_number,position,hire_date,status,companies(name,short_name),departments(name)"


def employee_detail_select() -> str:
    return "id,name,gender,birth_date,phone,id_card_number,id_card_expiry,position,hire_date,probation_end_date,status,education,school,graduation_date,major,current_address,hukou_address,bank_account,bank_name,resignation_date,resignation_reason,notes,companies(name,short_name),departments(name)"


def contract_select() -> str:
    return "id,type,sequence,sign_date,duration_years,start_date,expiry_date,is_permanent,scan_file_url,notes,employees(id,name,phone,id_card_number,companies(name))"


def performance_review_select() -> str:
    return "id,review_date,self_score,supervisor_score,final_score,performance_ratio,performance_salary,actual_performance_salary,performance_adjustment,notes,employees(id,name,phone,id_card_number,companies(name))"


def insurance_change_select() -> str:
    return "id,change_date,hire_date,probation_end_date,resignation_date,insurance_add_date,insurance_remove_date,status,signed_upload,hr_clerk,notes,employees(id,name,phone,id_card_number,companies(name))"


def personnel_change_select() -> str:
    return "id,current_department,current_position,probation_salary,regular_salary,new_department,new_position,change_reason,salary_before,salary_after,effective_date,procedures_complete,signed_upload,hr_clerk,notes,employees(id,name,phone,id_card_number,companies(name))"


def disciplinary_record_select() -> str:
    return "id,incident_dates,penalty_type,penalty_reason,signed_upload,hr_clerk,employees(id,name,phone,id_card_number,companies(name))"


def seal_usage_select() -> str:
    return "id,company_id,applicant_id,seal_applicant_id,usage_date,reason,attachments,notes,companies(id,name),applicant:employees!seal_usage_applicant_id_fkey(id,name,phone,id_card_number,companies(name)),seal_applicant:employees!seal_usage_seal_applicant_id_fkey(id,name,phone,id_card_number,companies(name))"


def clean_optional(value: Any) -> str | None:
    normalized = str(value).strip() if value is not None else ""
    return normalized or None


def normalize_required(value: Any, label: str) -> str:
    normalized = clean_optional(value)
    if not normalized:
        raise RuntimeError(f"{label} is required")
    return normalized


def deep_get(value: Any, path: str) -> Any:
    current = value
    for part in path.split("."):
        if not isinstance(current, dict):
            return None
        current = current.get(part)
    return current


def parse_date_value(value: Any) -> date | None:
    normalized = clean_optional(value)
    if not normalized:
        return None
    try:
        return date.fromisoformat(normalized[:10])
    except ValueError:
        return None


def contract_recency_key(row: dict[str, Any]) -> tuple[int, date, date]:
    sequence = clean_integer(row.get("sequence")) or 0
    start_date = parse_date_value(row.get("start_date")) or date.min
    expiry_date = parse_date_value(row.get("expiry_date")) or date.min
    return (sequence, start_date, expiry_date)


def scope_label(company_name: str | None, company_names: list[str] | None) -> str | list[str] | None:
    company = clean_optional(company_name)
    if company:
        return company
    companies = [item for item in map(clean_optional, company_names or []) if item]
    return companies or None


def employee_business_row(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row.get("id"),
        "name": row.get("name"),
        "company": deep_get(row, "companies.name"),
        "department": deep_get(row, "departments.name"),
        "status": row.get("status"),
        "position": row.get("position"),
        "hire_date": row.get("hire_date"),
        "phone": row.get("phone"),
        "id_card_number": row.get("id_card_number"),
    }


def employee_detail_business_row(row: dict[str, Any]) -> dict[str, Any]:
    base = employee_business_row(row)
    for field in [
        "gender",
        "birth_date",
        "id_card_expiry",
        "probation_end_date",
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
    ]:
        base[field] = row.get(field)
    return base


def contract_business_row(row: dict[str, Any]) -> dict[str, Any]:
    return {field: row.get(field) for field in ["id", "type", "sequence", "sign_date", "duration_years", "start_date", "expiry_date", "is_permanent", "scan_file_url", "notes"]} | {"employee": deep_get(row, "employees.name"), "company": deep_get(row, "employees.companies.name")}


def performance_business_row(row: dict[str, Any]) -> dict[str, Any]:
    return {field: row.get(field) for field in ["id", "review_date", "self_score", "supervisor_score", "final_score", "performance_ratio", "performance_salary", "actual_performance_salary", "performance_adjustment", "notes"]} | {"employee_id": row.get("employee_id") or deep_get(row, "employees.id"), "employee": deep_get(row, "employees.name"), "company": deep_get(row, "employees.companies.name")}


def insurance_change_business_row(row: dict[str, Any]) -> dict[str, Any]:
    return {field: row.get(field) for field in ["id", "change_date", "hire_date", "probation_end_date", "resignation_date", "insurance_add_date", "insurance_remove_date", "status", "signed_upload", "hr_clerk", "notes"]} | {"employee_id": row.get("employee_id") or deep_get(row, "employees.id"), "employee": deep_get(row, "employees.name"), "company": deep_get(row, "employees.companies.name")}


def personnel_change_business_row(row: dict[str, Any]) -> dict[str, Any]:
    return {field: row.get(field) for field in ["id", "current_department", "current_position", "probation_salary", "regular_salary", "new_department", "new_position", "change_reason", "salary_before", "salary_after", "effective_date", "procedures_complete", "signed_upload", "hr_clerk", "notes"]} | {"employee": deep_get(row, "employees.name"), "company": deep_get(row, "employees.companies.name")}


def disciplinary_record_business_row(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row.get("id"),
        "incident_date": row.get(DISCIPLINARY_DATE_FIELD) or row.get("incident_date"),
        **{field: row.get(field) for field in ["penalty_type", "penalty_reason", "signed_upload", "hr_clerk"]},
    } | {"employee": deep_get(row, "employees.name"), "company": deep_get(row, "employees.companies.name")}


def seal_usage_business_row(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row.get("id"),
        "company": deep_get(row, "companies.name"),
        "usage_date": row.get("usage_date"),
        "applicant": deep_get(row, "applicant.name"),
        "seal_applicant": deep_get(row, "seal_applicant.name"),
        "reason": row.get("reason"),
        "attachments": row.get("attachments"),
        "notes": row.get("notes"),
    }


def audit_business_row(row: dict[str, Any], mapper: Callable[[dict[str, Any]], dict[str, Any]]) -> dict[str, Any]:
    return {
        **mapper(row),
        "id": row.get("id"),
        "is_deleted": row.get("is_deleted"),
        "updated_by": row.get("updated_by"),
        "updated_at": row.get("updated_at"),
    }


def audit_select(select: str) -> str:
    fields = [field.strip() for field in select.split(",")]
    additions = [field for field in ["is_deleted", "updated_by", "updated_at"] if field not in fields]
    return ",".join([select, *additions])


def deleted_record_config(resource: str | None) -> dict[str, Any]:
    normalized = normalize_deleted_resource(resource)
    configs: dict[str, dict[str, Any]] = {
        "employee": {
            "name": "employee",
            "resource": "hr.employee",
            "table": "employees",
            "select": employee_detail_select(),
            "scope": "company",
            "mapper": employee_detail_business_row,
        },
        "contract": {
            "name": "contract",
            "resource": "hr.contract",
            "table": "contracts",
            "select": contract_select(),
            "scope": "employee",
            "mapper": contract_business_row,
        },
        "performance": {
            "name": "performance",
            "resource": "hr.performance",
            "table": "performance_reviews",
            "select": performance_review_select(),
            "scope": "employee",
            "mapper": performance_business_row,
        },
        "insurance": {
            "name": "insurance",
            "resource": "hr.insurance",
            "table": "insurance_changes",
            "select": insurance_change_select(),
            "scope": "employee",
            "mapper": insurance_change_business_row,
        },
        "personnel-change": {
            "name": "personnel-change",
            "resource": "hr.personnel_change",
            "table": "personnel_changes",
            "select": personnel_change_select(),
            "scope": "employee",
            "mapper": personnel_change_business_row,
        },
        "disciplinary": {
            "name": "disciplinary",
            "resource": "hr.disciplinary",
            "table": "disciplinary_records",
            "select": disciplinary_record_select(),
            "scope": "employee",
            "mapper": disciplinary_record_business_row,
        },
        "seal-usage": {
            "name": "seal-usage",
            "resource": "hr.seal_usage",
            "table": "seal_usage",
            "select": seal_usage_select(),
            "scope": "company",
            "mapper": seal_usage_business_row,
        },
    }
    return configs[normalized]


def resource_read_config(resource: str | None) -> dict[str, Any]:
    normalized = normalize_read_resource(resource)
    configs: dict[str, dict[str, Any]] = {
        "company": {
            "name": "company",
            "resource": "hr.company",
            "table": "companies",
            "select": "id,name,short_name",
            "scope_select": "id,name",
            "order": "name",
            "scope": "self",
            "mapper": lambda row: {
                "id": row.get("id"),
                "name": row.get("name"),
                "short_name": row.get("short_name"),
            },
        },
        "department": {
            "name": "department",
            "resource": "hr.department",
            "table": "departments",
            "select": "id,name,company_id,companies(name)",
            "scope_select": "id,company_id,companies(name)",
            "order": "name",
            "scope": "company_id",
            "mapper": lambda row: {
                "id": row.get("id"),
                "name": row.get("name"),
                "company": deep_get(row, "companies.name"),
            },
        },
        "employee": {
            "name": "employee",
            "resource": "hr.employee",
            "table": "employees",
            "select": employee_detail_select(),
            "scope_select": "id,company_id,companies(name)",
            "order": "name",
            "scope": "company_id",
            "mapper": employee_detail_business_row,
        },
        "contract": {
            "name": "contract",
            "resource": "hr.contract",
            "table": "contracts",
            "select": contract_select(),
            "scope_select": "id,employee_id,employees(id,company_id,companies(name))",
            "order": "start_date",
            "scope": "employee_id",
            "mapper": contract_business_row,
            "date_fields": ["start_date", "expiry_date", "sign_date"],
        },
        "performance": {
            "name": "performance",
            "resource": "hr.performance",
            "table": "performance_reviews",
            "select": performance_review_select(),
            "scope_select": "id,employee_id,employees(id,company_id,companies(name))",
            "order": "review_date",
            "scope": "employee_id",
            "mapper": performance_business_row,
            "date_fields": ["review_date"],
        },
        "insurance": {
            "name": "insurance",
            "resource": "hr.insurance",
            "table": "insurance_changes",
            "select": insurance_change_select(),
            "scope_select": "id,employee_id,employees(id,company_id,companies(name))",
            "order": "change_date",
            "scope": "employee_id",
            "mapper": insurance_change_business_row,
            "date_fields": ["change_date"],
        },
        "personnel-change": {
            "name": "personnel-change",
            "resource": "hr.personnel_change",
            "table": "personnel_changes",
            "select": personnel_change_select(),
            "scope_select": "id,employee_id,employees(id,company_id,companies(name))",
            "order": "effective_date",
            "scope": "employee_id",
            "mapper": personnel_change_business_row,
            "date_fields": ["effective_date"],
        },
        "disciplinary": {
            "name": "disciplinary",
            "resource": "hr.disciplinary",
            "table": "disciplinary_records",
            "select": disciplinary_record_select(),
            "scope_select": "id,employee_id,employees(id,company_id,companies(name))",
            "order": DISCIPLINARY_DATE_FIELD,
            "scope": "employee_id",
            "mapper": disciplinary_record_business_row,
            "date_fields": ["incident_date"],
        },
        "seal-usage": {
            "name": "seal-usage",
            "resource": "hr.seal_usage",
            "table": "seal_usage",
            "select": seal_usage_select(),
            "scope_select": "id,company_id,companies(name)",
            "order": "usage_date",
            "scope": "company_id",
            "mapper": seal_usage_business_row,
            "date_fields": ["usage_date"],
        },
    }
    return configs[normalized]


def normalize_read_resource(resource: str | None) -> str:
    normalized = normalize_required(resource, "resource").replace("_", "-")
    aliases = {
        "company": "company",
        "companies": "company",
        "organization": "department",
        "organizations": "department",
        "department": "department",
        "departments": "department",
        "employee": "employee",
        "employees": "employee",
        "contract": "contract",
        "contracts": "contract",
        "performance": "performance",
        "performance-review": "performance",
        "performance-reviews": "performance",
        "insurance": "insurance",
        "insurance-change": "insurance",
        "insurance-changes": "insurance",
        "personnel-change": "personnel-change",
        "personnel-changes": "personnel-change",
        "disciplinary": "disciplinary",
        "disciplinary-record": "disciplinary",
        "disciplinary-records": "disciplinary",
        "seal-usage": "seal-usage",
    }
    if normalized not in aliases:
        raise RuntimeError(f"unsupported read resource: {resource}")
    return aliases[normalized]


def resource_filter_specs(resource: str, filters: dict[str, Any]) -> list[tuple[str, Any]]:
    normalized = normalize_deleted_resource(resource)
    if normalized == "contract":
        return [("type", filters.get("type"))]
    if normalized == "insurance":
        return [("status", filters.get("status"))]
    if normalized == "personnel-change":
        return [("change_reason", filters.get("reason"))]
    if normalized == "disciplinary":
        return [("penalty_type", filters.get("penalty_type"))]
    return []


def read_row_company(row: dict[str, Any], config: dict[str, Any]) -> str | None:
    if config["scope"] == "self":
        return row.get("name")
    if config["scope"] == "company_id":
        return deep_get(row, "companies.name")
    if config["scope"] == "employee_id":
        return deep_get(row, "employees.companies.name")
    return None


def normalize_deleted_resource(resource: str | None) -> str:
    normalized = normalize_required(resource, "resource").replace("_", "-")
    aliases = {
        "company": "company",
        "companies": "company",
        "organization": "department",
        "organizations": "department",
        "department": "department",
        "departments": "department",
        "employees": "employee",
        "contracts": "contract",
        "performance-review": "performance",
        "performance-reviews": "performance",
        "insurance-change": "insurance",
        "insurance-changes": "insurance",
        "personnel-changes": "personnel-change",
        "disciplinary-record": "disciplinary",
        "disciplinary-records": "disciplinary",
        "seal-usages": "seal-usage",
    }
    normalized = aliases.get(normalized, normalized)
    allowed = {"employee", "contract", "performance", "insurance", "personnel-change", "disciplinary", "seal-usage"}
    if normalized not in allowed:
        raise RuntimeError(f"unsupported deleted-records resource: {resource}")
    return normalized


def pending_review_business_row(row: dict[str, Any]) -> dict[str, Any]:
    preview_reason = "；".join(row.get("preview_issues") or [])
    return {
        "company": row.get("company"),
        "department": row.get("department") or row.get("current_department"),
        "name": row.get("name") or row.get("employee_name"),
        "date": row.get("review_date") or row.get("change_date") or row.get("effective_date") or row.get("incident_date") or row.get(DISCIPLINARY_DATE_FIELD) or row.get("source_incident_date"),
        "type": row.get("status") or row.get("change_reason") or row.get("penalty_type"),
        "reason": row.get("reason") or preview_reason or "需人事确认",
        "source_file": row.get("source_file"),
        "source_sheet": row.get("source_sheet"),
        "source_row": row.get("source_row"),
    }


def row_needs_review(row: dict[str, Any]) -> bool:
    return bool(row.get("preview_issues") or row.get("needs_review") or row.get("pending_review"))


def month_range(value: str | None) -> dict[str, str]:
    normalized = normalize_required(value, "month")
    if len(normalized) == 10:
        from_date = normalized
        label = normalized[:7]
    elif len(normalized) == 7:
        from_date = f"{normalized}-01"
        label = normalized
    else:
        raise RuntimeError(f"month expected as YYYY-MM: {value}")
    parsed = datetime.strptime(from_date, "%Y-%m-%d").replace(tzinfo=UTC).date()
    if parsed.month == 12:
        next_month = date(parsed.year + 1, 1, 1)
    else:
        next_month = date(parsed.year, parsed.month + 1, 1)
    to_date = next_month - timedelta(days=1)
    return {"label": label, "from": from_date, "to": to_date.isoformat()}


def year_range(value: str | None) -> dict[str, str]:
    label = clean_optional(value) or str(date.today().year)
    if len(label) != 4 or not label.isdigit():
        raise RuntimeError(f"year expected as YYYY: {value}")
    return {"label": label, "from": f"{label}-01-01", "to": f"{label}-12-31"}


def normalize_records_plan(plan: Any, normalizer: Callable[[dict[str, Any]], dict[str, Any]] | None = None) -> dict[str, Any]:
    if isinstance(plan, list):
        raw = plan
        base = {}
    elif isinstance(plan, dict) and isinstance(plan.get("records"), list):
        raw = plan["records"]
        base = dict(plan)
    elif isinstance(plan, dict):
        raw = [plan]
        base = dict(plan)
    else:
        raw = []
        base = {}
    records = [normalizer(record) if normalizer else dict(record) for record in raw if isinstance(record, dict)]
    if not records:
        raise RuntimeError("录入计划未包含 records 数据，请先根据用户自然语言生成 JSON 对象或 records 数组")
    return {**base, "records": records}


def normalize_org_plan(plan: Any, fallback_company_name: str | None = None) -> dict[str, Any]:
    if isinstance(plan, list):
        company = clean_optional(fallback_company_name)
        return {"companies": [{"name": company, "departments": plan}]} if company else {"companies": []}
    if not isinstance(plan, dict):
        return {"companies": []}
    if isinstance(plan.get("records"), list):
        companies: list[dict[str, Any]] = []
        for record in plan["records"]:
            if not isinstance(record, dict):
                continue
            normalized = normalize_org_plan(record, fallback_company_name)
            companies.extend(normalized.get("companies") or [])
        return {**plan, "companies": companies}
    if isinstance(plan.get("companies"), list):
        companies = [
            {
                **normalize_match_id(company),
                "departments": [
                    normalize_match_id(department) if isinstance(department, dict) else department
                    for department in list(company.get("departments") or [])
                ],
            }
            for company in plan["companies"]
            if isinstance(company, dict)
        ]
        for department in plan.get("departments") or []:
            company_name = clean_optional(department.get("company") or department.get("companyName") or department.get("company_name") or fallback_company_name)
            if not company_name:
                continue
            company = next((item for item in companies if clean_optional(item.get("name")) == company_name), None)
            if not company:
                company = {"name": company_name, "departments": []}
                companies.append(company)
            company["departments"].append(department)
        return {**plan, "companies": companies}
    company_name = clean_optional(plan.get("company") or plan.get("companyName") or plan.get("company_name") or fallback_company_name)
    if not company_name:
        if clean_optional(plan.get("match_id") or plan.get("id")):
            return {**plan, "companies": [{"departments": [normalize_match_id(plan)]}]}
        return {"companies": []}
    if isinstance(plan.get("departments"), list):
        departments = plan.get("departments")
    elif isinstance(plan.get("department"), dict):
        departments = [plan.get("department")]
    elif clean_optional(plan.get("department")):
        departments = [
            {
                "name": plan.get("department"),
                "match_name": plan.get("match_name") or plan.get("match_department"),
                "match_department": plan.get("match_department"),
                "new_name": plan.get("new_name") or plan.get("new_department"),
                "new_department": plan.get("new_department"),
                "target_company": plan.get("target_company") or plan.get("new_company"),
                "new_company": plan.get("new_company"),
                "remark": plan.get("remark"),
                "notes": plan.get("notes"),
            }
        ]
    elif clean_optional(plan.get("name")):
        departments = [{"name": plan.get("name"), "remark": plan.get("remark"), "notes": plan.get("notes")}]
    else:
        departments = []
    return {
        **plan,
        "companies": [
            {
                **normalize_match_id(plan),
                "name": company_name,
                "departments": [
                    normalize_match_id(department) if isinstance(department, dict) else department
                    for department in departments
                ],
            }
        ],
    }


def normalize_match_id(record: dict[str, Any]) -> dict[str, Any]:
    normalized = dict(record)
    if "_match_id" not in normalized:
        value = clean_optional(record.get("match_id")) or clean_optional(record.get("id"))
        if value:
            normalized["_match_id"] = value
    normalized.pop("match_id", None)
    return normalized


def assert_non_empty_org_plan(plan: dict[str, Any]) -> None:
    count = len(plan.get("companies") or []) + sum(len(company.get("departments") or []) for company in plan.get("companies") or [])
    if count == 0:
        raise RuntimeError("录入计划未包含公司或部门数据，请先根据用户自然语言生成包含 company/departments 的 JSON")


def organization_match_name(company: dict[str, Any]) -> str:
    return normalize_required(
        company.get("match_name") or company.get("match_company") or company.get("name"),
        "company name",
    )


def organization_company_update_payload(company: dict[str, Any]) -> dict[str, Any]:
    payload: dict[str, Any] = {}
    if "name" in company:
        payload["name"] = normalize_required(company.get("name"), "company name")
    if "short_name" in company:
        payload["short_name"] = clean_optional(company.get("short_name"))
    return {key: value for key, value in payload.items() if key in COMPANY_WRITABLE_FIELDS}


def organization_department_match_name(department: dict[str, Any]) -> str | None:
    return clean_optional(
        department.get("match_name")
        or department.get("match_department")
        or department.get("department")
        or department.get("name")
    )


def organization_department_match_company(company: dict[str, Any], department: dict[str, Any]) -> str:
    return normalize_required(
        department.get("match_company") or company.get("match_name") or company.get("match_company") or company.get("name"),
        "department company",
    )


def normalize_employee_seed_record(record: dict[str, Any]) -> dict[str, Any]:
    normalized = normalize_match_id(record)
    if "id_card_number" not in normalized and "id_card" in record:
        normalized["id_card_number"] = clean_optional(record.get("id_card"))
    if "hukou_address" not in normalized:
        for alias in ["household_address", "household_registration_address", "hukou"]:
            if alias in record:
                normalized["hukou_address"] = clean_optional(record.get(alias))
                break
    if "notes" not in normalized and "remark" in record:
        normalized["notes"] = clean_optional(record.get("remark"))
    return normalized


def normalize_contract_seed_record(record: dict[str, Any]) -> dict[str, Any]:
    normalized = normalize_match_id(record)
    if "employee_name" not in normalized:
        for alias in ["name", "employee"]:
            if alias in record:
                normalized["employee_name"] = clean_optional(record.get(alias))
                break
    if "type" not in normalized and "contract_type" in record:
        normalized["type"] = clean_optional(record.get("contract_type"))
    if "start_date" not in normalized and "contract_start" in record:
        normalized["start_date"] = clean_optional(record.get("contract_start"))
    if "expiry_date" not in normalized:
        if "contract_end" in record:
            normalized["expiry_date"] = clean_optional(record.get("contract_end"))
        elif "end_date" in record:
            normalized["expiry_date"] = clean_optional(record.get("end_date"))
    contract_type = clean_optional(normalized.get("type"))
    if "is_permanent" not in normalized and contract_type and "无固定期限" in contract_type:
        normalized["is_permanent"] = True
    if "notes" not in normalized and "remark" in record:
        normalized["notes"] = clean_optional(record.get("remark"))
    return normalized


def normalize_named_employee_record(record: dict[str, Any]) -> dict[str, Any]:
    normalized = normalize_match_id(record)
    if "employee_name" not in normalized:
        for alias in ["name", "employee"]:
            if alias in record:
                normalized["employee_name"] = clean_optional(record.get(alias))
                break
    if "notes" not in normalized and "remark" in record:
        normalized["notes"] = clean_optional(record.get("remark"))
    return normalized


def normalize_personnel_change_record(record: dict[str, Any]) -> dict[str, Any]:
    normalized = normalize_named_employee_record(record)
    if "effective_date" not in normalized and "change_date" in record:
        normalized["effective_date"] = clean_optional(record.get("change_date"))
    if "change_reason" not in normalized and "change_type" in record:
        normalized["change_reason"] = clean_optional(record.get("change_type"))
    elif "match_change_reason" not in normalized and "change_type" in record:
        normalized["match_change_reason"] = clean_optional(record.get("change_type"))
    normalized.pop("change_date", None)
    normalized.pop("change_type", None)
    return normalized


def normalize_seal_usage_seed_record(record: dict[str, Any]) -> dict[str, Any]:
    normalized = normalize_match_id(record)
    if "seal_applicant" not in normalized and "seal_applicant_name" in record:
        normalized["seal_applicant"] = clean_optional(record.get("seal_applicant_name"))
    if "applicant" not in normalized and "applicant_name" in record:
        normalized["applicant"] = clean_optional(record.get("applicant_name"))
    if "match_reason" not in normalized:
        for alias in ["current_reason", "old_reason"]:
            if alias in record:
                normalized["match_reason"] = clean_optional(record.get(alias))
                break
    if "notes" not in normalized and "remark" in record:
        normalized["notes"] = clean_optional(record.get("remark"))
    normalized.pop("seal_applicant_name", None)
    normalized.pop("applicant_name", None)
    normalized.pop("current_reason", None)
    normalized.pop("old_reason", None)
    return normalized


def normalize_performance_review_seed_record(record: dict[str, Any]) -> dict[str, Any]:
    normalized = normalize_named_employee_record(record)
    if "review_date" not in normalized:
        review_month = clean_optional(record.get("review_month")) or clean_optional(record.get("month"))
        if review_month:
            normalized["review_date"] = f"{review_month}-01" if len(review_month) == 7 else review_month
    if "final_score" not in normalized and "score" in record:
        normalized["final_score"] = clean_optional(record.get("score"))
    if "self_score" not in normalized and "final_score" in normalized:
        normalized["self_score"] = normalized["final_score"]
    if "supervisor_score" not in normalized and "final_score" in normalized:
        normalized["supervisor_score"] = normalized["final_score"]
    normalized.pop("review_month", None)
    normalized.pop("month", None)
    normalized.pop("score", None)
    return normalized


def employee_payload(record: dict[str, Any], company_id: str, department_id: str | None) -> dict[str, Any]:
    fields = ["gender", "birth_date", "position", "hire_date", "probation_end_date", "id_card_number", "id_card_expiry", "phone", "education", "school", "graduation_date", "major", "current_address", "hukou_address", "bank_account", "bank_name", "resignation_date", "resignation_reason", "notes"]
    payload = {"company_id": company_id, "department_id": department_id, "name": normalize_required(record.get("name"), "employee name"), "status": clean_optional(record.get("status")) or "正式"}
    payload.update({field: clean_optional(record.get(field)) for field in fields})
    return {key: value for key, value in payload.items() if value is not None}


def contract_payload(
    record: dict[str, Any],
    employee_id: str,
    *,
    strip_nulls: bool = True,
) -> dict[str, Any]:
    payload: dict[str, Any] = {"employee_id": employee_id}
    if "type" in record:
        payload["type"] = normalize_required(record.get("type"), "contract type")
    if "sequence" in record:
        payload["sequence"] = clean_integer(record.get("sequence"))
    if "sign_date" in record:
        payload["sign_date"] = clean_optional(record.get("sign_date"))
    if "duration_years" in record:
        payload["duration_years"] = clean_integer(record.get("duration_years"))
    if "start_date" in record:
        payload["start_date"] = clean_optional(record.get("start_date"))
    if "expiry_date" in record:
        payload["expiry_date"] = clean_optional(record.get("expiry_date"))
    if "is_permanent" in record:
        payload["is_permanent"] = bool(record.get("is_permanent"))
    if "scan_file_url" in record:
        payload["scan_file_url"] = clean_optional(record.get("scan_file_url"))
    if "notes" in record:
        payload["notes"] = clean_optional(record.get("notes"))
    return strip_none(payload) if strip_nulls else payload


def generic_payload(
    record: dict[str, Any],
    employee_id: str,
    *,
    strip_nulls: bool = True,
) -> dict[str, Any]:
    match_only_fields = {
        "match",
        "employee_name",
        "name",
        "company",
        "company_name",
        "department",
        "department_name",
    }
    payload = {key: value for key, value in record.items() if key not in match_only_fields}
    payload["employee_id"] = employee_id
    return strip_none(payload) if strip_nulls else payload


def disciplinary_record_payload(
    record: dict[str, Any],
    employee_id: str,
    *,
    strip_nulls: bool = True,
) -> dict[str, Any]:
    payload = generic_payload(record, employee_id, strip_nulls=strip_nulls)
    incident_date = payload.pop("incident_date", None)
    if incident_date is not None and DISCIPLINARY_DATE_FIELD not in payload:
        payload[DISCIPLINARY_DATE_FIELD] = normalize_date_array(incident_date)
    elif DISCIPLINARY_DATE_FIELD in payload:
        payload[DISCIPLINARY_DATE_FIELD] = normalize_date_array(payload.get(DISCIPLINARY_DATE_FIELD))
    payload = {
        key: value
        for key, value in payload.items()
        if key in {*DISCIPLINARY_RECORD_WRITABLE_FIELDS, "employee_id"}
    }
    return payload


def record_field_value(record: dict[str, Any], field: str) -> Any:
    if field == DISCIPLINARY_DATE_FIELD:
        return record.get(DISCIPLINARY_DATE_FIELD) or record.get("incident_date")
    return record.get(field)


def match_field_value(record: dict[str, Any], field: str) -> Any:
    if field == DISCIPLINARY_DATE_FIELD and "match_incident_date" in record:
        return record.get("match_incident_date")
    match_field = f"match_{field}"
    if match_field in record:
        return record_field_value(record, match_field)
    return record_field_value(record, field)


def query_field_value(record: dict[str, Any], field: str, *, use_match: bool) -> Any:
    value = match_field_value(record, field) if use_match else record_field_value(record, field)
    if field == DISCIPLINARY_DATE_FIELD:
        return normalize_date_array(value)
    return clean_optional(value)


def query_value_present(value: Any) -> bool:
    if isinstance(value, list):
        return bool(value)
    return bool(clean_optional(value))


def normalize_date_array(value: Any) -> list[str] | None:
    if isinstance(value, list):
        return [item for item in map(clean_optional, value) if item] or None
    normalized = clean_optional(value)
    return [normalized] if normalized else None


def target_match_record(record: dict[str, Any]) -> dict[str, Any]:
    target = dict(record)
    for key in list(record):
        if not key.startswith("match_"):
            continue
        field = key.removeprefix("match_")
        if field in record:
            target.pop(key, None)
    if "match_incident_date" in target and ("incident_date" in record or DISCIPLINARY_DATE_FIELD in record):
        target.pop("match_incident_date", None)
    return target


def seal_usage_target_match_record(record: dict[str, Any]) -> dict[str, Any]:
    target = target_match_record(record)
    for alias in ["new_reason", "target_reason"]:
        if alias in record:
            target["reason"] = record.get(alias)
            target.pop(alias, None)
            target.pop("match_reason", None)
    return target


def seal_usage_payload(record: dict[str, Any], company_id: str) -> dict[str, Any]:
    applicant = deep_get(record, "match.applicant.employee")
    seal_applicant = deep_get(record, "match.seal_applicant.employee")
    return strip_none(
        {
            "company_id": company_id,
            "usage_date": clean_optional(record.get("usage_date")),
            "applicant_id": applicant.get("id") if applicant else None,
            "seal_applicant_id": seal_applicant.get("id") if seal_applicant else None,
            "reason": normalize_required(record.get("reason"), "seal usage reason"),
            "attachments": clean_text_array(record.get("attachments")),
            "notes": clean_optional(record.get("notes")),
        }
    )


def seal_usage_update_payload(record: dict[str, Any]) -> dict[str, Any]:
    payload: dict[str, Any] = {}
    if "company" in record:
        company = deep_get(record, "match.target_company.company") or deep_get(record, "match.company.company")
        if company:
            payload["company_id"] = company["id"]
    if "usage_date" in record:
        payload["usage_date"] = clean_optional(record.get("usage_date"))
    if "applicant" in record:
        applicant = deep_get(record, "match.target_applicant.employee") or deep_get(record, "match.applicant.employee")
        payload["applicant_id"] = applicant.get("id") if applicant else None
    if "seal_applicant" in record:
        seal_applicant = deep_get(record, "match.target_seal_applicant.employee") or deep_get(record, "match.seal_applicant.employee")
        payload["seal_applicant_id"] = seal_applicant.get("id") if seal_applicant else None
    if "new_reason" in record:
        payload["reason"] = clean_optional(record.get("new_reason"))
    elif "target_reason" in record:
        payload["reason"] = clean_optional(record.get("target_reason"))
    elif "reason" in record:
        payload["reason"] = clean_optional(record.get("reason"))
    if "attachments" in record:
        payload["attachments"] = clean_text_array(record.get("attachments"))
    if "notes" in record:
        payload["notes"] = clean_optional(record.get("notes"))
    return {key: value for key, value in payload.items() if key in SEAL_USAGE_WRITABLE_FIELDS}


def strip_none(value: dict[str, Any]) -> dict[str, Any]:
    return {key: item for key, item in value.items() if item is not None}


def update_preview_item(
    *,
    name: Any,
    matches: list[dict[str, Any]],
    payload: dict[str, Any],
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    base = {"name": name, **(extra or {}), **matched_records_summary(matches)}
    if len(matches) != 1:
        return {**base, "action": "skipped", "reason": f"expected one match, found {len(matches)}", "diffs": []}
    diffs = update_diffs(matches[0], payload)
    return {**base, "action": "would_update" if diffs else "unchanged", "diffs": diffs}


def update_summary(records: list[dict[str, Any]]) -> dict[str, int]:
    return {
        "records": len(records),
        "would_update": len([row for row in records if row.get("action") == "would_update"]),
        "unchanged": len([row for row in records if row.get("action") == "unchanged"]),
        "skipped": len([row for row in records if row.get("action") == "skipped"]),
    }


def update_diffs(current: dict[str, Any], payload: dict[str, Any]) -> list[dict[str, Any]]:
    diffs = []
    for field, expected in payload.items():
        actual = current.get(field)
        if normalize_comparable(expected) != normalize_comparable(actual):
            diffs.append({"field": field, "before": actual, "after": expected})
    return diffs


def changed_payload(current: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
    return {item["field"]: item["after"] for item in update_diffs(current, payload)}


def apply_update_to_matches(
    *,
    repo: HrRepository,
    table: str,
    matches: list[dict[str, Any]],
    payload: dict[str, Any],
    label: Any,
) -> dict[str, Any]:
    if len(matches) != 1:
        return {
            "name": label,
            "action": "skipped",
            "reason": f"expected one match, found {len(matches)}",
            **matched_records_summary(matches),
        }
    changed = changed_payload(matches[0], payload)
    if not changed:
        return {"name": label, "action": "unchanged", "fields": [], **matched_records_summary(matches)}
    data = execute_one(
        repo.table(table)
        .update(repo.audit_update(changed))
        .eq("id", matches[0]["id"])
        .select("*")
        .single()
    )
    return {
        "name": label,
        "action": "updated",
        "fields": list(changed),
        **matched_records_summary(matches),
    } | ({"id": data.get("id")} if not label else {})


def verify_update_matches(
    *,
    name: Any,
    matches: list[dict[str, Any]],
    payload: dict[str, Any],
    label: str,
) -> dict[str, Any]:
    diffs: list[dict[str, Any]] = []
    if len(matches) != 1:
        diffs.append({"field": label, "expected": "unique match", "actual": f"{len(matches)} matches"})
    else:
        for item in update_diffs(matches[0], payload):
            diffs.append({"field": item["field"], "expected": normalize_comparable(item["after"]), "actual": normalize_comparable(item["before"])})
    return {"name": name, "ok": not diffs, "diffs": diffs}


def generic_update_payload(
    record: dict[str, Any],
    employee: dict[str, Any] | None,
    payload_builder: Callable[..., dict[str, Any]],
    update_fields: list[str],
) -> dict[str, Any]:
    if not employee and not clean_optional(record.get("_match_id")):
        return {}
    payload = payload_builder(record, employee["id"] if employee else "", strip_nulls=False)
    ignored = {"employee_id"}
    return {
        field: value
        for field, value in payload.items()
        if field not in ignored and field in update_fields and not field.startswith("match_")
    }


def clean_integer(value: Any) -> int | None:
    normalized = clean_optional(value)
    if normalized is None:
        return None
    number = int(normalized)
    return number


def clean_numeric(value: Any) -> float | None:
    normalized = clean_optional(value)
    return float(normalized) if normalized is not None else None


def clean_text_array(value: Any) -> list[str] | None:
    if not isinstance(value, list):
        return None
    items = [item for item in map(clean_optional, value) if item]
    return items or None


def employee_matches_expected(row: dict[str, Any], record: dict[str, Any]) -> bool:
    checks = [("name", row.get("name"), record.get("name")), ("company", deep_get(row, "companies.name"), record.get("company")), ("department", deep_get(row, "departments.name"), record.get("department")), ("phone", row.get("phone"), record.get("phone")), ("id_card_number", row.get("id_card_number"), record.get("id_card_number"))]
    return all(clean_optional(expected) is None or normalize_comparable(actual) == clean_optional(expected) for _field, actual, expected in checks)


def compare_field(diffs: list[dict[str, Any]], field: str, expected: Any, actual: Any) -> None:
    if normalize_comparable(expected) != normalize_comparable(actual):
        diffs.append({"field": field, "expected": normalize_comparable(expected), "actual": normalize_comparable(actual)})


def normalize_comparable(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        normalized = value.strip()
        return normalized or None
    if isinstance(value, list):
        return None if not value else str(value)
    return str(value).strip()


def summary_item(mapping: dict[str, dict[str, Any]], key: str, extra: dict[str, Any] | None = None) -> dict[str, Any]:
    if key not in mapping:
        mapping[key] = {**(extra or {}), "total": 0, "statuses": {}}
    return mapping[key]


def duplicate_groups(mapping: dict[str, list[dict[str, Any]]]) -> list[dict[str, Any]]:
    return [{"value": key, "rows": rows} for key, rows in mapping.items() if len(rows) > 1]


def count_records_group(rows: list[dict[str, Any]], source_field: str, output_field: str) -> list[dict[str, Any]]:
    return [
        {output_field: key, "record_count": value}
        for key, value in count_by(rows, source_field).items()
    ]


def employee_summary_analysis_group(item: dict[str, Any], label_fields: list[str]) -> dict[str, Any]:
    statuses = dict(item.get("statuses") or {})
    active = sum(count for status, count in statuses.items() if employee_status_is_active(status))
    inactive = sum(count for status, count in statuses.items() if not employee_status_is_active(status))
    total = int(item.get("total") or 0)
    return {
        **{field: item.get(field) for field in label_fields},
        "employee_count": total,
        "active_employees": active,
        "inactive_employees": inactive,
        "statuses": statuses,
    }


def performance_summary_groups(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    groups = []
    for company, rows in group_records(records, "company").items():
        scores = [float(row["final_score"]) for row in rows if is_number(row.get("final_score"))]
        groups.append(
            {
                "company": company,
                "record_count": len(rows),
                "average_final_score": average(scores),
                "low_score_count_below_60": len([row for row in rows if to_float(row.get("final_score")) < 60]),
            }
        )
    return groups


def score_band_groups(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    bands = {"below_60": 0, "60_to_79": 0, "80_to_89": 0, "90_and_above": 0, "unknown": 0}
    for row in records:
        score = row.get("final_score")
        if not is_number(score):
            bands["unknown"] += 1
        elif to_float(score) < 60:
            bands["below_60"] += 1
        elif to_float(score) < 80:
            bands["60_to_79"] += 1
        elif to_float(score) < 90:
            bands["80_to_89"] += 1
        else:
            bands["90_and_above"] += 1
    return [{"band": key, "record_count": value} for key, value in bands.items() if value]


def group_records(records: list[dict[str, Any]], field: str) -> dict[str, list[dict[str, Any]]]:
    groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in records:
        groups[clean_optional(row.get(field)) or "(空)"].append(row)
    return dict(sorted(groups.items(), key=lambda item: item[0]))


def finding_consistency_checks(findings: list[dict[str, Any]]) -> list[tuple[str, bool]]:
    checks: list[tuple[str, bool]] = []
    for index, finding in enumerate(findings):
        kind = finding.get("kind") or index
        count = finding.get("count")
        record_ids = finding.get("record_ids") or []
        employee_names = finding.get("employee_names") or []
        records = finding.get("records") or []
        if record_ids:
            checks.append((f"findings.{kind}.count_matches_record_ids", count == len(record_ids)))
        if employee_names:
            checks.append((f"findings.{kind}.count_matches_employee_names", count == len(employee_names)))
        checks.append((f"findings.{kind}.count_matches_records", count == len(records)))
    return checks


def parse_analysis_date(value: str | None) -> date:
    text = clean_optional(value)
    if not text:
        return date.today()
    try:
        parsed = date.fromisoformat(text)
    except ValueError as exc:
        raise RuntimeError("Option --as-of must use YYYY-MM-DD") from exc
    if parsed > date.today():
        raise RuntimeError("Option --as-of cannot be in the future")
    return parsed


def analysis_scope(company_name: str | None, company_names: list[str] | None) -> dict[str, Any]:
    return {
        "company": clean_optional(company_name),
        "company_scope": [item for item in map(clean_optional, company_names or []) if item] or None,
    }


def employee_status_is_active(status: Any) -> bool:
    return clean_optional(status) != "离职"


def with_analytics_consistency(
    result: dict[str, Any],
    checks: list[tuple[str, bool]],
) -> dict[str, Any]:
    errors = [name for name, passed in checks if not passed]
    return {
        **result,
        "consistency": {
            "checked": True,
            "passed": not errors,
            "errors": errors,
        },
    }


def roster_quality_findings(summary: dict[str, Any]) -> list[dict[str, Any]]:
    checks = summary.get("checks") or {}
    findings = []
    if checks.get("emptyDepartment"):
        findings.append(
            analytics_finding(
                kind="missing_department",
                severity="medium",
                basis="员工主档部门为空",
                records=checks["emptyDepartment"],
            )
        )
    if checks.get("emptyIdCard"):
        findings.append(
            analytics_finding(
                kind="missing_id_card",
                severity="medium",
                basis="员工主档身份证号为空",
                records=checks["emptyIdCard"],
            )
        )
    if checks.get("duplicateIdCards"):
        findings.append(
            {
                "kind": "duplicate_id_card",
                "severity": "high",
                "basis": "同一身份证号匹配多名员工",
                "count": len(checks["duplicateIdCards"]),
                "groups": checks["duplicateIdCards"],
            }
        )
    if checks.get("duplicatePhones"):
        findings.append(
            {
                "kind": "duplicate_phone",
                "severity": "medium",
                "basis": "同一手机号匹配多名员工",
                "count": len(checks["duplicatePhones"]),
                "groups": checks["duplicatePhones"],
            }
        )
    return findings


def contract_is_active(row: dict[str, Any], *, as_of: date) -> bool:
    start_date = parse_optional_date(row.get("start_date"))
    if start_date and start_date > as_of:
        return False
    if row.get("is_permanent") is True:
        return True
    expiry_date = parse_optional_date(row.get("expiry_date"))
    return expiry_date is None or expiry_date >= as_of


def contract_expires_within(row: dict[str, Any], *, as_of: date, days: int) -> bool:
    if row.get("is_permanent") is True:
        return False
    expiry_date = parse_optional_date(row.get("expiry_date"))
    return expiry_date is not None and as_of <= expiry_date <= as_of + timedelta(days=days)


def parse_optional_date(value: Any) -> date | None:
    text = clean_optional(value)
    if not text:
        return None
    try:
        return date.fromisoformat(text)
    except ValueError:
        return None


def contract_business_row_for_analysis(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row.get("id"),
        "employee": deep_get(row, "employees.name"),
        "company": deep_get(row, "employees.companies.name"),
        "type": row.get("type"),
        "start_date": row.get("start_date"),
        "expiry_date": row.get("expiry_date"),
        "is_permanent": row.get("is_permanent"),
    }


def overlapping_contract_employee_rows(
    contracts: list[dict[str, Any]],
    active_employee_ids: set[Any],
) -> list[dict[str, Any]]:
    grouped: dict[Any, list[dict[str, Any]]] = defaultdict(list)
    for row in contracts:
        employee_id = row.get("employee_id")
        if employee_id in active_employee_ids:
            grouped[employee_id].append(row)
    results = []
    for rows in grouped.values():
        sorted_rows = sorted(rows, key=lambda item: parse_optional_date(item.get("start_date")) or date.min)
        previous_end: date | None = None
        for row in sorted_rows:
            start = parse_optional_date(row.get("start_date"))
            end = parse_optional_date(row.get("expiry_date")) or date.max
            if start and previous_end and start <= previous_end:
                employee = row.get("employees") if isinstance(row.get("employees"), dict) else {}
                results.append(employee_business_row(employee))
                break
            previous_end = max(previous_end or date.min, end)
    return results


def contract_coverage_findings(
    *,
    without_any_contract: list[dict[str, Any]],
    without_active_contract: list[dict[str, Any]],
    expiring_contracts: list[dict[str, Any]],
    overlap_employees: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    findings = []
    if without_any_contract:
        findings.append(
            analytics_finding(
                kind="missing_any_contract",
                severity="high",
                basis="在职员工没有任何合同记录",
                records=without_any_contract,
            )
        )
    if without_active_contract:
        findings.append(
            analytics_finding(
                kind="missing_active_contract",
                severity="high",
                basis="在职员工有历史合同，但 as_of 日期没有有效合同",
                records=without_active_contract,
            )
        )
    if expiring_contracts:
        findings.append(
            analytics_finding(
                kind="contract_expiring_30_days",
                severity="medium",
                basis="当前有效合同将在 30 天内到期",
                records=expiring_contracts,
            )
        )
    if overlap_employees:
        findings.append(
            analytics_finding(
                kind="contract_overlap",
                severity="medium",
                basis="同一员工存在合同期间重叠",
                records=overlap_employees,
            )
        )
    return findings


def analytics_finding(
    *,
    kind: str,
    severity: str,
    basis: str,
    records: list[dict[str, Any]],
) -> dict[str, Any]:
    return {
        "kind": kind,
        "severity": severity,
        "basis": basis,
        "count": len(records),
        "record_ids": [row.get("id") for row in records if row.get("id")],
        "employee_names": [
            row.get("name") or row.get("employee")
            for row in records
            if row.get("name") or row.get("employee")
        ],
        "records": records,
    }


def empty_contract_coverage_analysis(
    company_name: str | None,
    company_names: list[str] | None,
    as_of: date,
) -> dict[str, Any]:
    result = {
        "topic": "contract-coverage",
        "as_of": as_of.isoformat(),
        "scope": analysis_scope(company_name, company_names),
        "summary": {
            "total_employees": 0,
            "coverage_denominator": 0,
            "active_employees": 0,
            "contract_records": 0,
            "active_contract_records": 0,
            "employees_with_any_contract": 0,
            "employees_without_any_contract": 0,
            "employees_with_active_contract": 0,
            "employees_without_active_contract": 0,
            "coverage_rate_any": None,
            "coverage_rate_active": None,
        },
        "groups": {"by_contract_type": []},
        "findings": [],
        "legacy": {
            "employees_total": 0,
            "active_employees": 0,
            "contract_records": 0,
            "active_with_contracts": 0,
            "active_without_contracts": 0,
            "active_contract_coverage_rate": None,
            "contract_type_distribution": {},
            "active_without_contract_records": [],
        },
    }
    result.update(result["legacy"])
    return with_analytics_consistency(result, [])


def count_by(rows: list[dict[str, Any]], field: str) -> dict[str, int]:
    counts: dict[str, int] = {}
    for row in rows:
        key = clean_optional(row.get(field)) or "(空)"
        counts[key] = counts.get(key, 0) + 1
    return sort_object(counts)


def sort_object(value: dict[str, Any]) -> dict[str, Any]:
    return dict(sorted(value.items(), key=lambda item: item[0]))


def empty_employee_summary(company_name: str | None, company_names: list[str] | None, status: str) -> dict[str, Any]:
    return {"total": 0, "company": clean_optional(company_name), "company_scope": company_names, "match_status": status, "byCompany": [], "byDepartment": [], "checks": {"emptyDepartment": [], "emptyIdCard": [], "duplicateIdCards": [], "duplicatePhones": []}}


def is_number(value: Any) -> bool:
    try:
        float(value)
        return True
    except (TypeError, ValueError):
        return False


def to_float(value: Any) -> float:
    return float(value) if is_number(value) else 0.0


def sum_numeric(rows: list[dict[str, Any]], field: str) -> float:
    return round(sum(to_float(row.get(field)) for row in rows), 2)


def average(values: list[float]) -> float | None:
    return round(sum(values) / len(values), 2) if values else None


def summarize_performance_by(records: list[dict[str, Any]], field: str) -> list[dict[str, Any]]:
    groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for record in records:
        groups[clean_optional(record.get(field)) or "(空)"].append(record)
    return [
        {
            field: key,
            "count": len(rows),
            "average_final_score": average([to_float(row.get("final_score")) for row in rows if is_number(row.get("final_score"))]),
            "low_score_count_below_60": len([row for row in rows if to_float(row.get("final_score")) < 60]),
            "performance_salary_total": sum_numeric(rows, "performance_salary"),
            "actual_performance_salary_total": sum_numeric(rows, "actual_performance_salary"),
            "performance_adjustment_total": sum_numeric(rows, "performance_adjustment"),
        }
        for key, rows in sorted(groups.items())
    ]


def insurance_employee(row: dict[str, Any]) -> dict[str, Any]:
    return {"id": row.get("id"), "name": row.get("name"), "company": deep_get(row, "companies.name"), "department": deep_get(row, "departments.name"), "status": row.get("status"), "phone": row.get("phone"), "id_card_number": row.get("id_card_number")}


def preview_summary(records: list[dict[str, Any]], name_field: str = "name") -> dict[str, Any]:
    return {"records": len(records), "matched": len([row for row in records if deep_get(row, "match.employee")]), "unmatched": len([row for row in records if not deep_get(row, "match.employee")]), "by_company": count_by(records, "company"), "by_name": count_by(records, name_field)}


def bounded_result_limit(limit: Any) -> int:
    if limit is None:
        return DEFAULT_RESULT_LIMIT
    value = int(limit)
    if value < 1:
        return DEFAULT_RESULT_LIMIT
    return min(value, MAX_RESULT_LIMIT)


def result_limit_meta(count: int | None, returned_count: int, limit: int | None) -> dict[str, Any]:
    total = count if count is not None and count >= returned_count else returned_count
    return {
        "count": total,
        "limit": limit,
        "truncated": bool(limit is not None and total > limit),
    }


def limited_action(
    *,
    type_: str,
    message: str,
    records: list[dict[str, Any]],
    limit: int,
) -> dict[str, Any]:
    limited_records = records[:limit]
    return {
        "type": type_,
        "message": message,
        "records": limited_records,
        **result_limit_meta(len(records), len(limited_records), limit),
    }


def matched_records_summary(records: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "match_count": len(records),
        "matched_ids": [row.get("id") for row in records if row.get("id")],
    }


def hr_risk_recommended_actions(
    headcount: dict[str, Any],
    coverage: dict[str, Any],
    expiry: dict[str, Any],
    disciplinary: dict[str, Any],
    pending: list[dict[str, Any]],
    *,
    limit: int,
) -> list[dict[str, Any]]:
    actions = []
    if headcount["quality_flags"]["empty_department_count"] > 0:
        actions.append(
            limited_action(
                type_="empty_department",
                message=f"核对 {headcount['quality_flags']['empty_department_count']} 名空部门员工",
                records=[],
                limit=limit,
            )
        )
    if coverage["active_without_contracts"] > 0:
        actions.append(
            limited_action(
                type_="missing_contract",
                message=f"补齐 {coverage['active_without_contracts']} 名在职员工合同",
                records=coverage.get("active_without_contract_records") or [],
                limit=limit,
            )
        )
    if expiry["count"] > 0:
        actions.append(
            limited_action(
                type_="contract_expiry",
                message=f"跟进未来 90 天内到期的 {expiry['count']} 条合同",
                records=expiry.get("records") or [],
                limit=limit,
            )
        )
    if disciplinary["missing_signed_upload_count"] > 0:
        missing_uploads = [row for row in disciplinary.get("records") or [] if not row.get("signed_upload")]
        actions.append(
            limited_action(
                type_="disciplinary_missing_signed_upload",
                message=f"补齐 {disciplinary['missing_signed_upload_count']} 条奖惩记录签字附件",
                records=missing_uploads,
                limit=limit,
            )
        )
    pending_total = sum(item["count"] for item in pending)
    if pending_total > 0:
        pending_rows = [
            {**row, "module": item["module"], "source": item["source"]}
            for item in pending
            for row in item.get("rows", [])
        ]
        actions.append(
            limited_action(
                type_="pending_review",
                message=f"处理 {pending_total} 条待人事确认记录",
                records=pending_rows,
                limit=limit,
            )
        )
    return actions


def repository_allowed_company_names(resource: str, action: str) -> list[str] | None:
    try:
        return allowed_company_names(resource=resource, action=action)
    except RuntimeError as exc:
        if "缺少 WebUI 权限文件" in str(exc):
            return None
        raise
