from __future__ import annotations

import importlib.util
import asyncio
import sys
import types
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


def _load_channel_module() -> types.ModuleType:
    package_name = "nanobot_channel_webui"
    patched_modules = [
        package_name,
        f"{package_name}.session_workspace",
        "loguru",
        "nanobot.agent.hook",
        "nanobot.bus.events",
        "nanobot.bus.queue",
        "nanobot.channels.base",
        f"{package_name}.auth",
        f"{package_name}.config",
        f"{package_name}.instances",
        f"{package_name}.management",
        f"{package_name}.media",
        f"{package_name}.supabase_account",
        f"{package_name}.user_context",
        f"{package_name}.uploads",
        f"{package_name}.channel",
    ]
    originals = {name: sys.modules.get(name) for name in patched_modules}
    package = types.ModuleType(package_name)
    package.__path__ = [str(MODULE_PATH.parent)]
    sys.modules[package_name] = package
    sys.modules[f"{package_name}.session_workspace"] = MODULE

    loguru_module = types.ModuleType("loguru")
    loguru_module.logger = types.SimpleNamespace(info=lambda *args, **kwargs: None, warning=lambda *args, **kwargs: None, error=lambda *args, **kwargs: None)
    sys.modules["loguru"] = loguru_module

    hook_module = types.ModuleType("nanobot.agent.hook")
    hook_module.AgentHook = type("AgentHook", (), {})
    hook_module.AgentHookContext = type("AgentHookContext", (), {})
    sys.modules["nanobot.agent.hook"] = hook_module

    events_module = types.ModuleType("nanobot.bus.events")
    events_module.OutboundMessage = type("OutboundMessage", (), {})
    sys.modules["nanobot.bus.events"] = events_module

    queue_module = types.ModuleType("nanobot.bus.queue")
    queue_module.MessageBus = type("MessageBus", (), {})
    sys.modules["nanobot.bus.queue"] = queue_module

    channels_base_module = types.ModuleType("nanobot.channels.base")
    channels_base_module.BaseChannel = type("BaseChannel", (), {})
    sys.modules["nanobot.channels.base"] = channels_base_module

    auth_module = types.ModuleType(f"{package_name}.auth")
    auth_module.WebUIAccessControl = type("WebUIAccessControl", (), {})
    sys.modules[f"{package_name}.auth"] = auth_module

    config_module = types.ModuleType(f"{package_name}.config")
    config_module.CHANNEL_NAME = "webui"
    config_module.WebUIConfig = type("WebUIConfig", (), {"model_validate": classmethod(lambda cls, value: value)})
    sys.modules[f"{package_name}.config"] = config_module

    instances_module = types.ModuleType(f"{package_name}.instances")
    instances_module.InstanceSpecBuilder = type("InstanceSpecBuilder", (), {})
    instances_module.InstanceSpecBuilderOptions = type("InstanceSpecBuilderOptions", (), {})
    instances_module.ManagedInstanceBootstrapService = type("ManagedInstanceBootstrapService", (), {})
    instances_module.ManagedInstanceManager = type("ManagedInstanceManager", (), {})
    instances_module.discover_packaged_skill_catalog = lambda *args, **kwargs: []
    instances_module.refresh_managed_skill_links = lambda *args, **kwargs: []
    sys.modules[f"{package_name}.instances"] = instances_module

    management_module = types.ModuleType(f"{package_name}.management")
    management_module.WebUIManagementService = type("WebUIManagementService", (), {})
    sys.modules[f"{package_name}.management"] = management_module

    media_module = types.ModuleType(f"{package_name}.media")
    media_module.MediaService = type("MediaService", (), {})
    sys.modules[f"{package_name}.media"] = media_module

    supabase_module = types.ModuleType(f"{package_name}.supabase_account")
    supabase_module.SupabaseAccountClient = type("SupabaseAccountClient", (), {})
    sys.modules[f"{package_name}.supabase_account"] = supabase_module

    user_context_module = types.ModuleType(f"{package_name}.user_context")
    user_context_module.CurrentUser = type("CurrentUser", (), {})
    user_context_module.bind_current_user = lambda user: types.SimpleNamespace(__enter__=lambda self: None, __exit__=lambda self, exc_type, exc, tb: False)
    sys.modules[f"{package_name}.user_context"] = user_context_module

    uploads_module = types.ModuleType(f"{package_name}.uploads")
    uploads_module.attachment_prompt_suffix = lambda *args, **kwargs: ""
    uploads_module.next_upload_path = lambda *args, **kwargs: Path("/tmp/uploaded")
    uploads_module.upload_display_name = lambda filename: filename or "upload.bin"
    sys.modules[f"{package_name}.uploads"] = uploads_module

    channel_path = MODULE_PATH.parent / "channel.py"
    channel_spec = importlib.util.spec_from_file_location(f"{package_name}.channel", channel_path)
    assert channel_spec is not None
    assert channel_spec.loader is not None
    channel_module = importlib.util.module_from_spec(channel_spec)
    sys.modules[f"{package_name}.channel"] = channel_module
    channel_spec.loader.exec_module(channel_module)
    for name, original in originals.items():
        if original is None:
            sys.modules.pop(name, None)
        else:
            sys.modules[name] = original
    return channel_module


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


def test_workspace_record_helper_filters_invalid_media(tmp_path: Path) -> None:
    channel_module = _load_channel_module()
    service = SessionWorkspaceService(tmp_path)
    channel = channel_module.WebUIChannel.__new__(channel_module.WebUIChannel)
    channel._workspace = service

    workspace = channel._record_workspace_media(
        "chat-1",
        [
            {"name": "kept.txt", "url": "/media/good", "mime": "text/plain"},
            {"name": "missing-url.txt", "mime": "text/plain"},
            {"url": "/media/missing-name", "mime": "text/plain"},
            {"name": "blank-url.txt", "url": "   ", "mime": "text/plain"},
        ],
    )

    assert workspace["chat_id"] == "chat-1"
    assert [item["name"] for item in workspace["files"]] == ["kept.txt"]
    assert workspace["files"][0]["url"] == "/media/good"


def test_workspace_record_helper_skips_persist_when_no_valid_media(tmp_path: Path) -> None:
    channel_module = _load_channel_module()
    service = SessionWorkspaceService(tmp_path)
    channel = channel_module.WebUIChannel.__new__(channel_module.WebUIChannel)
    channel._workspace = service

    workspace = channel._record_workspace_media(
        "chat-1",
        [{"name": "missing-url.txt"}, {"url": "/media/missing-name"}],
    )

    assert workspace["chat_id"] == "chat-1"
    assert workspace["files"] == []
    assert service._path_for_chat("chat-1").exists() is False


def test_workspace_route_returns_chat_payload(monkeypatch, tmp_path: Path) -> None:
    channel_module = _load_channel_module()
    service = SessionWorkspaceService(tmp_path)
    chat_id = "f1f2a35e-7dfa-4c87-afc2-7b1ef49224be"
    service.record_deliveries(
        chat_id,
        [{"name": "report.docx", "url": "/media/token-1", "mime": "application/docx"}],
    )

    class FakeWeb:
        @staticmethod
        def json_response(payload: dict[str, object], status: int = 200) -> types.SimpleNamespace:
            return types.SimpleNamespace(status=status, payload=payload)

    monkeypatch.setitem(sys.modules, "aiohttp", types.SimpleNamespace(web=FakeWeb))

    channel = channel_module.WebUIChannel.__new__(channel_module.WebUIChannel)
    channel._workspace = service

    async def authorize(request: object) -> tuple[bool, None, None]:
        return True, None, None

    access_checks: list[tuple[object | None, str]] = []

    async def can_access(current_user: object | None, chat_id: str) -> bool:
        access_checks.append((current_user, chat_id))
        return True

    channel._authorize_request = authorize
    channel._can_access_session = can_access

    request = types.SimpleNamespace(match_info={"chat_id": chat_id})
    response = asyncio.run(channel._handle_workspace(request))

    assert access_checks == [(None, chat_id)]
    assert response.status == 200
    assert response.payload["chat_id"] == chat_id
    assert response.payload["file_count"] == 1
    assert response.payload["updated_at"] is not None
    assert response.payload["files"][0]["name"] == "report.docx"


def test_workspace_route_rejects_forbidden_session(monkeypatch, tmp_path: Path) -> None:
    channel_module = _load_channel_module()
    service = SessionWorkspaceService(tmp_path)
    chat_id = "f1f2a35e-7dfa-4c87-afc2-7b1ef49224be"
    service.record_deliveries(
        chat_id,
        [{"name": "secret.txt", "url": "/media/secret", "mime": "text/plain"}],
    )

    class FakeWeb:
        @staticmethod
        def json_response(payload: dict[str, object], status: int = 200) -> types.SimpleNamespace:
            return types.SimpleNamespace(status=status, payload=payload)

    monkeypatch.setitem(sys.modules, "aiohttp", types.SimpleNamespace(web=FakeWeb))

    channel = channel_module.WebUIChannel.__new__(channel_module.WebUIChannel)
    channel._workspace = service

    user = types.SimpleNamespace(id="user-1")

    async def authorize(request: object) -> tuple[bool, None, object]:
        return True, None, user

    async def can_access(current_user: object, chat_id: str) -> bool:
        assert current_user is user
        assert chat_id == "f1f2a35e-7dfa-4c87-afc2-7b1ef49224be"
        return False

    channel._authorize_request = authorize
    channel._can_access_session = can_access

    request = types.SimpleNamespace(match_info={"chat_id": chat_id})
    response = asyncio.run(channel._handle_workspace(request))

    assert response.status == 404
    assert response.payload == {"error": "无权访问此会话"}
    assert "files" not in response.payload


def test_send_records_workspace_without_local_emit(tmp_path: Path) -> None:
    channel_module = _load_channel_module()
    service = SessionWorkspaceService(tmp_path)
    channel = channel_module.WebUIChannel.__new__(channel_module.WebUIChannel)
    channel._workspace = service
    channel._media = types.SimpleNamespace(
        build_media_items=lambda media: [{"name": "kept.txt", "url": "/media/good", "mime": "text/plain"}]
    )

    msg = types.SimpleNamespace(
        chat_id="chat-1",
        content="hello",
        buttons=None,
        media=["/tmp/kept.txt"],
    )

    asyncio.run(channel.send(msg))

    workspace = service.load_workspace("chat-1")
    assert [item["name"] for item in workspace["files"]] == ["kept.txt"]


def test_send_skips_workspace_when_no_media_items(tmp_path: Path) -> None:
    channel_module = _load_channel_module()
    service = SessionWorkspaceService(tmp_path)
    channel = channel_module.WebUIChannel.__new__(channel_module.WebUIChannel)
    channel._workspace = service
    channel._media = types.SimpleNamespace(build_media_items=lambda media: [])

    msg = types.SimpleNamespace(
        chat_id="chat-1",
        content="hello",
        buttons=None,
        media=["/tmp/kept.txt"],
    )

    asyncio.run(channel.send(msg))

    assert service._path_for_chat("chat-1").exists() is False
