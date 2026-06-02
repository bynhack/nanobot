"""Skill contract parsing for tenant-runtime aware business skills."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any


_CONTRACT_BLOCK_RE = re.compile(
    r"```(?:json\s+)?tenant-runtime-contract\s*(?P<body>.*?)```",
    re.DOTALL | re.IGNORECASE,
)


def _tuple_of_strings(value: Any) -> tuple[str, ...]:
    if value is None:
        return ()
    if isinstance(value, str):
        items = value.replace("，", ",").splitlines()
        if len(items) == 1:
            items = value.replace("，", ",").split(",")
    elif isinstance(value, (list, tuple, set, frozenset)):
        items = value
    else:
        items = (value,)
    return tuple(str(item).strip() for item in items if str(item).strip())


@dataclass(frozen=True, slots=True)
class SkillResourceRequirement:
    resource: str
    actions: tuple[str, ...] = ()
    scope_key: str = ""

    def to_payload(self) -> dict[str, Any]:
        payload: dict[str, Any] = {"resource": self.resource, "actions": list(self.actions)}
        if self.scope_key:
            payload["scope_key"] = self.scope_key
        return payload

    @classmethod
    def from_payload(cls, payload: dict[str, Any]) -> "SkillResourceRequirement":
        actions = payload.get("actions")
        if isinstance(actions, str):
            action_values = tuple(item.strip() for item in actions.split(",") if item.strip())
        elif isinstance(actions, list):
            action_values = tuple(str(item).strip() for item in actions if str(item).strip())
        else:
            action_values = ()
        return cls(
            resource=str(payload.get("resource") or ""),
            actions=action_values,
            scope_key=str(payload.get("scope_key") or payload.get("scopeKey") or ""),
        )


@dataclass(frozen=True, slots=True)
class SkillCapability:
    id: str
    title: str = ""
    kind: str = "query"
    commands: tuple[str, ...] = ()
    resources: tuple[SkillResourceRequirement, ...] = ()
    requires_confirmation: bool = False
    triggers: tuple[str, ...] = ()
    focus_terms: tuple[str, ...] = ()
    related_capabilities: tuple[str, ...] = ()
    recipe: tuple[str, ...] = ()

    def to_payload(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "title": self.title,
            "kind": self.kind,
            "commands": list(self.commands),
            "resources": [item.to_payload() for item in self.resources],
            "requires_confirmation": self.requires_confirmation,
            "triggers": list(self.triggers),
            "focus_terms": list(self.focus_terms),
            "related_capabilities": list(self.related_capabilities),
            "recipe": list(self.recipe),
        }

    @classmethod
    def from_payload(cls, payload: dict[str, Any]) -> "SkillCapability":
        commands = payload.get("commands")
        command = payload.get("command")
        resources = payload.get("resources")
        command_values: list[str] = []
        if isinstance(commands, list):
            command_values.extend(str(item).strip() for item in commands if str(item).strip())
        elif isinstance(command, str) and command.strip():
            command_values.append(command.strip())
        triggers = payload.get("triggers")
        focus_terms = payload.get("focus_terms") or payload.get("focusTerms")
        related = (
            payload.get("related_capabilities")
            or payload.get("relatedCapabilities")
            or payload.get("include_capabilities")
            or payload.get("includeCapabilities")
        )
        recipe = payload.get("recipe") or payload.get("workflow") or payload.get("instructions")
        return cls(
            id=str(payload.get("id") or payload.get("name") or "").strip(),
            title=str(payload.get("title") or payload.get("description") or "").strip(),
            kind=str(payload.get("kind") or payload.get("type") or "query").strip(),
            commands=tuple(command_values),
            resources=tuple(
                SkillResourceRequirement.from_payload(item) for item in resources if isinstance(item, dict)
            )
            if isinstance(resources, list)
            else (),
            requires_confirmation=bool(payload.get("requires_confirmation") or payload.get("requiresConfirmation")),
            triggers=_tuple_of_strings(triggers),
            focus_terms=_tuple_of_strings(focus_terms),
            related_capabilities=_tuple_of_strings(related),
            recipe=_tuple_of_strings(recipe),
        )


@dataclass(frozen=True, slots=True)
class SkillContract:
    name: str
    kind: str = "business"
    managed: bool = True
    resources: tuple[SkillResourceRequirement, ...] = ()
    commands: tuple[str, ...] = ()
    denied_commands: tuple[str, ...] = ()
    capabilities: tuple[SkillCapability, ...] = ()
    requires_confirmation: bool = False

    def to_payload(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "kind": self.kind,
            "managed": self.managed,
            "resources": [item.to_payload() for item in self.resources],
            "commands": list(self.commands),
            "denied_commands": list(self.denied_commands),
            "capabilities": [item.to_payload() for item in self.capabilities],
            "requires_confirmation": self.requires_confirmation,
        }

    @classmethod
    def from_payload(cls, payload: dict[str, Any]) -> "SkillContract":
        resources = payload.get("resources")
        commands = payload.get("commands")
        denied_commands = payload.get("denied_commands") or payload.get("deniedCommands")
        capabilities = payload.get("capabilities")
        return cls(
            name=str(payload.get("name") or ""),
            kind=str(payload.get("kind") or payload.get("type") or "business"),
            managed=bool(payload.get("managed", True)),
            resources=tuple(
                SkillResourceRequirement.from_payload(item) for item in resources if isinstance(item, dict)
            )
            if isinstance(resources, list)
            else (),
            commands=tuple(str(item).strip() for item in commands if str(item).strip())
            if isinstance(commands, list)
            else (),
            denied_commands=tuple(str(item).strip() for item in denied_commands if str(item).strip())
            if isinstance(denied_commands, list)
            else (),
            capabilities=tuple(
                SkillCapability.from_payload(item) for item in capabilities if isinstance(item, dict)
            )
            if isinstance(capabilities, list)
            else (),
            requires_confirmation=bool(payload.get("requires_confirmation") or payload.get("requiresConfirmation")),
        )


def load_skill_contract(skill_dir: str | Path) -> SkillContract | None:
    """Load a skill contract from `tenant-runtime.json` or a SKILL.md fenced block."""

    root = Path(skill_dir)
    sidecar = root / "tenant-runtime.json"
    if sidecar.exists():
        return SkillContract.from_payload(json.loads(sidecar.read_text(encoding="utf-8")))

    skill_md = root / "SKILL.md"
    if not skill_md.exists():
        return None
    match = _CONTRACT_BLOCK_RE.search(skill_md.read_text(encoding="utf-8"))
    if match is None:
        return None
    return SkillContract.from_payload(json.loads(match.group("body")))
