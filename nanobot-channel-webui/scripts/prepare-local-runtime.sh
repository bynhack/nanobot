#!/usr/bin/env bash
set -euo pipefail

SOURCE_INSTANCE_DIR="${NANOBOT_WEBUI_LEGACY_HOME:-$HOME/.nanobot}"
TARGET_INSTANCE_DIR="${CASEWORK_HOME:-$HOME/.casework}"
TARGET_WORKSPACE_DIR="$TARGET_INSTANCE_DIR/workspace"
SOURCE_CONFIG="$SOURCE_INSTANCE_DIR/config.json"
TARGET_CONFIG="$TARGET_INSTANCE_DIR/config.json"

mkdir -p "$TARGET_INSTANCE_DIR"

python - "$SOURCE_INSTANCE_DIR" "$TARGET_INSTANCE_DIR" "$TARGET_WORKSPACE_DIR" "$SOURCE_CONFIG" "$TARGET_CONFIG" <<'PY'
from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path
from typing import Any

source_instance = Path(sys.argv[1]).expanduser()
target_instance = Path(sys.argv[2]).expanduser()
target_workspace = Path(sys.argv[3]).expanduser()
source_config = Path(sys.argv[4]).expanduser()
target_config = Path(sys.argv[5]).expanduser()

source_workspace = source_instance / "workspace"
workspace_value = "~/.casework/workspace"
legacy_workspace_values = {
    "~/.nanobot/workspace",
    str(source_workspace),
}


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


def update_workspace_skill_references(workspace: Path) -> None:
    update_text_references(workspace / "skills", workspace)


def update_workspace_data_references(workspace: Path) -> None:
    update_text_references(workspace / "data", workspace)


def update_text_references(root: Path, workspace: Path) -> None:
    if not root.exists():
        return
    replacements = {
        str(source_workspace): str(workspace),
        "~/.nanobot/workspace": "~/.casework/workspace",
        "/Users/brian/.nanobot/workspace": str(workspace),
        f"{workspace}/.nanobot_channel_webui/case_graphs": f"{workspace}/data/case_graphs",
        f"{workspace}/.nanobot_channel_webui/case_graph_contexts": f"{workspace}/data/case_graph_contexts",
        f"{workspace}/.nanobot_channel_webui/case_audits": f"{workspace}/data/case_audits",
        f"{workspace}/.nanobot_channel_webui/workspaces": f"{workspace}/data/chat_workspaces",
        f"{workspace}/.nanobot_webui_uploads": f"{workspace}/data/uploads",
        f"{workspace}/.nanobot_channel_webui_deleted_sessions.json": f"{workspace}/data/deleted_sessions.json",
        'WORKSPACE_ROOT / ".nanobot_channel_webui" / "case_graphs"': 'WORKSPACE_ROOT / "data" / "case_graphs"',
        'WORKSPACE_ROOT / ".nanobot_channel_webui" / "case_graph_contexts"': 'WORKSPACE_ROOT / "data" / "case_graph_contexts"',
        'WORKSPACE_ROOT / ".nanobot_channel_webui" / "case_audits"': 'WORKSPACE_ROOT / "data" / "case_audits"',
        'WORKSPACE_ROOT / ".nanobot_channel_webui" / "workspaces"': 'WORKSPACE_ROOT / "data" / "chat_workspaces"',
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


def replace_legacy_workspace(value: Any) -> Any:
    if isinstance(value, str):
        result = value
        for legacy in legacy_workspace_values:
            result = result.replace(legacy, workspace_value)
        return result
    if isinstance(value, list):
        return [replace_legacy_workspace(item) for item in value]
    if isinstance(value, dict):
        return {key: replace_legacy_workspace(item) for key, item in value.items()}
    return value


def load_config() -> dict[str, Any]:
    source = target_config if target_config.exists() else source_config
    if not source.exists():
        return {}
    with source.open("r", encoding="utf-8") as handle:
        data = json.load(handle)
    if not isinstance(data, dict):
        raise SystemExit(f"Config root must be a JSON object: {source}")
    return data


copy_dir_contents(source_workspace, target_workspace)
for name in ("cron", "media", "logs"):
    copy_dir_contents(source_instance / name, target_instance / name)
migrate_workspace_product_data(target_workspace)
update_workspace_skill_references(target_workspace)
update_workspace_data_references(target_workspace)

config = replace_legacy_workspace(load_config())
agents = config.setdefault("agents", {})
if not isinstance(agents, dict):
    raise SystemExit("Config field 'agents' must be an object")
defaults = agents.setdefault("defaults", {})
if not isinstance(defaults, dict):
    raise SystemExit("Config field 'agents.defaults' must be an object")
defaults["workspace"] = workspace_value

target_config.write_text(
    json.dumps(config, ensure_ascii=False, indent=2) + "\n",
    encoding="utf-8",
)
PY

echo "Runtime config: $TARGET_CONFIG"
echo "Runtime workspace: $TARGET_WORKSPACE_DIR"
