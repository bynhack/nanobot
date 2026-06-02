"""Permission-aware ToolRegistry proxy."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .audit import PermissionAuditLogger
from .command_policy import CommandPolicyGuard
from .context import get_policy_context
from .skill_view import DynamicSkillViewRenderer
from ..business_modules.registry import is_packaged_managed_skill, iter_packaged_skills
from ..tenant_runtime.skill_contract import load_skill_contract


_POLICY_ERROR_SUFFIX = (
    "\n\n[这是当前账号的权限边界，不是临时错误。不要尝试用其它工具、shell 技巧或底层数据库脚本绕过。]"
)
_RUNTIME_INPUT_DIR = ".nanobot_channel_webui/runtime-inputs"
_ARTIFACT_DIR = ".nanobot_channel_webui/artifacts"
_PRIVATE_DIR = ".nanobot_channel_webui/private"
_POLICIES_DIR = ".nanobot_channel_webui/policies"
_AUDIT_DIR = ".nanobot_channel_webui/audit"
_SESSIONS_DIR = "sessions"
_TOOL_RESULTS_DIR = ".nanobot/tool-results"
_MAX_RUNTIME_INPUT_BYTES = 256 * 1024
_MAX_ARTIFACT_BYTES = 5 * 1024 * 1024
_SCOPED_HIDDEN_TOOLS = {
    "cron",
    "edit_file",
    "grep",
    "long_task",
    "my",
    "notebook_edit",
    "spawn",
}


class _StaticToolResult:
    def __init__(self, content: str) -> None:
        self._content = content

    async def execute(self, **_kwargs: Any) -> str:
        return self._content


class AuthorizingToolRegistry:
    """Wrap ToolRegistry with per-request authorization."""

    _nanobot_webui_permission_wrapper = True

    def __init__(self, original: Any, *, audit: PermissionAuditLogger, workspace: Path | None = None) -> None:
        self._original = original
        self._audit = audit
        self._workspace = workspace or Path.home() / ".nanobot" / "workspace"
        self._commands = CommandPolicyGuard(workspace=workspace)
        self._skill_views = DynamicSkillViewRenderer(self._workspace)

    def __getattr__(self, name: str) -> Any:
        return getattr(self._original, name)

    def register(self, tool: Any) -> None:
        return self._original.register(tool)

    def unregister(self, name: str) -> None:
        return self._original.unregister(name)

    def get(self, name: str) -> Any:
        return self._original.get(name)

    def has(self, name: str) -> bool:
        return self._original.has(name)

    @property
    def tool_names(self) -> list[str]:
        return list(getattr(self._original, "tool_names", []))

    def get_definitions(self) -> list[dict[str, Any]]:
        policy = get_policy_context()
        definitions = self._original.get_definitions()
        if policy is None or policy.is_unrestricted:
            return definitions
        return [item for item in definitions if self._schema_name(item) not in _SCOPED_HIDDEN_TOOLS]

    def prepare_call(
        self,
        name: str,
        params: dict[str, Any],
    ) -> tuple[Any | None, dict[str, Any], str | None]:
        policy = get_policy_context()
        if policy is None:
            return self._original.prepare_call(name, params)

        if policy.is_unrestricted:
            command = str((params or {}).get("command") or (params or {}).get("cmd") or "")
            self._audit.record(policy=policy, tool=name, command=command, decision="allow", reason="admin_unrestricted")
            return self._original.prepare_call(name, params)

        if name == "ask_user":
            return self._original.prepare_call(name, params)

        if name == "read_file":
            path = str((params or {}).get("path") or "")
            if self._is_workspace_skills_root(path):
                self._audit.record(policy=policy, tool=name, command=path, decision="allow", reason="virtual_skill_index")
                return _StaticToolResult(self._virtual_skill_index(policy)), {}, None
            if self._can_read_path(path, policy):
                skill_name = self._skill_name_for_path(path)
                if skill_name and self._is_managed_skill(skill_name):
                    if self._is_reference_skill(skill_name):
                        self._audit.record(policy=policy, tool=name, command=path, decision="allow", reason="managed_reference_skill")
                        return self._original.prepare_call(name, params)
                    view = self._skill_views.render(skill_name, policy)
                    if view is not None:
                        self._audit.record(policy=policy, tool=name, command=path, decision="allow", reason="dynamic_skill_view")
                        return _StaticToolResult(view), {}, None
                    self._audit.record(policy=policy, tool=name, command=path, decision="deny", reason="managed_skill_hidden_file")
                    return None, params, f"Error: 当前账号无权读取该文件{_POLICY_ERROR_SUFFIX}"
                self._audit.record(policy=policy, tool=name, command=path, decision="allow", reason="allowed_skill_file")
                return self._original.prepare_call(name, params)
            self._audit.record(policy=policy, tool=name, command=path, decision="deny", reason="read_path_not_allowed")
            return None, params, f"Error: 当前账号无权读取该文件{_POLICY_ERROR_SUFFIX}"

        if name == "write_file":
            path = str((params or {}).get("path") or "")
            content = str((params or {}).get("content") or "")
            allowed, reason = self._can_write_runtime_input(path, content)
            if allowed:
                next_params = dict(params or {})
                next_params["content"] = content
                self._ensure_runtime_input_parent(path)
                self._audit.record(
                    policy=policy,
                    tool=name,
                    command=path,
                    decision="allow",
                    reason=reason,
                )
                return self._original.prepare_call(name, next_params)
            artifact_allowed, artifact_reason = self._can_write_artifact(path, content, policy)
            if artifact_allowed:
                self._ensure_parent(path)
                self._audit.record(policy=policy, tool=name, command=path, decision="allow", reason=artifact_reason)
                return self._original.prepare_call(name, params)
            relocated_path, relocate_reason = self._relocate_runtime_input(path, content, policy)
            if relocated_path is not None:
                relocated_path.parent.mkdir(parents=True, exist_ok=True)
                relocated_path.write_text(content, encoding="utf-8")
                self._audit.record(
                    policy=policy,
                    tool=name,
                    command=f"{path} -> {relocated_path}",
                    decision="allow",
                    reason=relocate_reason,
                )
                return (
                    _StaticToolResult(
                        "Wrote JSON runtime input file: "
                        f"{relocated_path}\nUse this exact path as the `--input` value for the next business CLI command."
                    ),
                    {},
                    None,
                )
            self._audit.record(policy=policy, tool=name, command=path, decision="deny", reason=reason)
            return None, params, f"Error: 当前账号无权写入该文件（{reason}）{_POLICY_ERROR_SUFFIX}"

        if name == "list_dir":
            path = str((params or {}).get("path") or "")
            if self._is_workspace_skills_root(path):
                self._audit.record(policy=policy, tool=name, command=path, decision="allow", reason="virtual_skill_index")
                return _StaticToolResult(self._virtual_skill_index(policy)), {}, None
            if self._can_list_path(path, policy):
                self._audit.record(policy=policy, tool=name, command=path, decision="allow", reason="list_path_allowed")
                return self._original.prepare_call(name, params)
            self._audit.record(policy=policy, tool=name, command=path, decision="deny", reason="list_path_not_allowed")
            return None, params, f"Error: 当前账号无权列出该目录{_POLICY_ERROR_SUFFIX}"

        if name in _SCOPED_HIDDEN_TOOLS:
            self._audit.record(policy=policy, tool=name, decision="deny", reason="scoped_tool_hidden")
            return None, params, f"Error: 当前账号无权使用该工具（scoped_tool_hidden）{_POLICY_ERROR_SUFFIX}"

        if name != "exec":
            self._audit.record(policy=policy, tool=name, decision="allow", reason="unmanaged_tool_passthrough")
            return self._original.prepare_call(name, params)

        command = str((params or {}).get("command") or (params or {}).get("cmd") or "")
        decision = self._commands.authorize(command, policy)
        if not decision.allowed:
            self._audit.record(
                policy=policy,
                tool=name,
                command=command,
                decision="deny",
                reason=decision.reason,
            )
            return None, params, f"Error: 当前账号无权执行该命令（{decision.reason}）{_POLICY_ERROR_SUFFIX}"

        next_params = dict(params or {})
        if "command" in next_params:
            next_params["command"] = decision.command
        else:
            next_params["cmd"] = decision.command
        self._audit.record(
            policy=policy,
            tool=name,
            command=command,
            decision="allow",
            reason=decision.reason,
        )
        return self._original.prepare_call(name, next_params)

    async def execute(self, name: str, params: dict[str, Any]) -> Any:
        tool, cast_params, error = self.prepare_call(name, params)
        if error:
            return error
        try:
            if tool is not None:
                return await tool.execute(**cast_params)
            return await self._original.execute(name, cast_params)
        except Exception as exc:
            return f"Error executing {name}: {exc}"

    def __len__(self) -> int:
        return len(self._original)

    def __contains__(self, name: str) -> bool:
        return name in self._original

    @staticmethod
    def _schema_name(schema: dict[str, Any]) -> str:
        fn = schema.get("function")
        if isinstance(fn, dict) and isinstance(fn.get("name"), str):
            return fn["name"]
        name = schema.get("name")
        return name if isinstance(name, str) else ""

    def _can_read_path(self, path: str, policy: Any) -> bool:
        normalized = path.replace("\\", "/")
        if self._is_protected_path(normalized):
            return False
        chat_id = str(getattr(policy, "chat_id", "") or "")
        if chat_id and f"/.nanobot/tool-results/webui_plugin_{chat_id}/" in normalized:
            return True
        if chat_id and f"/{_ARTIFACT_DIR}/{chat_id}/" in normalized:
            return True
        if chat_id and f"/{_RUNTIME_INPUT_DIR}/{chat_id}/" in normalized:
            return True
        if f"/{_ARTIFACT_DIR}/" in normalized or normalized.startswith(f"{_ARTIFACT_DIR}/"):
            return False
        skill_name = self._skill_name_for_path(path)
        if skill_name:
            if self._is_managed_skill(skill_name):
                return policy.can_use_skill(skill_name)
            return True
        return False

    def _can_list_path(self, path: str, policy: Any) -> bool:
        normalized = self._runtime_input_path(path)
        normalized_text = str(normalized).replace("\\", "/")
        if self._is_protected_path(normalized_text):
            return False
        chat_id = str(getattr(policy, "chat_id", "") or "")
        allowed_roots: list[Path] = []
        if chat_id:
            allowed_roots.extend(
                [
                    self._workspace / _RUNTIME_INPUT_DIR / chat_id,
                    self._workspace / _ARTIFACT_DIR / chat_id,
                    self._workspace / _TOOL_RESULTS_DIR / f"webui_plugin_{chat_id}",
                ]
            )
        for root in allowed_roots:
            try:
                normalized.resolve().relative_to(root.resolve())
                return True
            except (ValueError, OSError):
                continue
        return False

    def _skill_name_for_path(self, path: str) -> str:
        normalized = Path(path).expanduser()
        if not normalized.is_absolute():
            normalized = self._workspace / normalized
        try:
            relative = normalized.resolve().relative_to((self._workspace / "skills").resolve())
        except ValueError:
            return ""
        parts = relative.parts
        if parts:
            return parts[0]
        return ""

    def _is_managed_skill(self, skill_name: str) -> bool:
        if is_packaged_managed_skill(skill_name):
            return True
        contract = load_skill_contract(self._workspace / "skills" / skill_name)
        return bool(contract is not None and contract.managed)

    def _is_reference_skill(self, skill_name: str) -> bool:
        if skill_name not in {"hr-schema"}:
            return False
        contract = load_skill_contract(self._workspace / "skills" / skill_name)
        if contract is None:
            from ..business_modules.registry import get_packaged_contract

            contract = get_packaged_contract(skill_name)
        return bool(contract is not None and contract.managed and contract.kind == "reference")

    def _is_workspace_skills_root(self, path: str) -> bool:
        if not path:
            return False
        normalized = Path(path).expanduser()
        if not normalized.is_absolute():
            normalized = self._workspace / normalized
        try:
            return normalized.resolve() == (self._workspace / "skills").resolve()
        except OSError:
            return False

    def _virtual_skill_index(self, policy: Any) -> str:
        physical = f"Directory {self._workspace / 'skills'} is empty."
        allowed = [
            skill.name
            for skill in iter_packaged_skills()
            if policy.can_use_skill(skill.name)
        ]
        if not allowed:
            return physical
        router_path = self._workspace / "skills" / "hr-query-analysis-router" / "SKILL.md"
        lines = [
            physical,
            "",
            "Plugin virtual business skills are available at runtime; they are not physical directories.",
            "Do not scan the filesystem or guess `skills/hr-*` shell paths.",
            "",
            "Available virtual skills:",
        ]
        lines.extend(f"- {name}" for name in sorted(allowed))
        lines.extend(
            [
                "",
                f"For HR business-data requests, read this dynamic view first: {router_path}",
            ]
        )
        return "\n".join(lines)

    @staticmethod
    def _is_protected_path(normalized: str) -> bool:
        home_config = str(Path.home() / ".nanobot" / "config.json").replace("\\", "/")
        return (
            ".env" in normalized
            or normalized == home_config
            or normalized.endswith("/.nanobot/config.json")
            or "/.nanobot/config.json" in normalized
            or "/supabase-base/" in normalized
            or "skills/supabase-base/" in normalized
            or f"/{_PRIVATE_DIR}/" in normalized
            or normalized.startswith(f"{_PRIVATE_DIR}/")
            or f"/{_POLICIES_DIR}/" in normalized
            or normalized.startswith(f"{_POLICIES_DIR}/")
            or f"/{_AUDIT_DIR}/" in normalized
            or normalized.startswith(f"{_AUDIT_DIR}/")
            or f"/{_SESSIONS_DIR}/" in normalized
            or normalized.startswith(f"{_SESSIONS_DIR}/")
        )

    def _runtime_input_path(self, path: str) -> Path:
        normalized = Path(path).expanduser()
        if not normalized.is_absolute():
            normalized = self._workspace / normalized
        return normalized

    def _can_write_runtime_input(self, path: str, content: str) -> tuple[bool, str]:
        if not path:
            return False, "runtime_input_path_required"
        if len(content.encode("utf-8")) > _MAX_RUNTIME_INPUT_BYTES:
            return False, "runtime_input_too_large"
        normalized = self._runtime_input_path(path)
        try:
            normalized.resolve().relative_to((self._workspace / _RUNTIME_INPUT_DIR).resolve())
        except ValueError:
            return False, "write_path_not_allowed"
        if normalized.suffix.lower() != ".json":
            return False, "runtime_input_must_be_json"
        try:
            json.loads(content)
        except json.JSONDecodeError:
            return False, "runtime_input_invalid_json"
        return True, "runtime_input_allowed"

    def _can_write_artifact(self, path: str, content: str, policy: Any) -> tuple[bool, str]:
        if not path:
            return False, "artifact_path_required"
        if len(content.encode("utf-8")) > _MAX_ARTIFACT_BYTES:
            return False, "artifact_too_large"
        chat_id = str(getattr(policy, "chat_id", "") or "")
        if not chat_id:
            return False, "artifact_chat_required"
        normalized = self._runtime_input_path(path)
        try:
            normalized.resolve().relative_to((self._workspace / _ARTIFACT_DIR / chat_id).resolve())
        except ValueError:
            return False, "artifact_path_not_allowed"
        return True, "artifact_allowed"

    def _ensure_runtime_input_parent(self, path: str) -> None:
        self._ensure_parent(path)

    def _ensure_parent(self, path: str) -> None:
        normalized = self._runtime_input_path(path)
        normalized.parent.mkdir(parents=True, exist_ok=True)

    def _relocate_runtime_input(self, path: str, content: str, policy: Any) -> tuple[Path | None, str]:
        if len(content.encode("utf-8")) > _MAX_RUNTIME_INPUT_BYTES:
            return None, "runtime_input_too_large"
        try:
            json.loads(content)
        except json.JSONDecodeError:
            return None, "runtime_input_invalid_json"
        requested = Path(path).expanduser() if path else Path("input-plan.json")
        if requested.suffix.lower() != ".json":
            return None, "runtime_input_must_be_json"
        name = self._safe_runtime_input_name(requested.name)
        chat_id = str(getattr(policy, "chat_id", "") or "unscoped")
        return self._workspace / _RUNTIME_INPUT_DIR / chat_id / name, "runtime_input_relocated"

    @staticmethod
    def _safe_runtime_input_name(name: str) -> str:
        safe = "".join(char if char.isalnum() or char in {".", "-", "_"} else "_" for char in name)
        safe = safe.strip("._") or "input-plan.json"
        if not safe.lower().endswith(".json"):
            safe = f"{safe}.json"
        return safe
