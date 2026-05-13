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
uv tool install nanobot-ai --with "$WHEEL_PATH" --force
echo "Done"
