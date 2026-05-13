#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FRONTEND_DIR="$ROOT_DIR/frontend"
VENV_PYTHON="$ROOT_DIR/../.venv/bin/python"

echo "[1/4] Running Python tests"
"$VENV_PYTHON" -m pytest "$ROOT_DIR/tests" -q

echo "[2/4] Running frontend tests"
cd "$FRONTEND_DIR"
bun run test

echo "[3/4] Building frontend assets"
bun run build

echo "[4/4] Compiling Python sources"
cd "$ROOT_DIR"
python3 -m compileall "$ROOT_DIR/src"

echo "Verification complete"
