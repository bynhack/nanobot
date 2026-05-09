"""WebUI channel — serves a browser chat UI over HTTP + WebSocket."""

from __future__ import annotations

import asyncio
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

from .auth import WebUIAccessControl
from .compat.runtime import attach_webui_runtime, current_route_context
from .config import CHANNEL_NAME, WebUIConfig
from .connections import ConnectionRegistry
from .management import WebUIManagementService
from .media import MediaService
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
from .sessions import SessionQueryService, is_valid_chat_id, parse_session_ref
from .uploads import attachment_prompt_suffix, next_upload_path

STATIC_DIR = Path(__file__).parent / "static"
PACKAGE_ROOT = Path(__file__).resolve().parent.parent


class _TurnTracker:
    """Track whether a streaming turn has already produced content."""

    def __init__(self) -> None:
        self._stream_activity: set[str] = set()
        self._active_stream_ids: dict[str, str | None] = {}

    def begin_stream(self, chat_id: str, stream_id: str | None) -> bool:
        previous = self._active_stream_ids.get(chat_id)
        self._active_stream_ids[chat_id] = stream_id
        return previous != stream_id

    def note_stream_output(self, chat_id: str) -> None:
        self._stream_activity.add(chat_id)

    def had_stream_output(self, chat_id: str) -> bool:
        return chat_id in self._stream_activity

    def clear(self, chat_id: str) -> None:
        self._stream_activity.discard(chat_id)
        self._active_stream_ids.pop(chat_id, None)


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


def _resolve_webui_title(config_title: str) -> str:
    return (
        os.environ.get("NANOBOT_WEBUI_TITLE", "").strip()
        or _read_env_file_value("NANOBOT_WEBUI_TITLE")
        or config_title
    )


def _is_control_tool(name: str) -> bool:
    return name == "ask_user"


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

    def __init__(self, registry: ConnectionRegistry, turns: _TurnTracker) -> None:
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

        content = ""
        buttons: list[list[str]] | None = None
        if not self._turns.had_stream_output(chat_id):
            content = ctx.final_content or ""
        if ctx.stop_reason == "ask_user":
            parsed_ask = _ask_user_prompt_from_context(ctx)
            if parsed_ask is not None:
                content, buttons = parsed_ask

        await self._registry.emit_to_chat(
            chat_id,
            turn_completed_event(chat_id, content=content, buttons=buttons),
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
        self._turns = _TurnTracker()
        self._runner: Any = None
        self._access = WebUIAccessControl(
            allowed_origins=self.config.allowed_origins,
            auth_token=self.config.auth_token,
        )
        self._media = MediaService(
            ttl_seconds=self.config.media_token_ttl_seconds,
            auth_token=self.config.auth_token,
            signing_secret=self.config.media_signing_secret,
        )
        self._sessions = SessionQueryService()
        self._management = WebUIManagementService(self._sessions.workspace)
        self._hook = WebUIHook(self._registry, self._turns)
        self._runtime_attached = self._ensure_runtime_attached()

    @classmethod
    def default_config(cls) -> dict[str, Any]:
        return WebUIConfig().model_dump(by_alias=True)

    def get_hook(self) -> WebUIHook:
        return self._hook

    def _ensure_runtime_attached(self) -> bool:
        attached = attach_webui_runtime(self.bus, self._hook)
        if not attached:
            logger.warning("WebUI runtime hook is not attached yet; tool lifecycle events will wait for AgentLoop")
        return attached

    @property
    def supports_streaming(self) -> bool:
        return self.config.streaming

    def _create_app(self, web: Any) -> Any:
        app = web.Application()
        app.router.add_get("/", self._handle_index)
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

        content = msg.content
        buttons = msg.buttons or None
        if not buttons:
            pending_ask = self._sessions.pending_ask_user_prompt(msg.chat_id)
            if pending_ask is not None:
                question, pending_buttons = pending_ask
                content = _strip_webui_ask_user_text_fallback(content, question, pending_buttons)
                buttons = pending_buttons

        payload = turn_completed_event(
            msg.chat_id,
            content=content,
            media=self._media.build_media_items(msg.media) if msg.media else None,
            buttons=buttons,
        )
        await self._registry.emit_to_chat(msg.chat_id, payload)
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

    async def _authorize_request(self, request: Any) -> tuple[bool, Any | None]:
        from aiohttp import web

        allowed, status, message = self._access.authorize(request)
        if allowed:
            return True, None
        return False, web.json_response({"error": message}, status=status)

    async def _handle_index(self, request: Any) -> Any:
        from aiohttp import web

        path = STATIC_DIR / "index.html"
        if not path.exists():
            return web.Response(
                text="缺少页面静态资源，请先构建前端。",
                status=500,
                content_type="text/plain",
            )

        html = await asyncio.to_thread(path.read_text, encoding="utf-8")
        bootstrap = json.dumps(
            {
                "title": self._resolved_title,
                "authRequired": self._access.auth_required,
            },
            ensure_ascii=False,
        )
        html = html.replace('"__WEBUI_BOOTSTRAP__"', bootstrap)
        return web.Response(text=html, content_type="text/html")

    async def _handle_sessions(self, request: Any) -> Any:
        from aiohttp import web

        allowed, resp = await self._authorize_request(request)
        if not allowed:
            return resp
        sessions = await asyncio.to_thread(self._sessions.list_sessions)
        return web.json_response(sessions)

    async def _handle_delete_session(self, request: Any) -> Any:
        from aiohttp import web

        allowed, resp = await self._authorize_request(request)
        if not allowed:
            return resp

        chat_id = request.match_info.get("chat_id", "").strip()
        if not chat_id or not is_valid_chat_id(chat_id):
            return web.json_response({"error": "无效的会话 ID"}, status=400)

        deleted = await asyncio.to_thread(self._sessions.delete_session, chat_id)
        if not deleted:
            return web.json_response({"error": "会话不存在"}, status=404)

        self._turns.clear(chat_id)
        await self._registry.delete_chat(chat_id, session_deleted_event(chat_id))
        return web.json_response({"ok": True})

    async def _handle_skills(self, request: Any) -> Any:
        from aiohttp import web

        allowed, resp = await self._authorize_request(request)
        if not allowed:
            return resp

        skills = await asyncio.to_thread(self._management.list_skills)
        return web.json_response({"skills": skills})

    async def _handle_skill_detail(self, request: Any) -> Any:
        from aiohttp import web

        allowed, resp = await self._authorize_request(request)
        if not allowed:
            return resp

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

        allowed, resp = await self._authorize_request(request)
        if not allowed:
            return resp

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

        allowed, resp = await self._authorize_request(request)
        if not allowed:
            return resp

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

        allowed, resp = await self._authorize_request(request)
        if not allowed:
            return resp

        snapshot = await asyncio.to_thread(self._management.config_snapshot)
        return web.json_response(snapshot)

    async def _handle_save_config(self, request: Any) -> Any:
        from aiohttp import web

        allowed, resp = await self._authorize_request(request)
        if not allowed:
            return resp

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

        allowed, resp = await self._authorize_request(request)
        if not allowed:
            return resp

        snapshot = await asyncio.to_thread(self._management.runtime_snapshot)
        snapshot["session_count"] = len(await asyncio.to_thread(self._sessions.list_sessions))
        return web.json_response(snapshot)

    async def _handle_uploads(self, request: Any) -> Any:
        from aiohttp import web

        allowed, resp = await self._authorize_request(request)
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

            destination = next_upload_path(self._sessions.workspace, chat_id, filename)
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

        allowed, resp = await self._authorize_request(request)
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

        allowed, resp = await self._authorize_request(request)
        if not allowed:
            return resp

        ws = web.WebSocketResponse()
        await ws.prepare(request)

        requested = request.rel_url.query.get("chat_id", "").strip()
        requested_channel, requested_chat_id = parse_session_ref(requested)
        if requested and requested_channel == CHANNEL_NAME and is_valid_chat_id(requested_chat_id):
            chat_ref = [requested_chat_id]
            logger.info("WebUI: resumed session {}", chat_ref[0][:32])
        else:
            chat_ref = [str(uuid.uuid4())]
            logger.info("WebUI: new session {}", chat_ref[0][:8])

        self._registry.mark_active(chat_ref[0])
        self._registry.subscribe(ws, chat_ref[0])
        await self._registry.emit_to_ws(ws, session_init_event(chat_ref[0]))

        if requested and requested_channel == CHANNEL_NAME and is_valid_chat_id(requested_chat_id):
            history = await asyncio.to_thread(
                self._sessions.load_history,
                chat_ref[0],
                media_service=self._media,
            )
            await self._registry.emit_to_ws(ws, session_history_event(chat_ref[0], history))

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
                    if not is_valid_chat_id(chat_ref[0]):
                        await self._registry.emit_to_ws(ws, error_event("当前会话为只读视图，不能继续发送消息", code="read_only_session"))
                        continue
                    attachments = command.attachments or []
                    content = command.content
                    if attachments:
                        suffixes = [
                            attachment_prompt_suffix(item.path, name=item.name, mime=item.mime)
                            for item in attachments
                        ]
                        extra = "\n\n".join(part for part in suffixes if part)
                        if extra:
                            content = f"{content}\n\n{extra}".strip() if content else extra
                    await self._handle_message(
                        sender_id="webui_browser",
                        chat_id=chat_ref[0],
                        content=content,
                        media=[item.path for item in attachments] or None,
                    )
                    continue

                if command.type == "message.cancel":
                    if not is_valid_chat_id(chat_ref[0]):
                        await self._registry.emit_to_ws(ws, error_event("当前会话为只读视图，不能发送停止命令", code="read_only_session"))
                        continue
                    await self._handle_message(
                        sender_id="webui_browser",
                        chat_id=chat_ref[0],
                        content="/stop",
                    )
                    continue

                if command.type == "session.new":
                    old_chat = chat_ref[0]
                    chat_ref[0] = str(uuid.uuid4())
                    self._registry.mark_active(chat_ref[0])
                    self._registry.subscribe(ws, chat_ref[0])
                    self._turns.clear(old_chat)
                    logger.info("WebUI: new chat {} → {}", old_chat[:8], chat_ref[0][:8])
                    await self._registry.emit_to_ws(ws, session_init_event(chat_ref[0]))
                    await self._registry.emit_to_ws(ws, session_history_event(chat_ref[0], []))
                    continue

                if command.type == "session.switch":
                    target = str(command.chat_id or "").strip()
                    target_channel, target_chat_id = parse_session_ref(target)
                    if not target or target_channel != CHANNEL_NAME or not is_valid_chat_id(target_chat_id):
                        await self._registry.emit_to_ws(ws, error_event("无效的会话 ID", code="invalid_chat_id"))
                        continue
                    old_chat = chat_ref[0]
                    chat_ref[0] = target_chat_id
                    self._registry.mark_active(chat_ref[0])
                    self._registry.subscribe(ws, chat_ref[0])
                    logger.info("WebUI: switch {} → {}", old_chat[:8], chat_ref[0][:8])
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
            logger.info("WebUI: session closed {}", chat_ref[0][:8])

        return ws
