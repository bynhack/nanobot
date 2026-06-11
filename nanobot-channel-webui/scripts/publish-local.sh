#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="$ROOT_DIR/dist"

echo "[1/7] Preparing local casework runtime"
"$ROOT_DIR/scripts/prepare-local-runtime.sh"

echo "[2/7] Running plugin verification"
cd "$ROOT_DIR"
"$ROOT_DIR/scripts/verify-local.sh"

echo "[3/7] Syncing static assets into Python package"
"$ROOT_DIR/scripts/sync-static-assets.sh"

echo "[4/7] Building wheel"
mkdir -p "$DIST_DIR"
rm -f "$DIST_DIR"/*
uv build

WHEEL_PATH="$(find "$DIST_DIR" -maxdepth 1 -name '*.whl' -print | sort | tail -n 1)"
if [[ -z "${WHEEL_PATH:-}" ]]; then
  echo "No wheel found in $DIST_DIR" >&2
  exit 1
fi

WHEEL_NAME="$(basename "$WHEEL_PATH")"

echo "[5/7] Installing plugin into global nanobot tool env"
uv tool install nanobot-ai --with "$WHEEL_PATH" --force

echo "[6/7] Installed wheel details"
echo "  wheel: $WHEEL_NAME"
echo "  path:  $WHEEL_PATH"

echo "[7/7] Done"
echo "Start with: nanobot gateway --config ~/.casework/config.json"
