#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="$ROOT_DIR/dist"

echo "[1/6] Running plugin verification"
cd "$ROOT_DIR"
"$ROOT_DIR/scripts/verify-local.sh"

echo "[2/6] Syncing static assets into Python package"
"$ROOT_DIR/scripts/sync-static-assets.sh"

echo "[3/6] Building wheel"
mkdir -p "$DIST_DIR"
rm -f "$DIST_DIR"/*
uv build --wheel

WHEEL_PATH="$(find "$DIST_DIR" -maxdepth 1 -name '*.whl' -print | sort | tail -n 1)"
if [[ -z "${WHEEL_PATH:-}" ]]; then
  echo "No wheel found in $DIST_DIR" >&2
  exit 1
fi

WHEEL_NAME="$(basename "$WHEEL_PATH")"

echo "[4/6] Installing WebUI control-plane tool"
uv tool install "$WHEEL_PATH" --force

echo "[5/6] Installed wheel details"
echo "  wheel: $WHEEL_NAME"
echo "  path:  $WHEEL_PATH"

echo "[6/6] Done"
echo "Start with: nanobot-webui gateway --config ~/.nanobot/config.json"
