"""Supabase Python SDK adapter for HR business data."""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import quote

import httpx


@dataclass(frozen=True)
class SupabaseConfig:
    url: str
    service_key: str
    source: Path


def load_supabase_config() -> SupabaseConfig:
    config_path = Path(os.environ.get("NANOBOT_CONFIG") or Path.home() / ".nanobot" / "config.json")
    url = clean(os.environ.get("NANOBOT_WEBUI_SUPABASE_URL"))
    service_key = clean(os.environ.get("NANOBOT_WEBUI_SUPABASE_SERVICE_ROLE_KEY"))
    if url and service_key:
        return SupabaseConfig(url=url, service_key=service_key, source=config_path)

    payload = json.loads(config_path.read_text(encoding="utf-8"))
    webui = payload.get("channels", {}).get("webui_plugin") or payload.get("channels", {}).get("webuiPlugin") or {}
    url = clean(webui.get("supabaseUrl") or webui.get("supabase_url"))
    service_key = clean(
        webui.get("supabaseServiceRoleKey")
        or webui.get("supabaseServiceKey")
        or webui.get("supabase_service_role_key")
        or webui.get("supabase_service_key")
    )
    if not url:
        raise RuntimeError(
            "NANOBOT_WEBUI_SUPABASE_URL or channels.webui_plugin.supabaseUrl is missing"
        )
    if not service_key:
        raise RuntimeError(
            "NANOBOT_WEBUI_SUPABASE_SERVICE_ROLE_KEY or "
            "channels.webui_plugin.supabaseServiceRoleKey is missing"
        )
    return SupabaseConfig(url=url, service_key=service_key, source=config_path)


class SupabaseConnector:
    """Small adapter that keeps repository code independent of SDK details."""

    def __init__(self, client: Any | None = None, config: SupabaseConfig | None = None) -> None:
        self._client = client
        self._config = config

    @property
    def config(self) -> SupabaseConfig:
        if self._config is None:
            self._config = load_supabase_config()
        return self._config

    @property
    def client(self) -> Any:
        if self._client is None:
            try:
                from supabase import create_client
            except ImportError:
                self._client = PostgrestClient(self.config.url, self.config.service_key)
            else:
                self._client = create_client(self.config.url, self.config.service_key)
        return self._client

    def table(self, name: str) -> Any:
        return self.client.table(name)

    def from_(self, name: str) -> Any:
        return self.table(name)

    def rpc(self, function_name: str, params: dict[str, Any] | None = None) -> Any:
        return self.client.rpc(function_name, params or {})

    def upload_file(
        self,
        *,
        bucket: str,
        object_path: str,
        content: bytes,
        content_type: str,
    ) -> str:
        storage = getattr(self.client, "storage", None)
        if storage is not None:
            bucket_client = storage.from_(bucket)
            upload = bucket_client.upload(
                object_path,
                content,
                {"content-type": content_type, "upsert": "true"},
            )
            error = getattr(upload, "error", None) or (upload.get("error") if isinstance(upload, dict) else None)
            if error:
                raise RuntimeError(f"upload to Supabase Storage failed: {error}")
            public = bucket_client.get_public_url(object_path)
            public_url = (
                deep_get(public, "data.publicUrl")
                if isinstance(public, dict)
                else getattr(getattr(public, "data", None), "publicUrl", None)
            )
            return str(public_url or "").strip() or self.storage_public_url(bucket, object_path)
        if isinstance(self.client, PostgrestClient):
            return self.client.upload_file(
                bucket=bucket,
                object_path=object_path,
                content=content,
                content_type=content_type,
            )
        raise RuntimeError("Supabase client does not support Storage upload")

    def storage_public_url(self, bucket: str, object_path: str) -> str:
        return f"{self.config.url.rstrip('/')}/storage/v1/object/public/{quote(bucket)}/{quote(object_path, safe='/')}"


def execute(builder: Any) -> tuple[list[dict[str, Any]], int | None]:
    response = builder.execute() if hasattr(builder, "execute") else builder
    data = getattr(response, "data", None)
    count = getattr(response, "count", None)
    if isinstance(response, dict):
        data = response.get("data")
        count = response.get("count")
        error = response.get("error")
        if error:
            message = error.get("message") if isinstance(error, dict) else str(error)
            raise RuntimeError(message)
    if data is None:
        data = []
    return data, count


def execute_one(builder: Any) -> dict[str, Any] | None:
    data, _count = execute(builder)
    if isinstance(data, dict):
        return data
    if not data:
        return None
    return data[0]


def clean(value: Any) -> str:
    return str(value).strip() if value is not None else ""


def deep_get(value: Any, path: str) -> Any:
    current = value
    for part in path.split("."):
        if not isinstance(current, dict):
            return None
        current = current.get(part)
    return current


class PostgrestClient:
    """Minimal Python PostgREST client for the HR CLI.

    The full supabase-py package currently conflicts with Nanobot's websockets
    dependency. HR only needs database and storage-style REST calls, so this
    adapter keeps the runtime Python-only without pulling the Node stack back in.
    """

    def __init__(self, url: str, service_key: str) -> None:
        self.url = url.rstrip("/")
        self.service_key = service_key

    def table(self, name: str) -> "PostgrestQuery":
        return PostgrestQuery(self, name)

    def rpc(self, function_name: str, params: dict[str, Any] | None = None) -> Any:
        response = httpx.post(
            f"{self.url}/rest/v1/rpc/{quote(function_name)}",
            headers=self.headers(),
            json=params or {},
            timeout=30,
        )
        response.raise_for_status()
        return {"data": response.json()}

    def headers(self, *, prefer: str | None = None) -> dict[str, str]:
        headers = {
            "apikey": self.service_key,
            "Authorization": f"Bearer {self.service_key}",
            "Content-Type": "application/json",
        }
        if prefer:
            headers["Prefer"] = prefer
        return headers

    def upload_file(
        self,
        *,
        bucket: str,
        object_path: str,
        content: bytes,
        content_type: str,
    ) -> str:
        response = httpx.post(
            f"{self.url}/storage/v1/object/{quote(bucket)}/{quote(object_path, safe='/')}",
            headers={
                "apikey": self.service_key,
                "Authorization": f"Bearer {self.service_key}",
                "Content-Type": content_type,
                "x-upsert": "true",
            },
            content=content,
            timeout=30,
        )
        response.raise_for_status()
        return f"{self.url}/storage/v1/object/public/{quote(bucket)}/{quote(object_path, safe='/')}"


class PostgrestQuery:
    def __init__(self, client: PostgrestClient, table: str) -> None:
        self.client = client
        self.table_name = table
        self.select_value = "*"
        self.filters: list[tuple[str, str]] = []
        self.order_value: str | None = None
        self.limit_value: int | None = None
        self.method = "GET"
        self.body: Any = None
        self.want_single = False
        self.count = ""
        self.head = False

    def select(self, value: str = "*", **kwargs: Any) -> "PostgrestQuery":
        self.select_value = value
        self.count = kwargs.get("count") or ""
        self.head = bool(kwargs.get("head"))
        return self

    def order(self, key: str, desc: bool = False, **kwargs: Any) -> "PostgrestQuery":
        ascending = kwargs.get("ascending")
        if ascending is not None:
            desc = not bool(ascending)
        self.order_value = f"{key}.{'desc' if desc else 'asc'}"
        return self

    def limit(self, count: int) -> "PostgrestQuery":
        self.limit_value = count
        return self

    def eq(self, key: str, value: Any) -> "PostgrestQuery":
        self.filters.append((key, f"eq.{self._value(value)}"))
        return self

    def neq(self, key: str, value: Any) -> "PostgrestQuery":
        self.filters.append((key, f"neq.{self._value(value)}"))
        return self

    def gte(self, key: str, value: Any) -> "PostgrestQuery":
        self.filters.append((key, f"gte.{self._value(value)}"))
        return self

    def lte(self, key: str, value: Any) -> "PostgrestQuery":
        self.filters.append((key, f"lte.{self._value(value)}"))
        return self

    def ilike(self, key: str, value: Any) -> "PostgrestQuery":
        self.filters.append((key, f"ilike.{self._value(value)}"))
        return self

    def in_(self, key: str, values: list[Any]) -> "PostgrestQuery":
        encoded = ",".join(str(item) for item in values)
        self.filters.append((key, f"in.({encoded})"))
        return self

    def is_(self, key: str, value: Any) -> "PostgrestQuery":
        literal = "null" if value is None else str(value).lower()
        self.filters.append((key, f"is.{literal}"))
        return self

    def insert(self, body: Any) -> "PostgrestQuery":
        self.method = "POST"
        self.body = body
        return self

    def update(self, body: Any) -> "PostgrestQuery":
        self.method = "PATCH"
        self.body = body
        return self

    def delete(self) -> "PostgrestQuery":
        self.method = "DELETE"
        return self

    def single(self) -> "PostgrestQuery":
        self.want_single = True
        return self

    def execute(self) -> dict[str, Any]:
        params: list[tuple[str, str]] = [("select", self.select_value)]
        for key, value in self.filters:
            params.append((key, value))
        if self.order_value:
            params.append(("order", self.order_value))
        if self.limit_value is not None:
            params.append(("limit", str(self.limit_value)))
        prefer = "return=representation"
        if self.count:
            prefer = f"{prefer},count={self.count}"
        response = httpx.request(
            self.method,
            f"{self.client.url}/rest/v1/{quote(self.table_name)}",
            headers=self.client.headers(prefer=prefer),
            params=params,
            json=self.body,
            timeout=30,
        )
        response.raise_for_status()
        if self.head:
            return {"data": [], "count": self._content_range_count(response)}
        data = response.json() if response.content else []
        if self.want_single and isinstance(data, list):
            data = data[0] if data else None
        return {"data": data, "count": self._content_range_count(response)}

    @staticmethod
    def _content_range_count(response: httpx.Response) -> int | None:
        content_range = response.headers.get("content-range", "")
        if "/" not in content_range:
            return None
        value = content_range.rsplit("/", 1)[-1]
        return None if value == "*" else int(value)

    @staticmethod
    def _value(value: Any) -> str:
        if isinstance(value, bool):
            return "true" if value else "false"
        if isinstance(value, list):
            return "{" + ",".join(PostgrestQuery._array_value(item) for item in value) + "}"
        return str(value)

    @staticmethod
    def _array_value(value: Any) -> str:
        item = str(value)
        if not item or any(char in item for char in [",", "{", "}", '"', "\\"]) or item != item.strip():
            return '"' + item.replace("\\", "\\\\").replace('"', '\\"') + '"'
        return item
