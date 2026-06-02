"""Compatibility imports for the WebUI tenant runtime implementation.

New integration code should import from `nanobot_channel_webui.tenant_runtime`.
This package remains the implementation home for the current wrappers to avoid
breaking existing imports during the tenant-runtime rename.
"""

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
