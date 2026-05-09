"""Plugin-local configuration models."""

from __future__ import annotations

from pydantic import Field

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
