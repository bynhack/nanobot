"""Management services for the standalone WebUI channel."""

from __future__ import annotations

import json
import re
from datetime import datetime
from pathlib import Path
from typing import Any

from nanobot.agent.skills import BUILTIN_SKILLS_DIR

from .tenant_runtime.audit import TenantAuditLogger
from .tenant_runtime.contract_validator import validate_workspace_skill_contracts

_FRONTMATTER_RE = re.compile(r"^---\n(.*?)\n---\n?", re.DOTALL)


def _iso_mtime(path: Path) -> str:
    return datetime.fromtimestamp(path.stat().st_mtime).isoformat()


def _read_text(path: Path, limit: int = 120_000) -> str:
    try:
        return path.read_text(encoding="utf-8")[:limit]
    except Exception:
        return ""


def _frontmatter_map(text: str) -> dict[str, str]:
    match = _FRONTMATTER_RE.match(text)
    if not match:
        return {}
    metadata: dict[str, str] = {}
    for line in match.group(1).splitlines():
        key, sep, value = line.partition(":")
        if not sep:
            continue
        metadata[key.strip()] = value.strip().strip('"')
    return metadata


def _description_from_markdown(text: str) -> str:
    metadata = _frontmatter_map(text)
    if metadata.get("description"):
        return metadata["description"]

    body = _FRONTMATTER_RE.sub("", text, count=1).strip()
    for line in body.splitlines():
        stripped = line.strip().lstrip("#").strip()
        if stripped:
            return stripped[:160]
    return ""


class WebUIManagementService:
    """Aggregate local project data for the independent WebUI settings workspace."""

    def __init__(self, workspace: Path) -> None:
        self.workspace = workspace
        self.instance_dir = workspace.parent
        self.config_path = self.instance_dir / "config.json"
        self.cron_dir = self.instance_dir / "cron"
        self.media_dir = self.instance_dir / "media"
        self.plugins_dir = self.instance_dir / "plugins"
        self.traces_path = self.instance_dir / "traces.jsonl"
        self.workspace_skills_dir = workspace / "skills"
        self.workspace_sessions_dir = workspace / "sessions"
        self.workspace_memory_dir = workspace / "memory"
        self.builtin_skills_dir = BUILTIN_SKILLS_DIR
        self._audit = TenantAuditLogger(workspace)
        self._runtime_observer: Any = None

    def bind_runtime_observer(self, observer: Any) -> None:
        self._runtime_observer = observer

    def _scan_skill_source(self, base: Path, source: str) -> list[dict[str, Any]]:
        if not base.exists():
            return []

        records: list[dict[str, Any]] = []
        for skill_dir in sorted(base.iterdir()):
            if not skill_dir.is_dir():
                continue
            enabled_file = skill_dir / "SKILL.md"
            disabled_file = skill_dir / "SKILL.disabled.md"
            skill_file = enabled_file if enabled_file.exists() else disabled_file if disabled_file.exists() else None
            if skill_file is None:
                continue
            text = _read_text(skill_file)
            records.append({
                "name": skill_dir.name,
                "source": source,
                "path": str(skill_file),
                "updated_at": _iso_mtime(skill_file),
                "description": _description_from_markdown(text),
                "enabled": enabled_file.exists(),
                "can_toggle": source == "workspace",
            })
        return records

    def list_skills(self) -> list[dict[str, Any]]:
        return self._scan_skill_source(self.workspace_skills_dir, "workspace")

    def get_skill(self, name: str, source: str | None = None) -> dict[str, Any] | None:
        for item in self.list_skills():
            if item["name"] != name:
                continue
            if source and item["source"] != source:
                continue
            skill_path = Path(item["path"])
            skill_dir = skill_path.parent
            files = []
            for child in sorted(skill_dir.rglob("*")):
                if child.is_dir():
                    continue
                files.append({
                    "path": str(child),
                    "relative_path": str(child.relative_to(skill_dir)),
                    "name": child.name,
                    "size": child.stat().st_size,
                })
            return {
                **item,
                "files": files,
            }
        return None

    def set_skill_enabled(self, name: str, enabled: bool, source: str | None = None) -> dict[str, Any] | None:
        detail = self.get_skill(name, source)
        if detail is None or detail["source"] != "workspace":
            return None

        skill_dir = Path(detail["path"]).parent
        enabled_file = skill_dir / "SKILL.md"
        disabled_file = skill_dir / "SKILL.disabled.md"

        if enabled and disabled_file.exists():
            disabled_file.rename(enabled_file)
        elif not enabled and enabled_file.exists():
            enabled_file.rename(disabled_file)

        return self.get_skill(name, source)

    def get_skill_file(self, name: str, file_path: str, source: str | None = None) -> dict[str, Any] | None:
        detail = self.get_skill(name, source)
        if detail is None:
            return None
        requested = Path(file_path)
        if not requested.is_absolute():
            requested = Path(detail["path"]).parent / requested
        requested = requested.resolve(strict=False)
        skill_root = Path(detail["path"]).parent.resolve(strict=False)
        if skill_root not in requested.parents and requested != skill_root / "SKILL.md":
            return None
        if not requested.exists() or not requested.is_file():
            return None
        return {
            "name": requested.name,
            "path": str(requested),
            "content": _read_text(requested, limit=500_000),
            "is_markdown": requested.suffix.lower() in {".md", ".markdown"},
        }

    def config_snapshot(self) -> dict[str, Any]:
        raw = _read_text(self.config_path, limit=500_000)
        parsed: dict[str, Any] = {}
        if raw:
            try:
                parsed = json.loads(raw)
            except json.JSONDecodeError:
                parsed = {}

        runtime_files = []
        for directory in (self.cron_dir, self.media_dir, self.plugins_dir, self.workspace_memory_dir):
            if not directory.exists():
                continue
            for child in sorted(directory.iterdir()):
                runtime_files.append({
                    "name": child.name,
                    "path": str(child),
                    "updated_at": _iso_mtime(child),
                    "size": child.stat().st_size if child.is_file() else 0,
                })

        return {
            "workspace": str(self.workspace),
            "config_path": str(self.config_path),
            "config_exists": self.config_path.exists(),
            "raw": raw,
            "sections": sorted(parsed.keys()),
            "parsed": parsed,
            "omx_files": runtime_files,
        }

    def save_config(self, raw: str) -> dict[str, Any]:
        raw = raw.replace("\r\n", "\n")
        json.loads(raw)
        self.config_path.parent.mkdir(parents=True, exist_ok=True)
        self.config_path.write_text(raw if raw.endswith("\n") else raw + "\n", encoding="utf-8")
        return self.config_snapshot()

    def runtime_snapshot(self) -> dict[str, Any]:
        def collect(directory: Path, pattern: str) -> list[dict[str, Any]]:
            if not directory.exists():
                return []
            results = []
            for path in sorted(directory.glob(pattern), key=lambda item: item.stat().st_mtime, reverse=True):
                if not path.is_file():
                    continue
                results.append({
                    "name": path.name,
                    "path": str(path),
                    "updated_at": _iso_mtime(path),
                    "size": path.stat().st_size,
                })
            return results

        config_summary = {}
        raw_config = _read_text(self.config_path, limit=200_000)
        if raw_config:
            try:
                config_summary = json.loads(raw_config)
            except json.JSONDecodeError:
                config_summary = {}

        recent_logs = collect(self.instance_dir, "*.jsonl")[:8]
        recent_state = collect(self.workspace_sessions_dir, "*.jsonl")[:12]
        recent_plans = collect(self.workspace_memory_dir, "*.md")[:12]

        log_preview = ""
        if recent_logs:
            log_preview = _read_text(Path(recent_logs[0]["path"]), limit=8_000)

        live_runtime: dict[str, Any] = {}
        if self._runtime_observer is not None:
            try:
                live_runtime = dict(self._runtime_observer())
            except Exception as exc:
                live_runtime = {"observer_error": str(exc)}

        return {
            "workspace": str(self.workspace),
            "metrics": config_summary,
            "live_runtime": live_runtime,
            "recent_logs": recent_logs,
            "recent_state_files": recent_state,
            "recent_plans": recent_plans,
            "latest_log_preview": log_preview,
        }

    def runtime_snapshot_for_user(self, *, is_admin: bool, session_count: int) -> dict[str, Any]:
        snapshot = self.runtime_snapshot()
        snapshot["session_count"] = session_count
        if is_admin:
            return snapshot

        live_runtime = snapshot.get("live_runtime", {}) or {}
        channel_info = live_runtime.get("channel", {}) or {}
        return {
            "session_count": session_count,
            "metrics": {},
            "workspace": "",
            "live_runtime": {
                "channel": {
                    "name": channel_info.get("name"),
                    "streaming_enabled": channel_info.get("streaming_enabled"),
                }
            },
            "recent_logs": [],
            "recent_state_files": [],
            "recent_plans": [],
            "latest_log_preview": "",
        }

    def audit_snapshot_for_user(self, *, email: str, is_admin: bool, limit: int = 100) -> dict[str, Any]:
        events = self._audit.recent(email=email, include_all=is_admin, limit=limit)
        allow_count = sum(1 for item in events if item.get("decision") == "allow")
        deny_count = sum(1 for item in events if item.get("decision") == "deny")
        return {
            "workspace": str(self.workspace) if is_admin else "",
            "audit_path": str(self._audit.path) if is_admin else "",
            "scope": "all" if is_admin else "self",
            "limit": limit,
            "events": events,
            "summary": {
                "total": len(events),
                "allow": allow_count,
                "deny": deny_count,
            },
        }

    def tenant_contracts_snapshot(self) -> dict[str, Any]:
        return validate_workspace_skill_contracts(self.workspace)
