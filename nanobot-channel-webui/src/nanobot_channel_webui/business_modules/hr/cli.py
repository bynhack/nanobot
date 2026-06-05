"""CLI entry point for plugin-packaged business modules."""

from __future__ import annotations

import os
import sys
from pathlib import Path

from .runtime import commands


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
    env = os.environ.copy()
    _set_default_policy_file(env, Path.cwd())
    env.setdefault("NANOBOT_CONFIG", str(Path.home() / ".nanobot" / "config.json"))
    previous_policy = os.environ.get("NANOBOT_WEBUI_POLICY_FILE")
    previous_config = os.environ.get("NANOBOT_CONFIG")
    try:
        os.environ.update(env)
        return commands.main(args)
    finally:
        _restore_env("NANOBOT_WEBUI_POLICY_FILE", previous_policy)
        _restore_env("NANOBOT_CONFIG", previous_config)


def _set_default_policy_file(env: dict[str, str], cwd: Path) -> None:
    if env.get("NANOBOT_WEBUI_POLICY_FILE"):
        return
    policy_file = cwd / ".nanobot_channel_webui" / "policies" / "policy.json"
    if policy_file.exists():
        env["NANOBOT_WEBUI_POLICY_FILE"] = str(policy_file)


def _restore_env(key: str, previous: str | None) -> None:
    if previous is None:
        os.environ.pop(key, None)
    else:
        os.environ[key] = previous


if __name__ == "__main__":
    raise SystemExit(main())
