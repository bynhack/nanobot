from __future__ import annotations

from pathlib import Path

from nanobot_channel_webui.media import MediaService


def test_media_tokens_round_trip_across_restart_with_fixed_signing_secret(tmp_path: Path) -> None:
    target = tmp_path / "员工名单.docx"
    target.write_bytes(b"docx-bytes")

    first = MediaService(ttl_seconds=300, signing_secret="stable-secret")
    token = first.issue_token(target)

    second = MediaService(ttl_seconds=300, signing_secret="stable-secret")
    assert second.resolve_token(token) == target


def test_media_tokens_fail_with_different_signing_secret(tmp_path: Path) -> None:
    target = tmp_path / "report.pdf"
    target.write_bytes(b"pdf-bytes")

    first = MediaService(ttl_seconds=300, signing_secret="stable-secret")
    token = first.issue_token(target)

    second = MediaService(ttl_seconds=300, signing_secret="another-secret")
    assert second.resolve_token(token) is None


def test_media_tokens_are_issued_without_expiry(tmp_path: Path) -> None:
    target = tmp_path / "archive.zip"
    target.write_bytes(b"zip-bytes")

    service = MediaService(ttl_seconds=300, signing_secret="stable-secret")
    token = service.issue_token(target)
    assert service.resolve_token(token) == target
