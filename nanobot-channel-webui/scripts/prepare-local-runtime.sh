#!/usr/bin/env bash
set -euo pipefail

SOURCE_INSTANCE_DIR="${NANOBOT_WEBUI_LEGACY_HOME:-$HOME/.nanobot}"
TARGET_INSTANCE_DIR="${CASEWORK_HOME:-$HOME/.casework}"
TARGET_WORKSPACE_DIR="$TARGET_INSTANCE_DIR/workspace"
SOURCE_CONFIG="$SOURCE_INSTANCE_DIR/config.json"
TARGET_CONFIG="$TARGET_INSTANCE_DIR/config.json"

mkdir -p "$TARGET_INSTANCE_DIR"

python - "$SOURCE_INSTANCE_DIR" "$SOURCE_CONFIG" "$TARGET_CONFIG" <<'PY'
from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

source_instance = Path(sys.argv[1]).expanduser()
source_config = Path(sys.argv[2]).expanduser()
target_config = Path(sys.argv[3]).expanduser()

source_workspace = source_instance / "workspace"
workspace_value = "~/.casework/workspace"
legacy_workspace_values = {
    "~/.nanobot/workspace",
    str(source_workspace),
}


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
