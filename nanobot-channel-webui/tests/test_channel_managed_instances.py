from __future__ import annotations

import asyncio
from types import SimpleNamespace

from nanobot.config.schema import Config

from nanobot_channel_webui.channel import WebUIChannel
from nanobot_channel_webui.config import WebUIConfig
from nanobot_channel_webui.user_context import CurrentUser


def _channel_for_managed_instances() -> WebUIChannel:
    channel = WebUIChannel.__new__(WebUIChannel)
    channel.config = WebUIConfig(supabase_url="https://example.supabase.co", supabase_anon_key="anon", supabase_service_role_key="service")
    channel._supabase = SimpleNamespace(enabled=True)
    channel._managed_instance_service = None
    return channel


def test_managed_instances_enable_for_supabase_even_with_external_upstream() -> None:
    channel = _channel_for_managed_instances()

    assert channel._managed_instances_enabled() is True

    channel.config = WebUIConfig(
        supabase_url="https://example.supabase.co", supabase_anon_key="anon", supabase_service_role_key="service",
        upstream_gateway_url="http://127.0.0.1:8765",
    )
    assert channel._managed_instances_enabled() is True

    channel.config = WebUIConfig()
    channel._supabase = SimpleNamespace(enabled=False)
    assert channel._managed_instances_enabled() is False


def test_issue_upstream_token_starts_managed_instance_for_current_user() -> None:
    channel = _channel_for_managed_instances()
    user = CurrentUser(id="u1", email="u1@example.com", role="user", token="auth")
    events: list[object] = []

    class FakeBootstrapService:
        async def bootstrap_for_user(self, got_user):
            events.append(got_user)
            return {
                "token": "issued",
                "ws_url": "ws://127.0.0.1:19101/",
                "gateway_port": 19100,
                "websocket_port": 19101,
            }

    channel._managed_instance_bootstrap_service = lambda: FakeBootstrapService()

    status, payload = asyncio.run(channel._issue_upstream_token(user))

    assert status == 200
    assert payload["token"] == "issued"
    assert payload["gateway_port"] == 19100
    assert events == [user]


def test_issue_upstream_token_requires_user_for_managed_instances() -> None:
    channel = _channel_for_managed_instances()

    status, payload = asyncio.run(channel._issue_upstream_token(None))

    assert status == 401
    assert payload == {"error": "托管实例需要登录用户"}


def test_managed_instance_service_uses_plugin_runtime_root(monkeypatch, tmp_path) -> None:
    channel = _channel_for_managed_instances()
    channel.config = WebUIConfig(
        supabase_url="https://example.supabase.co", supabase_anon_key="anon", supabase_service_role_key="service",
        runtime_root=str(tmp_path / "webui-runtime"),
    )
    channel._managed_instance_manager = object()
    channel._managed_instance_service = None

    monkeypatch.setattr("nanobot.config.loader.load_config", lambda _path=None: Config())

    service = channel._managed_instance_bootstrap_service()

    assert service._builder._options.instances_root == tmp_path / "webui-runtime" / "instances"
    assert service._builder._options.environment == {
        "NANOBOT_WEBUI_SUPABASE_URL": "https://example.supabase.co/",
        "NANOBOT_WEBUI_SUPABASE_SERVICE_ROLE_KEY": "service",
        "NANOBOT_WEBUI_SUPABASE_PROFILES_TABLE": "webui_user_profiles",
    }


def test_upstream_base_from_bootstrap_prefers_websocket_port() -> None:
    assert WebUIChannel._upstream_base_from_bootstrap({
        "gateway_port": 19100,
        "websocket_port": 19101,
    }) == "http://127.0.0.1:19101"
    assert WebUIChannel._upstream_base_from_bootstrap({
        "gateway_port": 19100,
    }) == "http://127.0.0.1:19100"
    assert WebUIChannel._upstream_base_from_bootstrap({}) == ""


def test_upstream_delete_session_proxies_get_to_websocket_sidecar() -> None:
    channel = _channel_for_managed_instances()
    user = CurrentUser(id="u1", email="u1@example.com", role="user", token="auth")
    calls: list[dict[str, object]] = []

    async def fake_authorize(request):
        return True, None, user

    async def fake_issue(got_user):
        assert got_user is user
        return 200, {
            "token": "issued",
            "websocket_port": 19101,
        }

    async def fake_upstream_json(path, *, token="", method="GET", base_url=None):
        calls.append({
            "path": path,
            "token": token,
            "method": method,
            "base_url": base_url,
        })
        return 200, {"deleted": True}

    channel._authorize_request = fake_authorize
    channel._issue_upstream_token = fake_issue
    channel._upstream_json = fake_upstream_json

    async def run_case() -> None:
        response = await channel._handle_upstream_delete_session(
            SimpleNamespace(match_info={"chat_id": "f1f2a35e-7dfa-4c87-afc2-7b1ef49224be"})
        )
        assert response.status == 200

    asyncio.run(run_case())

    assert calls == [{
        "path": "/api/sessions/websocket:f1f2a35e-7dfa-4c87-afc2-7b1ef49224be/delete",
        "token": "issued",
        "method": "GET",
        "base_url": "http://127.0.0.1:19101",
    }]


def test_managed_session_access_uses_upstream_websocket_sessions_not_external_index() -> None:
    channel = _channel_for_managed_instances()
    user = CurrentUser(id="u1", email="u1@example.com", role="user", token="auth")
    calls: list[dict[str, object]] = []

    async def fake_issue(got_user):
        assert got_user is user
        return 200, {
            "token": "issued",
            "websocket_port": 19101,
        }

    async def fake_upstream_json(path, *, token="", method="GET", base_url=None):
        calls.append({
            "path": path,
            "token": token,
            "method": method,
            "base_url": base_url,
        })
        return 200, {
            "sessions": [
                {"key": "websocket:f1f2a35e-7dfa-4c87-afc2-7b1ef49224be"},
                {"key": "telegram:external"},
            ]
        }

    class ForbiddenExternalSessionIndex:
        async def get_for_user(self, *_args, **_kwargs):
            raise AssertionError("managed session access must not use an external session index")

    channel._issue_upstream_token = fake_issue
    channel._upstream_json = fake_upstream_json
    channel._session_index = ForbiddenExternalSessionIndex()

    allowed = asyncio.run(channel._can_access_session(user, "f1f2a35e-7dfa-4c87-afc2-7b1ef49224be"))

    assert allowed is True
    assert calls == [{
        "path": "/api/sessions",
        "token": "issued",
        "method": "GET",
        "base_url": "http://127.0.0.1:19101",
    }]


def test_runtime_session_count_uses_upstream_websocket_sessions(monkeypatch, tmp_path) -> None:
    channel = _channel_for_managed_instances()
    user = CurrentUser(id="u1", email="u1@example.com", role="user", token="auth")
    instance_workspace = tmp_path / "runtime" / "instances" / "user-u1" / "workspace"
    instance_workspace.mkdir(parents=True)

    class FakeWeb:
        @staticmethod
        def json_response(payload, status=200):
            return SimpleNamespace(status=status, payload=payload)

    monkeypatch.setitem(__import__("sys").modules, "aiohttp", SimpleNamespace(web=FakeWeb))

    async def fake_authorize(_request):
        return True, None, user

    async def fake_issue(got_user):
        assert got_user is user
        return 200, {
            "token": "issued",
            "websocket_port": 19101,
        }

    async def fake_upstream_json(_path, *, token="", method="GET", base_url=None):
        return 200, {
            "sessions": [
                {"key": "websocket:chat-a"},
                {"key": "slack:ignored"},
                {"key": "websocket:chat-b"},
            ]
        }

    class FakeBootstrapService:
        def spec_for_user(self, got_user):
            assert got_user is user
            return SimpleNamespace(workspace=SimpleNamespace(workspace=instance_workspace))

    class ForbiddenExternalSessionIndex:
        async def list_for_user(self, *_args, **_kwargs):
            raise AssertionError("runtime session_count must not use an external session index")

    channel._authorize_request = fake_authorize
    channel._issue_upstream_token = fake_issue
    channel._upstream_json = fake_upstream_json
    channel._session_index = ForbiddenExternalSessionIndex()
    channel._managed_instance_bootstrap_service = lambda: FakeBootstrapService()

    response = asyncio.run(channel._handle_runtime(SimpleNamespace()))

    assert response.status == 200
    assert response.payload["session_count"] == 2
    assert response.payload["workspace"] == ""


def test_settings_config_uses_current_managed_instance_workspace(monkeypatch, tmp_path) -> None:
    channel = _channel_for_managed_instances()
    user = CurrentUser(id="admin", email="admin@example.com", role="admin", token="auth")
    instance_workspace = tmp_path / "runtime" / "instances" / "user-admin" / "workspace"
    instance_workspace.mkdir(parents=True)
    (instance_workspace.parent / "config.json").write_text('{"agents": {}}\n', encoding="utf-8")
    channel._management = SimpleNamespace(config_snapshot=lambda: {"workspace": "control-plane"})

    class FakeWeb:
        @staticmethod
        def json_response(payload, status=200):
            return SimpleNamespace(status=status, payload=payload)

    class FakeBootstrapService:
        def spec_for_user(self, got_user):
            assert got_user is user
            return SimpleNamespace(workspace=SimpleNamespace(workspace=instance_workspace))

    monkeypatch.setitem(__import__("sys").modules, "aiohttp", SimpleNamespace(web=FakeWeb))
    async def fake_authorize(_request):
        return True, None, user

    channel._authorize_request = fake_authorize
    channel._managed_instance_bootstrap_service = lambda: FakeBootstrapService()

    response = asyncio.run(channel._handle_config(SimpleNamespace()))

    assert response.status == 200
    assert response.payload["workspace"] == str(instance_workspace)
    assert response.payload["config_path"] == str(instance_workspace.parent / "config.json")


def test_settings_runtime_uses_current_managed_instance_workspace(monkeypatch, tmp_path) -> None:
    channel = _channel_for_managed_instances()
    user = CurrentUser(id="admin", email="admin@example.com", role="admin", token="auth")
    instance_workspace = tmp_path / "runtime" / "instances" / "user-admin" / "workspace"
    sessions_dir = instance_workspace / "sessions"
    sessions_dir.mkdir(parents=True)
    (sessions_dir / "websocket_chat-a.jsonl").write_text("{}", encoding="utf-8")

    class FakeWeb:
        @staticmethod
        def json_response(payload, status=200):
            return SimpleNamespace(status=status, payload=payload)

    class FakeBootstrapService:
        def spec_for_user(self, got_user):
            assert got_user is user
            return SimpleNamespace(workspace=SimpleNamespace(workspace=instance_workspace))

    async def fake_upstream_sessions(_user):
        return [{"key": "websocket:chat-a"}]

    monkeypatch.setitem(__import__("sys").modules, "aiohttp", SimpleNamespace(web=FakeWeb))
    async def fake_authorize(_request):
        return True, None, user

    channel._authorize_request = fake_authorize
    channel._managed_instance_bootstrap_service = lambda: FakeBootstrapService()
    channel._upstream_sessions_for_user = fake_upstream_sessions

    response = asyncio.run(channel._handle_runtime(SimpleNamespace()))

    assert response.status == 200
    assert response.payload["workspace"] == str(instance_workspace)
    assert response.payload["session_count"] == 1
    assert response.payload["recent_state_files"][0]["path"] == str(
        sessions_dir / "websocket_chat-a.jsonl"
    )


def test_settings_skills_use_current_managed_instance_workspace(monkeypatch, tmp_path) -> None:
    channel = _channel_for_managed_instances()
    user = CurrentUser(id="admin", email="admin@example.com", role="admin", token="auth")
    control_skill = tmp_path / "control" / "workspace" / "skills" / "wrong-skill"
    control_skill.mkdir(parents=True)
    (control_skill / "SKILL.md").write_text("# Wrong\n", encoding="utf-8")
    channel._management = __import__("nanobot_channel_webui.management").management.WebUIManagementService(
        control_skill.parents[2]
    )

    instance_workspace = tmp_path / "runtime" / "instances" / "user-admin" / "workspace"
    instance_skill = instance_workspace / "skills" / "hr-query-analysis-router"
    instance_skill.mkdir(parents=True)
    (instance_skill / "SKILL.md").write_text(
        "---\nname: hr-query-analysis-router\ndescription: 当前实例技能\n---\n# HR\n",
        encoding="utf-8",
    )

    class FakeWeb:
        @staticmethod
        def json_response(payload, status=200):
            return SimpleNamespace(status=status, payload=payload)

    class FakeBootstrapService:
        def spec_for_user(self, got_user):
            assert got_user is user
            return SimpleNamespace(workspace=SimpleNamespace(workspace=instance_workspace))

    async def fake_authorize(_request):
        return True, None, user

    monkeypatch.setitem(__import__("sys").modules, "aiohttp", SimpleNamespace(web=FakeWeb))
    channel._authorize_request = fake_authorize
    channel._managed_instance_bootstrap_service = lambda: FakeBootstrapService()

    response = asyncio.run(channel._handle_skills(SimpleNamespace()))

    assert response.status == 200
    assert [item["name"] for item in response.payload["skills"]] == ["hr-query-analysis-router"]
    assert response.payload["skills"][0]["path"] == str(instance_skill / "SKILL.md")


def test_settings_skill_detail_uses_current_managed_instance_workspace(
    monkeypatch,
    tmp_path,
) -> None:
    channel = _channel_for_managed_instances()
    user = CurrentUser(id="admin", email="admin@example.com", role="admin", token="auth")
    instance_workspace = tmp_path / "runtime" / "instances" / "user-admin" / "workspace"
    instance_skill = instance_workspace / "skills" / "hr-query-analysis-router"
    instance_skill.mkdir(parents=True)
    (instance_skill / "SKILL.md").write_text("# HR\n", encoding="utf-8")

    class FakeWeb:
        @staticmethod
        def json_response(payload, status=200):
            return SimpleNamespace(status=status, payload=payload)

    class FakeBootstrapService:
        def spec_for_user(self, got_user):
            assert got_user is user
            return SimpleNamespace(workspace=SimpleNamespace(workspace=instance_workspace))

    class FakeRelUrl:
        query = {"source": "workspace"}

    async def fake_authorize(_request):
        return True, None, user

    monkeypatch.setitem(__import__("sys").modules, "aiohttp", SimpleNamespace(web=FakeWeb))
    channel._authorize_request = fake_authorize
    channel._managed_instance_bootstrap_service = lambda: FakeBootstrapService()

    response = asyncio.run(
        channel._handle_skill_detail(
            SimpleNamespace(
                match_info={"name": "hr-query-analysis-router"},
                rel_url=FakeRelUrl(),
            )
        )
    )

    assert response.status == 200
    assert response.payload["path"] == str(instance_skill / "SKILL.md")
