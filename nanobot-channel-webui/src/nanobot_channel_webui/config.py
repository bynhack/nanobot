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
            title="查看负责公司",
            label="确认当前账号可见的公司和部门",
            prompt="请帮我查询我当前账号能查看哪些公司，以及这些公司下面有哪些部门。",
        ),
        WebUIConversationStarter(
            title="员工花名册",
            label="查看授权范围内员工人数和状态",
            prompt="请帮我查询我负责公司范围内的员工花名册，并按公司、部门和在职状态做一个简要汇总。",
        ),
        WebUIConversationStarter(
            title="合同覆盖检查",
            label="检查在职员工合同缺口",
            prompt="请帮我分析我负责公司范围内的劳动合同覆盖情况，重点列出在职但缺少合同记录的员工。",
        ),
        WebUIConversationStarter(
            title="绩效社保概况",
            label="按月份查看绩效和社保记录",
            prompt="请帮我查询 2026 年 3 月我负责公司范围内的绩效记录和社保异动情况，并给出简要汇总。",
        ),
        WebUIConversationStarter(
            title="人事异动奖惩",
            label="查看异动、纪律处分和用章记录",
            prompt="请帮我查询 2026 年我负责公司范围内的人事异动、纪律处分和用章记录，并按类别汇总。",
        ),
        WebUIConversationStarter(
            title="查询员工档案",
            label="按姓名查看员工基础信息和合同",
            prompt="请帮我查询某位员工的基础信息和合同情况。如果员工不在我的权限范围内，请直接说明权限边界。",
        ),
    ]


class WebUIUIConfig(Base):
    welcome_title: str = "从一项人事工作开始。"
    welcome_subtitle: str = "选择常用 HR 查询，或直接输入你要处理的人事问题。"
    composer_placeholder: str = "输入人事查询、员工姓名、导入任务或 / 选择技能…"
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
    upstream_gateway_url: str = ""

    @field_validator("pocketbase_url")
    @classmethod
    def _normalize_pocketbase_url(cls, value: str) -> str:
        raw = value.strip()
        if not raw:
            return ""
        return raw if raw.endswith("/") else raw + "/"

    @field_validator("upstream_gateway_url")
    @classmethod
    def _normalize_upstream_gateway_url(cls, value: str) -> str:
        raw = value.strip()
        if not raw:
            return ""
        return raw.rstrip("/")
