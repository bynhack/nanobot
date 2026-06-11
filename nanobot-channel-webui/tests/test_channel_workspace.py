from __future__ import annotations

import json

from nanobot.bus.queue import MessageBus
from nanobot.config.loader import set_config_path
from nanobot_channel_webui.channel import WebUIChannel


def test_channel_services_use_active_config_workspace(tmp_path) -> None:
    workspace = tmp_path / "casework" / "workspace"
    config_path = tmp_path / "casework" / "config.json"
    config_path.parent.mkdir(parents=True)
    config_path.write_text(
        json.dumps(
            {
                "agents": {"defaults": {"workspace": str(workspace)}},
                "channels": {"webui_plugin": {"enabled": True}},
            }
        ),
        encoding="utf-8",
    )
    set_config_path(config_path)

    channel = WebUIChannel({"enabled": True}, MessageBus())

    assert channel._sessions.workspace == workspace
    assert channel._case_graph_storage._workspace == workspace
    assert channel._case_graph_relation_service._storage._repository._workspace_root == workspace
    assert channel._case_audit_storage._workspace == workspace
