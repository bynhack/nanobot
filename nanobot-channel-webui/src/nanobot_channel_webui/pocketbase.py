"""Lightweight PocketBase client helpers for the WebUI plugin."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Literal

import aiohttp


UserRole = Literal["admin", "user"]


@dataclass(slots=True)
class PocketBaseUser:
    """Normalized user payload returned from PocketBase auth."""

    id: str
    email: str
    role: UserRole
    token: str = ""


@dataclass(slots=True)
class PocketBaseSessionRecord:
    """Session index record stored in PocketBase."""

    id: str
    owner_id: str
    chat_id: str
    session_key: str
    title: str
    preview: str
    last_activity_at: str


class PocketBaseError(RuntimeError):
    """Base PocketBase client error."""


class PocketBaseAuthError(PocketBaseError):
    """Authentication or authorization failure."""


def role_from_record(record: dict[str, Any]) -> UserRole:
    """Return the supported role value from a PocketBase record."""
    return "admin" if str(record.get("role", "")).strip() == "admin" else "user"


def user_from_auth_payload(payload: dict[str, Any]) -> PocketBaseUser:
    """Normalize a PocketBase auth payload into a plugin user."""
    record = payload.get("record")
    if not isinstance(record, dict):
        raise PocketBaseAuthError("PocketBase 响应缺少用户记录")

    user_id = str(record.get("id", "")).strip()
    if not user_id:
        raise PocketBaseAuthError("PocketBase 响应缺少用户 ID")

    return PocketBaseUser(
        id=user_id,
        email=str(record.get("email", "")).strip(),
        role=role_from_record(record),
        token=str(payload.get("token", "")).strip(),
    )


def session_record_from_payload(payload: dict[str, Any]) -> PocketBaseSessionRecord:
    """Normalize a PocketBase chat_sessions record."""
    record_id = str(payload.get("id", "")).strip()
    owner_id = str(payload.get("owner", "")).strip()
    chat_id = str(payload.get("chat_id", "")).strip()
    if not record_id or not owner_id or not chat_id:
        raise PocketBaseError("PocketBase 会话索引记录缺少必要字段")
    return PocketBaseSessionRecord(
        id=record_id,
        owner_id=owner_id,
        chat_id=chat_id,
        session_key=str(payload.get("session_key", "")).strip(),
        title=str(payload.get("title", "")).strip(),
        preview=str(payload.get("preview", "")).strip(),
        last_activity_at=str(payload.get("last_activity_at", "")).strip(),
    )


def utc_now_iso() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


class PocketBaseClient:
    """Small async REST client for PocketBase auth and session indexes."""

    def __init__(
        self,
        *,
        base_url: str,
        users_collection: str = "users",
        sessions_collection: str = "chat_sessions",
        timeout_seconds: float = 10.0,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._users_collection = users_collection
        self._sessions_collection = sessions_collection
        self._timeout = aiohttp.ClientTimeout(total=timeout_seconds)

    @property
    def enabled(self) -> bool:
        return bool(self._base_url)

    def _collection_url(self, collection: str, suffix: str) -> str:
        return f"{self._base_url}/api/collections/{collection}{suffix}"

    async def _request(
        self,
        method: str,
        path: str,
        *,
        token: str = "",
        json_body: dict[str, Any] | None = None,
        params: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        headers = {"Content-Type": "application/json"}
        if token:
            headers["Authorization"] = token
        async with aiohttp.ClientSession(timeout=self._timeout) as session:
            async with session.request(
                method,
                f"{self._base_url}{path}",
                json=json_body,
                params=params,
                headers=headers,
            ) as response:
                if response.status == 204:
                    return {}
                raw_text = await response.text()
                if not raw_text.strip():
                    return {}
                try:
                    data = await response.json(content_type=None)
                except Exception as exc:
                    raise PocketBaseError("PocketBase 返回了无效响应") from exc
                if response.status in {401, 403}:
                    message = data.get("message") if isinstance(data, dict) else "PocketBase 鉴权失败"
                    raise PocketBaseAuthError(str(message))
                if response.status >= 400:
                    message = data.get("message") if isinstance(data, dict) else "PocketBase 请求失败"
                    raise PocketBaseError(str(message))
                if not isinstance(data, dict):
                    raise PocketBaseError("PocketBase 返回了无效响应")
                return data

    async def login(self, identity: str, password: str) -> PocketBaseUser:
        payload = await self._request(
            "POST",
            f"/api/collections/{self._users_collection}/auth-with-password",
            json_body={"identity": identity, "password": password},
        )
        return user_from_auth_payload(payload)

    async def get_current_user(self, token: str) -> PocketBaseUser:
        payload = await self._request(
            "POST",
            f"/api/collections/{self._users_collection}/auth-refresh",
            token=token,
        )
        return user_from_auth_payload(payload)

    async def list_session_records(
        self,
        token: str,
        *,
        owner_id: str | None = None,
        chat_id: str | None = None,
    ) -> list[PocketBaseSessionRecord]:
        filters: list[str] = []
        if owner_id:
            filters.append(f"owner='{owner_id}'")
        if chat_id:
            filters.append(f"chat_id='{chat_id}'")
        params: dict[str, Any] = {
            "perPage": 200,
            "sort": "-last_activity_at",
            "skipTotal": "true",
        }
        if filters:
            params["filter"] = " && ".join(filters)
        payload = await self._request(
            "GET",
            f"/api/collections/{self._sessions_collection}/records",
            token=token,
            params=params,
        )
        items = payload.get("items", [])
        if not isinstance(items, list):
            return []
        return [session_record_from_payload(item) for item in items if isinstance(item, dict)]

    async def create_session_record(self, token: str, payload: dict[str, str]) -> PocketBaseSessionRecord:
        result = await self._request(
            "POST",
            f"/api/collections/{self._sessions_collection}/records",
            token=token,
            json_body=payload,
        )
        return session_record_from_payload(result)

    async def update_session_record(
        self,
        token: str,
        record_id: str,
        payload: dict[str, str],
    ) -> PocketBaseSessionRecord:
        result = await self._request(
            "PATCH",
            f"/api/collections/{self._sessions_collection}/records/{record_id}",
            token=token,
            json_body=payload,
        )
        return session_record_from_payload(result)

    async def delete_session_record(self, token: str, record_id: str) -> None:
        await self._request(
            "DELETE",
            f"/api/collections/{self._sessions_collection}/records/{record_id}",
            token=token,
        )
