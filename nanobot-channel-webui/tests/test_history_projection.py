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
        },
        {
            "type": "tools",
            "tools": [
                {
                    "name": "message",
                    "args": {"content": "已发送", "media": ["/tmp/report.pdf"]},
                    "result": "",
                    "status": "ok",
                }
            ],
        },
    ]


def test_projects_tool_results_across_channel_delivery_messages() -> None:
    raw = [
        {
            "role": "assistant",
            "content": "",
            "tool_calls": [
                {
                    "id": "call_write",
                    "function": {
                        "name": "write_file",
                        "arguments": '{"path":"navicat-reset-intro.html","content":"<html></html>"}',
                    },
                }
            ],
        },
        {
            "role": "assistant",
            "content": "给你写好了，一个干干净净的 HTML 介绍页",
            "_channel_delivery": True,
            "media": ["/workspace/navicat-reset-intro.html"],
        },
        {
            "role": "tool",
            "tool_call_id": "call_write",
            "name": "write_file",
            "content": "Successfully wrote 7190 characters to /workspace/navicat-reset-intro.html",
        },
        {
            "role": "assistant",
            "content": "",
            "tool_calls": [
                {
                    "id": "call_message",
                    "function": {
                        "name": "message",
                        "arguments": (
                            '{"content":"给你写好了，一个干干净净的 HTML 介绍页",'
                            '"media":["/workspace/navicat-reset-intro.html"]}'
                        ),
                    },
                }
            ],
        },
        {
            "role": "tool",
            "tool_call_id": "call_message",
            "name": "message",
            "content": "Message sent to websocket:c9842da7 with 1 attachments",
        },
    ]

    projected = project_session_messages(raw, media_service=_MediaService())

    assert {
        "type": "tools",
        "tools": [
            {
                "name": "write_file",
                "args": {"path": "navicat-reset-intro.html", "content": "<html></html>"},
                "result": "Successfully wrote 7190 characters to /workspace/navicat-reset-intro.html",
                "status": "ok",
            },
        ],
    } in projected
    assert {
        "type": "tools",
        "tools": [
            {
                "name": "message",
                "args": {
                    "content": "给你写好了，一个干干净净的 HTML 介绍页",
                    "media": ["/workspace/navicat-reset-intro.html"],
                },
                "result": "Message sent to websocket:c9842da7 with 1 attachments",
                "status": "ok",
            },
        ],
    } in projected
    assert {
        "type": "outbound",
        "content": "给你写好了，一个干干净净的 HTML 介绍页",
        "media": [
            {
                "url": "/media//workspace/navicat-reset-intro.html",
                "name": "navicat-reset-intro.html",
                "mime": "",
            }
        ],
    } in projected
