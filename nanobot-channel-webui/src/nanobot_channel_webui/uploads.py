"""Upload helpers for WebUI message attachments."""

from __future__ import annotations

import hashlib
import mimetypes
import time
from pathlib import Path

from nanobot.utils.helpers import ensure_dir, safe_filename

UPLOAD_FILENAME_COMPONENT_MAX_BYTES = 180
_UPLOAD_FILENAME_HASH_CHARS = 12
_UPLOAD_FILENAME_SUFFIX_MAX_BYTES = 32


def classify_attachment_type(mime: str, name: str = "") -> str:
    """Classify an attachment for UI rendering."""
    mime = (mime or "").lower()
    if mime.startswith("image/"):
        return "image"
    if mime in {
        "application/pdf",
        "application/msword",
        "application/vnd.ms-powerpoint",
        "application/vnd.ms-excel",
    } or "officedocument" in mime:
        return "document"
    guessed = mimetypes.guess_type(name)[0] or ""
    if guessed.startswith("image/"):
        return "image"
    if guessed in {
        "application/pdf",
        "application/msword",
        "application/vnd.ms-powerpoint",
        "application/vnd.ms-excel",
    } or "officedocument" in guessed:
        return "document"
    return "file"


def attachment_prompt_suffix(path: str, *, name: str, mime: str) -> str:
    """Build extra text the model can use to locate non-image files."""
    kind = classify_attachment_type(mime, name)
    if kind == "image":
        return ""
    label = safe_filename(name) or Path(path).name
    return f"[file: {label}]\n[File: source: {path}]"


def upload_display_name(filename: str) -> str:
    """Return the user-facing uploaded filename."""
    return safe_filename(filename) or "upload.bin"


def _utf8_len(text: str) -> int:
    return len(text.encode("utf-8"))


def _truncate_utf8(text: str, max_bytes: int) -> str:
    if max_bytes <= 0:
        return ""
    if _utf8_len(text) <= max_bytes:
        return text

    parts: list[str] = []
    used = 0
    for char in text:
        char_len = _utf8_len(char)
        if used + char_len > max_bytes:
            break
        parts.append(char)
        used += char_len
    return "".join(parts)


def _short_upload_component(timestamp_ms: str, safe_name: str) -> str:
    candidate = f"{timestamp_ms}_{safe_name}"
    if _utf8_len(candidate) <= UPLOAD_FILENAME_COMPONENT_MAX_BYTES:
        return candidate

    digest = hashlib.sha256(safe_name.encode("utf-8")).hexdigest()[:_UPLOAD_FILENAME_HASH_CHARS]
    path = Path(safe_name)
    suffix = path.suffix
    stem = path.stem
    if not stem:
        stem = safe_name
        suffix = ""
    if _utf8_len(suffix) > _UPLOAD_FILENAME_SUFFIX_MAX_BYTES:
        stem = safe_name
        suffix = ""

    prefix = f"{timestamp_ms}_{digest}_"
    remaining = UPLOAD_FILENAME_COMPONENT_MAX_BYTES - _utf8_len(prefix) - _utf8_len(suffix)
    short_stem = _truncate_utf8(stem, remaining).rstrip(" ._-") or "upload"
    return f"{prefix}{short_stem}{suffix}"


def next_upload_path(workspace: Path, user_id: str, chat_id: str, filename: str) -> Path:
    """Return the destination path for an uploaded file."""
    upload_dir = ensure_dir(workspace / ".nanobot_webui_uploads" / user_id / chat_id)
    safe_name = upload_display_name(filename)
    component = _short_upload_component(str(int(time.time() * 1000)), safe_name)
    return upload_dir / component
