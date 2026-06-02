"""CLI entry point for plugin-packaged business modules."""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from importlib import resources
from pathlib import Path


def main(argv: list[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    if not args or args[0] in {"-h", "--help", "help"}:
        print("Usage: nanobot-webui-business hr <hr-command> [options]", file=sys.stderr)
        return 0
    module = args.pop(0)
    if module != "hr":
        print(f"Unknown business module: {module}", file=sys.stderr)
        return 2
    return run_hr(args)


def run_hr(args: list[str]) -> int:
    node = _find_node()
    if not node:
        print("Unable to find node. Install node or configure PATH/NVM_DIR.", file=sys.stderr)
        return 127

    script = Path(str(resources.files("nanobot_channel_webui.business_modules.hr") / "skills" / "hr-db-ops" / "scripts" / "hr_cli.mjs"))
    env = os.environ.copy()
    env.setdefault("NANOBOT_WEBUI_SUPABASE_CONNECTOR", _packaged_supabase_connector().as_uri())
    env.setdefault("NANOBOT_CONFIG", str(Path.home() / ".nanobot" / "config.json"))
    completed = subprocess.run([node, str(script), *args], env=env)
    return int(completed.returncode)


def _packaged_supabase_connector() -> Path:
    connector = Path(
        str(resources.files("nanobot_channel_webui.business_modules.hr") / "supabase_connector.mjs")
    )
    dependency = connector.parent / "node_modules" / "@supabase" / "supabase-js" / "package.json"
    if not dependency.exists():
        print(
            "Packaged HR Supabase runtime is incomplete: "
            f"missing {dependency}. Rebuild the plugin with scripts/publish-local.sh.",
            file=sys.stderr,
        )
    return connector


def _find_node() -> str:
    found = shutil.which("node")
    if found:
        return found
    nvm_dir = os.environ.get("NVM_DIR")
    candidates: list[Path] = []
    if nvm_dir:
        candidates.extend(Path(nvm_dir).glob("versions/node/*/bin/node"))
    candidates.extend((Path.home() / ".nvm" / "versions" / "node").glob("*/bin/node"))
    for candidate in candidates:
        if candidate.exists() and os.access(candidate, os.X_OK):
            return str(candidate)
    return ""


if __name__ == "__main__":
    raise SystemExit(main())
