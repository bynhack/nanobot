"""WebUI channel — serves a browser chat UI over HTTP + WebSocket."""

from __future__ import annotations

import asyncio
import base64
import html as html_lib
import json
import mimetypes
import os
import re
from pathlib import Path
from typing import Any

from loguru import logger

from nanobot.bus.events import OutboundMessage
from nanobot.bus.queue import MessageBus
from nanobot.channels.base import BaseChannel
from nanobot.config.paths import get_workspace_path

from .auth import WebUIAccessControl
from .config import CHANNEL_NAME, WebUIConfig
from .instances import (
    InstanceSpecBuilder,
    InstanceSpecBuilderOptions,
    ManagedInstanceBootstrapService,
    ManagedInstanceManager,
    refresh_managed_skill_links,
    discover_packaged_skill_catalog,
)
from .management import WebUIManagementService
from .media import MediaService
from .session_workspace import SessionWorkspaceService
from .supabase_account import SupabaseAccountClient
from .user_context import CurrentUser, bind_current_user
from .uploads import next_upload_path, upload_display_name

STATIC_DIR = Path(__file__).parent / "static"
PACKAGE_ROOT = Path(__file__).resolve().parent.parent
DRAFT_UPLOAD_CHAT_ID = "__nanobot_draft_thread__"
_UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    re.IGNORECASE,
)


def is_valid_chat_id(chat_id: str) -> bool:
    return bool(_UUID_RE.match(chat_id))


def is_valid_upload_chat_id(chat_id: str) -> bool:
    return chat_id == DRAFT_UPLOAD_CHAT_ID or is_valid_chat_id(chat_id)


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
    configured = str(config_title or "").strip()
    if configured:
        return configured
    return (
        os.environ.get("NANOBOT_WEBUI_TITLE", "").strip()
        or _read_env_file_value("NANOBOT_WEBUI_TITLE")
        or "Nanobot"
    )


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
        self._runner: Any = None
        self._workspace_root = get_workspace_path()
        self._supabase = SupabaseAccountClient(
            url=self.config.account_supabase_url,
            anon_key=self.config.supabase_anon_key,
            service_role_key=self.config.account_supabase_service_role_key,
            profiles_table=self.config.supabase_profiles_table,
        )
        self._access = WebUIAccessControl(
            allowed_origins=self.config.allowed_origins,
            auth_token=self.config.auth_token,
            supabase=self._supabase,
        )
        self._media = MediaService(
            ttl_seconds=self.config.media_token_ttl_seconds,
            auth_token=self.config.auth_token,
            signing_secret=self.config.media_signing_secret,
        )
        self._workspace = SessionWorkspaceService(self._workspace_root)
        self._management = WebUIManagementService(self._workspace_root)
        self._management.bind_runtime_observer(self._runtime_observability_snapshot)
        self._managed_instance_manager = ManagedInstanceManager()
        self._managed_instance_service: ManagedInstanceBootstrapService | None = None

    @classmethod
    def default_config(cls) -> dict[str, Any]:
        return WebUIConfig().model_dump(by_alias=True)

    def _runtime_observability_snapshot(self) -> dict[str, Any]:
        return {
            "channel": {
                "name": self.name,
                "streaming_enabled": self.supports_streaming,
                "mode": "control_plane",
            },
            "runtime": {
                "conversation_channel": "upstream_websocket",
                "local_conversation_routes": False,
            },
        }

    @property
    def supports_streaming(self) -> bool:
        return self.config.streaming

    def _create_app(self, web: Any) -> Any:
        app = web.Application()
        app.router.add_get("/", self._handle_index)
        app.router.add_get("/health", self._handle_health)
        app.router.add_get("/api/auth/me", self._handle_auth_me)
        app.router.add_get("/api/settings/skills", self._handle_skills)
        app.router.add_get("/api/settings/skills/{name}", self._handle_skill_detail)
        app.router.add_get("/api/settings/skills/{name}/file", self._handle_skill_file)
        app.router.add_post("/api/settings/skills/{name}/toggle", self._handle_skill_toggle)
        app.router.add_get("/api/settings/config", self._handle_config)
        app.router.add_post("/api/settings/config", self._handle_save_config)
        app.router.add_get("/api/settings/runtime", self._handle_runtime)
        app.router.add_get("/api/settings/audit", self._handle_audit)
        app.router.add_get("/api/settings/tenant-contracts", self._handle_tenant_contracts)
        app.router.add_get("/api/upstream/bootstrap", self._handle_upstream_bootstrap)
        app.router.add_get("/api/upstream/ws/{instance_id}", self._handle_upstream_ws_proxy)
        app.router.add_get("/api/upstream/sessions", self._handle_upstream_sessions)
        app.router.add_get("/api/upstream/sessions/{chat_id}/webui-thread", self._handle_upstream_thread)
        app.router.add_delete("/api/upstream/sessions/{chat_id}", self._handle_upstream_delete_session)
        app.router.add_get("/api/public-media/{payload}", self._handle_upstream_media)
        app.router.add_get("/api/upstream/media/{sig}/{payload}", self._handle_upstream_media)
        app.router.add_get("/api/media/{sig}/{payload}", self._handle_upstream_media)
        app.router.add_get("/api/workspaces/{chat_id}", self._handle_workspace)
        app.router.add_post("/uploads/{chat_id}", self._handle_uploads)
        app.router.add_get("/media/{token}", self._handle_media)
        assets_dir = STATIC_DIR / "assets"
        if assets_dir.exists():
            app.router.add_static("/assets/", assets_dir)
        return app

    async def _handle_health(self, request: Any) -> Any:
        from aiohttp import web

        return web.json_response({"status": "ok", "mode": "control_plane"})

    async def start(self) -> None:
        try:
            from aiohttp import web
        except ImportError:
            logger.error("WebUI channel requires aiohttp: pip install 'nanobot-ai[webui]'")
            return

        self._running = True
        app = self._create_app(web)

        self._runner = web.AppRunner(app)
        await self._runner.setup()
        site = web.TCPSite(self._runner, self.config.host, self.config.port)
        await site.start()
        self._refresh_existing_managed_skill_links()
        logger.info("WebUI channel started → http://{}:{}", self.config.host, self.config.port)

        while self._running:
            await asyncio.sleep(0.5)

    async def stop(self) -> None:
        self._running = False
        if self._runner:
            await self._runner.cleanup()
            self._runner = None
        await self._managed_instance_manager.stop_all()

    async def send(self, msg: OutboundMessage) -> None:
        media_items = self._media.build_media_items(msg.media) if msg.media else None
        if media_items:
            await asyncio.to_thread(self._record_workspace_media, msg.chat_id, media_items)

    async def send_delta(self, chat_id: str, delta: str, metadata: dict[str, Any] | None = None) -> None:
        return None

    async def _can_access_session(self, user: CurrentUser | None, chat_id: str) -> bool:
        if user is None:
            return True
        if not self._managed_instances_enabled():
            return True
        sessions = await self._upstream_sessions_for_user(user)
        expected_key = f"websocket:{chat_id}"
        return any(str(item.get("key") or "") == expected_key for item in sessions)

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
        managed_instances_enabled = self._managed_instances_enabled()
        bootstrap = json.dumps(
            {
                "title": self._resolved_title,
                "authRequired": self._access.auth_required,
                "authMode": self._access.auth_mode,
                "supabase": {
                    "url": self.config.account_supabase_url,
                    "anonKey": self.config.supabase_anon_key,
                },
                "upstreamGateway": {
                    "enabled": managed_instances_enabled or bool(self.config.upstream_gateway_url),
                    "baseUrl": "" if managed_instances_enabled else self.config.upstream_gateway_url,
                    "bootstrapUrl": "/api/upstream/bootstrap",
                },
                "ui": self.config.ui.model_dump(by_alias=True),
            },
            ensure_ascii=False,
        )
        page = page.replace("<title>Nanobot</title>", f"<title>{html_lib.escape(self._resolved_title)}</title>")
        page = page.replace('"__WEBUI_BOOTSTRAP__"', bootstrap)
        return web.Response(text=page, content_type="text/html")

    async def _handle_auth_me(self, request: Any) -> Any:
        from aiohttp import web

        allowed, resp, user = await self._authorize_request(request)
        if not allowed:
            return resp
        return web.json_response({
            "token": user.token if user is not None else "",
            "user": None if user is None else {"id": user.id, "email": user.email, "role": user.role},
        })

    async def _upstream_json(
        self,
        path: str,
        *,
        token: str = "",
        method: str = "GET",
        base_url: str | None = None,
    ) -> tuple[int, dict[str, Any]]:
        import aiohttp

        upstream_base = (base_url or self.config.upstream_gateway_url).rstrip("/")
        if not upstream_base:
            return 404, {"error": "未配置上游 WebUI Gateway"}
        url = f"{upstream_base}{path}"
        headers = {"Authorization": f"Bearer {token}"} if token else {}
        try:
            async with aiohttp.ClientSession() as session:
                async with session.request(method, url, headers=headers) as response:
                    text = await response.text()
                    try:
                        payload = json.loads(text) if text else {}
                    except json.JSONDecodeError:
                        payload = {"error": text or f"HTTP {response.status}"}
                    if isinstance(payload, dict):
                        return response.status, payload
                    return response.status, {"data": payload}
        except Exception as exc:
            return 502, {"error": f"访问上游 WebUI Gateway 失败: {exc}"}

    async def _upstream_bytes(
        self,
        path: str,
        *,
        token: str = "",
        base_url: str | None = None,
    ) -> tuple[int, bytes, dict[str, str]]:
        import aiohttp

        upstream_base = (base_url or self.config.upstream_gateway_url).rstrip("/")
        if not upstream_base:
            return (
                404,
                json.dumps({"error": "未配置上游 WebUI Gateway"}, ensure_ascii=False).encode("utf-8"),
                {"Content-Type": "application/json"},
            )
        url = f"{upstream_base}{path}"
        headers = {"Authorization": f"Bearer {token}"} if token else {}
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(url, headers=headers) as response:
                    body = await response.read()
                    selected_headers = {
                        key: value
                        for key, value in response.headers.items()
                        if key.lower() in {"content-type", "cache-control", "accept-ranges", "content-range"}
                    }
                    return response.status, body, selected_headers
        except Exception as exc:
            return (
                502,
                json.dumps({"error": f"访问上游媒体失败: {exc}"}, ensure_ascii=False).encode("utf-8"),
                {"Content-Type": "application/json"},
            )

    @staticmethod
    def _rewrite_upstream_media_url(url: str) -> str:
        prefix = "/api/media/"
        if not url.startswith(prefix):
            return url
        parts = url[len(prefix):].split("/", 1)
        payload = parts[1] if len(parts) == 2 else parts[0]
        return f"/api/public-media/{payload}"

    @classmethod
    def _rewrite_upstream_payload_media_urls(cls, value: Any) -> Any:
        if isinstance(value, list):
            return [cls._rewrite_upstream_payload_media_urls(item) for item in value]
        if not isinstance(value, dict):
            return value
        rewritten: dict[str, Any] = {}
        for key, item in value.items():
            if key == "url" and isinstance(item, str):
                rewritten[key] = cls._rewrite_upstream_media_url(item)
            else:
                rewritten[key] = cls._rewrite_upstream_payload_media_urls(item)
        return rewritten

    @classmethod
    def _media_items_from_upstream_payload(cls, payload: Any) -> list[dict[str, Any]]:
        if not isinstance(payload, dict):
            return []
        messages = payload.get("messages")
        if not isinstance(messages, list):
            return []
        media_items: list[dict[str, Any]] = []
        for message in messages:
            if not isinstance(message, dict):
                continue
            raw_media = message.get("media")
            if not isinstance(raw_media, list):
                raw_media = message.get("media_urls")
            if not isinstance(raw_media, list):
                continue
            delivered_at = (
                message.get("delivered_at")
                or message.get("created_at")
                or message.get("updated_at")
            )
            for item in raw_media:
                if not isinstance(item, dict):
                    continue
                url = str(item.get("url") or "").strip()
                name = str(item.get("name") or "").strip()
                if not url or not name:
                    continue
                normalized = {
                    "url": cls._rewrite_upstream_media_url(url),
                    "name": name,
                    "mime": str(item.get("mime") or "").strip(),
                }
                if isinstance(delivered_at, str) and delivered_at:
                    normalized["delivered_at"] = delivered_at
                media_items.append(normalized)
        return media_items

    def _managed_instances_enabled(self) -> bool:
        return bool(getattr(getattr(self, "_supabase", None), "enabled", False))

    @staticmethod
    def _decode_media_payload(payload: str) -> Path | None:
        try:
            padded = payload + "=" * (-len(payload) % 4)
            decoded = base64.urlsafe_b64decode(padded.encode("ascii")).decode("utf-8")
        except Exception:
            return None
        path = Path(decoded)
        if path.is_absolute() or any(part in {"", ".", ".."} for part in path.parts):
            return None
        return path

    @staticmethod
    def _decode_upload_media_payload(payload: str) -> Path | None:
        try:
            padded = payload + "=" * (-len(payload) % 4)
            decoded = base64.urlsafe_b64decode(padded.encode("ascii")).decode("utf-8")
            data = json.loads(decoded)
        except Exception:
            return None
        path = Path(str(data.get("path", ""))).expanduser()
        return path if path.is_absolute() else None

    @staticmethod
    def _encode_upload_media_payload(path: Path) -> str:
        raw = json.dumps(
            {"path": str(path.resolve(strict=False))},
            separators=(",", ":"),
            ensure_ascii=False,
        ).encode("utf-8")
        return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")

    def _public_upload_media_url(self, path: Path) -> str:
        return f"/api/public-media/{self._encode_upload_media_payload(path)}"

    def _public_upload_media_path(self, payload: str) -> Path | None:
        path = self._decode_upload_media_payload(payload)
        if path is None:
            return None
        try:
            resolved = path.resolve(strict=False)
        except OSError:
            return None
        if ".nanobot_webui_uploads" not in resolved.parts:
            return None

        roots = [self._workspace_root.resolve() / ".nanobot_webui_uploads"]
        if self._managed_instances_enabled():
            instances_root = Path(self.config.runtime_root).expanduser() / "instances"
            if instances_root.exists():
                roots.extend(
                    (workspace / ".nanobot_webui_uploads").resolve()
                    for workspace in instances_root.glob("*/workspace")
                )

        for root in roots:
            try:
                resolved.relative_to(root)
            except ValueError:
                continue
            return resolved if resolved.is_file() else None
        return None

    def _public_media_path(self, payload: str) -> Path | None:
        upload_path = self._public_upload_media_path(payload)
        if upload_path is not None:
            return upload_path

        relative = self._decode_media_payload(payload)
        if relative is None:
            return None
        if self._managed_instances_enabled():
            instances_root = Path(self.config.runtime_root).expanduser() / "instances"
            if not instances_root.exists():
                return None
            for media_root in sorted(instances_root.glob("*/media")):
                candidate = (media_root / relative).resolve()
                try:
                    candidate.relative_to(media_root.resolve())
                except ValueError:
                    continue
                if candidate.is_file():
                    return candidate
            return None
        candidate = (self._workspace_root / ".nanobot_media" / relative).resolve()
        try:
            candidate.relative_to((self._workspace_root / ".nanobot_media").resolve())
        except ValueError:
            return None
        return candidate if candidate.is_file() else None

    def _managed_instance_bootstrap_service(self) -> ManagedInstanceBootstrapService:
        if self._managed_instance_service is not None:
            return self._managed_instance_service

        from nanobot.config.loader import load_config, resolve_config_env_vars

        base_config = resolve_config_env_vars(load_config(None))
        instances_root = Path(self.config.runtime_root).expanduser() / "instances"
        builder = InstanceSpecBuilder(
            InstanceSpecBuilderOptions(
                instances_root=instances_root,
                skill_catalog=discover_packaged_skill_catalog(),
                environment={
                    "NANOBOT_WEBUI_SUPABASE_URL": self.config.account_supabase_url,
                    "NANOBOT_WEBUI_SUPABASE_SERVICE_ROLE_KEY": (
                        self.config.account_supabase_service_role_key
                    ),
                    "NANOBOT_WEBUI_SUPABASE_PROFILES_TABLE": (
                        self.config.supabase_profiles_table
                    ),
                },
            )
        )
        self._managed_instance_service = ManagedInstanceBootstrapService(
            builder=builder,
            manager=self._managed_instance_manager,
            base_config=base_config,
        )
        return self._managed_instance_service

    def _management_for_user(self, user: CurrentUser | None) -> WebUIManagementService:
        if self._managed_instances_enabled() and user is not None:
            spec = self._managed_instance_bootstrap_service().spec_for_user(user)
            return WebUIManagementService(spec.workspace.workspace)
        return self._management

    def _refresh_existing_managed_skill_links(self) -> None:
        if not self._managed_instances_enabled():
            return
        try:
            instances_root = Path(self.config.runtime_root).expanduser() / "instances"
            refreshed = refresh_managed_skill_links(
                instances_root,
                discover_packaged_skill_catalog(),
            )
            if refreshed:
                logger.info("Refreshed {} managed skill links", len(refreshed))
        except Exception as exc:
            logger.warning("Failed to refresh managed skill links: {}", exc)

    async def _issue_upstream_token(
        self,
        user: CurrentUser | None = None,
    ) -> tuple[int, dict[str, Any]]:
        if self._managed_instances_enabled():
            if user is None:
                return 401, {"error": "托管实例需要登录用户"}
            try:
                payload = await self._managed_instance_bootstrap_service().bootstrap_for_user(user)
            except Exception as exc:
                logger.exception("managed Nanobot instance bootstrap failed")
                return 502, {"error": f"启动用户实例失败: {exc}"}
            return 200, payload
        return await self._upstream_json("/webui/bootstrap")

    @staticmethod
    def _upstream_base_from_bootstrap(boot: dict[str, Any]) -> str:
        port = int(boot.get("websocket_port") or boot.get("gateway_port") or 0)
        if port <= 0:
            return ""
        return f"http://127.0.0.1:{port}"

    async def _handle_upstream_bootstrap(self, request: Any) -> Any:
        from aiohttp import web

        allowed, resp, user = await self._authorize_request(request)
        if not allowed:
            return resp
        status, payload = await self._issue_upstream_token(user)
        if (
            status == 200
            and self._managed_instances_enabled()
            and isinstance(payload, dict)
            and payload.get("instance_id")
        ):
            payload = dict(payload)
            payload["ws_url"] = self._public_upstream_ws_url(
                request,
                str(payload["instance_id"]),
            )
        return web.json_response(payload, status=status)

    @staticmethod
    def _public_upstream_ws_url(request: Any, instance_id: str) -> str:
        _ = request
        return f"/api/upstream/ws/{instance_id}"

    async def _handle_upstream_ws_proxy(self, request: Any) -> Any:
        from aiohttp import WSMsgType, web
        import aiohttp

        allowed, resp, user = await self._authorize_request(request)
        if not allowed:
            return resp
        if not self._managed_instances_enabled() or user is None:
            return web.json_response({"error": "托管实例 WebSocket 代理需要登录用户"}, status=401)

        instance_id = str(request.match_info.get("instance_id") or "")
        expected_instance_id = InstanceSpecBuilder.instance_id_for_user(user)
        if instance_id != expected_instance_id:
            return web.json_response({"error": "当前账号无权访问该实例"}, status=403)

        status, boot = await self._issue_upstream_token(user)
        if status != 200:
            return web.json_response(boot, status=status)
        port = int(boot.get("websocket_port") or boot.get("gateway_port") or 0)
        if port <= 0:
            return web.json_response({"error": "用户实例 WebSocket 端口不可用"}, status=502)

        token = str(request.rel_url.query.get("token") or boot.get("token") or "")
        client_id = str(request.rel_url.query.get("client_id") or "nanobot-channel-webui")
        path = str(boot.get("ws_path") or "/")
        upstream_url = f"ws://127.0.0.1:{port}{path}"
        upstream_params = {"client_id": client_id}
        if token:
            upstream_params["token"] = token

        client_ws = web.WebSocketResponse()
        await client_ws.prepare(request)
        try:
            async with aiohttp.ClientSession() as session:
                async with session.ws_connect(upstream_url, params=upstream_params) as upstream_ws:
                    client_to_upstream = asyncio.create_task(
                        self._proxy_websocket_messages(client_ws, upstream_ws, WSMsgType)
                    )
                    upstream_to_client = asyncio.create_task(
                        self._proxy_websocket_messages(upstream_ws, client_ws, WSMsgType)
                    )
                    done, pending = await asyncio.wait(
                        {client_to_upstream, upstream_to_client},
                        return_when=asyncio.FIRST_COMPLETED,
                    )
                    for task in pending:
                        task.cancel()
                    for task in done:
                        task.result()
        except Exception as exc:
            logger.warning("upstream websocket proxy closed: {}", exc)
        finally:
            await client_ws.close()
        return client_ws

    @staticmethod
    async def _proxy_websocket_messages(source: Any, target: Any, msg_type: Any) -> None:
        async for msg in source:
            if msg.type == msg_type.TEXT:
                await target.send_str(msg.data)
            elif msg.type == msg_type.BINARY:
                await target.send_bytes(msg.data)
            elif msg.type in (msg_type.CLOSE, msg_type.CLOSED, msg_type.ERROR):
                await target.close()
                break

    async def _handle_upstream_sessions(self, request: Any) -> Any:
        from aiohttp import web

        allowed, resp, user = await self._authorize_request(request)
        if not allowed:
            return resp
        status, payload = await self._upstream_sessions_payload_for_user(user)
        return web.json_response(payload, status=status)

    async def _upstream_sessions_payload_for_user(self, user: CurrentUser | None) -> tuple[int, dict[str, Any]]:
        status, boot = await self._issue_upstream_token(user)
        token = str(boot.get("token", "")) if status == 200 else ""
        if not token:
            return status, boot
        return await self._upstream_json(
            "/api/sessions",
            token=token,
            base_url=self._upstream_base_from_bootstrap(boot),
        )

    async def _upstream_sessions_for_user(self, user: CurrentUser | None) -> list[dict[str, Any]]:
        status, payload = await self._upstream_sessions_payload_for_user(user)
        if status != 200:
            return []
        sessions = payload.get("sessions")
        if not isinstance(sessions, list):
            return []
        return [item for item in sessions if isinstance(item, dict)]

    async def _handle_upstream_thread(self, request: Any) -> Any:
        from aiohttp import web

        allowed, resp, user = await self._authorize_request(request)
        if not allowed:
            return resp
        chat_id = request.match_info.get("chat_id", "").strip()
        if not chat_id or not is_valid_chat_id(chat_id):
            return web.json_response({"error": "无效的会话 ID"}, status=400)
        status, boot = await self._issue_upstream_token(user)
        token = str(boot.get("token", "")) if status == 200 else ""
        if not token:
            return web.json_response(boot, status=status)
        key = f"websocket:{chat_id}"
        status, payload = await self._upstream_json(
            f"/api/sessions/{key}/webui-thread",
            token=token,
            base_url=self._upstream_base_from_bootstrap(boot),
        )
        payload = self._rewrite_upstream_payload_media_urls(payload)
        return web.json_response(payload, status=status)

    async def _handle_upstream_media(self, request: Any) -> Any:
        from aiohttp import web

        payload = request.match_info.get("payload", "")
        media_path = self._public_media_path(payload)
        if media_path is None:
            return web.json_response({"error": "媒体文件不存在或已失效"}, status=404)
        content_type = mimetypes.guess_type(media_path.name)[0] or "application/octet-stream"
        return web.FileResponse(media_path, headers={"Content-Type": content_type})

    async def _handle_upstream_delete_session(self, request: Any) -> Any:
        from aiohttp import web

        allowed, resp, user = await self._authorize_request(request)
        if not allowed:
            return resp
        chat_id = request.match_info.get("chat_id", "").strip()
        if not chat_id or not is_valid_chat_id(chat_id):
            return web.json_response({"error": "无效的会话 ID"}, status=400)
        status, boot = await self._issue_upstream_token(user)
        token = str(boot.get("token", "")) if status == 200 else ""
        if not token:
            return web.json_response(boot, status=status)
        key = f"websocket:{chat_id}"
        status, payload = await self._upstream_json(
            f"/api/sessions/{key}/delete",
            token=token,
            base_url=self._upstream_base_from_bootstrap(boot),
        )
        return web.json_response(payload, status=status)

    async def _handle_skills(self, request: Any) -> Any:
        from aiohttp import web

        allowed, resp, user = await self._authorize_request(request)
        if not allowed:
            return resp
        admin_allowed, status, message = self._require_admin(user)
        if not admin_allowed:
            return web.json_response({"error": message}, status=status)

        skills = await asyncio.to_thread(self._management_for_user(user).list_skills)
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

        detail = await asyncio.to_thread(self._management_for_user(user).get_skill, name, source)
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

        detail = await asyncio.to_thread(
            self._management_for_user(user).get_skill_file,
            name,
            file_path,
            source,
        )
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
        detail = await asyncio.to_thread(
            self._management_for_user(user).set_skill_enabled,
            name,
            bool(payload["enabled"]),
            source,
        )
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

        management = self._management_for_user(user)
        snapshot = await asyncio.to_thread(management.config_snapshot)
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
            management = self._management_for_user(user)
            snapshot = await asyncio.to_thread(management.save_config, raw)
        except Exception as exc:
            return web.json_response({"error": f"保存配置失败: {exc}"}, status=400)
        return web.json_response(snapshot)

    async def _handle_runtime(self, request: Any) -> Any:
        from aiohttp import web

        allowed, resp, user = await self._authorize_request(request)
        if not allowed:
            return resp
        upstream_sessions = await self._upstream_sessions_for_user(user) if user is not None else []
        session_count = sum(
            1
            for item in upstream_sessions
            if str(item.get("key") or "").startswith("websocket:")
        )
        snapshot = await asyncio.to_thread(
            self._management_for_user(user).runtime_snapshot_for_user,
            is_admin=user.is_admin if user is not None else True,
            session_count=session_count,
        )
        return web.json_response(snapshot)

    async def _handle_audit(self, request: Any) -> Any:
        from aiohttp import web

        allowed, resp, user = await self._authorize_request(request)
        if not allowed:
            return resp

        limit_raw = request.rel_url.query.get("limit", "100")
        try:
            limit = max(1, min(500, int(limit_raw)))
        except ValueError:
            limit = 100

        audit = await asyncio.to_thread(
            self._management.audit_snapshot_for_user,
            email=user.email if user is not None else "",
            is_admin=user.is_admin if user is not None else True,
            limit=limit,
        )
        return web.json_response(audit)

    async def _handle_tenant_contracts(self, request: Any) -> Any:
        from aiohttp import web

        allowed, resp, user = await self._authorize_request(request)
        if not allowed:
            return resp
        admin_allowed, status, message = self._require_admin(user)
        if not admin_allowed:
            return web.json_response({"error": message}, status=status)

        snapshot = await asyncio.to_thread(self._management_for_user(user).tenant_contracts_snapshot)
        return web.json_response(snapshot)

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

    async def _workspace_from_upstream_thread(
        self,
        user: CurrentUser | None,
        chat_id: str,
    ) -> dict[str, Any]:
        status, boot = await self._issue_upstream_token(user)
        token = str(boot.get("token", "")) if status == 200 else ""
        if not token:
            return await asyncio.to_thread(self._workspace.load_workspace, chat_id)
        key = f"websocket:{chat_id}"
        status, payload = await self._upstream_json(
            f"/api/sessions/{key}/webui-thread",
            token=token,
            base_url=self._upstream_base_from_bootstrap(boot),
        )
        if status != 200:
            return await asyncio.to_thread(self._workspace.load_workspace, chat_id)
        media = self._media_items_from_upstream_payload(payload)
        return await asyncio.to_thread(self._record_workspace_media, chat_id, media)

    def _workspace_root_for_user(self, user: CurrentUser | None) -> Path:
        if user is None or not self._managed_instances_enabled():
            return self._workspace_root
        spec = self._managed_instance_bootstrap_service().spec_for_user(user)
        return spec.workspace.workspace.expanduser()

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

        if self._managed_instances_enabled():
            workspace = await self._workspace_from_upstream_thread(user, chat_id)
        else:
            workspace = await asyncio.to_thread(self._workspace.load_workspace, chat_id)
        return web.json_response({
            "chat_id": workspace["chat_id"],
            "updated_at": workspace["updated_at"],
            "file_count": len(workspace["files"]),
            "files": workspace["files"],
        })

    def _upload_workspace_root_for_user(self, user: CurrentUser | None) -> Path:
        return self._workspace_root_for_user(user)

    async def _handle_uploads(self, request: Any) -> Any:
        from aiohttp import web

        allowed, resp, user = await self._authorize_request(request)
        if not allowed:
            return resp

        chat_id = request.match_info.get("chat_id", "").strip()
        if not chat_id or not is_valid_upload_chat_id(chat_id):
            return web.json_response({"error": "无效的会话 ID"}, status=400)
        if chat_id != DRAFT_UPLOAD_CHAT_ID and not await self._can_access_session(user, chat_id):
            return web.json_response({"error": "无权访问此会话"}, status=404)

        reader = await request.multipart()
        uploaded: list[dict[str, str]] = []
        upload_workspace = self._upload_workspace_root_for_user(user)

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
                upload_workspace,
                user.id if user is not None else "shared",
                chat_id,
                filename,
            )
            with open(destination, "wb") as handle:
                while chunk := await part.read_chunk():
                    handle.write(chunk)

            uploaded.append({
                "path": str(destination),
                "name": upload_display_name(filename),
                "mime": part.headers.get("Content-Type", "") or mimetypes.guess_type(destination.name)[0] or "",
                "url": self._public_upload_media_url(destination),
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
