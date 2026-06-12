"""Structured HR business tool for model-facing Nanobot calls."""

from __future__ import annotations

import json
import os
from contextlib import contextmanager
from pathlib import Path
from typing import Any

from nanobot.agent.tools.base import Tool
from nanobot.agent.tools.context import RequestContext, ToolContext

from ..business_modules.hr.runtime.commands import (
    normalize_business_command,
    parse_args,
    run_business_command,
)
from ..business_modules.hr.runtime.context import BusinessCommandContext
from ..business_modules.hr.runtime.policy import AccessPolicy, HR_COMMAND_RULES, HR_SCOPE_RESOURCES
from ..business_modules.hr.runtime.registry import validate_options
from ..permissions.audit import PermissionAuditLogger
from ..permissions.context import PolicyContext, get_policy_context

OUTPUT_PERSIST_THRESHOLD = 5_000
MAX_RUNTIME_INPUT_BYTES = 256 * 1024

OPTION_NAME_ALIASES = {
    "from_date": "from",
    "to_date": "to",
    "page_size": "page-size",
    "penalty_type": "penalty-type",
    "expiry_before": "expiry-before",
    "expiry_after": "expiry-after",
    "as_of": "as-of",
}

SCHEMA_RESOURCE_MAP = {
    "company": "hr.company",
    "organization": "hr.organization",
    "department": "hr.department",
    "employee": "hr.employee",
    "contract": "hr.contract",
    "performance": "hr.performance",
    "performance-review": "hr.performance",
    "insurance": "hr.insurance",
    "insurance-change": "hr.insurance",
    "personnel-change": "hr.personnel_change",
    "personnel-changes": "hr.personnel_change",
    "disciplinary": "hr.disciplinary",
    "disciplinary-record": "hr.disciplinary",
    "seal-usage": "hr.seal_usage",
}


class HrBusinessTool(Tool):
    """Model-facing structured entrypoint for HR business operations."""

    config_key = "hr_business"
    _scopes = {"core"}

    def __init__(self, *, workspace: Path | str | None = None) -> None:
        self._workspace = Path(workspace or Path.home() / ".nanobot" / "workspace")
        self._request_ctx: RequestContext | None = None

    @classmethod
    def create(cls, ctx: ToolContext) -> "HrBusinessTool":
        return cls(workspace=ctx.workspace)

    def set_context(self, ctx: RequestContext) -> None:
        self._request_ctx = ctx

    @property
    def name(self) -> str:
        return "hr_business"

    @property
    def description(self) -> str:
        return (
            "Run authorized HR business operations using structured parameters. "
            "Use this instead of exec for HR list/get/analyze/schema/write workflows."
        )

    @property
    def parameters(self) -> dict[str, Any]:
        value = {"type": ["string", "integer", "number", "boolean", "null"]}
        string_or_null = {"type": ["string", "null"]}
        integer_or_null = {"type": ["integer", "null"]}
        number_or_null = {"type": ["number", "null"]}
        return {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "action": {
                    "type": "string",
                    "enum": [
                        "list",
                        "get",
                        "analyze",
                        "preview",
                        "create",
                        "preview-update",
                        "update",
                        "delete",
                        "schema",
                        "capabilities",
                    ],
                },
                "resource": string_or_null,
                "id": string_or_null,
                "input": string_or_null,
                "workflow": {"type": ["string", "null"], "enum": ["create", "update", None]},
                "company": string_or_null,
                "department": string_or_null,
                "name": string_or_null,
                "employee": string_or_null,
                "status": string_or_null,
                "month": string_or_null,
                "year": integer_or_null,
                "from_date": string_or_null,
                "to_date": string_or_null,
                "days": integer_or_null,
                "threshold": number_or_null,
                "type": string_or_null,
                "penalty_type": string_or_null,
                "expiry_before": string_or_null,
                "expiry_after": string_or_null,
                "applicant": string_or_null,
                "as_of": string_or_null,
                "page": integer_or_null,
                "page_size": integer_or_null,
                "limit": integer_or_null,
                "tool_call_id": string_or_null,
            },
            "required": ["action"],
        }

    async def execute(self, **kwargs: Any) -> dict[str, Any]:
        action = str(kwargs.get("action") or "").strip()
        resource = _clean_optional(kwargs.get("resource"))
        policy = get_policy_context()
        chat_id = _chat_id(policy, self._request_ctx)
        argv = self._build_argv(action, resource, kwargs, chat_id)
        command, options = self._resolve_command(argv)
        self._authorize_registry_layer(
            policy=policy,
            action=action,
            resource=resource,
            command=command,
        )

        context = BusinessCommandContext(
            chat_id=chat_id,
            user_id=policy.user_id if policy else "",
            workspace=self._workspace,
            policy_file=policy.policy_file if policy else "",
            policy=_access_policy_from_context(policy),
            tool_call_id=_clean_optional(kwargs.get("tool_call_id")),
        )
        audit = PermissionAuditLogger(self._workspace)
        with _temporary_runtime_env(policy):
            result = run_business_command(argv, context=context)

        response = self._maybe_persist_result(result, chat_id=chat_id, command=command)
        audit.record(
            policy=policy,
            tool=self.name,
            command=" ".join(argv),
            decision="allow" if result.get("ok") else "error",
            reason="hr_business_executed",
            metadata={
                "hr_command": command,
                "persisted": bool(response.get("persisted")),
                "full_output_path": str(response.get("full_output_path") or ""),
            },
        )
        return response

    def _build_argv(
        self,
        action: str,
        resource: str | None,
        params: dict[str, Any],
        chat_id: str,
    ) -> list[str]:
        if not action:
            raise RuntimeError("action is required")
        if action == "get" and not _clean_optional(params.get("id")):
            raise RuntimeError("Command get requires option --id")
        argv = ["business", action]
        if resource:
            argv.append(resource)
        options: dict[str, Any] = {}
        for key, value in params.items():
            if key in {"action", "resource", "tool_call_id"} or value is None or value == "":
                continue
            option_name = OPTION_NAME_ALIASES.get(key, key.replace("_", "-"))
            if option_name == "input":
                value = str(self._resolve_input_path(str(value), chat_id))
            options[option_name] = value
        for key, value in options.items():
            argv.append(f"--{key}")
            if value is not True:
                argv.append(str(value))
        return argv

    @staticmethod
    def _resolve_command(argv: list[str]) -> tuple[str, dict[str, Any]]:
        parsed = parse_args(argv)
        command = parsed["command"]
        options = parsed["options"]
        if command == "business":
            command, options = normalize_business_command(parsed)
        options = validate_options(command, options)
        return command, options

    @staticmethod
    def _authorize_registry_layer(
        *,
        policy: PolicyContext | None,
        action: str,
        resource: str | None,
        command: str,
    ) -> None:
        if policy is None or policy.is_unrestricted:
            return
        if action == "capabilities":
            tenant_policy = policy.to_tenant_policy()
            if any(tenant_policy.resource(item) is not None for item in HR_SCOPE_RESOURCES):
                return
            raise RuntimeError("当前账号无 HR 权限")
        if action == "schema" and resource:
            hr_resource = SCHEMA_RESOURCE_MAP.get(resource, "hr.employee")
            if not policy.to_tenant_policy().allows(hr_resource, "read"):
                raise RuntimeError(f"当前账号无权执行 HR 资源动作: {hr_resource}:read")
            return
        hr_resource, hr_action, _ = HR_COMMAND_RULES.get(command, ("hr.employee", "query", None))
        if not policy.to_tenant_policy().allows(hr_resource, hr_action):
            raise RuntimeError(f"当前账号无权执行 HR 资源动作: {hr_resource}:{hr_action}")

    def _resolve_input_path(self, raw: str, chat_id: str) -> Path:
        base = (
            self._workspace
            / ".nanobot_channel_webui"
            / "runtime-inputs"
            / (chat_id or "unknown")
        ).resolve()
        candidate = Path(raw).resolve() if Path(raw).is_absolute() else (base / raw).resolve()
        if not candidate.is_relative_to(base):
            raise RuntimeError("input 路径越界，必须位于当前实例 runtime-inputs 目录内")
        if candidate.suffix != ".json":
            raise RuntimeError("input 只接受 .json 文件")
        if not candidate.exists():
            raise RuntimeError(f"input 文件不存在: {candidate}")
        if candidate.stat().st_size > MAX_RUNTIME_INPUT_BYTES:
            raise RuntimeError("input 文件超过 256 KB 限制")
        return candidate

    def _maybe_persist_result(
        self,
        result: dict[str, Any],
        *,
        chat_id: str,
        command: str,
    ) -> dict[str, Any]:
        serialized = json.dumps(result, ensure_ascii=False, indent=2, default=str)
        should_persist = len(serialized) > OUTPUT_PERSIST_THRESHOLD
        if not should_persist:
            return result
        directory = (
            self._workspace
            / ".nanobot"
            / "tool-results"
            / f"webui_plugin_{chat_id or 'unknown'}"
            / "hr"
        )
        directory.mkdir(parents=True, exist_ok=True)
        path = directory / f"{command}-{abs(hash(serialized))}.json"
        path.write_text(serialized + "\n", encoding="utf-8")
        return {
            "ok": bool(result.get("ok")),
            "persisted": True,
            "full_output_path": str(path),
            "summary": _summarize_result(result),
            "error": result.get("error") if not result.get("ok") else None,
        }


@contextmanager
def _temporary_runtime_env(policy: PolicyContext | None):
    previous_policy = os.environ.get("NANOBOT_WEBUI_POLICY_FILE")
    previous_config = os.environ.get("NANOBOT_CONFIG")
    try:
        if policy and policy.policy_file:
            os.environ["NANOBOT_WEBUI_POLICY_FILE"] = policy.policy_file
        os.environ.setdefault("NANOBOT_CONFIG", str(Path.home() / ".nanobot" / "config.json"))
        yield
    finally:
        _restore_env("NANOBOT_WEBUI_POLICY_FILE", previous_policy)
        _restore_env("NANOBOT_CONFIG", previous_config)


def _restore_env(key: str, previous: str | None) -> None:
    if previous is None:
        os.environ.pop(key, None)
    else:
        os.environ[key] = previous


def _chat_id(policy: PolicyContext | None, request_ctx: RequestContext | None) -> str:
    if policy and policy.chat_id:
        return policy.chat_id
    if request_ctx and request_ctx.chat_id:
        return request_ctx.chat_id
    return "unknown"


def _clean_optional(value: Any) -> str | None:
    text = str(value).strip() if value is not None else ""
    return text or None


def _access_policy_from_context(policy: PolicyContext | None) -> AccessPolicy | None:
    if policy is None:
        return None
    company_scope = list(policy.effective_scopes.get("company", ()))
    return AccessPolicy(
        unrestricted=policy.is_unrestricted,
        missing_policy_file=False,
        user_id=policy.user_id,
        email=policy.email,
        role=policy.role,
        business_role=policy.business_role,
        company_scope=company_scope,
        resources=[dict(item) for item in policy.resources],
    )


def _summarize_result(result: dict[str, Any]) -> dict[str, Any]:
    data = result.get("data")
    if isinstance(data, dict):
        records = data.get("records")
        return {
            "keys": sorted(str(key) for key in data.keys())[:20],
            "record_count": len(records) if isinstance(records, list) else None,
            "count": data.get("count"),
            "topic": data.get("topic"),
            "command": data.get("command"),
        }
    return {"type": type(data).__name__}
