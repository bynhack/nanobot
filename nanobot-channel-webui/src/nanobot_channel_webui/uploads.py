"""Upload helpers for WebUI message attachments."""

from __future__ import annotations

import mimetypes
import time
from pathlib import Path

from nanobot.utils.helpers import ensure_dir, safe_filename

from .storage_paths import uploads_root


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


def next_upload_path(workspace: Path, user_id: str, chat_id: str, filename: str) -> Path:
    """Return the destination path for an uploaded file."""
    upload_dir = ensure_dir(uploads_root(workspace) / user_id / chat_id)
    safe_name = safe_filename(filename) or "upload.bin"
    return upload_dir / f"{int(time.time() * 1000)}_{safe_name}"
