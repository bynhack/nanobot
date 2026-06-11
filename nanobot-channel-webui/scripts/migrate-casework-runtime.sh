#!/usr/bin/env bash
set -euo pipefail

SOURCE_INSTANCE_DIR="${NANOBOT_WEBUI_LEGACY_HOME:-$HOME/.nanobot}"
TARGET_INSTANCE_DIR="${CASEWORK_HOME:-$HOME/.casework}"
TARGET_WORKSPACE_DIR="$TARGET_INSTANCE_DIR/workspace"

"$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/prepare-local-runtime.sh"

python - "$SOURCE_INSTANCE_DIR" "$TARGET_INSTANCE_DIR" "$TARGET_WORKSPACE_DIR" <<'PY'
from __future__ import annotations

import shutil
import sys
from pathlib import Path

source_instance = Path(sys.argv[1]).expanduser()
target_instance = Path(sys.argv[2]).expanduser()
target_workspace = Path(sys.argv[3]).expanduser()


def copy_dir_contents(source: Path, target: Path) -> None:
    if not source.exists():
        return
    target.mkdir(parents=True, exist_ok=True)
    for child in source.iterdir():
        destination = target / child.name
        if destination.exists() or destination.is_symlink():
            continue
        if child.is_dir() and not child.is_symlink():
            shutil.copytree(child, destination, symlinks=True)
        else:
            shutil.copy2(child, destination, follow_symlinks=False)


def migrate_workspace_product_data(workspace: Path) -> None:
    legacy_root = workspace / ".nanobot_channel_webui"
    data_root = workspace / "data"
    mappings = (
        (legacy_root / "case_graphs", data_root / "case_graphs"),
        (legacy_root / "case_graph_contexts", data_root / "case_graph_contexts"),
        (legacy_root / "case_audits", data_root / "case_audits"),
        (legacy_root / "workspaces", data_root / "chat_workspaces"),
        (workspace / ".nanobot_webui_uploads", data_root / "uploads"),
    )
    for source, target in mappings:
        copy_dir_contents(source, target)
    legacy_deleted = workspace / ".nanobot_channel_webui_deleted_sessions.json"
    deleted = data_root / "deleted_sessions.json"
    deleted.parent.mkdir(parents=True, exist_ok=True)
    if legacy_deleted.exists() and not deleted.exists():
        shutil.copy2(legacy_deleted, deleted, follow_symlinks=False)


def update_text_references(root: Path, workspace: Path) -> None:
    if not root.exists():
        return
    replacements = {
        str(source_instance / "workspace"): str(workspace),
        "~/.nanobot/workspace": "~/.casework/workspace",
        f"{workspace}/.nanobot_channel_webui/case_graphs": f"{workspace}/data/case_graphs",
        f"{workspace}/.nanobot_channel_webui/case_graph_contexts": f"{workspace}/data/case_graph_contexts",
        f"{workspace}/.nanobot_channel_webui/case_audits": f"{workspace}/data/case_audits",
        f"{workspace}/.nanobot_channel_webui/workspaces": f"{workspace}/data/chat_workspaces",
        f"{workspace}/.nanobot_webui_uploads": f"{workspace}/data/uploads",
        f"{workspace}/.nanobot_channel_webui_deleted_sessions.json": f"{workspace}/data/deleted_sessions.json",
        ".nanobot_channel_webui/case_graphs": "data/case_graphs",
        ".nanobot_channel_webui/case_graph_contexts": "data/case_graph_contexts",
        ".nanobot_channel_webui/case_audits": "data/case_audits",
        ".nanobot_channel_webui/workspaces": "data/chat_workspaces",
        ".nanobot_webui_uploads": "data/uploads",
        ".nanobot_channel_webui_deleted_sessions.json": "data/deleted_sessions.json",
    }
    for path in root.rglob("*"):
        if not path.is_file() or path.is_symlink():
            continue
        if path.suffix not in {".md", ".py", ".json", ".jsonl", ".txt", ".sh"} and path.name not in {"SKILL.md"}:
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        updated = text
        for old, new in replacements.items():
            updated = updated.replace(old, new)
        if updated != text:
            path.write_text(updated, encoding="utf-8")


copy_dir_contents(source_instance / "workspace", target_workspace)
for name in ("cron", "media", "logs"):
    copy_dir_contents(source_instance / name, target_instance / name)
migrate_workspace_product_data(target_workspace)
update_text_references(target_workspace / "skills", target_workspace)
update_text_references(target_workspace / "data", target_workspace)
PY

echo "One-time migration complete."
echo "Runtime workspace: $TARGET_WORKSPACE_DIR"
