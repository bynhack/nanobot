"""Build managed instance specs from authenticated WebUI users."""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from ..permissions.resolver import PolicyResolver
from ..user_context import CurrentUser
from .manager import ManagedInstanceSpec
from .runtime import ProgrammaticGatewayRuntimeOptions
from .workspace import InstanceWorkspaceSpec, SkillBundle, sync_instance_workspace


@dataclass(frozen=True, slots=True)
class InstanceSpecBuilderOptions:
    """Inputs needed to derive one user's managed Nanobot instance."""

    instances_root: Path
    skill_catalog: dict[str, Path] = field(default_factory=dict)
    port_base: int = 19_000
    websocket_port_offset: int = 1
    environment: dict[str, str] = field(default_factory=dict)
    runtime_options: ProgrammaticGatewayRuntimeOptions = field(
        default_factory=ProgrammaticGatewayRuntimeOptions
    )


@dataclass(frozen=True, slots=True)
class InstanceSyncResult:
    """The derived instance spec plus concrete synced workspace path."""

    spec: ManagedInstanceSpec
    workspace: Path


class InstanceSpecBuilder:
    """Convert a login user and base Nanobot config into a managed instance spec."""

    def __init__(
        self,
        options: InstanceSpecBuilderOptions,
        *,
        policy_resolver: PolicyResolver | None = None,
    ) -> None:
        self._options = options
        self._policy_resolver = policy_resolver or PolicyResolver()

    def build_for_user(self, user: CurrentUser, base_config: Any) -> ManagedInstanceSpec:
        policy = self._policy_resolver.resolve(user)
        instance_id = self.instance_id_for_user(user)
        instance_dir = self._options.instances_root.expanduser() / instance_id
        workspace = instance_dir / "workspace"
        config_path = instance_dir / "config.json"
        config = self._copy_config(base_config)
        self._set_workspace(config, workspace)
        self._enforce_workspace_restriction(config)
        port = self._options.port_base + self.port_offset(instance_id)
        self._set_gateway_port(config, port)
        self._enable_websocket_channel(
            config,
            port + self._options.websocket_port_offset,
            token=self.websocket_token(instance_id, workspace),
        )
        bundles = self._skill_bundles_for_allowlist(policy.skill_allowlist)
        workspace_spec = InstanceWorkspaceSpec(
            workspace=workspace,
            skill_bundles=bundles,
            policy=policy.to_policy_payload(),
        )
        return ManagedInstanceSpec(
            instance_id=instance_id,
            config=config,
            config_path=config_path,
            workspace=workspace_spec,
            environment=dict(self._options.environment),
            runtime_options=self._options.runtime_options,
        )

    def sync_user_instance(self, user: CurrentUser, base_config: Any) -> InstanceSyncResult:
        spec = self.build_for_user(user, base_config)
        sync_instance_workspace(spec.workspace)
        return InstanceSyncResult(spec=spec, workspace=spec.workspace.workspace)

    @staticmethod
    def instance_id_for_user(user: CurrentUser) -> str:
        sanitized = re.sub(r"[^a-zA-Z0-9_-]+", "-", user.id.strip()).strip("-").lower()
        if not sanitized:
            digest = hashlib.sha1(user.email.encode("utf-8")).hexdigest()[:12]
            sanitized = f"email-{digest}"
        return f"user-{sanitized}"

    @staticmethod
    def port_offset(instance_id: str) -> int:
        digest = hashlib.sha1(instance_id.encode("utf-8")).hexdigest()
        return int(digest[:6], 16) % 1000 * 2

    @staticmethod
    def websocket_token(instance_id: str, workspace: Path) -> str:
        seed = f"{instance_id}\0{workspace}".encode("utf-8")
        return hashlib.sha256(seed).hexdigest()

    def _skill_bundles_for_allowlist(self, allowlist: frozenset[str]) -> list[SkillBundle]:
        if "*" in allowlist:
            names = sorted(self._options.skill_catalog)
        else:
            names = sorted(name for name in allowlist if name in self._options.skill_catalog)
        return [
            SkillBundle(name=name, source=self._options.skill_catalog[name])
            for name in names
        ]

    @staticmethod
    def _copy_config(base_config: Any) -> Any:
        model_copy = getattr(base_config, "model_copy", None)
        if callable(model_copy):
            return model_copy(deep=True)
        import copy

        return copy.deepcopy(base_config)

    @staticmethod
    def _set_workspace(config: Any, workspace: Path) -> None:
        config.agents.defaults.workspace = str(workspace)

    @staticmethod
    def _enforce_workspace_restriction(config: Any) -> None:
        config.tools.restrict_to_workspace = True

    @staticmethod
    def _set_gateway_port(config: Any, port: int) -> None:
        config.gateway.port = port

    @staticmethod
    def _enable_websocket_channel(config: Any, websocket_port: int, *, token: str) -> None:
        from nanobot.config.schema import ChannelsConfig

        config.channels = ChannelsConfig()
        websocket_config = {
            "enabled": True,
            "host": "127.0.0.1",
            "port": websocket_port,
            "token": token,
            "allow_from": ["*"],
            "streaming": True,
        }
        setattr(config.channels, "websocket", websocket_config)
