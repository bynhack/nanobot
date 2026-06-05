from __future__ import annotations

import asyncio

from nanobot_channel_webui.config import WebUIConfig
from nanobot_channel_webui.supabase_account import (
    SupabaseAccountClient,
    SupabaseAuthError,
    SupabaseProfile,
    profile_from_payload,
)


def test_webui_config_accepts_supabase_settings() -> None:
    config = WebUIConfig.model_validate({
        "enabled": True,
        "supabaseUrl": "https://example.supabase.co",
        "supabaseAnonKey": "anon-key",
        "supabaseServiceRoleKey": "service-role-key",
        "supabaseProfilesTable": "webui_user_profiles",
    })

    assert config.supabase_url == "https://example.supabase.co/"
    assert config.supabase_anon_key == "anon-key"
    assert config.supabase_service_role_key == "service-role-key"
    assert config.supabase_profiles_table == "webui_user_profiles"


def test_webui_config_does_not_enable_supabase_without_unified_settings() -> None:
    config = WebUIConfig.model_validate({
        "enabled": True,
    })

    assert config.account_supabase_url == ""
    assert config.account_supabase_service_role_key == ""


def test_profile_from_payload_defaults_to_user() -> None:
    profile = profile_from_payload({
        "auth_user_id": "auth-1",
        "email": "hr@example.com",
        "business_role": "hr_specialist",
        "tenant_id": "tenant-a",
        "resources": [{"resource": "hr.company", "actions": ["read"]}],
        "skills": ["hr-db-ops"],
    }, token="jwt")

    assert profile == SupabaseProfile(
        id="auth-1",
        email="hr@example.com",
        role="user",
        token="jwt",
        business_role="hr_specialist",
        tenant_id="tenant-a",
        resources=[{"resource": "hr.company", "actions": ["read"]}],
        skills=["hr-db-ops"],
    )


def test_profile_from_payload_requires_identity_and_policy() -> None:
    try:
        profile_from_payload({"email": "missing@example.com"}, token="jwt")
    except SupabaseAuthError as exc:
        assert "用户 ID" in str(exc)
    else:
        raise AssertionError("missing auth user id must fail closed")

    try:
        profile_from_payload({"auth_user_id": "auth-1", "email": "missing@example.com"}, token="jwt")
    except SupabaseAuthError as exc:
        assert "权限画像" in str(exc)
    else:
        raise AssertionError("missing permission profile must fail closed")


def test_supabase_get_current_user_fetches_auth_user_and_permission_profile() -> None:
    calls: list[tuple[str, str, dict[str, str] | None]] = []

    class _Response:
        def __init__(self, status: int, payload: dict):
            self.status = status
            self._payload = payload

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def text(self) -> str:
            import json
            return json.dumps(self._payload)

        async def json(self, content_type=None):
            return self._payload

    class _Session:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        def request(self, method, url, **kwargs):
            calls.append((method, url, kwargs.get("headers")))
            if url.endswith("/auth/v1/user"):
                return _Response(200, {"id": "auth-1", "email": "hr@example.com"})
            return _Response(200, [{
                "auth_user_id": "auth-1",
                "email": "hr@example.com",
                "role": "admin",
                "resources": [{"resource": "hr.company", "actions": ["read"]}],
            }])

    import nanobot_channel_webui.supabase_account as account_module
    original = account_module.aiohttp.ClientSession
    account_module.aiohttp.ClientSession = _Session
    try:
        client = SupabaseAccountClient(
            url="https://example.supabase.co/",
            anon_key="anon",
            service_role_key="service",
        )
        user = asyncio.run(client.get_current_user("jwt"))
    finally:
        account_module.aiohttp.ClientSession = original

    assert user.id == "auth-1"
    assert user.role == "admin"
    assert calls[0][1] == "https://example.supabase.co/auth/v1/user"
    assert calls[0][2]["Authorization"] == "Bearer jwt"
    assert calls[1][1].startswith("https://example.supabase.co/rest/v1/webui_user_profiles")
    assert calls[1][2]["Authorization"] == "Bearer service"
