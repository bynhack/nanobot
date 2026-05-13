from __future__ import annotations

import importlib.util
from pathlib import Path

MODULE_PATH = (
    Path(__file__).resolve().parents[1]
    / "src"
    / "nanobot_channel_webui"
    / "session_workspace.py"
)
MODULE_SPEC = importlib.util.spec_from_file_location("test_session_workspace_module", MODULE_PATH)
assert MODULE_SPEC is not None
assert MODULE_SPEC.loader is not None
MODULE = importlib.util.module_from_spec(MODULE_SPEC)
MODULE_SPEC.loader.exec_module(MODULE)

SessionWorkspaceService = MODULE.SessionWorkspaceService


def test_records_delivered_files_per_chat(tmp_path: Path) -> None:
    service = SessionWorkspaceService(tmp_path)

    workspace = service.record_deliveries(
        "chat-1",
        [
            {
                "name": "report.docx",
                "url": "/media/token-1",
                "mime": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            }
        ],
    )

    assert workspace["chat_id"] == "chat-1"
    assert len(workspace["files"]) == 1
    assert workspace["files"][0] == {
        "id": workspace["files"][0]["id"],
        "name": "report.docx",
        "url": "/media/token-1",
        "mime": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "delivered_at": workspace["files"][0]["delivered_at"],
    }


def test_deduplicates_same_file_by_url_and_name(tmp_path: Path) -> None:
    service = SessionWorkspaceService(tmp_path)

    service.record_deliveries(
        "chat-1",
        [{"name": "report.docx", "url": "/media/token-1", "mime": "application/docx"}],
    )
    workspace = service.record_deliveries(
        "chat-1",
        [{"name": "report.docx", "url": "/media/token-1", "mime": "application/docx"}],
    )

    assert len(workspace["files"]) == 1


def test_persists_workspace_file_under_plugin_directory(tmp_path: Path) -> None:
    service = SessionWorkspaceService(tmp_path)
    chat_id = "../chat-1/nested"

    service.record_deliveries(
        chat_id,
        [{"name": "report.docx", "url": "/media/token-1", "mime": "application/docx"}],
    )

    files = list((tmp_path / ".nanobot_channel_webui" / "workspaces").glob("*.json"))

    assert len(files) == 1
    assert files[0].parent == tmp_path / ".nanobot_channel_webui" / "workspaces"
    assert tmp_path.resolve() in files[0].resolve().parents
    assert ".." not in files[0].name
    assert "/" not in files[0].name


def test_sorts_files_by_delivered_at_descending(tmp_path: Path) -> None:
    service = SessionWorkspaceService(tmp_path)

    workspace = service.record_deliveries(
        "chat-1",
        [
            {
                "name": "older.txt",
                "url": "/media/token-1",
                "mime": "text/plain",
                "delivered_at": "2026-05-13T10:00:00+00:00",
            },
            {
                "name": "newer.txt",
                "url": "/media/token-2",
                "mime": "text/plain",
                "delivered_at": "2026-05-13T11:00:00+00:00",
            },
        ],
    )

    assert [item["name"] for item in workspace["files"]] == ["newer.txt", "older.txt"]


def test_sorts_files_by_mixed_timezone_offsets(tmp_path: Path) -> None:
    service = SessionWorkspaceService(tmp_path)

    workspace = service.record_deliveries(
        "chat-1",
        [
            {
                "name": "utc-plus-8.txt",
                "url": "/media/token-1",
                "mime": "text/plain",
                "delivered_at": "2026-05-13T10:30:00+08:00",
            },
            {
                "name": "utc.txt",
                "url": "/media/token-2",
                "mime": "text/plain",
                "delivered_at": "2026-05-13T03:00:00+00:00",
            },
        ],
    )

    assert [item["name"] for item in workspace["files"]] == ["utc.txt", "utc-plus-8.txt"]


def test_returns_empty_workspace_for_corrupt_json(tmp_path: Path) -> None:
    service = SessionWorkspaceService(tmp_path)
    path = service._path_for_chat("chat-1")
    path.write_text("{broken", encoding="utf-8")

    workspace = service.load_workspace("chat-1")

    assert workspace["chat_id"] == "chat-1"
    assert workspace["updated_at"] is None
    assert workspace["files"] == []
