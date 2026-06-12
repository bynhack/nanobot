from pathlib import Path

import nanobot_channel_webui.uploads as uploads


def _byte_len(value: str) -> int:
    return len(value.encode("utf-8"))


def test_next_upload_path_shortens_long_filename_component(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(uploads.time, "time", lambda: 1780815153.650)
    long_name = f"{'reset_for_mac_' * 40}.sh"

    path = uploads.next_upload_path(tmp_path, "user-1", "chat-1", long_name)

    assert path.parent == tmp_path / ".nanobot_webui_uploads" / "user-1" / "chat-1"
    assert path.name.startswith("1780815153650_")
    assert path.name.endswith(".sh")
    assert _byte_len(path.name) <= uploads.UPLOAD_FILENAME_COMPONENT_MAX_BYTES
    assert uploads.upload_display_name(long_name) == long_name


def test_next_upload_path_shortens_multibyte_filename_without_splitting_chars(
    tmp_path: Path,
    monkeypatch,
) -> None:
    monkeypatch.setattr(uploads.time, "time", lambda: 1780815153.650)
    long_name = f"{'合同附件' * 80}.pdf"

    path = uploads.next_upload_path(tmp_path, "user-1", "chat-1", long_name)

    assert path.name.startswith("1780815153650_")
    assert path.name.endswith(".pdf")
    assert _byte_len(path.name) <= uploads.UPLOAD_FILENAME_COMPONENT_MAX_BYTES
    path.name.encode("utf-8").decode("utf-8")
