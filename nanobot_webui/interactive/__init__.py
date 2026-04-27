"""Interactive components support for WebUI-only chats."""

from nanobot_webui.interactive.registry import InteractionRegistry, PendingInteraction
from nanobot_webui.interactive.tools import interactive_tools

__all__ = ["InteractionRegistry", "PendingInteraction", "interactive_tools"]
