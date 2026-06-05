from __future__ import annotations

import asyncio
from types import SimpleNamespace

from nanobot_channel_webui.instances.manager import (
    ManagedInstanceManager,
    ManagedInstanceSpec,
)
from nanobot_channel_webui.instances.workspace import InstanceWorkspaceSpec


class FakeProcess:
    def __init__(self, label: str = "") -> None:
        self.label = label
        self.returncode: int | None = None
        self.signals: list[int] = []
        self.killed = False

    def send_signal(self, sig: int) -> None:
        self.signals.append(sig)
        self.returncode = 0

    async def wait(self) -> int:
        self.returncode = 0
        return 0

    def kill(self) -> None:
        self.killed = True
        self.returncode = -9


def _config(workspace) -> SimpleNamespace:
    return SimpleNamespace(
        workspace_path=workspace,
        model_dump_json=lambda **_kwargs: '{"ok": true}',
    )


def _spec(tmp_path, instance_id: str = "user-u1") -> ManagedInstanceSpec:
    workspace = tmp_path / "instances" / instance_id / "workspace"
    return ManagedInstanceSpec(
        instance_id=instance_id,
        config=_config(workspace),
        config_path=tmp_path / "instances" / instance_id / "config.json",
        workspace=InstanceWorkspaceSpec(
            workspace=workspace,
            skill_bundles=[],
            policy={"user_id": instance_id},
        ),
        environment={"NANOBOT_WEBUI_SUPABASE_URL": "https://example.supabase.co"},
    )


def test_managed_instance_manager_syncs_workspace_writes_config_and_starts_gateway(
    monkeypatch,
    tmp_path,
) -> None:
    calls: list[tuple[str, object]] = []
    process = FakeProcess("u1")
    spec = _spec(tmp_path)

    def fake_sync(workspace_spec):
        calls.append(("sync", workspace_spec))

    async def fake_create_subprocess_exec(*args, **kwargs):
        calls.append(("exec", (args, kwargs)))
        return process

    monkeypatch.setattr("nanobot_channel_webui.instances.manager.sync_instance_workspace", fake_sync)
    monkeypatch.setattr(
        "nanobot_channel_webui.instances.manager.asyncio.create_subprocess_exec",
        fake_create_subprocess_exec,
    )

    async def run_case() -> None:
        manager = ManagedInstanceManager(command=("nanobot", "gateway"))
        runtime = await manager.ensure_runtime(spec)
        assert runtime.process is process
        assert manager.get_runtime("user-u1") is runtime

    asyncio.run(run_case())

    assert calls[0] == ("sync", spec.workspace)
    assert spec.config_path.read_text(encoding="utf-8") == '{"ok": true}\n'
    exec_args, exec_kwargs = calls[1][1]
    assert exec_args == ("nanobot", "gateway", "--config", str(spec.config_path))
    assert exec_kwargs["cwd"] == str(spec.workspace.workspace)
    assert exec_kwargs["env"]["NANOBOT_CONFIG"] == str(spec.config_path)
    assert exec_kwargs["env"]["NANOBOT_WEBUI_INSTANCE_ID"] == "user-u1"
    assert exec_kwargs["env"]["NANOBOT_WEBUI_POLICY_FILE"] == str(
        spec.workspace.workspace / ".nanobot_channel_webui" / "policies" / "policy.json"
    )
    assert exec_kwargs["env"]["NANOBOT_WEBUI_SUPABASE_URL"] == "https://example.supabase.co"
    assert (tmp_path / "instances" / "user-u1" / "logs").exists()


def test_managed_instance_manager_reuses_running_gateway_process(monkeypatch, tmp_path) -> None:
    starts = 0
    spec = _spec(tmp_path)

    monkeypatch.setattr(
        "nanobot_channel_webui.instances.manager.sync_instance_workspace",
        lambda _spec: None,
    )

    async def fake_create_subprocess_exec(*_args, **_kwargs):
        nonlocal starts
        starts += 1
        return FakeProcess("u1")

    monkeypatch.setattr(
        "nanobot_channel_webui.instances.manager.asyncio.create_subprocess_exec",
        fake_create_subprocess_exec,
    )

    async def run_case() -> None:
        manager = ManagedInstanceManager()
        first = await manager.start_instance(spec)
        second = await manager.start_instance(spec)
        assert first is second

    asyncio.run(run_case())

    assert starts == 1


def test_managed_instance_manager_stops_all_cached_gateway_processes(monkeypatch, tmp_path) -> None:
    processes = [FakeProcess("u1"), FakeProcess("u2")]

    monkeypatch.setattr(
        "nanobot_channel_webui.instances.manager.sync_instance_workspace",
        lambda _spec: None,
    )

    async def fake_create_subprocess_exec(*_args, **_kwargs):
        return processes.pop(0)

    monkeypatch.setattr(
        "nanobot_channel_webui.instances.manager.asyncio.create_subprocess_exec",
        fake_create_subprocess_exec,
    )

    async def run_case() -> None:
        manager = ManagedInstanceManager()
        first = await manager.start_instance(_spec(tmp_path, "user-u1"))
        second = await manager.start_instance(_spec(tmp_path, "user-u2"))
        await manager.stop_all()
        assert manager.get_runtime("user-u1") is None
        assert manager.get_runtime("user-u2") is None
        assert first.process.returncode == 0
        assert second.process.returncode == 0
        assert first.log_handle.closed
        assert second.log_handle.closed

    asyncio.run(run_case())
