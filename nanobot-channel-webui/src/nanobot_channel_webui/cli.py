"""Command line entrypoint for the WebUI control plane."""

from __future__ import annotations

import argparse
import asyncio
from contextlib import suppress
from pathlib import Path
from typing import Any, Sequence

from nanobot.bus.queue import MessageBus
from nanobot.config.loader import load_config, resolve_config_env_vars

from .channel import WebUIChannel
from .config import CHANNEL_NAME, WebUIConfig


async def run_gateway_control_plane(channel: WebUIChannel) -> None:
    """Run the WebUI control plane and stop it cleanly on shutdown."""

    try:
        await channel.start()
    finally:
        with suppress(Exception):
            await channel.stop()


def main(argv: Sequence[str] | None = None) -> int:
    parser = _build_parser()
    args = parser.parse_args(list(argv) if argv is not None else None)
    if args.command == "gateway":
        return _run_gateway(args)
    parser.print_help()
    return 1


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="nanobot-webui")
    subparsers = parser.add_subparsers(dest="command")
    gateway = subparsers.add_parser(
        "gateway",
        help="start the Nanobot WebUI control plane without an outer default agent",
    )
    gateway.add_argument(
        "--config",
        default=None,
        help="path to nanobot config.json; defaults to Nanobot's standard config path",
    )
    return parser


def _run_gateway(args: argparse.Namespace) -> int:
    config_path = Path(args.config).expanduser() if args.config else None
    config = resolve_config_env_vars(load_config(config_path))
    webui_config = webui_config_from_nanobot_config(config)
    channel = WebUIChannel(webui_config, MessageBus())
    try:
        asyncio.run(run_gateway_control_plane(channel))
    except KeyboardInterrupt:
        return 0
    return 0


def webui_config_from_nanobot_config(config: Any) -> WebUIConfig:
    """Extract this plugin's channel config from a Nanobot config object."""

    channels = getattr(config, "channels", None)
    raw = getattr(channels, CHANNEL_NAME, None) if channels is not None else None
    if raw is None:
        return WebUIConfig.model_validate({"enabled": True})
    if isinstance(raw, WebUIConfig):
        data = raw.model_dump(by_alias=True)
        data["enabled"] = True
        return WebUIConfig.model_validate(data)
    if hasattr(raw, "model_dump"):
        raw = raw.model_dump(by_alias=True)
    elif not isinstance(raw, dict):
        raw = {
            key: value
            for key, value in vars(raw).items()
            if not key.startswith("_")
        }
    data = dict(raw)
    data["enabled"] = True
    return WebUIConfig.model_validate(data)


if __name__ == "__main__":
    raise SystemExit(main())
