"""Project nanobot session messages into WebUI history payloads."""

from __future__ import annotations

import json
from typing import Any


def message_text(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        texts: list[str] = []
        for block in content:
            if isinstance(block, dict) and block.get("type") == "text":
                texts.append(str(block.get("text", "")))
        return "\n".join(text for text in texts if text)
    if content is None:
        return ""
    return json.dumps(content, ensure_ascii=False)


def extract_user_attachments(content: str) -> tuple[str, list[str]]:
    attachments: list[str] = []
    clean_lines: list[str] = []
    for line in content.splitlines():
        stripped = line.strip()
        if stripped.startswith("[image:") and stripped.endswith("]"):
            path = stripped[7:-1].strip()
            if path:
                attachments.append(path)
            continue
        if stripped.startswith("[File: source:") and stripped.endswith("]"):
            path = stripped[len("[File: source:"):-1].strip()
            if path:
                attachments.append(path)
            continue
        if stripped.startswith("[file:") and stripped.endswith("]"):
            continue
        clean_lines.append(line)

    return "\n".join(clean_lines).strip(), attachments


def parse_ask_user_tool_arguments(value: Any) -> tuple[str, list[list[str]]] | None:
    try:
        parsed = json.loads(value) if isinstance(value, str) else dict(value)
    except Exception:
        return None
    if not isinstance(parsed, dict):
        return None
    question = str(parsed.get("question", "")).strip()
    raw_options = parsed.get("options")
    if not question or not isinstance(raw_options, list):
        return None
    options = [str(option).strip() for option in raw_options if str(option).strip()]
    if not options:
        return None
    return question, [options]


def tool_call_name(tool_call: dict[str, Any]) -> str:
    function = tool_call.get("function")
    if isinstance(function, dict) and isinstance(function.get("name"), str):
        return function["name"]
    name = tool_call.get("name")
    return name if isinstance(name, str) else ""


def tool_call_arguments(tool_call: dict[str, Any]) -> Any:
    function = tool_call.get("function")
    if isinstance(function, dict):
        return function.get("arguments", "{}")
    return tool_call.get("arguments", "{}")


def project_session_messages(
    raw_messages: list[dict[str, Any]],
    *,
    media_service: Any,
) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    index = 0

    while index < len(raw_messages):
        message = raw_messages[index]
        role = message.get("role")

        if role == "user":
            content = message_text(message.get("content", ""))
            text, attachments = extract_user_attachments(content)
            if text.strip() or attachments:
                payload: dict[str, Any] = {"type": "user", "content": text}
                if attachments:
                    payload["media"] = media_service.build_media_items(attachments)
                result.append(payload)
            index += 1
            continue

        if role != "assistant":
            index += 1
            continue

        content = message_text(message.get("content", ""))
        tool_calls = message.get("tool_calls") or []
        if content.strip():
            result.append({"type": "assistant", "content": content})

        if not tool_calls:
            index += 1
            continue

        tool_results: dict[str, str] = {}
        cursor = index + 1
        while cursor < len(raw_messages) and raw_messages[cursor].get("role") == "tool":
            tool_message = raw_messages[cursor]
            tool_results[str(tool_message.get("tool_call_id", ""))] = message_text(
                tool_message.get("content", "")
            )
            cursor += 1
        index = cursor

        tool_block: list[dict[str, Any]] = []
        for tool_call in tool_calls:
            if not isinstance(tool_call, dict):
                continue
            name = tool_call_name(tool_call)
            raw_args = tool_call_arguments(tool_call)
            try:
                args = json.loads(raw_args) if isinstance(raw_args, str) else dict(raw_args)
            except Exception:
                args = {}
            result_text = tool_results.get(str(tool_call.get("id", "")), "")
            status = "error" if isinstance(result_text, str) and result_text.startswith("Error") else "ok"

            if name == "ask_user":
                parsed_ask = parse_ask_user_tool_arguments(raw_args)
                if parsed_ask is not None:
                    question, buttons = parsed_ask
                    result.append({
                        "type": "assistant",
                        "content": question,
                        "buttons": buttons,
                    })
                continue

            if name == "message":
                media_value = args.get("media")
                media_paths = (
                    media_value
                    if isinstance(media_value, list)
                    else [media_value]
                    if isinstance(media_value, str) and media_value
                    else []
                )
                result.append({
                    "type": "outbound",
                    "content": str(args.get("content", "")),
                    "media": media_service.build_media_items(media_paths),
                })
                continue

            tool_block.append({
                "name": name,
                "args": args,
                "result": result_text,
                "status": status,
            })

        if tool_block:
            result.append({"type": "tools", "tools": tool_block})

    return result
