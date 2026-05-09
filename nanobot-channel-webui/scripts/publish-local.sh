#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FRONTEND_DIR="$ROOT_DIR/frontend"
STATIC_DIR="$ROOT_DIR/static"
PACKAGE_STATIC_DIR="$ROOT_DIR/src/nanobot_channel_webui/static"
DIST_DIR="$ROOT_DIR/dist"

echo "[1/5] Building frontend assets"
cd "$FRONTEND_DIR"
npm run build

echo "[2/5] Syncing static assets into Python package"
mkdir -p "$PACKAGE_STATIC_DIR"
rsync -a --delete "$STATIC_DIR/" "$PACKAGE_STATIC_DIR/"

echo "[3/5] Building wheel"
cd "$ROOT_DIR"
rm -f "$DIST_DIR"/*
uv build

WHEEL_PATH="$(find "$DIST_DIR" -maxdepth 1 -name '*.whl' -print | sort | tail -n 1)"
if [[ -z "${WHEEL_PATH:-}" ]]; then
  echo "No wheel found in $DIST_DIR" >&2
  exit 1
fi

echo "[4/5] Installing plugin into global nanobot tool env"
uv tool install nanobot-ai --with "$WHEEL_PATH" --force

echo "[5/5] Done"
echo "Installed wheel: $WHEEL_PATH"
echo "Start with: nanobot gateway --config ~/.nanobot/config.json"
