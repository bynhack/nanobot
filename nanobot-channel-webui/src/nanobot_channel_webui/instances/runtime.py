"""Programmatic gateway runtime for managed Nanobot instances."""

from __future__ import annotations

import asyncio
from contextlib import suppress
from dataclasses import dataclass, field
import inspect
from typing import Any

from nanobot.agent.loop import AgentLoop
from nanobot.bus.queue import MessageBus
from nanobot.channels.manager import ChannelManager
from nanobot.cron.service import CronService
from nanobot.providers.image_generation import image_gen_provider_configs
from nanobot.session.manager import SessionManager

try:
    from nanobot.bus.runtime_events import RuntimeEventBus
except ImportError:
    class RuntimeEventBus:  # type: ignore[no-redef]
        """Compatibility shim for Nanobot versions without runtime event bus."""

        pass


@dataclass(slots=True)
class ProgrammaticGatewayRuntimeOptions:
    """Options for building a managed gateway runtime."""

    hooks: list[Any] = field(default_factory=list)
    webui_static_dist: bool = True
    webui_runtime_surface: str = "browser"
    webui_runtime_capabilities: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class ProgrammaticGatewayRuntime:
    """A Nanobot gateway runtime composed without shelling out to the CLI."""

    config: Any
    bus: Any
    runtime_events: Any
    session_manager: Any
    cron: Any
    agent: Any
    channels: Any
    _tasks: list[asyncio.Task[Any]] = field(default_factory=list, init=False)
    _started: bool = field(default=False, init=False)

    @property
    def enabled_channels(self) -> list[str]:
        return list(getattr(self.channels, "enabled_channels", []))

    async def start(self) -> None:
        """Start the agent loop and configured channels for this instance."""

        if self._started:
            return
        self._started = True
        cron_start = getattr(self.cron, "start", None)
        if cron_start is not None:
            result = cron_start()
            if asyncio.iscoroutine(result):
                await result
        self._tasks = [
            asyncio.create_task(self.agent.run(), name="nanobot-webui-instance-agent"),
            asyncio.create_task(
                self.channels.start_all(),
                name="nanobot-webui-instance-channels",
            ),
        ]

    async def stop(self) -> None:
        """Stop the runtime and wait for background tasks to settle."""

        if not self._started:
            return
        with suppress(Exception):
            self.agent.stop()
        with suppress(Exception):
            await self.channels.stop_all()
        with suppress(Exception):
            self.cron.stop()
        close_mcp = getattr(self.agent, "close_mcp", None)
        if close_mcp is not None:
            with suppress(Exception):
                await close_mcp()
        pending = [task for task in self._tasks if not task.done()]
        if pending:
            done, still_pending = await asyncio.wait(pending, timeout=5)
            for task in done:
                with suppress(Exception):
                    task.result()
            for task in still_pending:
                task.cancel()
            for task in still_pending:
                with suppress(asyncio.CancelledError):
                    await task
        self._tasks = []
        self._started = False


def build_programmatic_gateway_runtime(
    config: Any,
    options: ProgrammaticGatewayRuntimeOptions | None = None,
) -> ProgrammaticGatewayRuntime:
    """Build the same core pieces as ``nanobot gateway`` for one managed instance."""

    opts = options or ProgrammaticGatewayRuntimeOptions()
    bus = MessageBus()
    runtime_events = RuntimeEventBus()
    session_manager = SessionManager(config.workspace_path)
    cron = CronService(config.workspace_path / "cron" / "jobs.json")
    agent_kwargs = _agent_from_config_kwargs(
        AgentLoop,
        {
            "cron_service": cron,
            "session_manager": session_manager,
            "hooks": list(opts.hooks),
            "image_generation_provider_configs": image_gen_provider_configs(config),
            "runtime_events": runtime_events,
        },
    )
    agent = AgentLoop.from_config(config, bus, **agent_kwargs)
    channel_kwargs = _supported_kwargs(
        ChannelManager,
        {
            "session_manager": session_manager,
            "webui_static_dist": opts.webui_static_dist,
            "webui_runtime_surface": opts.webui_runtime_surface,
            "webui_runtime_capabilities": opts.webui_runtime_capabilities,
        },
    )
    channels = ChannelManager(config, bus, **channel_kwargs)
    return ProgrammaticGatewayRuntime(
        config=config,
        bus=bus,
        runtime_events=runtime_events,
        session_manager=session_manager,
        cron=cron,
        agent=agent,
        channels=channels,
    )


def _supported_kwargs(callable_obj: Any, kwargs: dict[str, Any]) -> dict[str, Any]:
    """Keep compatibility with Nanobot versions that predate newer gateway kwargs."""

    try:
        signature = inspect.signature(callable_obj)
    except (TypeError, ValueError):
        return kwargs
    parameters = signature.parameters.values()
    if any(param.kind == inspect.Parameter.VAR_KEYWORD for param in parameters):
        return kwargs
    supported = set(signature.parameters)
    return {key: value for key, value in kwargs.items() if key in supported}


def _agent_from_config_kwargs(agent_loop_cls: Any, kwargs: dict[str, Any]) -> dict[str, Any]:
    """Filter AgentLoop extras by the constructor that ``from_config`` delegates into."""

    init = getattr(agent_loop_cls, "__init__", None)
    if init is not None and init is not object.__init__:
        return _supported_kwargs(init, kwargs)
    return _supported_kwargs(agent_loop_cls.from_config, kwargs)
