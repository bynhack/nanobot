"""Lifecycle manager for Nanobot gateway instance processes."""

from __future__ import annotations

import asyncio
import os
from dataclasses import dataclass, field
from pathlib import Path
import signal
from typing import Any

from .runtime import ProgrammaticGatewayRuntimeOptions
from .workspace import InstanceWorkspaceSpec, sync_instance_workspace


@dataclass(frozen=True, slots=True)
class ManagedInstanceSpec:
    """Desired runtime state for one managed Nanobot instance."""

    instance_id: str
    config: Any
    config_path: Path
    workspace: InstanceWorkspaceSpec
    environment: dict[str, str] = field(default_factory=dict)
    runtime_options: ProgrammaticGatewayRuntimeOptions = field(
        default_factory=ProgrammaticGatewayRuntimeOptions
    )


@dataclass(slots=True)
class ManagedInstanceProcess:
    """One user instance backed by the upstream ``nanobot gateway`` CLI."""

    process: asyncio.subprocess.Process
    log_handle: Any
    config_path: Path
    workspace: Path

    async def stop(self) -> None:
        if self.process.returncode is None:
            self.process.send_signal(signal.SIGTERM)
            try:
                await asyncio.wait_for(self.process.wait(), timeout=10)
            except asyncio.TimeoutError:
                self.process.kill()
                await self.process.wait()
        self.log_handle.close()


class ManagedInstanceManager:
    """Prepare, cache, start, and stop managed Nanobot gateway processes."""

    def __init__(self, *, command: tuple[str, ...] = ("nanobot", "gateway")) -> None:
        self._command = command
        self._runtimes: dict[str, ManagedInstanceProcess] = {}

    def get_runtime(self, instance_id: str) -> ManagedInstanceProcess | None:
        return self._runtimes.get(instance_id)

    async def ensure_runtime(self, spec: ManagedInstanceSpec) -> ManagedInstanceProcess:
        runtime = self._runtimes.get(spec.instance_id)
        if runtime is not None and runtime.process.returncode is None:
            return runtime
        if runtime is not None:
            runtime.log_handle.close()
            self._runtimes.pop(spec.instance_id, None)
        sync_instance_workspace(spec.workspace)
        _write_config_snapshot(spec.config_path, spec.config)
        runtime = await self._start_process(spec)
        self._runtimes[spec.instance_id] = runtime
        return runtime

    async def start_instance(self, spec: ManagedInstanceSpec) -> ManagedInstanceProcess:
        return await self.ensure_runtime(spec)

    async def stop_instance(self, instance_id: str) -> None:
        runtime = self._runtimes.pop(instance_id, None)
        if runtime is None:
            return
        await runtime.stop()

    async def stop_all(self) -> None:
        """Stop every cached runtime managed by this WebUI channel."""

        instance_ids = list(self._runtimes)
        for instance_id in instance_ids:
            await self.stop_instance(instance_id)

    async def _start_process(self, spec: ManagedInstanceSpec) -> ManagedInstanceProcess:
        workspace = spec.workspace.workspace.expanduser()
        instance_dir = spec.config_path.expanduser().parent
        logs_dir = instance_dir / "logs"
        logs_dir.mkdir(parents=True, exist_ok=True)
        log_handle = (logs_dir / "gateway.log").open("ab")
        env = os.environ.copy()
        env["NANOBOT_CONFIG"] = str(spec.config_path)
        env["NANOBOT_WEBUI_INSTANCE_ID"] = spec.instance_id
        env["NANOBOT_WEBUI_POLICY_FILE"] = str(
            workspace / ".nanobot_channel_webui" / "policies" / "policy.json"
        )
        env.update({key: value for key, value in spec.environment.items() if value})
        process = await asyncio.create_subprocess_exec(
            *self._command,
            "--config",
            str(spec.config_path),
            cwd=str(workspace),
            env=env,
            stdout=log_handle,
            stderr=asyncio.subprocess.STDOUT,
        )
        return ManagedInstanceProcess(
            process=process,
            log_handle=log_handle,
            config_path=spec.config_path,
            workspace=workspace,
        )


def _write_config_snapshot(path: Path, config: Any) -> None:
    path = path.expanduser()
    path.parent.mkdir(parents=True, exist_ok=True)
    dump_json = getattr(config, "model_dump_json", None)
    if callable(dump_json):
        text = dump_json(by_alias=True, indent=2)
    else:
        import json

        payload = config.model_dump(by_alias=True, mode="json") if hasattr(config, "model_dump") else config
        text = json.dumps(payload, ensure_ascii=False, indent=2)
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(text if text.endswith("\n") else text + "\n", encoding="utf-8")
    tmp.replace(path)
