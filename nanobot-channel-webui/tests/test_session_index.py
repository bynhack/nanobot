from __future__ import annotations

import pytest

from nanobot_channel_webui.pocketbase import PocketBaseSessionRecord, PocketBaseUser
from nanobot_channel_webui.session_index import SessionIndexService


class _FakePocketBaseClient:
    def __init__(self) -> None:
        self.records = [
            PocketBaseSessionRecord(
                id="s1",
                owner_id="u1",
                chat_id="chat-a",
                session_key="webui_plugin:chat-a",
                title="A",
                preview="hello",
                last_activity_at="2026-05-10T10:00:00Z",
            ),
            PocketBaseSessionRecord(
                id="s2",
                owner_id="u2",
                chat_id="chat-b",
                session_key="webui_plugin:chat-b",
                title="B",
                preview="world",
                last_activity_at="2026-05-10T11:00:00Z",
            ),
        ]
        self.created_payloads: list[dict[str, str]] = []
        self.updated_payloads: list[tuple[str, dict[str, str]]] = []
        self.deleted_ids: list[str] = []

    async def list_session_records(
        self,
        token: str,
        *,
        owner_id: str | None = None,
        chat_id: str | None = None,
    ) -> list[PocketBaseSessionRecord]:
        records = list(self.records)
        if owner_id is not None:
            records = [record for record in records if record.owner_id == owner_id]
        if chat_id is not None:
            records = [record for record in records if record.chat_id == chat_id]
        return records

    async def create_session_record(self, token: str, payload: dict[str, str]) -> PocketBaseSessionRecord:
        self.created_payloads.append(payload)
        record = PocketBaseSessionRecord(
            id="new",
            owner_id=payload["owner"],
            chat_id=payload["chat_id"],
            session_key=payload["session_key"],
            title=payload["title"],
            preview=payload["preview"],
            last_activity_at=payload["last_activity_at"],
        )
        self.records.append(record)
        return record

    async def update_session_record(self, token: str, record_id: str, payload: dict[str, str]) -> PocketBaseSessionRecord:
        self.updated_payloads.append((record_id, payload))
        for index, record in enumerate(self.records):
            if record.id != record_id:
                continue
            updated = PocketBaseSessionRecord(
                id=record.id,
                owner_id=record.owner_id,
                chat_id=record.chat_id,
                session_key=record.session_key,
                title=payload.get("title", record.title),
                preview=payload.get("preview", record.preview),
                last_activity_at=payload.get("last_activity_at", record.last_activity_at),
            )
            self.records[index] = updated
            return updated
        raise AssertionError("missing record")

    async def delete_session_record(self, token: str, record_id: str) -> None:
        self.deleted_ids.append(record_id)
        self.records = [record for record in self.records if record.id != record_id]


def _user(user_id: str, role: str = "user") -> PocketBaseUser:
    return PocketBaseUser(id=user_id, email=f"{user_id}@example.com", role=role, token=f"token-{user_id}")


@pytest.mark.asyncio
async def test_session_index_filters_records_for_regular_user() -> None:
    service = SessionIndexService(_FakePocketBaseClient())

    records = await service.list_for_user(_user("u1"))

    assert [record.chat_id for record in records] == ["chat-a"]


@pytest.mark.asyncio
async def test_session_index_returns_all_records_for_admin() -> None:
    service = SessionIndexService(_FakePocketBaseClient())

    records = await service.list_for_user(_user("admin", role="admin"))

    assert [record.chat_id for record in records] == ["chat-b", "chat-a"]


@pytest.mark.asyncio
async def test_session_index_touch_updates_existing_record() -> None:
    client = _FakePocketBaseClient()
    service = SessionIndexService(client)

    await service.touch_session(
        _user("u1"),
        chat_id="chat-a",
        session_key="webui_plugin:chat-a",
        title="Updated",
        preview="fresh",
    )

    assert client.created_payloads == []
    assert client.updated_payloads
    assert client.updated_payloads[0][0] == "s1"
    assert client.updated_payloads[0][1]["preview"] == "fresh"


@pytest.mark.asyncio
async def test_session_index_touch_creates_new_record() -> None:
    client = _FakePocketBaseClient()
    service = SessionIndexService(client)

    await service.touch_session(
        _user("u3"),
        chat_id="chat-c",
        session_key="webui_plugin:chat-c",
        title="New",
        preview="hello",
    )

    assert client.created_payloads[0]["owner"] == "u3"
    assert client.created_payloads[0]["chat_id"] == "chat-c"


@pytest.mark.asyncio
async def test_session_index_deletes_only_owned_record_for_regular_user() -> None:
    client = _FakePocketBaseClient()
    service = SessionIndexService(client)

    deleted = await service.delete_for_user(_user("u1"), "chat-a")

    assert deleted is True
    assert client.deleted_ids == ["s1"]
