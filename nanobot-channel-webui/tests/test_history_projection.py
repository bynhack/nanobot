from __future__ import annotations

from nanobot_channel_webui.history_projection import project_session_messages


class _MediaService:
    def build_media_items(self, paths: list[str]) -> list[dict[str, str]]:
        return [{"url": f"/media/{path}", "name": path.rsplit("/", 1)[-1], "mime": ""} for path in paths]


def test_projects_ask_user_tool_to_button_message() -> None:
    raw = [
        {
            "role": "assistant",
            "content": "",
            "tool_calls": [
                {
                    "id": "tool_1",
                    "function": {
                        "name": "ask_user",
                        "arguments": '{"question":"继续吗？","options":["继续","停止"]}',
                    },
                }
            ],
        }
    ]

    projected = project_session_messages(raw, media_service=_MediaService())

    assert projected[0]["type"] == "assistant"
    assert projected[0]["buttons"] == [["继续", "停止"]]


def test_projects_message_tool_to_outbound_message() -> None:
    raw = [
        {
            "role": "assistant",
            "content": "",
            "tool_calls": [
                {
                    "id": "tool_2",
                    "function": {
                        "name": "message",
                        "arguments": '{"content":"已发送","media":["/tmp/report.pdf"]}',
                    },
                }
            ],
        }
    ]

    projected = project_session_messages(raw, media_service=_MediaService())

    assert projected == [
        {
            "type": "outbound",
            "content": "已发送",
            "media": [{"url": "/media//tmp/report.pdf", "name": "report.pdf", "mime": ""}],
        }
    ]
