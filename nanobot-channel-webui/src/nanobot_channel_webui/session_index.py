"""PocketBase-backed session index helpers."""

from __future__ import annotations

from typing import Protocol

from .pocketbase import PocketBaseSessionRecord, utc_now_iso
from .pocketbase import PocketBaseUser
from .user_context import CurrentUser


class SessionIndexClient(Protocol):
    async def list_session_records(
        self,
        token: str,
        *,
        owner_id: str | None = None,
        chat_id: str | None = None,
    ) -> list[PocketBaseSessionRecord]: ...

    async def create_session_record(self, token: str, payload: dict[str, str]) -> PocketBaseSessionRecord: ...

    async def update_session_record(
        self,
        token: str,
        record_id: str,
        payload: dict[str, str],
    ) -> PocketBaseSessionRecord: ...

    async def delete_session_record(self, token: str, record_id: str) -> None: ...


class SessionIndexService:
    """Maintain the PocketBase chat_sessions index."""

    def __init__(self, client: SessionIndexClient) -> None:
        self._client = client

    @staticmethod
    def _is_admin(user: CurrentUser | PocketBaseUser) -> bool:
        return user.role == "admin"

    async def list_for_user(self, user: CurrentUser | PocketBaseUser) -> list[PocketBaseSessionRecord]:
        owner_id = None if self._is_admin(user) else user.id
        records = await self._client.list_session_records(user.token, owner_id=owner_id)
        return sorted(records, key=lambda item: item.last_activity_at or "", reverse=True)

    async def get_for_user(self, user: CurrentUser | PocketBaseUser, chat_id: str) -> PocketBaseSessionRecord | None:
        records = await self._client.list_session_records(
            user.token,
            owner_id=None if self._is_admin(user) else user.id,
            chat_id=chat_id,
        )
        return records[0] if records else None

    async def touch_session(
        self,
        user: CurrentUser | PocketBaseUser,
        *,
        chat_id: str,
        session_key: str,
        title: str,
        preview: str,
    ) -> PocketBaseSessionRecord:
        record = await self.get_for_user(user, chat_id)
        payload = {
            "owner": user.id,
            "chat_id": chat_id,
            "session_key": session_key,
            "title": title,
            "preview": preview,
            "last_activity_at": utc_now_iso(),
        }
        if record is None:
            return await self._client.create_session_record(user.token, payload)
        return await self._client.update_session_record(
            user.token,
            record.id,
            {
                "title": payload["title"],
                "preview": payload["preview"],
                "last_activity_at": payload["last_activity_at"],
            },
        )

    async def delete_for_user(self, user: CurrentUser | PocketBaseUser, chat_id: str) -> bool:
        record = await self.get_for_user(user, chat_id)
        if record is None:
            return False
        await self._client.delete_session_record(user.token, record.id)
        return True
