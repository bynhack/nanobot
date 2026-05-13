"""HTTP and WebSocket access control helpers for WebUI."""

from __future__ import annotations

from typing import Any

from .pocketbase import PocketBaseAuthError, PocketBaseClient, PocketBaseError
from .user_context import CurrentUser


class WebUIAccessControl:
    """Apply shared token and origin checks across WebUI endpoints."""

    def __init__(
        self,
        *,
        allowed_origins: list[str],
        auth_token: str,
        pocketbase: PocketBaseClient | None = None,
    ) -> None:
        self._allowed_origins = [origin.rstrip("/") for origin in allowed_origins if origin]
        self._auth_token = auth_token.strip()
        self._pocketbase = pocketbase

    @property
    def auth_required(self) -> bool:
        return bool(self._auth_token or (self._pocketbase and self._pocketbase.enabled))

    @property
    def auth_mode(self) -> str:
        if self._pocketbase and self._pocketbase.enabled:
            return "pocketbase"
        if self._auth_token:
            return "token"
        return "none"

    def extract_token(self, request: Any) -> str:
        auth_header = request.headers.get("Authorization", "").strip()
        if auth_header.lower().startswith("bearer "):
            return auth_header[7:].strip()
        return (
            request.headers.get("X-WebUI-Token", "").strip()
            or request.rel_url.query.get("token", "").strip()
            or request.rel_url.query.get("auth_token", "").strip()
        )

    def is_origin_allowed(self, request: Any) -> bool:
        origin = request.headers.get("Origin", "").rstrip("/")
        if not origin:
            return True
        if "*" in self._allowed_origins:
            return True
        if self._allowed_origins:
            return origin in self._allowed_origins
        return origin == f"{request.scheme}://{request.host}".rstrip("/")

    async def authorize(self, request: Any) -> tuple[bool, int, str, CurrentUser | None]:
        if not self.is_origin_allowed(request):
            return False, 403, "当前来源未被允许访问", None

        token = self.extract_token(request)
        if self._pocketbase and self._pocketbase.enabled:
            if not token:
                return False, 401, "未登录或登录已失效", None
            try:
                user = await self._pocketbase.get_current_user(token)
            except PocketBaseAuthError as exc:
                return False, 401, str(exc) or "登录已失效", None
            except PocketBaseError as exc:
                return False, 502, str(exc) or "PocketBase 服务不可用", None
            return True, 200, "", CurrentUser.from_pocketbase_user(user)

        if self._auth_token and token != self._auth_token:
            return False, 401, "认证令牌无效", None
        return True, 200, "", None
