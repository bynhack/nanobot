"""Plugin-local configuration models."""

from __future__ import annotations

from pydantic import Field, field_validator

from nanobot.config.schema import Base

CHANNEL_NAME = "webui_plugin"


class WebUIConfig(Base):
    enabled: bool = False
    host: str = "127.0.0.1"
    port: int = 8080
    allow_from: list[str] = Field(default_factory=lambda: ["*"])
    allowed_origins: list[str] = Field(default_factory=list)
    auth_token: str = ""
    media_signing_secret: str = ""
    media_token_ttl_seconds: int = 300
    streaming: bool = True
    title: str = "Nanobot"
    pocketbase_url: str = ""
    pocketbase_users_collection: str = "users"
    pocketbase_sessions_collection: str = "chat_sessions"

    @field_validator("pocketbase_url")
    @classmethod
    def _normalize_pocketbase_url(cls, value: str) -> str:
        raw = value.strip()
        if not raw:
            return ""
        return raw if raw.endswith("/") else raw + "/"
