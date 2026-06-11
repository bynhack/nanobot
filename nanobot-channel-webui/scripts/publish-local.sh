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

echo "[4/6] Installing nanobot-ai with WebUI plugin"
if uv tool install --help | grep -q -- "--with-executables-from"; then
  uv tool install nanobot-ai \
    --with "$WHEEL_PATH" \
    --with-executables-from "$WHEEL_PATH" \
    --force
else
  uv tool install nanobot-ai --with "$WHEEL_PATH" --force
  UV_TOOL_DIR="$(uv tool dir)"
  UV_TOOL_BIN_DIR="$(uv tool dir --bin)"
  mkdir -p "$UV_TOOL_BIN_DIR"
  for executable in nanobot-webui nanobot-webui-business; do
    target="$UV_TOOL_DIR/nanobot-ai/bin/$executable"
    if [[ ! -x "$target" ]]; then
      echo "Expected executable not found in nanobot-ai tool env: $target" >&2
      exit 1
    fi
    ln -sfn "$target" "$UV_TOOL_BIN_DIR/$executable"
  done
fi

echo "[5/6] Installed wheel details"
echo "  wheel: $WHEEL_NAME"
echo "  path:  $WHEEL_PATH"

echo "[6/6] Done"
echo "Start with: nanobot-webui gateway --config ~/.nanobot/config.json"
