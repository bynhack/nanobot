"""WebUI channel — serves a browser chat UI over HTTP + WebSocket."""

from __future__ import annotations

import asyncio
import html as html_lib
import json
import mimetypes
import os
import time
import uuid
from pathlib import Path
from typing import Any

from loguru import logger

from nanobot.agent.hook import AgentHook, AgentHookContext
from nanobot.bus.events import OutboundMessage
from nanobot.bus.queue import MessageBus
from nanobot.channels.base import BaseChannel
from nanobot.utils.helpers import ensure_dir

from .auth import WebUIAccessControl
from .case_audit import CaseAuditService, CaseAuditStorage
from .case_graph.mysql_client import CaseGraphMySQLConfig, PyMySQLCaseGraphQueryClient
from .case_graph.graph_state_service import GraphStateService
from .case_graph.relation_service import RelationGraphService
from .case_graph.service import CaseGraphService
from .case_graph.storage import CaseGraphCorruptError, CaseGraphStorage
from .compat.runtime import attach_webui_runtime, current_route_context, runtime_snapshot
from .config import CHANNEL_NAME, WebUIConfig
from .connections import ConnectionRegistry
from .management import WebUIManagementService
from .media import MediaService
from .pocketbase import PocketBaseAuthError, PocketBaseClient
from .protocol import (
    error_event,
    parse_client_command,
    session_deleted_event,
    session_history_event,
    session_init_event,
    tools_finished_event,
    tools_started_event,
    turn_completed_event,
    turn_delta_event,
    turn_phase_event,
)
from .session_index import SessionIndexService
from .sessions import SessionQueryService, is_valid_chat_id, parse_session_ref
from .session_workspace import SessionWorkspaceService
from .turns import TurnAccumulator
from .user_context import CurrentUser, bind_current_user
from .uploads import attachment_prompt_suffix, next_upload_path

STATIC_DIR = Path(__file__).parent / "static"
PACKAGE_ROOT = Path(__file__).resolve().parent.parent


class _CaseGraphQueryClientNotConfiguredError(RuntimeError):
    """Raised when case-graph query endpoints are used without DB config."""


class _UnconfiguredCaseGraphQueryClient:
    def __init__(self, config: WebUIConfig) -> None:
        self._config = config

    def list_cases(self) -> list[dict[str, Any]]:
        raise self._error()

    def list_accounts(self, case_id: str, keyword: str = "") -> list[dict[str, Any]]:
        raise self._error()

    def case_audit_overview(self, case_id: str) -> dict[str, Any]:
        raise self._error()

    def query_case_audit_trades(self, payload: dict[str, Any]) -> list[dict[str, Any]]:
        raise self._error()

    def query_graph(self, payload: dict[str, Any]) -> dict[str, Any]:
        raise self._error()

    def drill_down(self, payload: dict[str, Any]) -> list[dict[str, Any]]:
        raise self._error()

    def drill_up(self, payload: dict[str, Any]) -> list[dict[str, Any]]:
        raise self._error()

    def drill(self, payload: dict[str, Any]) -> list[dict[str, Any]]:
        raise self._error()

    def target_detail(self, payload: dict[str, Any]) -> dict[str, Any]:
        raise self._error()

    def query_relation_one_hop(self, **_kwargs: Any) -> dict[str, Any]:
        raise self._error()

    def query_relation_between_accounts(self, **_kwargs: Any) -> dict[str, Any]:
        raise self._error()

    def _error(self) -> _CaseGraphQueryClientNotConfiguredError:
        missing = [
            name for name, value in (
                ("case_graph_db_host", self._config.case_graph_db_host),
                ("case_graph_db_user", self._config.case_graph_db_user),
                ("case_graph_db_name", self._config.case_graph_db_name),
            )
            if not str(value).strip()
        ]
        detail = ", ".join(missing) if missing else "case_graph_db_*"
        return _CaseGraphQueryClientNotConfiguredError(
            f"case-graph query client 未配置，请先补充数据库配置: {detail}"
        )


def _has_case_graph_db_config(config: WebUIConfig) -> bool:
    return all(
        str(value).strip()
        for value in (
            config.case_graph_db_host,
            config.case_graph_db_user,
            config.case_graph_db_name,
        )
    )


def _hint(name: str, args: dict[str, Any]) -> str:
    if not args:
        return f"{name}()"
    key, value = next(iter(args.items()))
    text = str(value)
    if len(text) > 50:
        text = text[:50] + "…"
    suffix = ", …" if len(args) > 1 else ""
    return f'{name}("{text}"{suffix})'


def _read_env_file_value(key: str) -> str:
    for base in (Path.cwd(), PACKAGE_ROOT):
        env_path = base / ".env"
        if not env_path.exists():
            continue
        try:
            for raw_line in env_path.read_text(encoding="utf-8").splitlines():
                line = raw_line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                name, value = line.split("=", 1)
                if name.strip() != key:
                    continue
                return value.strip().strip('"').strip("'")
        except Exception:
            continue
    return ""


def _resolve_runtime_workspace() -> Path:
    """Resolve the workspace from the active gateway config.

    The upstream path helper defaults to ~/.nanobot/workspace when no explicit
    workspace is passed. The WebUI plugin stores product state itself, so the
    channel must read the active config and pass the workspace into each local
    storage service instead of relying on that helper's default.
    """
    from nanobot.config.loader import load_config, resolve_config_env_vars

    config = resolve_config_env_vars(load_config())
    return ensure_dir(config.workspace_path)


def _resolve_webui_title(config_title: str) -> str:
    configured = str(config_title or "").strip()
    if configured:
        return configured
    return (
        os.environ.get("NANOBOT_WEBUI_TITLE", "").strip()
        or _read_env_file_value("NANOBOT_WEBUI_TITLE")
        or "Nanobot"
    )


def _is_control_tool(name: str) -> bool:
    return name == "ask_user"


async def _read_json_object(request: Any) -> tuple[dict[str, Any] | None, Any | None]:
    from aiohttp import web

    try:
        payload = await request.json()
    except Exception:
        return None, web.json_response({"error": "请求体不是有效 JSON"}, status=400)
    if not isinstance(payload, dict):
        return None, web.json_response({"error": "请求体格式无效"}, status=400)
    return payload, None


def _missing_required_fields(payload: dict[str, Any], *names: str) -> list[str]:
    missing: list[str] = []
    for name in names:
        value = payload.get(name)
        if isinstance(value, str):
            if not value.strip():
                missing.append(name)
            continue
        if value is None:
            missing.append(name)
    return missing


def _require_text_field(payload: dict[str, Any], name: str) -> str:
    value = payload.get(name)
    if not isinstance(value, str):
        raise ValueError(name)
    text = value.strip()
    if not text:
        raise ValueError(name)
    return text


def _is_dict_list(value: Any) -> bool:
    return isinstance(value, list) and all(isinstance(item, dict) for item in value)


def _case_graph_corrupt_response(web: Any, exc: CaseGraphCorruptError) -> Any:
    return web.json_response(
        {
            "error": f"图数据损坏: {exc.graph_id}",
            "kind": exc.kind,
            "graphId": exc.graph_id,
        },
        status=409,
    )


def _ask_user_prompt_from_context(ctx: AgentHookContext) -> tuple[str, list[list[str]]] | None:
    for tool_call in reversed(ctx.tool_calls):
        if tool_call.name != "ask_user":
            continue
        question = str(tool_call.arguments.get("question", "")).strip()
        options = [
            str(option).strip()
            for option in tool_call.arguments.get("options", [])
            if str(option).strip()
        ]
        if question and options:
            return question, [options]
    return None


def _strip_webui_ask_user_text_fallback(content: str, question: str, buttons: list[list[str]]) -> str:
    labels = [label for row in buttons for label in row if label]
    if not labels:
        return content

    expected_lines = [question, "", *[f"{index}. {label}" for index, label in enumerate(labels, 1)]]
    expected = "\n".join(expected_lines).strip()
    if content.strip() == expected:
        return question
    return content


class WebUIHook(AgentHook):
    """Push WebUI-specific tool lifecycle and streaming completion events."""

    def __init__(self, registry: ConnectionRegistry, turns: TurnAccumulator) -> None:
        self._registry = registry
        self._turns = turns
        self._tools_started_at: dict[str, float] = {}

    @staticmethod
    def _chat_id(ctx: AgentHookContext) -> str:
        route = current_route_context()
        return route.chat_id if route is not None else ""

    @staticmethod
    def _session_key(ctx: AgentHookContext) -> str:
        route = current_route_context()
        return route.session_key if route is not None else WebUIHook._chat_id(ctx)

    async def before_execute_tools(self, ctx: AgentHookContext) -> None:
        chat_id = self._chat_id(ctx)
        visible_tool_calls = [
            tool_call for tool_call in ctx.tool_calls
            if not _is_control_tool(tool_call.name)
        ]
        if not chat_id or not visible_tool_calls or self._registry.is_blocked(chat_id):
            return

        self._tools_started_at[self._session_key(ctx)] = time.monotonic()
        await self._registry.emit_to_chat(chat_id, turn_phase_event(chat_id, "running_tools"))
        await self._registry.emit_to_chat(
            chat_id,
            tools_started_event(
                chat_id,
                [
                    {
                        "name": tool_call.name,
                        "args": tool_call.arguments,
                        "hint": _hint(tool_call.name, tool_call.arguments),
                    }
                    for tool_call in visible_tool_calls
                ],
            ),
        )

    async def after_iteration(self, ctx: AgentHookContext) -> None:
        chat_id = self._chat_id(ctx)
        if not chat_id or self._registry.is_blocked(chat_id):
            return

        visible_tool_indexes = [
            index for index, tool_call in enumerate(ctx.tool_calls)
            if not _is_control_tool(tool_call.name)
        ]

        if visible_tool_indexes:
            session_key = self._session_key(ctx)
            started = self._tools_started_at.pop(session_key, None)
            if started is None:
                started = time.monotonic()
            duration_ms = round((time.monotonic() - started) * 1000)
            results: list[dict[str, Any]] = []
            for index in visible_tool_indexes:
                event = ctx.tool_events[index] if index < len(ctx.tool_events) else {}
                raw = ctx.tool_results[index] if index < len(ctx.tool_results) else None
                results.append({
                    "name": event.get("name", ""),
                    "status": event.get("status", "ok"),
                    "detail": "" if raw is None else str(raw),
                })
            await self._registry.emit_to_chat(
                chat_id,
                tools_finished_event(chat_id, duration_ms=duration_ms, results=results),
            )
            return

        route = current_route_context()
        if route is None or not route.wants_streaming:
            return

        if ctx.final_content is None and ctx.error is None and ctx.stop_reason not in {"max_iterations", "error"}:
            return

        snapshot = self._turns.finish(chat_id)
        if not snapshot.should_emit_completion:
            return

        content = ""
        buttons: list[list[str]] | None = None
        if not snapshot.had_stream_output:
            content = ctx.final_content or ""
        if ctx.stop_reason == "ask_user":
            parsed_ask = _ask_user_prompt_from_context(ctx)
            if parsed_ask is not None:
                content, buttons = parsed_ask

        await self._registry.emit_to_chat(
            chat_id,
            turn_completed_event(
                chat_id,
                content=content,
                buttons=buttons,
                stream_id=snapshot.stream_id,
            ),
        )
        self._turns.clear(chat_id)


class WebUIChannel(BaseChannel):
    """Browser-based chat channel served over HTTP + WebSocket."""

    name = CHANNEL_NAME
    display_name = "Web UI Plugin"

    def __init__(self, config: Any, bus: MessageBus) -> None:
        if isinstance(config, dict):
            config = WebUIConfig.model_validate(config)
        super().__init__(config, bus)
        self.config: WebUIConfig = config
        self._resolved_title = _resolve_webui_title(self.config.title)
        self._registry = ConnectionRegistry()
        self._turns = TurnAccumulator()
        self._runner: Any = None
        self._runtime_attach_warned = False
        self._pocketbase = PocketBaseClient(
            base_url=self.config.pocketbase_url,
            users_collection=self.config.pocketbase_users_collection,
            sessions_collection=self.config.pocketbase_sessions_collection,
        )
        self._access = WebUIAccessControl(
            allowed_origins=self.config.allowed_origins,
            auth_token=self.config.auth_token,
            pocketbase=self._pocketbase,
        )
        self._media = MediaService(
            ttl_seconds=self.config.media_token_ttl_seconds,
            auth_token=self.config.auth_token,
            signing_secret=self.config.media_signing_secret,
        )
        self._runtime_workspace = _resolve_runtime_workspace()
        self._sessions = SessionQueryService(workspace=self._runtime_workspace)
        self._workspace = SessionWorkspaceService(self._sessions.workspace)
        self._session_index = SessionIndexService(self._pocketbase)
        self._management = WebUIManagementService(self._sessions.workspace)
        self._management.bind_runtime_observer(self._runtime_observability_snapshot)
        self._case_graph_storage = CaseGraphStorage(workspace=self._runtime_workspace)
        self._case_graph_state_service = GraphStateService(self._case_graph_storage._workspace)
        self._case_graph_service = CaseGraphService(
            storage=self._case_graph_storage,
            query_client=self._build_case_graph_query_client(),
        )
        self._case_graph_relation_service = RelationGraphService(
            query_client=self._build_case_graph_query_client(),
            snapshot_storage=self._case_graph_storage,
            workspace_root=self._runtime_workspace,
        )
        self._case_audit_service = CaseAuditService(
            query_client=self._build_case_graph_query_client(),
        )
        self._case_audit_storage = CaseAuditStorage(workspace=self._runtime_workspace)
        self._hook = WebUIHook(self._registry, self._turns)
        self._runtime_attached = self._ensure_runtime_attached()

    @classmethod
    def default_config(cls) -> dict[str, Any]:
        return WebUIConfig().model_dump(by_alias=True)

    def get_hook(self) -> WebUIHook:
        return self._hook

    def _build_case_graph_query_client(self) -> Any:
        if not _has_case_graph_db_config(self.config):
            return _UnconfiguredCaseGraphQueryClient(self.config)
        return PyMySQLCaseGraphQueryClient(
            CaseGraphMySQLConfig(
                host=self.config.case_graph_db_host.strip(),
                port=int(self.config.case_graph_db_port),
                user=self.config.case_graph_db_user.strip(),
                password=self.config.case_graph_db_password,
                database=self.config.case_graph_db_name.strip(),
            )
        )

    def _ensure_runtime_attached(self) -> bool:
        attached = attach_webui_runtime(self.bus, self._hook)
        if attached:
            self._runtime_attach_warned = False
            return True
        if not self._runtime_attach_warned:
            logger.warning(
                "WebUI runtime hook unavailable; running in outbound-only compatibility mode"
            )
            self._runtime_attach_warned = True
        return False

    def _runtime_observability_snapshot(self) -> dict[str, Any]:
        return {
            "channel": {
                "name": self.name,
                "streaming_enabled": self.supports_streaming,
                "runtime_attached": self._runtime_attached,
                "runtime_attach_warned": self._runtime_attach_warned,
            },
            "runtime": runtime_snapshot(self.bus),
            "connections": self._registry.snapshot(),
            "turns": self._turns.snapshot(),
        }

    @property
    def supports_streaming(self) -> bool:
        return self.config.streaming

    def _create_app(self, web: Any) -> Any:
        app = web.Application()
        app.router.add_get("/", self._handle_index)
        app.router.add_post("/api/auth/login", self._handle_auth_login)
        app.router.add_post("/api/auth/logout", self._handle_auth_logout)
        app.router.add_get("/api/auth/me", self._handle_auth_me)
        app.router.add_get("/ws", self._handle_ws)
        app.router.add_get("/sessions", self._handle_sessions)
        app.router.add_delete("/sessions/{chat_id}", self._handle_delete_session)
        app.router.add_get("/api/settings/skills", self._handle_skills)
        app.router.add_get("/api/settings/skills/{name}", self._handle_skill_detail)
        app.router.add_get("/api/settings/skills/{name}/file", self._handle_skill_file)
        app.router.add_post("/api/settings/skills/{name}/toggle", self._handle_skill_toggle)
        app.router.add_get("/api/settings/config", self._handle_config)
        app.router.add_post("/api/settings/config", self._handle_save_config)
        app.router.add_get("/api/settings/runtime", self._handle_runtime)
        app.router.add_post("/api/case-graph/graphs", self._handle_case_graph_create)
        app.router.add_get("/api/case-graph/graphs", self._handle_case_graph_list)
        app.router.add_get("/api/case-graph/cases", self._handle_case_graph_cases)
        app.router.add_get("/api/case-graph/cases/{case_id}/accounts", self._handle_case_graph_accounts)
        app.router.add_get("/api/case-audit/cases", self._handle_case_audit_cases)
        app.router.add_get("/api/case-audit/cases/{case_id}/overview", self._handle_case_audit_overview)
        app.router.add_get("/api/case-audit/cases/{case_id}/audits", self._handle_case_audit_list)
        app.router.add_post("/api/case-audit/audits", self._handle_case_audit_create)
        app.router.add_post("/api/case-audit/audits/{audit_id}", self._handle_case_audit_update)
        app.router.add_post("/api/case-audit/run", self._handle_case_audit_run)
        app.router.add_get("/api/case-graph/graph/{graph_id}", self._handle_case_graph_detail)
        app.router.add_post("/api/case-graph/graph/{graph_id}", self._handle_case_graph_update)
        app.router.add_delete("/api/case-graph/graph/{graph_id}", self._handle_case_graph_delete)
        app.router.add_post("/api/case-graph/relation/query", self._handle_case_graph_relation_query)
        app.router.add_post("/api/case-graph/relation/complete", self._handle_case_graph_relation_complete)
        app.router.add_post("/api/case-graph/relation/filter", self._handle_case_graph_relation_filter)
        app.router.add_post("/api/case-graph/relation/exclude-trades", self._handle_case_graph_relation_exclude_trades)
        app.router.add_post("/api/case-graph/relation/summary-candidates", self._handle_case_graph_relation_summary_candidates)
        app.router.add_post("/api/case-graph/relation/summary-selection", self._handle_case_graph_relation_summary_selection)
        app.router.add_post("/api/case-graph/relation/exclude-node", self._handle_case_graph_relation_exclude_node)
        app.router.add_post("/api/case-graph/relation/restore-node", self._handle_case_graph_relation_restore_node)
        app.router.add_post("/api/case-graph/relation/restore-nodes", self._handle_case_graph_relation_restore_nodes)
        app.router.add_post("/api/case-graph/relation/investigation-group", self._handle_case_graph_relation_investigation_group)
        app.router.add_post("/api/case-graph/relation/manual-node", self._handle_case_graph_relation_manual_node)
        app.router.add_post("/api/case-graph/relation/manual-trade", self._handle_case_graph_relation_manual_trade)
        app.router.add_post("/api/case-graph/relation/reality-relation", self._handle_case_graph_relation_reality_relation)
        app.router.add_get("/api/case-graph/relation/state/{case_id}/{graph_id}", self._handle_case_graph_state_get)
        app.router.add_post("/api/case-graph/relation/state/{case_id}/{graph_id}/operations/layout", self._handle_case_graph_state_layout)
        app.router.add_post("/api/case-graph/relation/state/{case_id}/{graph_id}/operations/node-note", self._handle_case_graph_state_node_note)
        app.router.add_post("/api/case-graph/relation/state/{case_id}/{graph_id}/operations/latest-step-layout", self._handle_case_graph_state_latest_step_layout)
        app.router.add_get("/api/case-graph/relation/state/{case_id}/{graph_id}/steps", self._handle_case_graph_state_steps)
        app.router.add_post("/api/case-graph/target-detail", self._handle_case_graph_target_detail)
        app.router.add_post("/api/case-graph/context", self._handle_case_graph_context)
        app.router.add_get("/api/workspaces/{chat_id}", self._handle_workspace)
        app.router.add_post("/uploads/{chat_id}", self._handle_uploads)
        app.router.add_get("/media/{token}", self._handle_media)
        assets_dir = STATIC_DIR / "assets"
        if assets_dir.exists():
            app.router.add_static("/assets/", assets_dir)
        return app

    async def start(self) -> None:
        try:
            from aiohttp import web
        except ImportError:
            logger.error("WebUI channel requires aiohttp: pip install 'nanobot-ai[webui]'")
            return

        if not self._runtime_attached:
            self._runtime_attached = self._ensure_runtime_attached()

        self._running = True
        app = self._create_app(web)

        self._runner = web.AppRunner(app)
        await self._runner.setup()
        site = web.TCPSite(self._runner, self.config.host, self.config.port)
        await site.start()
        logger.info("WebUI channel started → http://{}:{}", self.config.host, self.config.port)

        while self._running:
            await asyncio.sleep(0.5)

    async def stop(self) -> None:
        self._running = False
        await self._registry.close_all()
        if self._runner:
            await self._runner.cleanup()
            self._runner = None

    async def send(self, msg: OutboundMessage) -> None:
        if self._registry.is_blocked(msg.chat_id):
            return

        snapshot = self._turns.finish(msg.chat_id)
        if not snapshot.should_emit_completion:
            return

        content = msg.content
        buttons = msg.buttons or None
        if not buttons:
            pending_ask = self._sessions.pending_ask_user_prompt(msg.chat_id)
            if pending_ask is not None:
                question, pending_buttons = pending_ask
                content = _strip_webui_ask_user_text_fallback(content, question, pending_buttons)
                buttons = pending_buttons
        media_items = self._media.build_media_items(msg.media) if msg.media else None

        payload = turn_completed_event(
            msg.chat_id,
            content=content,
            media=media_items,
            buttons=buttons,
            stream_id=snapshot.stream_id,
        )
        await self._registry.emit_to_chat(msg.chat_id, payload)
        if media_items:
            await asyncio.to_thread(self._record_workspace_media, msg.chat_id, media_items)
        self._turns.clear(msg.chat_id)

    async def send_delta(self, chat_id: str, delta: str, metadata: dict[str, Any] | None = None) -> None:
        if self._registry.is_blocked(chat_id):
            return

        meta = metadata or {}
        stream_id = str(meta.get("_stream_id", "")).strip() or None
        if meta.get("_stream_end"):
            phase = "running_tools" if meta.get("_resuming") else "finalizing"
            await self._registry.emit_to_chat(
                chat_id,
                turn_phase_event(chat_id, phase, streamId=stream_id, resuming=bool(meta.get("_resuming"))),
            )
            return

        is_new_stream = self._turns.begin_stream(chat_id, stream_id)
        self._turns.note_stream_output(chat_id)
        if is_new_stream:
            await self._registry.emit_to_chat(chat_id, turn_phase_event(chat_id, "streaming", streamId=stream_id))
        await self._registry.emit_to_chat(chat_id, turn_delta_event(chat_id, delta, stream_id=stream_id))

    @staticmethod
    def _session_title_from_preview(preview: str) -> str:
        text = (preview or "").strip()
        return text[:40] if text else "新对话"

    @staticmethod
    def _preview_from_content(content: str, attachments: list[Any] | None = None) -> str:
        text = (content or "").strip()
        if text:
            return text[:60] + ("…" if len(text) > 60 else "")
        if attachments:
            first = attachments[0]
            return str(getattr(first, "name", "") or first.get("name") or "附件")[:60]
        return "新对话"

    async def _load_indexed_sessions(self, user: CurrentUser) -> list[dict[str, Any]]:
        records = await self._session_index.list_for_user(user)
        return [
            self._sessions.summarize_session(
                record.chat_id,
                created_at=record.last_activity_at,
                last_ts=record.last_activity_at,
                preview=record.preview or record.title,
                session_key=record.session_key,
            )
            for record in records
        ]

    async def _can_access_session(self, user: CurrentUser | None, chat_id: str) -> bool:
        if user is None or not self._pocketbase.enabled:
            return True
        return await self._session_index.get_for_user(user, chat_id) is not None

    @staticmethod
    def _require_admin(user: CurrentUser | None) -> tuple[bool, int, str]:
        if user is None:
            return True, 200, ""
        if user.is_admin:
            return True, 200, ""
        return False, 403, "当前账号无权访问此功能"

    async def _authorize_request(self, request: Any) -> tuple[bool, Any | None, CurrentUser | None]:
        from aiohttp import web

        allowed, status, message, user = await self._access.authorize(request)
        if allowed:
            return True, None, user
        return False, web.json_response({"error": message}, status=status), None

    async def _handle_index(self, request: Any) -> Any:
        from aiohttp import web

        path = STATIC_DIR / "index.html"
        if not path.exists():
            return web.Response(
                text="缺少页面静态资源，请先构建前端。",
                status=500,
                content_type="text/plain",
            )

        page = await asyncio.to_thread(path.read_text, encoding="utf-8")
        bootstrap = json.dumps(
            {
                "title": self._resolved_title,
                "authRequired": self._access.auth_required,
                "authMode": self._access.auth_mode,
            },
            ensure_ascii=False,
        )
        page = page.replace("<title>Nanobot</title>", f"<title>{html_lib.escape(self._resolved_title)}</title>")
        page = page.replace('"__WEBUI_BOOTSTRAP__"', bootstrap)
        return web.Response(text=page, content_type="text/html")

    async def _handle_auth_login(self, request: Any) -> Any:
        from aiohttp import web

        if not self._pocketbase.enabled:
            return web.json_response({"error": "当前未启用 PocketBase 登录"}, status=404)

        try:
            payload = await request.json()
        except Exception:
            return web.json_response({"error": "请求体不是有效 JSON"}, status=400)
        if not isinstance(payload, dict):
            return web.json_response({"error": "请求体格式无效"}, status=400)

        identity = str(payload.get("identity", "")).strip()
        password = str(payload.get("password", "")).strip()
        if not identity or not password:
            return web.json_response({"error": "邮箱和密码不能为空"}, status=400)

        try:
            user = await self._pocketbase.login(identity, password)
        except PocketBaseAuthError as exc:
            return web.json_response({"error": str(exc) or "登录失败"}, status=401)
        except Exception as exc:
            return web.json_response({"error": f"登录失败: {exc}"}, status=502)

        return web.json_response({
            "token": user.token,
            "user": {"id": user.id, "email": user.email, "role": user.role},
        })

    async def _handle_auth_logout(self, request: Any) -> Any:
        from aiohttp import web

        return web.json_response({"ok": True})

    async def _handle_auth_me(self, request: Any) -> Any:
        from aiohttp import web

        allowed, resp, user = await self._authorize_request(request)
        if not allowed:
            return resp
        return web.json_response({
            "token": user.token if user is not None else "",
            "user": None if user is None else {"id": user.id, "email": user.email, "role": user.role},
        })

    async def _handle_sessions(self, request: Any) -> Any:
        from aiohttp import web

        if not self._runtime_attached:
            self._runtime_attached = self._ensure_runtime_attached()

        allowed, resp, user = await self._authorize_request(request)
        if not allowed:
            return resp
        if user is not None and self._pocketbase.enabled:
            sessions = await self._load_indexed_sessions(user)
        else:
            sessions = await asyncio.to_thread(self._sessions.list_sessions)
        return web.json_response(sessions)

    async def _handle_delete_session(self, request: Any) -> Any:
        from aiohttp import web

        allowed, resp, user = await self._authorize_request(request)
        if not allowed:
            return resp

        chat_id = request.match_info.get("chat_id", "").strip()
        if not chat_id or not is_valid_chat_id(chat_id):
            return web.json_response({"error": "无效的会话 ID"}, status=400)

        deleted = await self._delete_session_by_id(chat_id, user)
        if not deleted:
            message = "会话不存在或无权删除" if user is not None and self._pocketbase.enabled else "会话不存在"
            return web.json_response({"error": message}, status=404)
        return web.json_response({"ok": True})

    async def _delete_session_by_id(
        self,
        chat_id: str,
        user: CurrentUser | None,
        *,
        missing_ok: bool = False,
    ) -> bool:
        if user is not None and self._pocketbase.enabled:
            deleted_index = await self._session_index.delete_for_user(user, chat_id)
            if not deleted_index and not missing_ok:
                return False

        deleted = await asyncio.to_thread(self._sessions.delete_session, chat_id)
        if not deleted and not (user is not None and self._pocketbase.enabled) and not missing_ok:
            return False

        self._turns.clear(chat_id)
        await self._registry.delete_chat(chat_id, session_deleted_event(chat_id))
        return deleted or (user is not None and self._pocketbase.enabled)

    async def _handle_skills(self, request: Any) -> Any:
        from aiohttp import web

        allowed, resp, user = await self._authorize_request(request)
        if not allowed:
            return resp
        admin_allowed, status, message = self._require_admin(user)
        if not admin_allowed:
            return web.json_response({"error": message}, status=status)

        skills = await asyncio.to_thread(self._management.list_skills)
        return web.json_response({"skills": skills})

    async def _handle_skill_detail(self, request: Any) -> Any:
        from aiohttp import web

        allowed, resp, user = await self._authorize_request(request)
        if not allowed:
            return resp
        admin_allowed, status, message = self._require_admin(user)
        if not admin_allowed:
            return web.json_response({"error": message}, status=status)

        name = request.match_info.get("name", "").strip()
        source = request.rel_url.query.get("source", "").strip() or None
        if not name:
            return web.json_response({"error": "缺少技能名称"}, status=400)

        detail = await asyncio.to_thread(self._management.get_skill, name, source)
        if detail is None:
            return web.json_response({"error": "技能不存在"}, status=404)
        return web.json_response(detail)

    async def _handle_skill_file(self, request: Any) -> Any:
        from aiohttp import web

        allowed, resp, user = await self._authorize_request(request)
        if not allowed:
            return resp
        admin_allowed, status, message = self._require_admin(user)
        if not admin_allowed:
            return web.json_response({"error": message}, status=status)

        name = request.match_info.get("name", "").strip()
        source = request.rel_url.query.get("source", "").strip() or None
        file_path = request.rel_url.query.get("path", "").strip()
        if not name or not file_path:
            return web.json_response({"error": "缺少技能名称或文件路径"}, status=400)

        detail = await asyncio.to_thread(self._management.get_skill_file, name, file_path, source)
        if detail is None:
            return web.json_response({"error": "技能文件不存在"}, status=404)
        return web.json_response(detail)

    async def _handle_skill_toggle(self, request: Any) -> Any:
        from aiohttp import web

        allowed, resp, user = await self._authorize_request(request)
        if not allowed:
            return resp
        admin_allowed, status, message = self._require_admin(user)
        if not admin_allowed:
            return web.json_response({"error": message}, status=status)

        name = request.match_info.get("name", "").strip()
        if not name:
            return web.json_response({"error": "缺少技能名称"}, status=400)

        try:
            payload = await request.json()
        except Exception:
            return web.json_response({"error": "请求体不是有效 JSON"}, status=400)
        if not isinstance(payload, dict) or "enabled" not in payload:
            return web.json_response({"error": "缺少 enabled 参数"}, status=400)

        source = request.rel_url.query.get("source", "").strip() or None
        detail = await asyncio.to_thread(self._management.set_skill_enabled, name, bool(payload["enabled"]), source)
        if detail is None:
            return web.json_response({"error": "技能不存在或不支持开关"}, status=404)
        return web.json_response(detail)

    async def _handle_config(self, request: Any) -> Any:
        from aiohttp import web

        allowed, resp, user = await self._authorize_request(request)
        if not allowed:
            return resp
        admin_allowed, status, message = self._require_admin(user)
        if not admin_allowed:
            return web.json_response({"error": message}, status=status)

        snapshot = await asyncio.to_thread(self._management.config_snapshot)
        return web.json_response(snapshot)

    async def _handle_save_config(self, request: Any) -> Any:
        from aiohttp import web

        allowed, resp, user = await self._authorize_request(request)
        if not allowed:
            return resp
        admin_allowed, status, message = self._require_admin(user)
        if not admin_allowed:
            return web.json_response({"error": message}, status=status)

        try:
            payload = await request.json()
        except Exception:
            return web.json_response({"error": "请求体不是有效 JSON"}, status=400)
        if not isinstance(payload, dict):
            return web.json_response({"error": "请求体格式无效"}, status=400)

        raw = str(payload.get("raw", ""))
        if not raw.strip():
            return web.json_response({"error": "配置内容不能为空"}, status=400)

        try:
            snapshot = await asyncio.to_thread(self._management.save_config, raw)
        except Exception as exc:
            return web.json_response({"error": f"保存配置失败: {exc}"}, status=400)
        return web.json_response(snapshot)

    async def _handle_runtime(self, request: Any) -> Any:
        from aiohttp import web

        allowed, resp, user = await self._authorize_request(request)
        if not allowed:
            return resp
        session_count = len(await self._load_indexed_sessions(user)) if user is not None and self._pocketbase.enabled else len(await asyncio.to_thread(self._sessions.list_sessions))
        snapshot = await asyncio.to_thread(
            self._management.runtime_snapshot_for_user,
            is_admin=user.is_admin if user is not None else True,
            session_count=session_count,
        )
        return web.json_response(snapshot)

    async def _handle_case_graph_create(self, request: Any) -> Any:
        from aiohttp import web

        allowed, resp, _user = await self._authorize_request(request)
        if not allowed:
            return resp

        payload, error = await _read_json_object(request)
        if error is not None:
            return error
        assert payload is not None

        try:
            case_id = _require_text_field(payload, "caseId")
            graph_name = _require_text_field(payload, "graphName")
        except ValueError as exc:
            return web.json_response({"error": f"缺少或无效的必要字段: {exc.args[0]}"}, status=400)
        if not _is_dict_list(payload.get("tradeCards")):
            return web.json_response({"error": "tradeCards 必须是对象数组"}, status=400)

        try:
            graph = await asyncio.to_thread(
                self._case_graph_service.create_graph,
                case_id,
                graph_name,
                list(payload["tradeCards"]),
            )
        except Exception as exc:
            return web.json_response({"error": f"建图失败: {exc}"}, status=500)
        return web.json_response(graph)

    async def _handle_case_graph_cases(self, request: Any) -> Any:
        from aiohttp import web

        allowed, resp, _user = await self._authorize_request(request)
        if not allowed:
            return resp

        try:
            result = await asyncio.to_thread(self._case_graph_service.list_cases)
        except _CaseGraphQueryClientNotConfiguredError as exc:
            return web.json_response({"error": str(exc)}, status=503)
        except Exception as exc:
            return web.json_response({"error": f"案件列表读取失败: {exc}"}, status=502)
        return web.json_response({"items": result})

    async def _handle_case_graph_list(self, request: Any) -> Any:
        from aiohttp import web

        allowed, resp, _user = await self._authorize_request(request)
        if not allowed:
            return resp

        case_id = str(request.query.get("caseId") or "").strip() or None
        try:
            result = await asyncio.to_thread(self._case_graph_service.list_graphs, case_id)
        except Exception as exc:
            return web.json_response({"error": f"图列表读取失败: {exc}"}, status=502)
        return web.json_response({"items": result})

    async def _handle_case_graph_accounts(self, request: Any) -> Any:
        from aiohttp import web

        allowed, resp, _user = await self._authorize_request(request)
        if not allowed:
            return resp

        case_id = request.match_info.get("case_id", "").strip()
        if not case_id:
            return web.json_response({"error": "缺少 case_id"}, status=400)
        keyword = str(request.query.get("keyword") or "").strip()

        try:
            result = await asyncio.to_thread(self._case_graph_service.list_accounts, case_id, keyword)
        except _CaseGraphQueryClientNotConfiguredError as exc:
            return web.json_response({"error": str(exc)}, status=503)
        except ValueError as exc:
            if exc.args and exc.args[0] == "victimCondition":
                return web.json_response(
                    {"error": "请先填写被害人账号或姓名，涉诈资金审计需要以被害人入账作为追踪起点。"},
                    status=400,
                )
            return web.json_response({"error": f"缺少或无效的必要字段: {exc.args[0]}"}, status=400)
        except Exception as exc:
            return web.json_response({"error": f"主体列表读取失败: {exc}"}, status=502)
        return web.json_response({"items": result})

    async def _handle_case_audit_cases(self, request: Any) -> Any:
        from aiohttp import web

        allowed, resp, _user = await self._authorize_request(request)
        if not allowed:
            return resp

        try:
            result = await asyncio.to_thread(self._case_audit_service.list_cases)
        except _CaseGraphQueryClientNotConfiguredError as exc:
            return web.json_response({"error": str(exc)}, status=503)
        except Exception as exc:
            return web.json_response({"error": f"案件列表读取失败: {exc}"}, status=502)
        return web.json_response({"items": result})

    async def _handle_case_audit_overview(self, request: Any) -> Any:
        from aiohttp import web

        allowed, resp, _user = await self._authorize_request(request)
        if not allowed:
            return resp

        case_id = request.match_info.get("case_id", "").strip()
        if not case_id:
            return web.json_response({"error": "缺少 case_id"}, status=400)
        try:
            result = await asyncio.to_thread(self._case_audit_service.overview, case_id)
        except _CaseGraphQueryClientNotConfiguredError as exc:
            return web.json_response({"error": str(exc)}, status=503)
        except ValueError as exc:
            return web.json_response({"error": f"缺少或无效的必要字段: {exc.args[0]}"}, status=400)
        except Exception as exc:
            return web.json_response({"error": f"案件审计概览读取失败: {exc}"}, status=502)
        return web.json_response(result)

    async def _handle_case_audit_list(self, request: Any) -> Any:
        from aiohttp import web

        allowed, resp, _user = await self._authorize_request(request)
        if not allowed:
            return resp

        case_id = request.match_info.get("case_id", "").strip()
        if not case_id:
            return web.json_response({"error": "缺少 case_id"}, status=400)
        ensure = str(request.query.get("ensure") or "").strip() in {"1", "true", "yes"}
        try:
            active = (
                await asyncio.to_thread(self._case_audit_storage.get_or_create_default, case_id)
                if ensure
                else None
            )
            items = await asyncio.to_thread(self._case_audit_storage.list_audits, case_id)
        except ValueError as exc:
            return web.json_response({"error": f"缺少或无效的必要字段: {exc.args[0]}"}, status=400)
        except Exception as exc:
            return web.json_response({"error": f"审计档案读取失败: {exc}"}, status=500)
        active_audit_id = str(active.get("auditId") or "") if isinstance(active, dict) else ""
        if not active_audit_id and items:
            active_audit_id = str(items[0].get("auditId") or "")
        return web.json_response({"items": items, "activeAuditId": active_audit_id})

    async def _handle_case_audit_create(self, request: Any) -> Any:
        from aiohttp import web

        allowed, resp, _user = await self._authorize_request(request)
        if not allowed:
            return resp

        payload, error = await _read_json_object(request)
        if error is not None:
            return error
        assert payload is not None

        try:
            case_id = _require_text_field(payload, "caseId")
            result = await asyncio.to_thread(
                self._case_audit_storage.create_audit,
                case_id=case_id,
                audit_name=str(payload.get("auditName") or ""),
                conditions=payload.get("conditions") if isinstance(payload.get("conditions"), dict) else None,
                filters=payload.get("filters") if isinstance(payload.get("filters"), dict) else None,
            )
        except ValueError as exc:
            return web.json_response({"error": f"缺少或无效的必要字段: {exc.args[0]}"}, status=400)
        except Exception as exc:
            return web.json_response({"error": f"审计档案创建失败: {exc}"}, status=500)
        return web.json_response(result)

    async def _handle_case_audit_update(self, request: Any) -> Any:
        from aiohttp import web

        allowed, resp, _user = await self._authorize_request(request)
        if not allowed:
            return resp

        audit_id = request.match_info.get("audit_id", "").strip()
        if not audit_id:
            return web.json_response({"error": "缺少 audit_id"}, status=400)
        payload, error = await _read_json_object(request)
        if error is not None:
            return error
        assert payload is not None

        try:
            result = await asyncio.to_thread(self._case_audit_storage.update_audit, audit_id, dict(payload))
        except KeyError:
            return web.json_response({"error": "审计档案不存在"}, status=404)
        except ValueError as exc:
            return web.json_response({"error": f"缺少或无效的必要字段: {exc.args[0]}"}, status=400)
        except Exception as exc:
            return web.json_response({"error": f"审计档案保存失败: {exc}"}, status=500)
        return web.json_response(result)

    async def _handle_case_audit_run(self, request: Any) -> Any:
        from aiohttp import web

        allowed, resp, _user = await self._authorize_request(request)
        if not allowed:
            return resp

        payload, error = await _read_json_object(request)
        if error is not None:
            return error
        assert payload is not None

        try:
            _require_text_field(payload, "caseId")
            result = await asyncio.to_thread(self._case_audit_service.run_case_audit, dict(payload))
            audit_id = str(payload.get("auditId") or "").strip()
            if audit_id:
                await asyncio.to_thread(
                    self._case_audit_storage.save_run_result,
                    audit_id,
                    run_payload=dict(payload),
                    result=result,
                )
        except _CaseGraphQueryClientNotConfiguredError as exc:
            return web.json_response({"error": str(exc)}, status=503)
        except KeyError:
            return web.json_response({"error": "审计档案不存在"}, status=404)
        except ValueError as exc:
            return web.json_response({"error": f"缺少或无效的必要字段: {exc.args[0]}"}, status=400)
        except Exception as exc:
            return web.json_response({"error": f"涉诈资金审计失败: {exc}"}, status=502)
        return web.json_response(result)

    async def _handle_case_graph_detail(self, request: Any) -> Any:
        from aiohttp import web

        allowed, resp, _user = await self._authorize_request(request)
        if not allowed:
            return resp

        graph_id = request.match_info.get("graph_id", "").strip()
        if not graph_id:
            return web.json_response({"error": "缺少 graph_id"}, status=400)

        try:
            graph = await asyncio.to_thread(self._case_graph_storage.get_graph, graph_id)
        except CaseGraphCorruptError as exc:
            return _case_graph_corrupt_response(web, exc)
        except Exception as exc:
            return web.json_response({"error": f"读取图失败: {exc}"}, status=500)
        if graph is None:
            return web.json_response({"error": "图不存在"}, status=404)
        return web.json_response(graph)

    async def _handle_case_graph_update(self, request: Any) -> Any:
        from aiohttp import web

        allowed, resp, _user = await self._authorize_request(request)
        if not allowed:
            return resp

        graph_id = request.match_info.get("graph_id", "").strip()
        if not graph_id:
            return web.json_response({"error": "缺少 graph_id"}, status=400)

        payload, error = await _read_json_object(request)
        if error is not None:
            return error
        assert payload is not None

        try:
            graph = await asyncio.to_thread(
                self._case_graph_service.update_graph,
                graph_id,
                dict(payload),
            )
            graph_settings = {
                key: graph.get(key)
                for key in ("drillNums", "drillType")
                if key in payload
            }
            case_id = str(graph.get("caseId") or "").strip()
            if case_id and graph_settings:
                try:
                    await asyncio.to_thread(
                        self._case_graph_state_service.update_graph_settings,
                        case_id=case_id,
                        graph_id=graph_id,
                        settings=graph_settings,
                    )
                except FileNotFoundError:
                    pass
        except KeyError as exc:
            return web.json_response({"error": f"图不存在: {exc.args[0]}"}, status=404)
        except CaseGraphCorruptError as exc:
            return _case_graph_corrupt_response(web, exc)
        except Exception as exc:
            return web.json_response({"error": f"更新图失败: {exc}"}, status=500)
        return web.json_response(graph)

    async def _handle_case_graph_delete(self, request: Any) -> Any:
        from aiohttp import web

        allowed, resp, user = await self._authorize_request(request)
        if not allowed:
            return resp

        graph_id = request.match_info.get("graph_id", "").strip()
        if not graph_id:
            return web.json_response({"error": "缺少 graph_id"}, status=400)

        try:
            graph = await asyncio.to_thread(self._case_graph_storage.get_graph, graph_id)
            deleted = await asyncio.to_thread(self._case_graph_service.delete_graph, graph_id)
        except CaseGraphCorruptError as exc:
            return _case_graph_corrupt_response(web, exc)
        except Exception as exc:
            return web.json_response({"error": f"删除图失败: {exc}"}, status=500)
        if not deleted:
            return web.json_response({"error": "图不存在"}, status=404)
        chat_id = str((graph or {}).get("chatId") or "").strip()
        if chat_id and is_valid_chat_id(chat_id):
            try:
                await self._delete_session_by_id(chat_id, user, missing_ok=True)
            except Exception as exc:
                logger.warning("Deleted case graph {} but failed to delete bound chat {}: {}", graph_id, chat_id, exc)
        return web.json_response({"ok": True})

    async def _handle_case_graph_relation_query(self, request: Any) -> Any:
        from aiohttp import web

        allowed, resp, _user = await self._authorize_request(request)
        if not allowed:
            return resp

        payload, error = await _read_json_object(request)
        if error is not None:
            return error
        assert payload is not None

        try:
            _require_text_field(payload, "graphId")
            _require_text_field(payload, "caseId")
        except ValueError as exc:
            return web.json_response({"error": f"缺少或无效的必要字段: {exc.args[0]}"}, status=400)
        if not _is_dict_list(payload.get("seeds")):
            return web.json_response({"error": "seeds 必须是对象数组"}, status=400)

        try:
            result = await asyncio.to_thread(
                self._case_graph_relation_service.query_seed_one_hop,
                dict(payload),
            )
        except ValueError as exc:
            return web.json_response({"error": f"缺少或无效的必要字段: {exc.args[0]}"}, status=400)
        except _CaseGraphQueryClientNotConfiguredError as exc:
            return web.json_response({"error": str(exc)}, status=503)
        except Exception as exc:
            return web.json_response({"error": f"关系图查询失败: {exc}"}, status=502)
        return web.json_response(result)

    async def _handle_case_graph_relation_complete(self, request: Any) -> Any:
        from aiohttp import web

        allowed, resp, _user = await self._authorize_request(request)
        if not allowed:
            return resp

        payload, error = await _read_json_object(request)
        if error is not None:
            return error
        assert payload is not None

        try:
            _require_text_field(payload, "graphId")
            _require_text_field(payload, "caseId")
        except ValueError as exc:
            return web.json_response({"error": f"缺少或无效的必要字段: {exc.args[0]}"}, status=400)
        if not _is_dict_list(payload.get("accounts")):
            return web.json_response({"error": "accounts 必须是对象数组"}, status=400)

        try:
            result = await asyncio.to_thread(
                self._case_graph_relation_service.complete_current_graph,
                dict(payload),
            )
        except ValueError as exc:
            return web.json_response({"error": f"缺少或无效的必要字段: {exc.args[0]}"}, status=400)
        except _CaseGraphQueryClientNotConfiguredError as exc:
            return web.json_response({"error": str(exc)}, status=503)
        except Exception as exc:
            return web.json_response({"error": f"图上节点关系分析失败: {exc}"}, status=502)
        return web.json_response(result)

    async def _handle_case_graph_relation_filter(self, request: Any) -> Any:
        from aiohttp import web

        allowed, resp, _user = await self._authorize_request(request)
        if not allowed:
            return resp

        payload, error = await _read_json_object(request)
        if error is not None:
            return error
        assert payload is not None

        try:
            _require_text_field(payload, "graphId")
            _require_text_field(payload, "caseId")
        except ValueError as exc:
            return web.json_response({"error": f"缺少或无效的必要字段: {exc.args[0]}"}, status=400)
        if "filters" in payload and not isinstance(payload.get("filters"), dict):
            return web.json_response({"error": "filters 必须是对象"}, status=400)

        try:
            result = await asyncio.to_thread(
                self._case_graph_relation_service.filter_current_graph,
                dict(payload),
            )
        except ValueError as exc:
            return web.json_response({"error": f"缺少或无效的必要字段: {exc.args[0]}"}, status=400)
        except FileNotFoundError:
            return web.json_response({"error": "图不存在或还没有可筛选的图数据"}, status=404)
        except _CaseGraphQueryClientNotConfiguredError as exc:
            return web.json_response({"error": str(exc)}, status=503)
        except Exception as exc:
            return web.json_response({"error": f"图筛选失败: {exc}"}, status=502)
        return web.json_response(result)

    async def _handle_case_graph_relation_exclude_trades(self, request: Any) -> Any:
        from aiohttp import web

        allowed, resp, _user = await self._authorize_request(request)
        if not allowed:
            return resp

        payload, error = await _read_json_object(request)
        if error is not None:
            return error
        assert payload is not None

        try:
            _require_text_field(payload, "graphId")
            _require_text_field(payload, "caseId")
        except ValueError as exc:
            return web.json_response({"error": f"缺少或无效的必要字段: {exc.args[0]}"}, status=400)
        if "excludedTrades" in payload and not isinstance(payload.get("excludedTrades"), list):
            return web.json_response({"error": "excludedTrades 必须是数组"}, status=400)
        if "tradeFacts" in payload and not isinstance(payload.get("tradeFacts"), (list, dict)):
            return web.json_response({"error": "tradeFacts 必须是数组或对象"}, status=400)
        if "edgeTradeIds" in payload and not isinstance(payload.get("edgeTradeIds"), dict):
            return web.json_response({"error": "edgeTradeIds 必须是对象"}, status=400)

        try:
            result = await asyncio.to_thread(
                self._case_graph_relation_service.exclude_trades,
                dict(payload),
            )
        except ValueError as exc:
            field = exc.args[0] if exc.args else "payload"
            return web.json_response({"error": f"缺少或无效的必要字段: {field}"}, status=400)
        except FileNotFoundError:
            return web.json_response({"error": "图不存在或还没有可筛选的图数据"}, status=404)
        except Exception as exc:
            return web.json_response({"error": f"交易核查失败: {exc}"}, status=502)
        return web.json_response(result)

    async def _handle_case_graph_relation_exclude_node(self, request: Any) -> Any:
        from aiohttp import web

        allowed, resp, _user = await self._authorize_request(request)
        if not allowed:
            return resp

        payload, error = await _read_json_object(request)
        if error is not None:
            return error
        assert payload is not None

        try:
            _require_text_field(payload, "graphId")
            _require_text_field(payload, "caseId")
        except ValueError as exc:
            return web.json_response({"error": f"缺少或无效的必要字段: {exc.args[0]}"}, status=400)
        if "nodes" in payload:
            if not isinstance(payload.get("nodes"), list):
                return web.json_response({"error": "nodes 必须是数组"}, status=400)
            if not all(isinstance(node, dict) for node in payload.get("nodes") or []):
                return web.json_response({"error": "nodes 必须是对象数组"}, status=400)
        elif not isinstance(payload.get("node"), dict):
            return web.json_response({"error": "node 必须是对象"}, status=400)

        try:
            result = await asyncio.to_thread(
                self._case_graph_relation_service.exclude_node,
                dict(payload),
            )
        except ValueError as exc:
            return web.json_response({"error": f"缺少或无效的必要字段: {exc.args[0]}"}, status=400)
        except FileNotFoundError:
            return web.json_response({"error": "图不存在或还没有可排除的图数据"}, status=404)
        except Exception as exc:
            return web.json_response({"error": f"排除节点失败: {exc}"}, status=502)
        return web.json_response(result)

    async def _handle_case_graph_relation_summary_selection(self, request: Any) -> Any:
        from aiohttp import web

        allowed, resp, _user = await self._authorize_request(request)
        if not allowed:
            return resp

        payload, error = await _read_json_object(request)
        if error is not None:
            return error
        assert payload is not None

        try:
            _require_text_field(payload, "graphId")
            _require_text_field(payload, "caseId")
        except ValueError as exc:
            field_labels = {"graphId": "图谱", "caseId": "案件", "focusNodeId": "当前主体"}
            return web.json_response({"error": f"缺少或无效的必要字段: {field_labels.get(exc.args[0], '请求内容')}"}, status=400)
        if "candidateNodeIds" in payload and not isinstance(payload.get("candidateNodeIds"), list):
            return web.json_response({"error": "候选主体必须是数组"}, status=400)
        if "selectedNodeIds" in payload and not isinstance(payload.get("selectedNodeIds"), list):
            return web.json_response({"error": "保留主体必须是数组"}, status=400)

        try:
            result = await asyncio.to_thread(
                self._case_graph_relation_service.apply_summary_selection,
                dict(payload),
            )
        except ValueError as exc:
            field_labels = {"graphId": "图谱", "caseId": "案件", "focusNodeId": "当前主体"}
            return web.json_response({"error": f"缺少或无效的必要字段: {field_labels.get(exc.args[0], '请求内容')}"}, status=400)
        except FileNotFoundError:
            return web.json_response({"error": "图不存在或还没有可扩展的图数据"}, status=404)
        except Exception as exc:
            return web.json_response({"error": f"线索扩展失败: {exc}"}, status=502)
        return web.json_response(result)

    async def _handle_case_graph_relation_summary_candidates(self, request: Any) -> Any:
        from aiohttp import web

        allowed, resp, _user = await self._authorize_request(request)
        if not allowed:
            return resp

        payload, error = await _read_json_object(request)
        if error is not None:
            return error
        assert payload is not None

        try:
            _require_text_field(payload, "graphId")
            _require_text_field(payload, "caseId")
        except ValueError as exc:
            field_labels = {"graphId": "图谱", "caseId": "案件", "focusNodeId": "当前主体"}
            return web.json_response({"error": f"缺少或无效的必要字段: {field_labels.get(exc.args[0], '请求内容')}"}, status=400)
        if "filters" in payload and not isinstance(payload.get("filters"), dict):
            return web.json_response({"error": "筛选条件必须是对象"}, status=400)

        try:
            result = await asyncio.to_thread(
                self._case_graph_relation_service.query_summary_candidates,
                dict(payload),
            )
        except ValueError as exc:
            field_labels = {
                "graphId": "图谱",
                "caseId": "案件",
                "focusNodeId": "当前主体",
                "focusNodeAccounts": "当前主体账号",
            }
            return web.json_response({"error": f"缺少或无效的必要字段: {field_labels.get(exc.args[0], '请求内容')}"}, status=400)
        except FileNotFoundError:
            return web.json_response({"error": "图不存在或还没有可扩展的图数据"}, status=404)
        except _CaseGraphQueryClientNotConfiguredError as exc:
            return web.json_response({"error": str(exc)}, status=503)
        except Exception as exc:
            return web.json_response({"error": f"线索候选读取失败: {exc}"}, status=502)
        return web.json_response(result)

    async def _handle_case_graph_relation_restore_node(self, request: Any) -> Any:
        from aiohttp import web

        allowed, resp, _user = await self._authorize_request(request)
        if not allowed:
            return resp

        payload, error = await _read_json_object(request)
        if error is not None:
            return error
        assert payload is not None

        try:
            _require_text_field(payload, "graphId")
            _require_text_field(payload, "caseId")
            _require_text_field(payload, "nodeId")
        except ValueError as exc:
            return web.json_response({"error": f"缺少或无效的必要字段: {exc.args[0]}"}, status=400)

        try:
            result = await asyncio.to_thread(
                self._case_graph_relation_service.restore_node,
                dict(payload),
            )
        except ValueError as exc:
            return web.json_response({"error": f"缺少或无效的必要字段: {exc.args[0]}"}, status=400)
        except FileNotFoundError:
            return web.json_response({"error": "图不存在或还没有可恢复的图数据"}, status=404)
        except Exception as exc:
            return web.json_response({"error": f"恢复节点失败: {exc}"}, status=502)
        return web.json_response(result)

    async def _handle_case_graph_relation_restore_nodes(self, request: Any) -> Any:
        from aiohttp import web

        allowed, resp, _user = await self._authorize_request(request)
        if not allowed:
            return resp

        payload, error = await _read_json_object(request)
        if error is not None:
            return error
        assert payload is not None

        try:
            _require_text_field(payload, "graphId")
            _require_text_field(payload, "caseId")
            if not isinstance(payload.get("nodeIds"), list) or not [
                str(node_id or "").strip() for node_id in payload.get("nodeIds") if str(node_id or "").strip()
            ]:
                raise ValueError("nodeIds")
        except ValueError as exc:
            return web.json_response({"error": f"缺少或无效的必要字段: {exc.args[0]}"}, status=400)

        try:
            result = await asyncio.to_thread(
                self._case_graph_relation_service.restore_nodes,
                dict(payload),
            )
        except ValueError as exc:
            return web.json_response({"error": f"缺少或无效的必要字段: {exc.args[0]}"}, status=400)
        except FileNotFoundError:
            return web.json_response({"error": "图不存在或还没有可恢复的图数据"}, status=404)
        except Exception as exc:
            return web.json_response({"error": f"恢复节点失败: {exc}"}, status=502)
        return web.json_response(result)

    async def _handle_case_graph_relation_investigation_group(self, request: Any) -> Any:
        from aiohttp import web

        allowed, resp, _user = await self._authorize_request(request)
        if not allowed:
            return resp

        payload, error = await _read_json_object(request)
        if error is not None:
            return error
        assert payload is not None

        try:
            _require_text_field(payload, "graphId")
            _require_text_field(payload, "caseId")
            _require_text_field(payload, "operation")
        except ValueError as exc:
            field_labels = {"graphId": "图谱", "caseId": "案件", "operation": "操作类型"}
            return web.json_response({"error": f"缺少或无效的必要字段: {field_labels.get(exc.args[0], '请求内容')}"}, status=400)
        if "nodeIds" in payload and not isinstance(payload.get("nodeIds"), list):
            return web.json_response({"error": "研判组成员必须是数组"}, status=400)

        try:
            result = await asyncio.to_thread(
                self._case_graph_relation_service.apply_investigation_group,
                dict(payload),
            )
        except ValueError as exc:
            field_labels = {
                "graphId": "图谱",
                "caseId": "案件",
                "operation": "操作类型",
                "groupId": "研判组",
                "nodeIds": "研判组成员",
                "memberNodeId": "组内主体",
            }
            return web.json_response({"error": f"缺少或无效的必要字段: {field_labels.get(exc.args[0], '请求内容')}"}, status=400)
        except FileNotFoundError:
            return web.json_response({"error": "图不存在或还没有可归并的图数据"}, status=404)
        except Exception as exc:
            return web.json_response({"error": f"研判组操作失败: {exc}"}, status=502)
        return web.json_response(result)

    async def _handle_case_graph_relation_manual_node(self, request: Any) -> Any:
        from aiohttp import web

        allowed, resp, _user = await self._authorize_request(request)
        if not allowed:
            return resp

        payload, error = await _read_json_object(request)
        if error is not None:
            return error
        assert payload is not None

        try:
            _require_text_field(payload, "graphId")
            _require_text_field(payload, "caseId")
            _require_text_field(payload, "label")
        except ValueError as exc:
            field_labels = {"graphId": "图谱", "caseId": "案件", "label": "主体名称"}
            return web.json_response({"error": f"缺少或无效的必要字段: {field_labels.get(exc.args[0], '请求内容')}"}, status=400)

        try:
            result = await asyncio.to_thread(
                self._case_graph_relation_service.add_manual_node,
                dict(payload),
            )
        except ValueError as exc:
            if exc.args and exc.args[0] == "duplicateTradeCard":
                return web.json_response({"error": "该银行卡号或账号已在当前图谱中存在"}, status=400)
            if exc.args and exc.args[0] == "graphAnchor":
                return web.json_response({"error": "请先选择案件和侦办起点，当前图上没有可承载的主体"}, status=400)
            field_labels = {
                "graphId": "图谱",
                "caseId": "案件",
                "label": "主体名称",
            }
            return web.json_response({"error": f"缺少或无效的必要字段: {field_labels.get(exc.args[0], '请求内容')}"}, status=400)
        except FileNotFoundError:
            return web.json_response({"error": "图不存在或还没有可补充的图数据"}, status=404)
        except Exception as exc:
            return web.json_response({"error": f"创建交易主体失败: {exc}"}, status=502)
        return web.json_response(result)

    async def _handle_case_graph_relation_manual_trade(self, request: Any) -> Any:
        from aiohttp import web

        allowed, resp, _user = await self._authorize_request(request)
        if not allowed:
            return resp

        payload, error = await _read_json_object(request)
        if error is not None:
            return error
        assert payload is not None

        try:
            _require_text_field(payload, "graphId")
            _require_text_field(payload, "caseId")
        except ValueError as exc:
            field_labels = {"graphId": "图谱", "caseId": "案件"}
            return web.json_response({"error": f"缺少或无效的必要字段: {field_labels.get(exc.args[0], '请求内容')}"}, status=400)
        if not isinstance(payload.get("payer"), dict):
            return web.json_response({"error": "付款方必须是对象"}, status=400)
        if not isinstance(payload.get("payee"), dict):
            return web.json_response({"error": "收款方必须是对象"}, status=400)

        try:
            result = await asyncio.to_thread(
                self._case_graph_relation_service.add_manual_trade,
                dict(payload),
            )
        except ValueError as exc:
            field_labels = {
                "graphId": "图谱",
                "caseId": "案件",
                "payer": "付款方",
                "payee": "收款方",
                "amount": "交易金额",
                "counterparty": "交易双方",
                "graphAnchor": "图上已有主体",
            }
            return web.json_response({"error": f"缺少或无效的必要字段: {field_labels.get(exc.args[0], '请求内容')}"}, status=400)
        except FileNotFoundError:
            return web.json_response({"error": "图不存在或还没有可补充的图数据"}, status=404)
        except Exception as exc:
            return web.json_response({"error": f"补充资金往来失败: {exc}"}, status=502)
        return web.json_response(result)

    async def _handle_case_graph_relation_reality_relation(self, request: Any) -> Any:
        from aiohttp import web

        allowed, resp, _user = await self._authorize_request(request)
        if not allowed:
            return resp

        payload, error = await _read_json_object(request)
        if error is not None:
            return error
        assert payload is not None

        try:
            _require_text_field(payload, "graphId")
            _require_text_field(payload, "caseId")
            _require_text_field(payload, "sourceNodeId")
            _require_text_field(payload, "targetNodeId")
            _require_text_field(payload, "relationType")
        except ValueError as exc:
            field_labels = {
                "graphId": "图谱",
                "caseId": "案件",
                "sourceNodeId": "主体",
                "targetNodeId": "关联主体",
                "relationType": "现实关系",
            }
            return web.json_response({"error": f"缺少或无效的必要字段: {field_labels.get(exc.args[0], '请求内容')}"}, status=400)

        try:
            result = await asyncio.to_thread(
                self._case_graph_relation_service.add_reality_relation,
                dict(payload),
            )
        except ValueError as exc:
            field_labels = {
                "graphId": "图谱",
                "caseId": "案件",
                "sourceNodeId": "主体",
                "targetNodeId": "关联主体",
                "relationType": "现实关系",
                "counterparty": "关系双方",
            }
            return web.json_response({"error": f"缺少或无效的必要字段: {field_labels.get(exc.args[0], '请求内容')}"}, status=400)
        except FileNotFoundError:
            return web.json_response({"error": "图不存在或还没有可标注的图数据"}, status=404)
        except Exception as exc:
            return web.json_response({"error": f"标注现实关系失败: {exc}"}, status=502)
        return web.json_response(result)

    async def _handle_case_graph_state_get(self, request: Any) -> Any:
        from aiohttp import web

        allowed, resp, _user = await self._authorize_request(request)
        if not allowed:
            return resp

        case_id = request.match_info.get("case_id", "").strip()
        graph_id = request.match_info.get("graph_id", "").strip()
        if not case_id or not graph_id:
            return web.json_response({"error": "缺少 case_id 或 graph_id"}, status=400)
        try:
            graph = await asyncio.to_thread(self._case_graph_state_service.load_current, case_id, graph_id)
        except FileNotFoundError:
            return web.json_response({"error": "图状态不存在"}, status=404)
        except Exception as exc:
            return web.json_response({"error": f"读取图状态失败: {exc}"}, status=500)
        return web.json_response(graph)

    async def _handle_case_graph_state_layout(self, request: Any) -> Any:
        from aiohttp import web

        allowed, resp, _user = await self._authorize_request(request)
        if not allowed:
            return resp

        case_id = request.match_info.get("case_id", "").strip()
        graph_id = request.match_info.get("graph_id", "").strip()
        if not case_id or not graph_id:
            return web.json_response({"error": "缺少 case_id 或 graph_id"}, status=400)
        payload, error = await _read_json_object(request)
        if error is not None:
            return error
        assert payload is not None
        node_positions = payload.get("nodePositions")
        if not isinstance(node_positions, dict):
            return web.json_response({"error": "nodePositions 必须是对象"}, status=400)
        viewport = payload.get("viewport") if isinstance(payload.get("viewport"), dict) else {}
        position_meta = payload.get("positionMeta") if isinstance(payload.get("positionMeta"), dict) else {}
        group_layout = payload.get("groupLayout") if isinstance(payload.get("groupLayout"), dict) else {}
        graph_name = str(payload.get("graphName") or "").strip()
        try:
            graph = await asyncio.to_thread(
                self._case_graph_state_service.update_layout,
                case_id=case_id,
                graph_id=graph_id,
                graph_name=graph_name,
                node_positions=dict(node_positions),
                position_meta=dict(position_meta),
                group_layout=dict(group_layout),
                viewport=dict(viewport),
            )
        except FileNotFoundError:
            return web.json_response({"error": "图状态不存在"}, status=404)
        except Exception as exc:
            return web.json_response({"error": f"保存图布局失败: {exc}"}, status=500)
        return web.json_response(graph)

    async def _handle_case_graph_state_latest_step_layout(self, request: Any) -> Any:
        from aiohttp import web

        allowed, resp, _user = await self._authorize_request(request)
        if not allowed:
            return resp

        case_id = request.match_info.get("case_id", "").strip()
        graph_id = request.match_info.get("graph_id", "").strip()
        if not case_id or not graph_id:
            return web.json_response({"error": "缺少 case_id 或 graph_id"}, status=400)
        payload, error = await _read_json_object(request)
        if error is not None:
            return error
        assert payload is not None
        node_positions = payload.get("nodePositions")
        if not isinstance(node_positions, dict):
            return web.json_response({"error": "nodePositions 必须是对象"}, status=400)
        viewport = payload.get("viewport") if isinstance(payload.get("viewport"), dict) else {}
        position_meta = payload.get("positionMeta") if isinstance(payload.get("positionMeta"), dict) else {}
        group_layout = payload.get("groupLayout") if isinstance(payload.get("groupLayout"), dict) else {}
        try:
            graph = await asyncio.to_thread(
                self._case_graph_state_service.update_latest_step_layout,
                case_id=case_id,
                graph_id=graph_id,
                node_positions=dict(node_positions),
                position_meta=dict(position_meta),
                group_layout=dict(group_layout),
                viewport=dict(viewport),
            )
        except FileNotFoundError:
            return web.json_response({"error": "图状态不存在"}, status=404)
        except Exception as exc:
            return web.json_response({"error": f"保存步骤布局失败: {exc}"}, status=500)
        return web.json_response(graph)

    async def _handle_case_graph_state_node_note(self, request: Any) -> Any:
        from aiohttp import web

        allowed, resp, _user = await self._authorize_request(request)
        if not allowed:
            return resp

        case_id = request.match_info.get("case_id", "").strip()
        graph_id = request.match_info.get("graph_id", "").strip()
        if not case_id or not graph_id:
            return web.json_response({"error": "缺少 case_id 或 graph_id"}, status=400)
        payload, error = await _read_json_object(request)
        if error is not None:
            return error
        assert payload is not None
        node_id = str(payload.get("nodeId") or "").strip()
        if not node_id:
            return web.json_response({"error": "缺少 nodeId"}, status=400)
        try:
            graph = await asyncio.to_thread(
                self._case_graph_state_service.update_node_note,
                case_id=case_id,
                graph_id=graph_id,
                graph_name=str(payload.get("graphName") or "").strip(),
                node_id=node_id,
                note=str(payload.get("note") or ""),
                source_note=str(payload.get("sourceNote") or ""),
            )
        except FileNotFoundError:
            return web.json_response({"error": "图状态不存在"}, status=404)
        except KeyError:
            return web.json_response({"error": "主体不存在"}, status=404)
        except ValueError as exc:
            return web.json_response({"error": str(exc)}, status=400)
        except Exception as exc:
            return web.json_response({"error": f"保存主体备注失败: {exc}"}, status=500)
        return web.json_response(graph)

    async def _handle_case_graph_state_steps(self, request: Any) -> Any:
        from aiohttp import web

        allowed, resp, _user = await self._authorize_request(request)
        if not allowed:
            return resp

        case_id = request.match_info.get("case_id", "").strip()
        graph_id = request.match_info.get("graph_id", "").strip()
        if not case_id or not graph_id:
            return web.json_response({"error": "缺少 case_id 或 graph_id"}, status=400)
        try:
            steps = await asyncio.to_thread(self._case_graph_state_service.list_steps, case_id, graph_id)
        except Exception as exc:
            return web.json_response({"error": f"读取图步骤失败: {exc}"}, status=500)
        return web.json_response({"items": steps})

    async def _handle_case_graph_target_detail(self, request: Any) -> Any:
        from aiohttp import web

        allowed, resp, _user = await self._authorize_request(request)
        if not allowed:
            return resp

        payload, error = await _read_json_object(request)
        if error is not None:
            return error
        assert payload is not None

        try:
            graph_id = _require_text_field(payload, "graphId")
            case_id = _require_text_field(payload, "caseId")
        except ValueError as exc:
            return web.json_response({"error": f"缺少或无效的必要字段: {exc.args[0]}"}, status=400)

        payer_cards = payload.get("payerCards")
        payee_cards = payload.get("payeeCards")
        if payer_cards is not None and not _is_dict_list(payer_cards):
            return web.json_response({"error": "payerCards 必须是对象数组"}, status=400)
        if payee_cards is not None and not _is_dict_list(payee_cards):
            return web.json_response({"error": "payeeCards 必须是对象数组"}, status=400)

        if payer_cards is None:
            payer = payload.get("payer")
            if payer is None:
                return web.json_response({"error": "缺少或无效的必要字段: payerCards"}, status=400)
            try:
                payer = _require_text_field(payload, "payer")
            except ValueError:
                return web.json_response({"error": "缺少或无效的必要字段: payerCards"}, status=400)
            payer_cards = [{"tradeCard": payer}]

        if payee_cards is None:
            payee = payload.get("payee")
            if payee is None:
                return web.json_response({"error": "缺少或无效的必要字段: payeeCards"}, status=400)
            try:
                payee = _require_text_field(payload, "payee")
            except ValueError:
                return web.json_response({"error": "缺少或无效的必要字段: payeeCards"}, status=400)
            payee_cards = [{"tradeCard": payee}]

        try:
            result = await asyncio.to_thread(
                self._case_graph_service.target_detail,
                graph_id=graph_id,
                case_id=case_id,
                payer_cards=list(payer_cards),
                payee_cards=list(payee_cards),
                **{
                    key: value
                    for key, value in payload.items()
                    if key
                    not in {"graphId", "caseId", "payer", "payee", "payerCards", "payeeCards"}
                },
            )
        except KeyError as exc:
            return web.json_response({"error": f"图不存在: {exc.args[0]}"}, status=404)
        except CaseGraphCorruptError as exc:
            return _case_graph_corrupt_response(web, exc)
        except _CaseGraphQueryClientNotConfiguredError as exc:
            return web.json_response({"error": str(exc)}, status=503)
        except Exception as exc:
            return web.json_response({"error": f"线详情查询失败: {exc}"}, status=502)
        return web.json_response(result)

    async def _handle_case_graph_context(self, request: Any) -> Any:
        from aiohttp import web

        allowed, resp, _user = await self._authorize_request(request)
        if not allowed:
            return resp

        payload, error = await _read_json_object(request)
        if error is not None:
            return error
        assert payload is not None

        try:
            graph_id = _require_text_field(payload, "graphId")
        except ValueError as exc:
            return web.json_response({"error": f"缺少或无效的必要字段: {exc.args[0]}"}, status=400)

        focus = payload.get("focus")
        if focus is not None and not isinstance(focus, dict):
            return web.json_response({"error": "focus 必须是对象"}, status=400)

        case_id = str(payload.get("caseId") or "").strip()
        graph_name = str(payload.get("graphName") or "").strip()
        chat_id = str(payload.get("chatId") or "").strip()
        if case_id and hasattr(self._case_graph_state_service, "write_current_context"):
            try:
                context = await asyncio.to_thread(
                    self._case_graph_state_service.write_current_context,
                    case_id=case_id,
                    graph_id=graph_id,
                    graph_name=graph_name,
                    chat_id=chat_id,
                    focus=focus,
                    latest_step_id=str(payload.get("latestStepId") or "").strip(),
                    latest_operation=dict(payload.get("latestOperation") or {})
                    if isinstance(payload.get("latestOperation"), dict)
                    else None,
                    latest_step_summary=dict(payload.get("latestStepSummary") or {})
                    if isinstance(payload.get("latestStepSummary"), dict)
                    else None,
                    delta_summary=dict(payload.get("deltaSummary") or {})
                    if isinstance(payload.get("deltaSummary"), dict)
                    else None,
                )
                return web.json_response(context)
            except (FileNotFoundError, KeyError, ValueError, json.JSONDecodeError):
                pass

        try:
            context = await asyncio.to_thread(
                self._case_graph_storage.write_current_context,
                graph_id,
                focus,
            )
        except KeyError as exc:
            if not case_id:
                return web.json_response({"error": f"图不存在: {exc.args[0]}"}, status=404)
            try:
                context = await asyncio.to_thread(
                    self._case_graph_storage.write_current_context_from_metadata,
                    graph_id=graph_id,
                    case_id=case_id,
                    graph_name=graph_name,
                    chat_id=chat_id,
                    focus=focus,
                )
            except Exception as metadata_exc:
                return web.json_response({"error": f"写入图上下文失败: {metadata_exc}"}, status=500)
        except CaseGraphCorruptError as exc:
            return _case_graph_corrupt_response(web, exc)
        except Exception as exc:
            return web.json_response({"error": f"写入图上下文失败: {exc}"}, status=500)
        return web.json_response(context)

    def _record_workspace_media(self, chat_id: str, media: list[dict[str, Any]]) -> dict[str, Any]:
        delivered = []
        for item in media:
            url = str(item.get("url") or "").strip()
            name = str(item.get("name") or "").strip()
            if not url or not name:
                continue
            delivered.append(item)
        if not delivered:
            return self._workspace.load_workspace(chat_id)
        return self._workspace.record_deliveries(chat_id, delivered)

    async def _handle_workspace(self, request: Any) -> Any:
        from aiohttp import web

        allowed, resp, user = await self._authorize_request(request)
        if not allowed:
            return resp

        chat_id = request.match_info.get("chat_id", "").strip()
        if not chat_id or not is_valid_chat_id(chat_id):
            return web.json_response({"error": "无效的会话 ID"}, status=400)

        if not await self._can_access_session(user, chat_id):
            return web.json_response({"error": "无权访问此会话"}, status=404)

        workspace = await asyncio.to_thread(self._workspace.load_workspace, chat_id)
        return web.json_response({
            "chat_id": workspace["chat_id"],
            "updated_at": workspace["updated_at"],
            "file_count": len(workspace["files"]),
            "files": workspace["files"],
        })

    async def _handle_uploads(self, request: Any) -> Any:
        from aiohttp import web

        allowed, resp, user = await self._authorize_request(request)
        if not allowed:
            return resp

        chat_id = request.match_info.get("chat_id", "").strip()
        if not chat_id or not is_valid_chat_id(chat_id):
            return web.json_response({"error": "无效的会话 ID"}, status=400)

        reader = await request.multipart()
        uploaded: list[dict[str, str]] = []

        while True:
            part = await reader.next()
            if part is None:
                break
            if getattr(part, "name", "") != "files":
                continue
            filename = getattr(part, "filename", None)
            if not filename:
                continue

            destination = next_upload_path(
                self._sessions.workspace,
                user.id if user is not None else "shared",
                chat_id,
                filename,
            )
            with open(destination, "wb") as handle:
                while chunk := await part.read_chunk():
                    handle.write(chunk)

            media_item = self._media.build_media_item(str(destination))
            uploaded.append({
                "path": str(destination),
                "name": media_item.get("name") or destination.name,
                "mime": part.headers.get("Content-Type", "") or mimetypes.guess_type(destination.name)[0] or "",
                "url": media_item.get("url", ""),
            })

        if not uploaded:
            return web.json_response({"error": "未收到文件"}, status=400)

        return web.json_response({"files": uploaded})

    async def _handle_media(self, request: Any) -> Any:
        from aiohttp import web

        allowed, resp, _user = await self._authorize_request(request)
        if not allowed:
            return resp

        token = request.match_info.get("token", "").strip()
        path = self._media.resolve_token(token)
        if path is None:
            return web.json_response({"error": "媒体令牌无效或已过期"}, status=404)
        return web.FileResponse(path)

    async def _handle_ws(self, request: Any) -> Any:
        import aiohttp
        from aiohttp import web

        if not self._runtime_attached:
            self._runtime_attached = self._ensure_runtime_attached()

        allowed, resp, current_user = await self._authorize_request(request)
        if not allowed:
            return resp

        ws = web.WebSocketResponse()
        await ws.prepare(request)

        requested = request.rel_url.query.get("chat_id", "").strip()
        requested_channel, requested_chat_id = parse_session_ref(requested)
        can_resume_requested = False
        if (
            requested
            and requested_channel == CHANNEL_NAME
            and is_valid_chat_id(requested_chat_id)
            and await self._can_access_session(current_user, requested_chat_id)
        ):
            history = await asyncio.to_thread(
                self._sessions.load_history,
                requested_chat_id,
                media_service=self._media,
            )
            can_resume_requested = bool(history)

        if (
            can_resume_requested
        ):
            chat_ref: list[str | None] = [requested_chat_id]
            logger.info("WebUI: resumed session {}", chat_ref[0][:32])
        else:
            chat_ref = [None]
            logger.info("WebUI: draft session")

        if chat_ref[0] is not None:
            self._registry.mark_active(chat_ref[0])
            self._registry.subscribe(ws, chat_ref[0])
            await self._registry.emit_to_ws(ws, session_init_event(chat_ref[0]))
        elif requested and requested_channel == CHANNEL_NAME and requested_chat_id:
            await self._registry.emit_to_ws(ws, session_deleted_event(requested_chat_id))

        if (
            requested
            and requested_channel == CHANNEL_NAME
            and is_valid_chat_id(requested_chat_id)
            and chat_ref[0] == requested_chat_id
        ):
            await self._registry.emit_to_ws(ws, session_history_event(chat_ref[0], history))

        async def create_active_chat() -> str:
            old_chat = chat_ref[0]
            chat_id = str(uuid.uuid4())
            chat_ref[0] = chat_id
            self._registry.mark_active(chat_id)
            self._registry.subscribe(ws, chat_id)
            if old_chat:
                self._turns.clear(old_chat)
                logger.info("WebUI: new chat {} → {}", old_chat[:8], chat_id[:8])
            else:
                logger.info("WebUI: new chat {}", chat_id[:8])
            await self._registry.emit_to_ws(ws, session_init_event(chat_id))
            return chat_id

        try:
            async for raw in ws:
                if raw.type != aiohttp.WSMsgType.TEXT:
                    if raw.type in (aiohttp.WSMsgType.ERROR, aiohttp.WSMsgType.CLOSE):
                        break
                    continue

                command = parse_client_command(raw.data)
                if command is None:
                    await self._registry.emit_to_ws(ws, error_event("无效的请求参数"))
                    continue

                if command.type == "message.send":
                    chat_id = chat_ref[0]
                    if chat_id is None:
                        chat_id = await create_active_chat()
                    if not is_valid_chat_id(chat_id):
                        await self._registry.emit_to_ws(ws, error_event("当前会话为只读视图，不能继续发送消息", code="read_only_session"))
                        continue
                    attachments = command.attachments or []
                    content = command.content
                    if current_user is not None and self._pocketbase.enabled:
                        preview = self._preview_from_content(content, attachments)
                        await self._session_index.touch_session(
                            current_user,
                            chat_id=chat_id,
                            session_key=f"{CHANNEL_NAME}:{chat_id}",
                            title=self._session_title_from_preview(preview),
                            preview=preview,
                        )
                    if attachments:
                        suffixes = [
                            attachment_prompt_suffix(item.path, name=item.name, mime=item.mime)
                            for item in attachments
                        ]
                        extra = "\n\n".join(part for part in suffixes if part)
                        if extra:
                            content = f"{content}\n\n{extra}".strip() if content else extra
                    with bind_current_user(current_user):
                        await self._handle_message(
                            sender_id=f"webui_browser:{current_user.id}" if current_user is not None else "webui_browser",
                            chat_id=chat_id,
                            content=content,
                            media=[item.path for item in attachments] or None,
                        )
                    continue

                if command.type == "message.cancel":
                    chat_id = chat_ref[0]
                    if chat_id is None or not is_valid_chat_id(chat_id):
                        await self._registry.emit_to_ws(ws, error_event("当前会话为只读视图，不能发送停止命令", code="read_only_session"))
                        continue
                    with bind_current_user(current_user):
                        await self._handle_message(
                            sender_id=f"webui_browser:{current_user.id}" if current_user is not None else "webui_browser",
                            chat_id=chat_id,
                            content="/stop",
                        )
                    continue

                if command.type == "session.new":
                    await create_active_chat()
                    continue

                if command.type == "session.switch":
                    target = str(command.chat_id or "").strip()
                    target_channel, target_chat_id = parse_session_ref(target)
                    if not target or target_channel != CHANNEL_NAME or not is_valid_chat_id(target_chat_id):
                        await self._registry.emit_to_ws(ws, error_event("无效的会话 ID", code="invalid_chat_id"))
                        continue
                    if not await self._can_access_session(current_user, target_chat_id):
                        await self._registry.emit_to_ws(ws, error_event("无权访问此会话", code="forbidden_session"))
                        continue
                    old_chat = chat_ref[0]
                    chat_ref[0] = target_chat_id
                    self._registry.mark_active(chat_ref[0])
                    self._registry.subscribe(ws, chat_ref[0])
                    if old_chat:
                        logger.info("WebUI: switch {} → {}", old_chat[:8], chat_ref[0][:8])
                    else:
                        logger.info("WebUI: switch draft → {}", chat_ref[0][:8])
                    history = await asyncio.to_thread(
                        self._sessions.load_history,
                        chat_ref[0],
                        media_service=self._media,
                    )
                    await self._registry.emit_to_ws(ws, session_init_event(chat_ref[0]))
                    await self._registry.emit_to_ws(ws, session_history_event(chat_ref[0], history))
                    continue
        finally:
            self._registry.unsubscribe(ws)
            if chat_ref[0]:
                logger.info("WebUI: session closed {}", chat_ref[0][:8])
            else:
                logger.info("WebUI: draft session closed")

        return ws
