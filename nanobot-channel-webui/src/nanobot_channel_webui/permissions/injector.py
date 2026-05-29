"""Runtime permission injection."""

from __future__ import annotations

import gc
from pathlib import Path
from typing import Any

from loguru import logger

from .audit import PermissionAuditLogger
from .memory_store import AuthorizingMemoryStore
from .skills_loader import AuthorizingSkillsLoader
from .tool_registry import AuthorizingToolRegistry

_INJECTED_ATTR = "_nanobot_webui_permission_injected"


def attach_permission_runtime(bus: Any, *, workspace: Path) -> bool:
    """Attach permission wrappers to the live AgentLoop for this bus."""
    loop = _find_agent_loop(bus)
    if loop is None:
        return False
    if getattr(loop, _INJECTED_ATTR, False):
        return True

    audit = PermissionAuditLogger(workspace)

    tools = getattr(loop, "tools", None)
    if tools is not None and not getattr(tools, "_nanobot_webui_permission_wrapper", False):
        loop.tools = AuthorizingToolRegistry(tools, audit=audit, workspace=workspace)

    context = getattr(loop, "context", None)
    memory = getattr(context, "memory", None)
    if memory is not None and not getattr(memory, "_nanobot_webui_permission_wrapper", False):
        context.memory = AuthorizingMemoryStore(memory)

    skills = getattr(context, "skills", None)
    if skills is not None and not getattr(skills, "_nanobot_webui_permission_wrapper", False):
        context.skills = AuthorizingSkillsLoader(skills, workspace=workspace)

    setattr(loop, _INJECTED_ATTR, True)
    logger.info("WebUI permission runtime injected into AgentLoop")
    return True


def _find_agent_loop(bus: Any) -> Any | None:
    from nanobot.agent.loop import AgentLoop

    for obj in gc.get_objects():
        if isinstance(obj, AgentLoop) and getattr(obj, "bus", None) is bus:
            return obj
    return None
