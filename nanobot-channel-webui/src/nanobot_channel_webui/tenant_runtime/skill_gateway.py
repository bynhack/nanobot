"""Tenant-aware skill gateway exports."""

from __future__ import annotations

from ..permissions.skills_loader import AuthorizingSkillsLoader

SkillGateway = AuthorizingSkillsLoader

__all__ = ["AuthorizingSkillsLoader", "SkillGateway"]
