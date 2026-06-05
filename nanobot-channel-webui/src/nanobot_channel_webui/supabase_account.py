"""Supabase Auth and account-profile helpers for the WebUI plugin."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Literal
from urllib.parse import quote

import aiohttp


UserRole = Literal["admin", "user"]


@dataclass(slots=True)
class SupabaseProfile:
    """Normalized WebUI user profile loaded from Supabase."""

    id: str
    email: str
    role: UserRole
    token: str = ""
    business_role: str = ""
    tenant_id: str = ""
    scopes: dict[str, Any] | None = None
    resources: list[dict[str, Any]] | None = None
    skills: list[str] | str | None = None
    tenant_policy: dict[str, Any] | None = None


class SupabaseAccountError(RuntimeError):
    """Base Supabase account client error."""


class SupabaseAuthError(SupabaseAccountError):
    """Authentication or authorization failure."""


def role_from_profile(record: dict[str, Any]) -> UserRole:
    return "admin" if str(record.get("role", "")).strip() == "admin" else "user"


def profile_from_payload(payload: dict[str, Any], *, token: str) -> SupabaseProfile:
    user_id = str(
        payload.get("auth_user_id")
        or payload.get("authUserId")
        or payload.get("id")
        or "",
    ).strip()
    if not user_id:
        raise SupabaseAuthError("Supabase 权限画像缺少用户 ID")

    has_policy = any(
        isinstance(payload.get(key), expected)
        for key, expected in (
            ("tenant_policy", dict),
            ("tenantPolicy", dict),
            ("resources", list),
            ("scopes", dict),
        )
    )
    if not has_policy and role_from_profile(payload) != "admin":
        raise SupabaseAuthError("Supabase 权限画像缺少权限配置")

    return SupabaseProfile(
        id=user_id,
        email=str(payload.get("email", "")).strip(),
        role=role_from_profile(payload),
        token=token,
        business_role=str(payload.get("business_role") or payload.get("businessRole") or "").strip(),
        tenant_id=str(payload.get("tenant_id") or payload.get("tenantId") or "").strip(),
        scopes=payload.get("scopes") if isinstance(payload.get("scopes"), dict) else None,
        resources=payload.get("resources") if isinstance(payload.get("resources"), list) else None,
        skills=payload.get("skills")
        or payload.get("skill_allowlist")
        or payload.get("skillAllowlist")
        or payload.get("allowed_skills")
        or payload.get("allowedSkills"),
        tenant_policy=payload.get("tenant_policy")
        if isinstance(payload.get("tenant_policy"), dict)
        else payload.get("tenantPolicy")
        if isinstance(payload.get("tenantPolicy"), dict)
        else None,
    )


def utc_now_iso() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


class SupabaseAccountClient:
    """Small async REST client for Supabase Auth and WebUI account profiles."""

    def __init__(
        self,
        *,
        url: str,
        anon_key: str = "",
        service_role_key: str = "",
        profiles_table: str = "webui_user_profiles",
        timeout_seconds: float = 10.0,
    ) -> None:
        self._url = url.rstrip("/")
        self._anon_key = anon_key.strip()
        self._service_role_key = service_role_key.strip()
        self._profiles_table = profiles_table.strip() or "webui_user_profiles"
        self._timeout = aiohttp.ClientTimeout(total=timeout_seconds)

    @property
    def enabled(self) -> bool:
        return bool(self._url and self._anon_key and self._service_role_key)

    async def _request(
        self,
        method: str,
        url: str,
        *,
        headers: dict[str, str],
        params: dict[str, str] | None = None,
    ) -> Any:
        async with aiohttp.ClientSession(timeout=self._timeout) as session:
            async with session.request(method, url, headers=headers, params=params) as response:
                raw_text = await response.text()
                try:
                    data = await response.json(content_type=None) if raw_text.strip() else {}
                except Exception as exc:
                    raise SupabaseAccountError("Supabase 返回了无效响应") from exc
                if response.status in {401, 403}:
                    raise SupabaseAuthError(_error_message(data, "Supabase 鉴权失败"))
                if response.status >= 400:
                    raise SupabaseAccountError(_error_message(data, "Supabase 请求失败"))
                return data

    async def get_current_user(self, token: str) -> SupabaseProfile:
        token = token.strip()
        if not self.enabled:
            raise SupabaseAccountError("Supabase 账号体系未配置")
        if not token:
            raise SupabaseAuthError("未登录或登录已失效")

        auth_user = await self._request(
            "GET",
            f"{self._url}/auth/v1/user",
            headers={
                "apikey": self._anon_key,
                "Authorization": f"Bearer {token}",
            },
        )
        if not isinstance(auth_user, dict):
            raise SupabaseAuthError("Supabase 用户响应无效")
        auth_user_id = str(auth_user.get("id", "")).strip()
        if not auth_user_id:
            raise SupabaseAuthError("Supabase 用户响应缺少用户 ID")

        profiles = await self._request(
            "GET",
            f"{self._url}/rest/v1/{quote(self._profiles_table)}",
            headers={
                "apikey": self._service_role_key,
                "Authorization": f"Bearer {self._service_role_key}",
                "Accept": "application/json",
            },
            params={
                "select": "*",
                "auth_user_id": f"eq.{auth_user_id}",
                "limit": "1",
            },
        )
        if not isinstance(profiles, list) or not profiles:
            raise SupabaseAuthError("Supabase 权限画像不存在")
        profile = profiles[0]
        if not isinstance(profile, dict):
            raise SupabaseAuthError("Supabase 权限画像响应无效")
        profile.setdefault("auth_user_id", auth_user_id)
        profile.setdefault("email", auth_user.get("email", ""))
        return profile_from_payload(profile, token=token)


def _error_message(payload: Any, fallback: str) -> str:
    if isinstance(payload, dict):
        for key in ("msg", "message", "error_description", "error"):
            value = payload.get(key)
            if value:
                return str(value)
    return fallback
