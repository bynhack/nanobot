from __future__ import annotations

import asyncio
import importlib
from pathlib import Path
import sys
import tomllib
from types import SimpleNamespace

import pytest

ROOT = Path(__file__).resolve().parents[1]


def _load_real_cli_module():
    for name in list(sys.modules):
        if name == "nanobot_channel_webui" or name.startswith("nanobot_channel_webui."):
            sys.modules.pop(name)
    importlib.invalidate_caches()
    return importlib.import_module("nanobot_channel_webui.cli")


def test_gateway_command_loads_webui_channel_config_and_starts_control_plane(monkeypatch) -> None:
    cli = _load_real_cli_module()

    events: dict[str, object] = {}

    class FakeChannel:
        def __init__(self, config, bus):
            events["config"] = config
            events["bus"] = bus

        async def start(self) -> None:
            events["started"] = True

        async def stop(self) -> None:
            events["stopped"] = True

    class FakeBus:
        pass

    loaded = SimpleNamespace(
        channels=SimpleNamespace(
            webui_plugin={
                "enabled": True,
                "host": "0.0.0.0",
                "port": 18081,
                "title": "企业助手",
            }
        )
    )

    loaded_paths: list[object] = []
    monkeypatch.setattr(cli, "load_config", lambda path: loaded_paths.append(path) or loaded)
    monkeypatch.setattr(cli, "resolve_config_env_vars", lambda config: config)
    monkeypatch.setattr(cli, "MessageBus", FakeBus)
    monkeypatch.setattr(cli, "WebUIChannel", FakeChannel)

    cli.main(["gateway", "--config", "/tmp/nanobot-config.json"])

    assert events["started"] is True
    assert events["stopped"] is True
    assert isinstance(events["bus"], FakeBus)
    assert loaded_paths == [Path("/tmp/nanobot-config.json")]
    config = events["config"]
    if isinstance(config, dict):
        assert config["host"] == "0.0.0.0"
        assert config["port"] == 18081
        assert config["title"] == "企业助手"
    else:
        assert config.host == "0.0.0.0"
        assert config.port == 18081
        assert config.title == "企业助手"


def test_webui_config_from_nanobot_config_returns_attribute_config() -> None:
    cli = _load_real_cli_module()

    config = cli.webui_config_from_nanobot_config(
        SimpleNamespace(channels=SimpleNamespace(webui_plugin={"port": 18081}))
    )

    assert config.enabled is True
    assert config.port == 18081


def test_gateway_command_does_not_build_outer_agent_loop(monkeypatch) -> None:
    cli = _load_real_cli_module()

    class FakeChannel:
        def __init__(self, config, bus):
            pass

        async def start(self) -> None:
            pass

        async def stop(self) -> None:
            pass

    monkeypatch.setattr(cli, "load_config", lambda path: SimpleNamespace(channels=SimpleNamespace()))
    monkeypatch.setattr(cli, "resolve_config_env_vars", lambda config: config)
    monkeypatch.setattr(cli, "WebUIChannel", FakeChannel)

    with pytest.MonkeyPatch.context() as scoped:
        try:
            import nanobot.agent.loop as agent_loop
        except ImportError:
            agent_loop = None
        if agent_loop is not None:
            scoped.setattr(
                agent_loop.AgentLoop,
                "from_config",
                lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError("outer agent built")),
            )
        cli.main(["gateway"])


def test_gateway_runtime_stops_channel_on_cancellation() -> None:
    from nanobot_channel_webui.cli import run_gateway_control_plane

    events: list[str] = []

    class FakeChannel:
        async def start(self) -> None:
            events.append("start")
            await asyncio.Event().wait()

        async def stop(self) -> None:
            events.append("stop")

    async def run_case() -> None:
        task = asyncio.create_task(run_gateway_control_plane(FakeChannel()))
        await asyncio.sleep(0)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

    asyncio.run(run_case())

    assert events == ["start", "stop"]


def test_project_exposes_nanobot_webui_console_script() -> None:
    pyproject = tomllib.loads((ROOT / "pyproject.toml").read_text(encoding="utf-8"))

    assert pyproject["project"]["scripts"]["nanobot-webui"] == "nanobot_channel_webui.cli:main"


def test_publish_script_installs_webui_package_as_tool() -> None:
    script = (ROOT / "scripts" / "publish-local.sh").read_text(encoding="utf-8")

    assert 'uv tool install "$WHEEL_PATH" --force' in script
    assert "nanobot-ai --with" not in script
