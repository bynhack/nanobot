"""Product storage paths under the active casework workspace."""

from __future__ import annotations

from pathlib import Path

PRODUCT_DATA_DIR = "data"
CASE_GRAPHS_DIR = "case_graphs"
CASE_GRAPH_CONTEXTS_DIR = "case_graph_contexts"
CASE_AUDITS_DIR = "case_audits"
CHAT_WORKSPACES_DIR = "chat_workspaces"
UPLOADS_DIR = "uploads"
DELETED_SESSIONS_FILE = "deleted_sessions.json"


def product_data_root(workspace: Path) -> Path:
    return workspace / PRODUCT_DATA_DIR


def case_graphs_root(workspace: Path) -> Path:
    return product_data_root(workspace) / CASE_GRAPHS_DIR


def case_graph_contexts_root(workspace: Path) -> Path:
    return product_data_root(workspace) / CASE_GRAPH_CONTEXTS_DIR


def case_audits_root(workspace: Path) -> Path:
    return product_data_root(workspace) / CASE_AUDITS_DIR


def chat_workspaces_root(workspace: Path) -> Path:
    return product_data_root(workspace) / CHAT_WORKSPACES_DIR


def uploads_root(workspace: Path) -> Path:
    return product_data_root(workspace) / UPLOADS_DIR


def deleted_sessions_path(workspace: Path) -> Path:
    return product_data_root(workspace) / DELETED_SESSIONS_FILE
