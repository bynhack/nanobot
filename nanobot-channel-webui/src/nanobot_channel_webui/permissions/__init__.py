"""Runtime permission injection for the WebUI plugin."""

from .context import PolicyContext, bind_policy_context, get_policy_context
from .injector import attach_permission_runtime
from .resolver import PolicyResolver

__all__ = [
    "PolicyContext",
    "PolicyResolver",
    "attach_permission_runtime",
    "bind_policy_context",
    "get_policy_context",
]
