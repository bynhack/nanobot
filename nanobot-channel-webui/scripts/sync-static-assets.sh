#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATIC_DIR="$ROOT_DIR/static"
PACKAGE_STATIC_DIR="$ROOT_DIR/src/nanobot_channel_webui/static"

if [[ ! -d "$STATIC_DIR" ]]; then
  echo "Static directory not found: $STATIC_DIR" >&2
  exit 1
fi

mkdir -p "$PACKAGE_STATIC_DIR"
rsync -a --delete "$STATIC_DIR/" "$PACKAGE_STATIC_DIR/"

echo "Synced static assets:"
echo "  from: $STATIC_DIR"
echo "  to:   $PACKAGE_STATIC_DIR"
