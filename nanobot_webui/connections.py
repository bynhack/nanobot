"""Connection registry for WebUI browser subscriptions."""

from __future__ import annotations

from collections import defaultdict
from typing import Any

from loguru import logger


class ConnectionRegistry:
    """Track browser WebSocket subscriptions by chat id."""

    def __init__(self) -> None:
        self._chat_connections: dict[str, set[Any]] = defaultdict(set)
        self._ws_chat: dict[Any, str] = {}
        self._blocked_chats: set[str] = set()

    def chat_id_for(self, ws: Any) -> str | None:
        return self._ws_chat.get(ws)

    def subscribe(self, ws: Any, chat_id: str) -> None:
        """Bind a WebSocket to a chat subscription."""
        self.unsubscribe(ws)
        self._chat_connections[chat_id].add(ws)
        self._ws_chat[ws] = chat_id

    def unsubscribe(self, ws: Any) -> None:
        """Remove a WebSocket from any active subscription."""
        chat_id = self._ws_chat.pop(ws, None)
        if not chat_id:
            return
        connections = self._chat_connections.get(chat_id)
        if not connections:
            return
        connections.discard(ws)
        if not connections:
            self._chat_connections.pop(chat_id, None)

    async def close_all(self) -> None:
        """Close all tracked connections."""
        seen: set[Any] = set()
        for connections in list(self._chat_connections.values()):
            for ws in list(connections):
                if ws in seen:
                    continue
                seen.add(ws)
                try:
                    await ws.close()
                except Exception:
                    logger.debug("Failed to close WebUI websocket")
        self._chat_connections.clear()
        self._ws_chat.clear()

    async def emit_to_ws(self, ws: Any, payload: dict[str, Any]) -> bool:
        """Send one JSON payload to a websocket if still open."""
        if ws.closed:
            self.unsubscribe(ws)
            return False
        try:
            await ws.send_json(payload)
            return True
        except Exception:
            self.unsubscribe(ws)
            return False

    async def emit_to_chat(self, chat_id: str, payload: dict[str, Any]) -> None:
        """Broadcast an event to all subscribers of a chat."""
        if chat_id in self._blocked_chats:
            return
        for ws in list(self._chat_connections.get(chat_id, ())):
            await self.emit_to_ws(ws, payload)

    async def delete_chat(self, chat_id: str, payload: dict[str, Any]) -> None:
        """Notify and detach subscribers for a deleted chat."""
        self._blocked_chats.add(chat_id)
        for ws in list(self._chat_connections.get(chat_id, ())):
            await self.emit_to_ws(ws, payload)
            self.unsubscribe(ws)

    def mark_active(self, chat_id: str) -> None:
        """Allow deliveries for an active chat id."""
        self._blocked_chats.discard(chat_id)

    def is_blocked(self, chat_id: str) -> bool:
        """Return whether deliveries are blocked for a deleted chat."""
        return chat_id in self._blocked_chats
