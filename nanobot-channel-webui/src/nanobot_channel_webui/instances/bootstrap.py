"""Bootstrap payloads for connecting WebUI clients to managed instances."""

from __future__ import annotations

import asyncio
from typing import Any

from ..user_context import CurrentUser


class ManagedInstanceBootstrapService:
    """Start a user's managed instance and return websocket connection metadata."""

    def __init__(
        self,
        *,
        builder: Any,
        manager: Any,
        base_config: Any,
        bootstrap_client: Any | None = None,
    ) -> None:
        self._builder = builder
        self._manager = manager
        self._base_config = base_config
        self._bootstrap_client = bootstrap_client or _fetch_gateway_bootstrap

    async def bootstrap_for_user(self, user: CurrentUser) -> dict[str, Any]:
        spec = self.spec_for_user(user)
        await self._manager.start_instance(spec)
        websocket = getattr(spec.config.channels, "websocket", {})
        host = str(websocket.get("host") or "127.0.0.1")
        port = int(websocket.get("port") or spec.config.gateway.port)
        path = str(websocket.get("path") or "/")
        static_token = str(websocket.get("token") or "")
        payload = await self._bootstrap_client(
            host=host,
            port=port,
            token=static_token,
        )
        token = str(payload.get("token") or static_token)
        return {
            "instance_id": spec.instance_id,
            "ws_url": str(payload.get("ws_url") or f"ws://{host}:{port}{path}"),
            "ws_path": str(payload.get("ws_path") or path),
            "token": token,
            "gateway_port": int(spec.config.gateway.port),
            "websocket_port": port,
            "expires_in": payload.get("expires_in"),
            "runtime_surface": payload.get("runtime_surface"),
            "runtime_capabilities": payload.get("runtime_capabilities"),
        }

    def spec_for_user(self, user: CurrentUser) -> Any:
        return self._builder.build_for_user(user, self._base_config)

    def bootstrap_for_user_sync_for_test(self, user: CurrentUser) -> dict[str, Any]:
        return asyncio.run(self.bootstrap_for_user(user))


async def _fetch_gateway_bootstrap(
    *,
    host: str,
    port: int,
    token: str,
    attempts: int = 60,
    delay_s: float = 0.2,
) -> dict[str, Any]:
    """Ask the managed websocket channel for a short-lived WebUI/API token."""

    import aiohttp

    url = f"http://{host}:{port}/webui/bootstrap"
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    last_error = ""
    for attempt in range(attempts):
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(url, headers=headers) as response:
                    payload = await response.json(content_type=None)
                    if response.status == 200 and isinstance(payload, dict):
                        return payload
                    detail = payload.get("error") if isinstance(payload, dict) else payload
                    last_error = f"HTTP {response.status}: {detail}"
        except Exception as exc:
            last_error = str(exc)
        if attempt < attempts - 1:
            await asyncio.sleep(delay_s)
    raise RuntimeError(f"托管实例 WebUI bootstrap 失败: {last_error or 'unknown error'}")
