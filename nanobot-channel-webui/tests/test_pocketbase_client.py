from __future__ import annotations

from nanobot_channel_webui.config import WebUIConfig
from nanobot_channel_webui.channel import _resolve_webui_title
from nanobot_channel_webui.pocketbase import PocketBaseClient, PocketBaseUser, role_from_record, user_from_auth_payload


def test_webui_config_accepts_pocketbase_settings() -> None:
    config = WebUIConfig.model_validate({
        "enabled": True,
        "pocketbaseUrl": "http://127.0.0.1:8090",
        "pocketbaseUsersCollection": "users",
        "pocketbaseSessionsCollection": "chat_sessions",
    })

    assert str(config.pocketbase_url) == "http://127.0.0.1:8090/"
    assert config.pocketbase_users_collection == "users"
    assert config.pocketbase_sessions_collection == "chat_sessions"


def test_webui_config_accepts_conversation_ui_settings() -> None:
    config = WebUIConfig.model_validate({
        "enabled": True,
        "ui": {
            "welcomeTitle": "开始处理任务",
            "welcomeSubtitle": "选择一个入口或直接输入问题",
            "composerPlaceholder": "请输入你想处理的内容",
            "compactComposerPlaceholder": "发消息",
            "conversationStarters": [
                {
                    "title": "总结材料",
                    "label": "提炼重点和待办",
                    "prompt": "请总结这份材料",
                },
            ],
        },
    })

    assert config.ui.welcome_title == "开始处理任务"
    assert config.ui.composer_placeholder == "请输入你想处理的内容"
    assert config.ui.conversation_starters[0].prompt == "请总结这份材料"
    assert config.ui.model_dump(by_alias=True)["composerPlaceholder"] == "请输入你想处理的内容"


def test_resolve_webui_title_prefers_explicit_config(monkeypatch) -> None:
    monkeypatch.setenv("NANOBOT_WEBUI_TITLE", "小小助手")
    assert _resolve_webui_title("业务助手") == "业务助手"


def test_resolve_webui_title_falls_back_to_env(monkeypatch) -> None:
    monkeypatch.setenv("NANOBOT_WEBUI_TITLE", "小小助手")
    assert _resolve_webui_title("") == "小小助手"


def test_role_from_record_defaults_to_user() -> None:
    assert role_from_record({"id": "u1"}) == "user"
    assert role_from_record({"id": "u1", "role": "admin"}) == "admin"


def test_parse_current_user_from_login_payload() -> None:
    user = user_from_auth_payload({
        "token": "abc",
        "record": {
            "id": "u1",
            "email": "admin@example.com",
            "role": "admin",
        },
    })

    assert user == PocketBaseUser(
        id="u1",
        email="admin@example.com",
        role="admin",
        token="abc",
    )


def test_pocketbase_delete_allows_empty_204_response() -> None:
    class _Response:
        status = 204

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def text(self) -> str:
            return ""

    class _Session:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        def request(self, *args, **kwargs):
            return _Response()

    import nanobot_channel_webui.pocketbase as pocketbase_module
    original = pocketbase_module.aiohttp.ClientSession
    pocketbase_module.aiohttp.ClientSession = _Session
    try:
        client = PocketBaseClient(base_url="http://127.0.0.1:8090/")
        import asyncio
        asyncio.run(client.delete_session_record("token", "record-1"))
    finally:
        pocketbase_module.aiohttp.ClientSession = original
