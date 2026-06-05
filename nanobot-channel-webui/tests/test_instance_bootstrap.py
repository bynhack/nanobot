from __future__ import annotations

from types import SimpleNamespace

from nanobot_channel_webui.instances.bootstrap import (
    ManagedInstanceBootstrapService,
)
from nanobot_channel_webui.instances.manager import ManagedInstanceSpec
from nanobot_channel_webui.instances.runtime import ProgrammaticGatewayRuntimeOptions
from nanobot_channel_webui.instances.workspace import InstanceWorkspaceSpec
from nanobot_channel_webui.user_context import CurrentUser


def test_bootstrap_service_starts_user_instance_and_returns_websocket_payload(tmp_path) -> None:
    events: list[object] = []
    user = CurrentUser(id="u1", email="u1@example.com", role="user", token="auth")
    websocket_config = {
        "host": "127.0.0.1",
        "port": 19101,
        "path": "/",
        "token": "ws-token",
    }
    spec = ManagedInstanceSpec(
        instance_id="user-u1",
        config=SimpleNamespace(
            gateway=SimpleNamespace(host="127.0.0.1", port=19100),
            channels=SimpleNamespace(websocket=websocket_config),
        ),
        config_path=tmp_path / "instances" / "user-u1" / "config.json",
        workspace=InstanceWorkspaceSpec(
            workspace=tmp_path / "workspace",
            skill_bundles=[],
            policy={"user_id": "u1"},
        ),
        runtime_options=ProgrammaticGatewayRuntimeOptions(),
    )

    class FakeBuilder:
        def build_for_user(self, got_user, base_config):
            events.append(("build", got_user, base_config))
            return spec

    class FakeManager:
        async def start_instance(self, got_spec):
            events.append(("start", got_spec))

    async def fake_bootstrap_client(*, host, port, token):
        events.append(("bootstrap", host, port, token))
        return {
            "token": "issued-token",
            "ws_url": "ws://127.0.0.1:19101/",
            "ws_path": "/",
            "expires_in": 300,
            "runtime_surface": "browser",
            "runtime_capabilities": {"files": True},
        }

    service = ManagedInstanceBootstrapService(
        builder=FakeBuilder(),
        manager=FakeManager(),
        base_config=object(),
        bootstrap_client=fake_bootstrap_client,
    )

    payload = service.bootstrap_for_user_sync_for_test(user)

    assert payload == {
        "instance_id": "user-u1",
        "ws_url": "ws://127.0.0.1:19101/",
        "ws_path": "/",
        "token": "issued-token",
        "gateway_port": 19100,
        "websocket_port": 19101,
        "expires_in": 300,
        "runtime_surface": "browser",
        "runtime_capabilities": {"files": True},
    }
    assert events[0][0] == "build"
    assert events[1] == ("start", spec)
    assert events[2] == ("bootstrap", "127.0.0.1", 19101, "ws-token")
