"""Permission-aware ToolRegistry proxy."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from .audit import PermissionAuditLogger
from .command_policy import CommandPolicyGuard
from .context import get_policy_context
from .skill_view import DynamicSkillViewRenderer


_POLICY_ERROR_SUFFIX = (
    "\n\n[这是当前账号的权限边界，不是临时错误。不要尝试用其它工具、shell 技巧或底层数据库脚本绕过。]"
)


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
        return [schema for schema in definitions if self._can_show_tool(self._schema_name(schema))]

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
            if self._can_read_path(path, policy):
                skill_name = self._skill_name_for_path(path)
                if skill_name and policy.can_use_skill(skill_name):
                    view = self._skill_views.render(skill_name, policy)
                    if view is not None:
                        self._audit.record(policy=policy, tool=name, command=path, decision="allow", reason="dynamic_skill_view")
                        return _StaticToolResult(view), {}, None
                self._audit.record(policy=policy, tool=name, command=path, decision="allow", reason="allowed_skill_file")
                return self._original.prepare_call(name, params)
            self._audit.record(policy=policy, tool=name, command=path, decision="deny", reason="read_path_not_allowed")
            return None, params, f"Error: 当前账号无权读取该文件{_POLICY_ERROR_SUFFIX}"

        if name != "exec":
            self._audit.record(policy=policy, tool=name, decision="deny", reason="tool_not_allowed")
            return None, params, f"Error: 当前账号无权调用工具 '{name}'{_POLICY_ERROR_SUFFIX}"

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

    @staticmethod
    def _can_show_tool(name: str) -> bool:
        return name in {"exec", "read_file", "ask_user"}

    @staticmethod
    def _can_read_path(path: str, policy: Any) -> bool:
        normalized = path.replace("\\", "/")
        if ".env" in normalized or "/supabase-base/" in normalized or "skills/supabase-base/" in normalized:
            return False
        return any(f"/skills/{name}/" in normalized or normalized.startswith(f"skills/{name}/") for name in policy.skill_allowlist)

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
