"""Plugin-local configuration models."""

from __future__ import annotations

from pydantic import Field, field_validator

from nanobot.config.schema import Base

CHANNEL_NAME = "webui_plugin"


class WebUIConversationStarter(Base):
    title: str
    label: str = ""
    prompt: str


def _default_conversation_starters() -> list[WebUIConversationStarter]:
    return [
        WebUIConversationStarter(
            title="整理思路",
            label="把零散信息归纳成清晰结构",
            prompt="请帮我把现有信息整理成要点、问题和下一步行动",
        ),
        WebUIConversationStarter(
            title="提炼重点",
            label="从文本、附件或对话里抓关键内容",
            prompt="请帮我提炼这段内容的重点，并列出需要继续确认的事项",
        ),
        WebUIConversationStarter(
            title="生成草稿",
            label="起草邮件、说明、报告或清单",
            prompt="请帮我起草一份结构清晰、语气专业的初稿",
        ),
        WebUIConversationStarter(
            title="检查方案",
            label="发现风险、遗漏和可改进点",
            prompt="请帮我检查这个方案可能存在的风险、遗漏和改进建议",
        ),
        WebUIConversationStarter(
            title="解释概念",
            label="用易懂方式拆解复杂问题",
            prompt="请用简明的方式解释这个问题，并给出一个例子",
        ),
        WebUIConversationStarter(
            title="处理附件",
            label="上传文件后总结、转写或建立索引",
            prompt="我准备上传附件，请先告诉我你可以如何帮我阅读、总结和整理它",
        ),
    ]


class WebUIUIConfig(Base):
    welcome_title: str = "从一个问题开始。"
    welcome_subtitle: str = "选择一个常用任务，或直接输入你想处理的内容。"
    composer_placeholder: str = "输入问题、任务或 / 选择技能…"
    compact_composer_placeholder: str = "发消息…"
    conversation_starters: list[WebUIConversationStarter] = Field(default_factory=_default_conversation_starters)


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
    ui: WebUIUIConfig = Field(default_factory=WebUIUIConfig)
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
