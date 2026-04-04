"""Signed media URL generation for WebUI attachments."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import mimetypes
import secrets
import time
from pathlib import Path


def _urlsafe_b64encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def _urlsafe_b64decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(value + padding)


class MediaService:
    """Mint short-lived signed media URLs for local files."""

    def __init__(self, *, ttl_seconds: int, auth_token: str = "") -> None:
        seed = auth_token.encode("utf-8") if auth_token else secrets.token_bytes(32)
        self._secret = hashlib.sha256(seed).digest()
        self._ttl_seconds = max(ttl_seconds, 1)

    def build_media_items(self, paths: list[str]) -> list[dict[str, str]]:
        """Convert raw media paths into browser-safe display objects."""
        return [self.build_media_item(raw) for raw in paths]

    def build_media_item(self, raw: str) -> dict[str, str]:
        """Build a media item from a file path or URL."""
        # Try as local file first
        path = Path(raw).expanduser()
        if path.is_file():
            return {
                "url": f"/media/{self.issue_token(path)}",
                "name": path.name,
                "mime": mimetypes.guess_type(path.name)[0] or "application/octet-stream",
            }
        
        # Handle remote URLs
        if raw.startswith(("http://", "https://")):
            # Extract filename from URL
            from urllib.parse import urlparse, unquote
            parsed = urlparse(raw)
            path_parts = parsed.path.split("/")
            filename = unquote(path_parts[-1]) if path_parts else ""
            
            # Remove query parameters from filename if present
            if "?" in filename:
                filename = filename.split("?")[0]
            
            
            # Guess MIME type from URL extension
            mime_type = ""
            if filename:
                mime_type = mimetypes.guess_type(filename)[0] or ""
            
            # If no MIME type from filename, try to infer from URL patterns
            if not mime_type:
                lower_url = raw.lower()
                if ".png" in lower_url or "format=.png" in lower_url or "format=png" in lower_url:
                    mime_type = "image/png"
                elif ".jpg" in lower_url or ".jpeg" in lower_url or "format=.jpg" in lower_url or "format=jpeg" in lower_url:
                    mime_type = "image/jpeg"
                elif ".gif" in lower_url or "format=.gif" in lower_url:
                    mime_type = "image/gif"
                elif ".webp" in lower_url or "format=.webp" in lower_url:
                    mime_type = "image/webp"
                elif ".mp4" in lower_url:
                    mime_type = "video/mp4"
                elif ".pdf" in lower_url:
                    mime_type = "application/pdf"
            
            # Generate a default filename if none found
            if not filename or filename == "":
                if mime_type.startswith("image/"):
                    ext = mime_type.split("/")[1]
                    filename = f"image.{ext}"
                elif mime_type.startswith("video/"):
                    ext = mime_type.split("/")[1]
                    filename = f"video.{ext}"
                else:
                    filename = "file"
            
            return {
                "url": raw,
                "name": filename,
                "mime": mime_type,
            }
        
        # Fallback for unknown formats
        return {"url": raw, "name": "", "mime": ""}

    def issue_token(self, path: Path) -> str:
        payload = {
            "path": str(path.resolve(strict=False)),
            "exp": int(time.time()) + self._ttl_seconds,
        }
        raw = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
        sig = hmac.new(self._secret, raw, hashlib.sha256).digest()
        return f"{_urlsafe_b64encode(raw)}.{_urlsafe_b64encode(sig)}"

    def resolve_token(self, token: str) -> Path | None:
        try:
            payload_b64, sig_b64 = token.split(".", 1)
            raw = _urlsafe_b64decode(payload_b64)
            expected = hmac.new(self._secret, raw, hashlib.sha256).digest()
            actual = _urlsafe_b64decode(sig_b64)
            if not hmac.compare_digest(expected, actual):
                return None
            payload = json.loads(raw.decode("utf-8"))
        except Exception:
            return None

        if int(payload.get("exp", 0) or 0) < int(time.time()):
            return None

        path = Path(str(payload.get("path", ""))).expanduser()
        if not path.is_file():
            return None
        return path
