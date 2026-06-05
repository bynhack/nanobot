from __future__ import annotations

import asyncio
from types import SimpleNamespace

from nanobot_channel_webui.instances.runtime import (
    ProgrammaticGatewayRuntime,
    ProgrammaticGatewayRuntimeOptions,
    build_programmatic_gateway_runtime,
)


def test_build_programmatic_gateway_runtime_wires_agent_channels_and_hooks(
    monkeypatch, tmp_path
) -> None:
    created: dict[str, object] = {}
    hook = object()
    config = SimpleNamespace(
        workspace_path=tmp_path,
        gateway=SimpleNamespace(port=19001, host="127.0.0.1"),
        agents=SimpleNamespace(defaults=SimpleNamespace(dream=SimpleNamespace(enabled=False))),
        tools=SimpleNamespace(restrict_to_workspace=True),
    )

    class FakeBus:
        pass

    class FakeRuntimeEvents:
        pass

    class FakeSessionManager:
        def __init__(self, workspace):
            created["session_workspace"] = workspace

    class FakeCron:
        def __init__(self, path):
            created["cron_path"] = path

    class FakeAgentLoop:
        @classmethod
        def from_config(cls, cfg, bus, **kwargs):
            created["agent_config"] = cfg
            created["agent_bus"] = bus
            created["agent_kwargs"] = kwargs
            return SimpleNamespace(run=lambda: None, stop=lambda: None, close_mcp=lambda: None)

    class FakeChannelManager:
        def __init__(self, cfg, bus, **kwargs):
            created["channel_config"] = cfg
            created["channel_bus"] = bus
            created["channel_kwargs"] = kwargs
            self.enabled_channels = ["websocket"]

    monkeypatch.setattr("nanobot_channel_webui.instances.runtime.MessageBus", FakeBus)
    monkeypatch.setattr("nanobot_channel_webui.instances.runtime.RuntimeEventBus", FakeRuntimeEvents)
    monkeypatch.setattr("nanobot_channel_webui.instances.runtime.SessionManager", FakeSessionManager)
    monkeypatch.setattr("nanobot_channel_webui.instances.runtime.CronService", FakeCron)
    monkeypatch.setattr("nanobot_channel_webui.instances.runtime.AgentLoop", FakeAgentLoop)
    monkeypatch.setattr("nanobot_channel_webui.instances.runtime.ChannelManager", FakeChannelManager)
    monkeypatch.setattr(
        "nanobot_channel_webui.instances.runtime.image_gen_provider_configs",
        lambda cfg: {"image": "cfg"},
    )

    runtime = build_programmatic_gateway_runtime(
        config,
        ProgrammaticGatewayRuntimeOptions(hooks=[hook], webui_static_dist=False),
    )

    assert runtime.config is config
    assert runtime.enabled_channels == ["websocket"]
    assert created["session_workspace"] == tmp_path
    assert created["cron_path"] == tmp_path / "cron" / "jobs.json"
    assert created["agent_kwargs"]["hooks"] == [hook]
    assert created["agent_kwargs"]["session_manager"] is runtime.session_manager
    assert created["agent_kwargs"]["cron_service"] is runtime.cron
    assert created["agent_kwargs"]["runtime_events"] is runtime.runtime_events
    assert created["agent_kwargs"]["image_generation_provider_configs"] == {"image": "cfg"}
    assert created["channel_kwargs"]["session_manager"] is runtime.session_manager
    assert created["channel_kwargs"]["webui_static_dist"] is False


def test_build_programmatic_gateway_runtime_filters_legacy_agent_kwargs(
    monkeypatch,
    tmp_path,
) -> None:
    created: dict[str, object] = {}
    config = SimpleNamespace(
        workspace_path=tmp_path,
        agents=SimpleNamespace(defaults=SimpleNamespace(dream=SimpleNamespace(enabled=False))),
        tools=SimpleNamespace(restrict_to_workspace=True),
    )

    class FakeBus:
        pass

    class FakeRuntimeEvents:
        pass

    class FakeSessionManager:
        def __init__(self, workspace):
            pass

    class FakeCron:
        def __init__(self, path):
            pass

    class LegacyAgentLoop:
        def __init__(self, cfg, bus, *, cron_service, session_manager, hooks):
            created["agent_kwargs"] = {
                "cron_service": cron_service,
                "session_manager": session_manager,
                "hooks": hooks,
            }

        @classmethod
        def from_config(cls, cfg, bus, **kwargs):
            return cls(cfg, bus, **kwargs)

    class FakeChannelManager:
        enabled_channels: list[str] = []

        def __init__(self, cfg, bus, **kwargs):
            pass

    monkeypatch.setattr("nanobot_channel_webui.instances.runtime.MessageBus", FakeBus)
    monkeypatch.setattr("nanobot_channel_webui.instances.runtime.RuntimeEventBus", FakeRuntimeEvents)
    monkeypatch.setattr("nanobot_channel_webui.instances.runtime.SessionManager", FakeSessionManager)
    monkeypatch.setattr("nanobot_channel_webui.instances.runtime.CronService", FakeCron)
    monkeypatch.setattr("nanobot_channel_webui.instances.runtime.AgentLoop", LegacyAgentLoop)
    monkeypatch.setattr("nanobot_channel_webui.instances.runtime.ChannelManager", FakeChannelManager)
    monkeypatch.setattr(
        "nanobot_channel_webui.instances.runtime.image_gen_provider_configs",
        lambda cfg: {"image": "cfg"},
    )

    build_programmatic_gateway_runtime(config, ProgrammaticGatewayRuntimeOptions())

    assert set(created["agent_kwargs"]) == {"cron_service", "session_manager", "hooks"}


async def _wait_until(predicate, *, timeout: float = 1.0) -> None:
    deadline = asyncio.get_running_loop().time() + timeout
    while asyncio.get_running_loop().time() < deadline:
        if predicate():
            return
        await asyncio.sleep(0.01)
    raise AssertionError("condition was not reached before timeout")


def test_programmatic_gateway_runtime_start_and_stop_lifecycle() -> None:
    events: list[str] = []

    class FakeAgent:
        def __init__(self) -> None:
            self._stopped = asyncio.Event()

        async def run(self) -> None:
            events.append("agent.run")
            await self._stopped.wait()
            events.append("agent.done")

        def stop(self) -> None:
            events.append("agent.stop")
            self._stopped.set()

        async def close_mcp(self) -> None:
            events.append("agent.close_mcp")

    class FakeChannels:
        enabled_channels = ["websocket"]

        def __init__(self) -> None:
            self._stopped = asyncio.Event()

        async def start_all(self) -> None:
            events.append("channels.start_all")
            await self._stopped.wait()
            events.append("channels.done")

        async def stop_all(self) -> None:
            events.append("channels.stop_all")
            self._stopped.set()

    async def run_case() -> None:
        runtime = ProgrammaticGatewayRuntime(
            config=object(),
            bus=object(),
            runtime_events=object(),
            session_manager=object(),
            cron=SimpleNamespace(
                start=lambda: events.append("cron.start"),
                stop=lambda: events.append("cron.stop"),
            ),
            agent=FakeAgent(),
            channels=FakeChannels(),
        )

        await runtime.start()
        await _wait_until(lambda: "agent.run" in events and "channels.start_all" in events)

        await runtime.stop()

    asyncio.run(run_case())

    assert events == [
        "cron.start",
        "agent.run",
        "channels.start_all",
        "agent.stop",
        "channels.stop_all",
        "cron.stop",
        "agent.close_mcp",
        "agent.done",
        "channels.done",
    ]


def test_programmatic_gateway_runtime_start_is_idempotent_for_cron() -> None:
    events: list[str] = []

    class FakeCron:
        async def start(self) -> None:
            events.append("cron.start")

        def stop(self) -> None:
            events.append("cron.stop")

    class FakeAgent:
        def __init__(self) -> None:
            self._stopped = asyncio.Event()

        async def run(self) -> None:
            await self._stopped.wait()

        def stop(self) -> None:
            events.append("agent.stop")
            self._stopped.set()

        async def close_mcp(self) -> None:
            events.append("agent.close_mcp")

    class FakeChannels:
        enabled_channels: list[str] = []

        def __init__(self) -> None:
            self._stopped = asyncio.Event()

        async def start_all(self) -> None:
            await self._stopped.wait()

        async def stop_all(self) -> None:
            events.append("channels.stop_all")
            self._stopped.set()

    async def run_case() -> None:
        runtime = ProgrammaticGatewayRuntime(
            config=object(),
            bus=object(),
            runtime_events=object(),
            session_manager=object(),
            cron=FakeCron(),
            agent=FakeAgent(),
            channels=FakeChannels(),
        )

        await runtime.start()
        await runtime.start()
        await runtime.stop()

    asyncio.run(run_case())

    assert events.count("cron.start") == 1
