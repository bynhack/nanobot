"""Command registry metadata for the HR business runtime."""

from __future__ import annotations

from dataclasses import dataclass
from difflib import get_close_matches
from typing import Any, Literal

OptionType = Literal["string", "integer", "float", "enum"]
DEFAULT_RESULT_LIMIT = 200
MAX_RESULT_LIMIT = 500
DEFAULT_PAGE_SIZE = 100
MAX_PAGE_SIZE = 500
MAX_FILTERED_RESULT_ROWS = 5000


@dataclass(frozen=True)
class OptionSpec:
    name: str
    value_type: OptionType = "string"
    enum_values: tuple[str, ...] = ()
    minimum: int | float | None = None
    maximum: int | float | None = None


@dataclass(frozen=True)
class CommandOptionSpec:
    allowed_options: frozenset[str]
    required_options: frozenset[str] = frozenset()


BOOLEAN_OPTIONS = {"help"}

VALUE_OPTIONS: dict[str, OptionSpec] = {
    "company": OptionSpec("company"),
    "confirm": OptionSpec("confirm"),
    "department": OptionSpec("department"),
    "from": OptionSpec("from"),
    "id": OptionSpec("id"),
    "id-card": OptionSpec("id-card"),
    "input": OptionSpec("input"),
    "limit": OptionSpec("limit", "integer", minimum=1, maximum=MAX_RESULT_LIMIT),
    "month": OptionSpec("month"),
    "name": OptionSpec("name"),
    "page": OptionSpec("page", "integer", minimum=1),
    "page-size": OptionSpec("page-size", "integer", minimum=1, maximum=MAX_PAGE_SIZE),
    "phone": OptionSpec("phone"),
    "reason": OptionSpec("reason"),
    "resource": OptionSpec("resource"),
    "status": OptionSpec("status"),
    "to": OptionSpec("to"),
    "employee": OptionSpec("employee"),
    "type": OptionSpec("type"),
    "penalty-type": OptionSpec("penalty-type"),
    "expiry-before": OptionSpec("expiry-before"),
    "expiry-after": OptionSpec("expiry-after"),
    "applicant": OptionSpec("applicant"),
    "as-of": OptionSpec("as-of"),
    "workflow": OptionSpec("workflow", "enum", enum_values=("create", "update")),
    "year": OptionSpec("year", "integer", minimum=1900, maximum=9999),
    "days": OptionSpec("days", "integer", minimum=0),
    "threshold": OptionSpec("threshold", "float", minimum=0, maximum=100),
}

KNOWN_OPTIONS = frozenset(VALUE_OPTIONS) | frozenset(BOOLEAN_OPTIONS)

NO_OPTIONS = frozenset[str]()
COMPANY_FILTER = frozenset({"company"})
ANALYZE_SCOPE_OPTIONS = frozenset({"company", "as-of"})
EMPLOYEE_LOOKUP_OPTIONS = frozenset({"name", "company", "id-card", "phone", "department"})
MONTH_FILTER = frozenset({"month", "company"})
YEAR_FILTER = frozenset({"year", "company"})
DATE_RANGE_FILTER = frozenset({"from", "to", "company"})
WRITE_OPTIONS = frozenset({"input", "confirm", "company"})
DELETE_AUDIT_OPTIONS = frozenset({"resource", "company", "limit"})
LIMITABLE_COMMANDS = frozenset(
    {
        "list-companies",
        "list-departments",
        "list-employees",
        "list-contracts",
        "list-performance-reviews",
        "list-insurance-changes",
        "list-personnel-changes",
        "list-disciplinary-records",
        "list-seal-usage",
    }
)
PAGE_OPTIONS = frozenset({"page", "page-size", "limit"})
LIST_COMPANY_OPTIONS = frozenset({"name"}) | PAGE_OPTIONS
LIST_DEPARTMENT_OPTIONS = frozenset({"company", "name"}) | PAGE_OPTIONS
LIST_EMPLOYEE_OPTIONS = frozenset({"company", "department", "name", "id-card", "phone", "status"}) | PAGE_OPTIONS
LIST_CONTRACT_OPTIONS = frozenset({"company", "employee", "type", "expiry-before", "expiry-after"}) | PAGE_OPTIONS
LIST_PERFORMANCE_OPTIONS = frozenset({"company", "employee", "month", "year", "threshold"}) | PAGE_OPTIONS
LIST_INSURANCE_OPTIONS = frozenset({"company", "employee", "month", "status"}) | PAGE_OPTIONS
LIST_PERSONNEL_CHANGE_OPTIONS = frozenset({"company", "employee", "year", "reason"}) | PAGE_OPTIONS
LIST_DISCIPLINARY_OPTIONS = frozenset({"company", "employee", "penalty-type", "year"}) | PAGE_OPTIONS
LIST_SEAL_USAGE_OPTIONS = frozenset({"company", "applicant", "from", "to"}) | PAGE_OPTIONS
GET_OPTIONS = frozenset({"id"})

COMMAND_OPTIONS: dict[str, CommandOptionSpec] = {
    "count-all": CommandOptionSpec(NO_OPTIONS),
    "clear-business-data": CommandOptionSpec(frozenset({"confirm"})),
    "business-capabilities": CommandOptionSpec(NO_OPTIONS),
    "business-plan-schema": CommandOptionSpec(frozenset({"resource", "workflow"}), frozenset({"resource"})),
    "list-companies": CommandOptionSpec(LIST_COMPANY_OPTIONS),
    "organization-tree": CommandOptionSpec(COMPANY_FILTER),
    "find-company": CommandOptionSpec(frozenset({"name"})),
    "list-departments": CommandOptionSpec(LIST_DEPARTMENT_OPTIONS),
    "find-department": CommandOptionSpec(frozenset({"company", "department"})),
    "find-employee": CommandOptionSpec(EMPLOYEE_LOOKUP_OPTIONS),
    "find-employee-like": CommandOptionSpec(frozenset({"name", "company"})),
    "list-employees": CommandOptionSpec(LIST_EMPLOYEE_OPTIONS),
    "list-contracts": CommandOptionSpec(LIST_CONTRACT_OPTIONS),
    "list-performance-reviews": CommandOptionSpec(LIST_PERFORMANCE_OPTIONS),
    "list-insurance-changes": CommandOptionSpec(LIST_INSURANCE_OPTIONS),
    "list-personnel-changes": CommandOptionSpec(LIST_PERSONNEL_CHANGE_OPTIONS),
    "list-disciplinary-records": CommandOptionSpec(LIST_DISCIPLINARY_OPTIONS),
    "list-seal-usage": CommandOptionSpec(LIST_SEAL_USAGE_OPTIONS),
    "get-company": CommandOptionSpec(GET_OPTIONS, frozenset({"id"})),
    "get-department": CommandOptionSpec(GET_OPTIONS, frozenset({"id"})),
    "get-employee": CommandOptionSpec(GET_OPTIONS, frozenset({"id"})),
    "get-contract": CommandOptionSpec(GET_OPTIONS, frozenset({"id"})),
    "get-performance-review": CommandOptionSpec(GET_OPTIONS, frozenset({"id"})),
    "get-insurance-change": CommandOptionSpec(GET_OPTIONS, frozenset({"id"})),
    "get-personnel-change": CommandOptionSpec(GET_OPTIONS, frozenset({"id"})),
    "get-disciplinary-record": CommandOptionSpec(GET_OPTIONS, frozenset({"id"})),
    "get-seal-usage": CommandOptionSpec(GET_OPTIONS, frozenset({"id"})),
    "employee-detail": CommandOptionSpec(EMPLOYEE_LOOKUP_OPTIONS),
    "employee-timeline": CommandOptionSpec(EMPLOYEE_LOOKUP_OPTIONS | frozenset({"limit"})),
    "contracts-by-employee": CommandOptionSpec(EMPLOYEE_LOOKUP_OPTIONS),
    "performance-by-employee": CommandOptionSpec(EMPLOYEE_LOOKUP_OPTIONS),
    "performance-by-month": CommandOptionSpec(MONTH_FILTER),
    "insurance-by-employee": CommandOptionSpec(EMPLOYEE_LOOKUP_OPTIONS),
    "insurance-by-month": CommandOptionSpec(MONTH_FILTER),
    "personnel-changes-by-employee": CommandOptionSpec(EMPLOYEE_LOOKUP_OPTIONS),
    "personnel-changes-list": CommandOptionSpec(frozenset({"year", "reason", "company", "limit"})),
    "disciplinary-by-employee": CommandOptionSpec(EMPLOYEE_LOOKUP_OPTIONS),
    "seal-usage-list": CommandOptionSpec(frozenset({"company", "from", "to", "name"})),
    "deleted-records": CommandOptionSpec(DELETE_AUDIT_OPTIONS),
    "pending-review-list": CommandOptionSpec(NO_OPTIONS),
    "data-quality-check": CommandOptionSpec(NO_OPTIONS),
    "analyze-roster": CommandOptionSpec(ANALYZE_SCOPE_OPTIONS),
    "analyze-headcount": CommandOptionSpec(COMPANY_FILTER),
    "analyze-contract-coverage": CommandOptionSpec(ANALYZE_SCOPE_OPTIONS),
    "analyze-contract-expiry": CommandOptionSpec(frozenset({"days", "company"})),
    "analyze-performance-month": CommandOptionSpec(MONTH_FILTER),
    "analyze-low-performance": CommandOptionSpec(frozenset({"month", "company", "threshold"})),
    "analyze-insurance-month": CommandOptionSpec(MONTH_FILTER),
    "analyze-personnel-change": CommandOptionSpec(YEAR_FILTER),
    "analyze-disciplinary": CommandOptionSpec(COMPANY_FILTER),
    "analyze-seal-usage": CommandOptionSpec(DATE_RANGE_FILTER),
    "analyze-employee-profile": CommandOptionSpec(ANALYZE_SCOPE_OPTIONS),
    "analyze-hr-risk-dashboard": CommandOptionSpec(frozenset({"limit"})),
    "employee-summary": CommandOptionSpec(COMPANY_FILTER),
    "employees-without-contracts": CommandOptionSpec(NO_OPTIONS),
    "delete-empty-departments": CommandOptionSpec(WRITE_OPTIONS),
    "apply-employee-nickname-cleanup": CommandOptionSpec(WRITE_OPTIONS),
    "verify-employee-nickname-cleanup": CommandOptionSpec(frozenset({"input", "company"})),
    "apply-disciplinary-attachments": CommandOptionSpec(WRITE_OPTIONS),
    "verify-disciplinary-attachments": CommandOptionSpec(frozenset({"input", "company"})),
}

PUBLIC_COMMAND_OPTIONS = frozenset(
    {
        "business-capabilities",
        "business-plan-schema",
        "list-companies",
        "list-departments",
        "list-employees",
        "list-contracts",
        "list-performance-reviews",
        "list-insurance-changes",
        "list-personnel-changes",
        "list-disciplinary-records",
        "list-seal-usage",
        "get-company",
        "get-department",
        "get-employee",
        "get-contract",
        "get-performance-review",
        "get-insurance-change",
        "get-personnel-change",
        "get-disciplinary-record",
        "get-seal-usage",
        "deleted-records",
        "analyze-roster",
        "analyze-contract-coverage",
        "analyze-contract-expiry",
        "analyze-performance-month",
        "analyze-insurance-month",
        "analyze-personnel-change",
        "analyze-disciplinary",
        "analyze-seal-usage",
        "analyze-employee-profile",
        "preview-org-seeds",
        "apply-org-seeds",
        "preview-update-org-seeds",
        "update-org-seeds",
        "preview-employees",
        "apply-employees",
        "preview-update-employees",
        "update-employees",
        "delete-employee-records",
        "preview-contracts",
        "apply-contracts",
        "preview-update-contracts",
        "update-contracts",
        "delete-contracts",
        "preview-performance-reviews",
        "apply-performance-reviews",
        "preview-update-performance-reviews",
        "update-performance-reviews",
        "delete-performance-reviews",
        "preview-insurance-changes",
        "apply-insurance-changes",
        "preview-update-insurance-changes",
        "update-insurance-changes",
        "delete-insurance-changes",
        "preview-personnel-changes",
        "apply-personnel-changes",
        "preview-update-personnel-changes",
        "update-personnel-changes",
        "delete-personnel-changes",
        "preview-disciplinary-records",
        "apply-disciplinary-records",
        "preview-update-disciplinary-records",
        "update-disciplinary-records",
        "delete-disciplinary-records",
        "preview-seal-usage",
        "apply-seal-usage",
        "preview-update-seal-usage",
        "update-seal-usage",
        "delete-seal-usage",
    }
)

for _command in [
    "preview-org-seeds",
    "apply-org-seeds",
    "preview-update-org-seeds",
    "update-org-seeds",
    "preview-employees",
    "apply-employees",
    "preview-update-employees",
    "update-employees",
    "delete-employee-records",
    "preview-contracts",
    "apply-contracts",
    "preview-update-contracts",
    "update-contracts",
    "delete-contracts",
    "preview-performance-reviews",
    "apply-performance-reviews",
    "preview-update-performance-reviews",
    "update-performance-reviews",
    "delete-performance-reviews",
    "preview-insurance-changes",
    "apply-insurance-changes",
    "preview-update-insurance-changes",
    "update-insurance-changes",
    "delete-insurance-changes",
    "preview-personnel-changes",
    "apply-personnel-changes",
    "preview-update-personnel-changes",
    "update-personnel-changes",
    "delete-personnel-changes",
    "preview-disciplinary-records",
    "apply-disciplinary-records",
    "preview-update-disciplinary-records",
    "update-disciplinary-records",
    "delete-disciplinary-records",
    "preview-seal-usage",
    "apply-seal-usage",
    "preview-update-seal-usage",
    "update-seal-usage",
    "delete-seal-usage",
]:
    COMMAND_OPTIONS[_command] = CommandOptionSpec(WRITE_OPTIONS)

for _command in [
    "verify-org-seeds",
    "verify-employees",
    "verify-employee-deletions",
    "verify-contracts",
    "verify-performance-reviews",
    "verify-insurance-changes",
    "verify-personnel-changes",
    "verify-disciplinary-records",
    "verify-seal-usage",
]:
    COMMAND_OPTIONS[_command] = CommandOptionSpec(frozenset({"input", "company"}))


def option_contract() -> dict[str, Any]:
    """Return model-visible option metadata for capabilities output."""
    return {
        "value_options": {
            name: {
                "value_type": spec.value_type,
                **({"enum_values": list(spec.enum_values)} if spec.enum_values else {}),
                **({"minimum": spec.minimum} if spec.minimum is not None else {}),
                **({"maximum": spec.maximum} if spec.maximum is not None else {}),
            }
            for name, spec in sorted(VALUE_OPTIONS.items())
        },
        "boolean_options": sorted(BOOLEAN_OPTIONS),
        "result_limits": {
            "default": DEFAULT_RESULT_LIMIT,
            "maximum": MAX_RESULT_LIMIT,
            "default_page_size": DEFAULT_PAGE_SIZE,
            "maximum_page_size": MAX_PAGE_SIZE,
            "max_filtered_result_rows": MAX_FILTERED_RESULT_ROWS,
            "commands": sorted(LIMITABLE_COMMANDS),
        },
        "command_options": {
            command: {
                "allowed_options": sorted(spec.allowed_options),
                **({"required_options": sorted(spec.required_options)} if spec.required_options else {}),
            }
            for command, spec in sorted(COMMAND_OPTIONS.items())
            if command in PUBLIC_COMMAND_OPTIONS
        },
    }


def validate_options(command: str | None, options: dict[str, Any]) -> dict[str, Any]:
    """Validate and normalize command options before auth or repository work."""
    normalized = dict(options)
    for key in sorted(normalized):
        if key not in KNOWN_OPTIONS:
            raise RuntimeError(_unknown_option_message(key))
        if key in VALUE_OPTIONS:
            value = normalized[key]
            if value is True:
                raise RuntimeError(f"Option --{key} requires a value")
            normalized[key] = _normalize_option_value(VALUE_OPTIONS[key], value)
    _validate_command_options(command, normalized)
    return normalized


def _validate_command_options(command: str | None, options: dict[str, Any]) -> None:
    if command is None or command not in COMMAND_OPTIONS:
        return
    spec = COMMAND_OPTIONS[command]
    unsupported = sorted(key for key in options if key not in spec.allowed_options and key not in BOOLEAN_OPTIONS)
    if unsupported:
        key = unsupported[0]
        matches = get_close_matches(key, spec.allowed_options, n=1, cutoff=0.6)
        suggestion = f". Did you mean --{matches[0]}?" if matches else ""
        raise RuntimeError(f"Option --{key} is not supported by command {command}{suggestion}")
    missing = sorted(key for key in spec.required_options if key not in options or options.get(key) in {None, ""})
    if missing:
        raise RuntimeError(f"Command {command} requires option --{missing[0]}")


def _unknown_option_message(key: str) -> str:
    matches = get_close_matches(key, KNOWN_OPTIONS, n=1, cutoff=0.6)
    if matches:
        return f"Unknown option --{key}. Did you mean --{matches[0]}?"
    return f"Unknown option --{key}"


def _normalize_option_value(spec: OptionSpec, value: Any) -> Any:
    if value is None:
        return value
    text = str(value).strip()
    if spec.value_type == "integer":
        return _normalize_integer(spec, text)
    if spec.value_type == "float":
        return _normalize_float(spec, text)
    if spec.value_type == "enum":
        if text not in spec.enum_values:
            allowed = ", ".join(spec.enum_values)
            raise RuntimeError(f"Option --{spec.name} must be one of: {allowed}")
        return text
    return text


def _normalize_integer(spec: OptionSpec, text: str) -> int:
    try:
        value = int(text)
    except ValueError as exc:
        raise RuntimeError(f"Option --{spec.name} must be an integer") from exc
    _assert_range(spec, value)
    return value


def _normalize_float(spec: OptionSpec, text: str) -> float:
    try:
        value = float(text)
    except ValueError as exc:
        raise RuntimeError(f"Option --{spec.name} must be a number") from exc
    _assert_range(spec, value)
    return value


def _assert_range(spec: OptionSpec, value: int | float) -> None:
    if spec.minimum is not None and value < spec.minimum:
        if spec.maximum is not None:
            raise RuntimeError(f"Option --{spec.name} must be between {spec.minimum} and {spec.maximum}")
        raise RuntimeError(f"Option --{spec.name} must be at least {spec.minimum}")
    if spec.maximum is not None and value > spec.maximum:
        if spec.minimum is not None:
            raise RuntimeError(f"Option --{spec.name} must be between {spec.minimum} and {spec.maximum}")
        raise RuntimeError(f"Option --{spec.name} must be at most {spec.maximum}")
