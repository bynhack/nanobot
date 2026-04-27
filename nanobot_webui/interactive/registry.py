"""Pending interaction registry and runtime persistence for WebUI."""

from __future__ import annotations

import asyncio
import json
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Awaitable, Callable


@dataclass(slots=True)
class PendingInteraction:
    id: str
    session_key: str
    chat_id: str
    kind: str
    payload: dict[str, Any]
    created_at: float
    future: asyncio.Future[Any] | None = None

    def to_record(self) -> dict[str, Any]:
        return {
          "id": self.id,
          "session_key": self.session_key,
          "chat_id": self.chat_id,
          "kind": self.kind,
          "payload": self.payload,
          "created_at": self.created_at,
        }


class InteractionRegistry:
    """Manage pending interactions and persist recovery metadata."""

    def __init__(
        self,
        workspace: Path,
        emit_callback: Callable[[str, dict[str, Any]], Awaitable[None]],
    ) -> None:
        self._workspace = workspace
        self._emit_callback = emit_callback
        self._pending: dict[str, PendingInteraction] = {}
        self._store_path = workspace / ".nanobot_webui_runtime" / "pending_interactions.json"
        self._store_path.parent.mkdir(parents=True, exist_ok=True)
        self._restore_store()

    def _restore_store(self) -> None:
        records = self.load_records()
        self._pending = {
            record["id"]: PendingInteraction(
                id=record["id"],
                session_key=record["session_key"],
                chat_id=record["chat_id"],
                kind=record["kind"],
                payload=dict(record["payload"]),
                created_at=float(record["created_at"]),
                future=None,
            )
            for record in records
        }

    def _flush_store(self) -> None:
        self._store_path.write_text(
            json.dumps([pending.to_record() for pending in self._pending.values()], ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )

    def load_records(self) -> list[dict[str, Any]]:
        if not self._store_path.exists():
            return []
        try:
            payload = json.loads(self._store_path.read_text(encoding="utf-8"))
        except Exception:
            return []
        if not isinstance(payload, list):
            return []
        return [item for item in payload if isinstance(item, dict) and item.get("id")]

    def get_pending_for_session(self, session_key: str) -> PendingInteraction | None:
        for pending in self._pending.values():
            if pending.session_key == session_key and pending.future is not None and not pending.future.done():
                return pending
        return None

    def get(self, interaction_id: str) -> PendingInteraction | None:
        return self._pending.get(interaction_id)

    def create(
        self,
        *,
        session_key: str,
        chat_id: str,
        kind: str,
        payload: dict[str, Any],
    ) -> PendingInteraction:
        existing = self.get_pending_for_session(session_key)
        if existing is not None:
            raise RuntimeError(f"pending interaction already exists for session {session_key}")
        interaction_id = f"int_{uuid.uuid4().hex[:12]}"
        pending = PendingInteraction(
            id=interaction_id,
            session_key=session_key,
            chat_id=chat_id,
            kind=kind,
            payload=payload,
            created_at=time.time(),
            future=asyncio.get_running_loop().create_future(),
        )
        self._pending[pending.id] = pending
        self._flush_store()
        return pending

    async def emit_request(self, pending: PendingInteraction) -> None:
        await self._emit_callback(
            pending.chat_id,
            {
                "type": "interactive.request",
                "chatId": pending.chat_id,
                "sessionKey": pending.session_key,
                "id": pending.id,
                "kind": pending.kind,
                "payload": pending.payload,
                "createdAt": pending.created_at,
            },
        )

    async def resolve(self, interaction_id: str, result: Any) -> bool:
        pending = self._pending.pop(interaction_id, None)
        if pending is None:
            return False
        self._flush_store()
        if pending.future is None or pending.future.done():
            return False
        pending.future.set_result(result)
        return True

    async def cancel(self, interaction_id: str) -> bool:
        pending = self._pending.pop(interaction_id, None)
        if pending is None:
            return False
        self._flush_store()
        if pending.future is None or pending.future.done():
            return False
        pending.future.set_exception(asyncio.CancelledError(f"interaction {interaction_id} cancelled"))
        return True

    async def close(self) -> None:
        for interaction_id in list(self._pending.keys()):
            await self.cancel(interaction_id)
