"""HTTP and WebSocket access control helpers for WebUI."""

from __future__ import annotations

from typing import Any


class WebUIAccessControl:
    """Apply shared token and origin checks across WebUI endpoints."""

    def __init__(self, *, allowed_origins: list[str], auth_token: str) -> None:
        self._allowed_origins = [origin.rstrip("/") for origin in allowed_origins if origin]
        self._auth_token = auth_token.strip()

    @property
    def auth_required(self) -> bool:
        return bool(self._auth_token)

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

    def authorize(self, request: Any) -> tuple[bool, int, str]:
        if not self.is_origin_allowed(request):
            return False, 403, "当前来源未被允许访问"
        if self.auth_required and self.extract_token(request) != self._auth_token:
            return False, 401, "认证令牌无效"
        return True, 200, ""
