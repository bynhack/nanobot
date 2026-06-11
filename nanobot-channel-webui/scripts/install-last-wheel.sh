#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="$ROOT_DIR/dist"

WHEEL_PATH="$(find "$DIST_DIR" -maxdepth 1 -name '*.whl' -print | sort | tail -n 1)"
if [[ -z "${WHEEL_PATH:-}" ]]; then
  echo "No wheel found in $DIST_DIR. Run scripts/publish-local.sh first." >&2
  exit 1
fi

echo "Installing wheel: $(basename "$WHEEL_PATH")"
echo "Wheel path: $WHEEL_PATH"
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
echo "Done"
