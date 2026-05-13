# 会话交付文件工作空间实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 在 `nanobot-channel-webui` 插件内，为每个 `chat_id` 建立仅收录最终交付文件的工作空间列表，并在当前线程中提供「查看工作空间」入口和文件预览入口。

**架构：** 后端在插件层新增一个按 `chat_id` 存储的 delivered-files index，并在插件已知“文件已经最终发给用户”的两个时机写入该索引。前端按需读取该索引，在当前线程标题区打开一个右侧工作空间面板，文件点击后直接复用现有 detail preview / preview workspace 流程。

**技术栈：** Python 3.11、aiohttp、现有插件后端路由层、React 19、TypeScript、Vitest、现有 `preview-workspace/*`

---

## 文件结构

### 后端

- 创建：`/Users/brian/Documents/Project/nanobot/nanobot-channel-webui/src/nanobot_channel_webui/session_workspace.py`
  - 负责按 `chat_id` 读写 delivered-files index、去重、原子落盘。
- 修改：`/Users/brian/Documents/Project/nanobot/nanobot-channel-webui/src/nanobot_channel_webui/channel.py`
  - 注册工作空间读取路由；在 assistant/outbound 文件最终发出时写入工作空间索引。
- 测试：`/Users/brian/Documents/Project/nanobot/nanobot-channel-webui/tests/test_session_workspace.py`
  - 覆盖索引写入、去重、读取、空文件和损坏文件兜底。

### 前端数据层

- 修改：`/Users/brian/Documents/Project/nanobot/nanobot-channel-webui/frontend/src/types.ts`
  - 新增 `SessionWorkspaceFile`、`SessionWorkspace` 类型。
- 修改：`/Users/brian/Documents/Project/nanobot/nanobot-channel-webui/frontend/src/api.ts`
  - 新增 `loadSessionWorkspace(chatId, token)`。
- 修改：`/Users/brian/Documents/Project/nanobot/nanobot-channel-webui/frontend/src/store.ts`
  - 新增 `workspaceByChat`、`workspacePanel` 状态及 reducer action。
- 修改：`/Users/brian/Documents/Project/nanobot/nanobot-channel-webui/frontend/src/app-state.ts`
  - 让 `createInitialState` 带上工作空间初始状态。
- 测试：`/Users/brian/Documents/Project/nanobot/nanobot-channel-webui/frontend/src/store.workspace.test.ts`
  - 覆盖工作空间加载、打开、关闭、缓存更新。

### 前端 UI

- 创建：`/Users/brian/Documents/Project/nanobot/nanobot-channel-webui/frontend/src/components/chat/workspace-panel.tsx`
  - 渲染右侧工作空间面板、空态、错误态、文件列表。
- 修改：`/Users/brian/Documents/Project/nanobot/nanobot-channel-webui/frontend/src/components/chat/thread-shell.tsx`
  - 在当前线程标题区增加「查看工作空间」入口并挂载工作空间面板。
- 修改：`/Users/brian/Documents/Project/nanobot/nanobot-channel-webui/frontend/src/components/chat/detail-preview-context.tsx`
  - 如有必要补充打开工作空间文件所需的统一动作签名；尽量保持现有 `openMedia` 即可。
- 修改：`/Users/brian/Documents/Project/nanobot/nanobot-channel-webui/frontend/src/styles.css`
  - 增加工作空间按钮、面板、列表项样式。
- 测试：`/Users/brian/Documents/Project/nanobot/nanobot-channel-webui/frontend/src/components/chat/workspace-panel.test.tsx`
  - 覆盖入口显隐、面板渲染、点击文件后触发预览。

## 任务 1：实现插件后端工作空间索引服务

**文件：**
- 创建：`/Users/brian/Documents/Project/nanobot/nanobot-channel-webui/src/nanobot_channel_webui/session_workspace.py`
- 测试：`/Users/brian/Documents/Project/nanobot/nanobot-channel-webui/tests/test_session_workspace.py`

- [ ] **步骤 1：先写失败的后端单测**

```python
from pathlib import Path

from nanobot_channel_webui.session_workspace import SessionWorkspaceService


def test_records_delivered_files_per_chat(tmp_path: Path) -> None:
    service = SessionWorkspaceService(tmp_path)

    workspace = service.record_deliveries(
        "chat-1",
        [
            {
                "name": "报告.docx",
                "url": "/media/token-1",
                "mime": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            }
        ],
    )

    assert workspace["chat_id"] == "chat-1"
    assert len(workspace["files"]) == 1
    assert workspace["files"][0]["name"] == "报告.docx"


def test_deduplicates_same_file_by_url_and_name(tmp_path: Path) -> None:
    service = SessionWorkspaceService(tmp_path)

    service.record_deliveries(
        "chat-1",
        [{"name": "报告.docx", "url": "/media/token-1", "mime": "application/docx"}],
    )
    workspace = service.record_deliveries(
        "chat-1",
        [{"name": "报告.docx", "url": "/media/token-1", "mime": "application/docx"}],
    )

    assert len(workspace["files"]) == 1
```

- [ ] **步骤 2：运行后端单测，确认失败**

运行：

```bash
cd /Users/brian/Documents/Project/nanobot/nanobot-channel-webui && pytest tests/test_session_workspace.py -q
```

预期：FAIL，报错 `ModuleNotFoundError: No module named 'nanobot_channel_webui.session_workspace'`

- [ ] **步骤 3：实现最小索引服务**

```python
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from nanobot.utils.helpers import ensure_dir


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class SessionWorkspaceService:
    def __init__(self, workspace: Path) -> None:
        self._root = ensure_dir(workspace / ".nanobot_channel_webui" / "workspaces")

    def _path_for_chat(self, chat_id: str) -> Path:
        return self._root / f"{chat_id}.json"

    def load_workspace(self, chat_id: str) -> dict[str, Any]:
        path = self._path_for_chat(chat_id)
        if not path.exists():
            return {"chat_id": chat_id, "updated_at": None, "files": []}
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            return {"chat_id": chat_id, "updated_at": None, "files": []}

    def record_deliveries(self, chat_id: str, media: list[dict[str, Any]]) -> dict[str, Any]:
        current = self.load_workspace(chat_id)
        by_key = {(item["url"], item["name"]): item for item in current.get("files", [])}
        now = _utc_now_iso()
        for item in media:
            url = str(item.get("url", "")).strip()
            name = str(item.get("name", "")).strip()
            mime = str(item.get("mime", "")).strip()
            if not url or not name:
                continue
            by_key[(url, name)] = {
                "id": f"file_{abs(hash((url, name))) :x}",
                "name": name,
                "url": url,
                "mime": mime,
                "delivered_at": item.get("delivered_at") or now,
            }
        payload = {
            "chat_id": chat_id,
            "updated_at": now,
            "files": sorted(by_key.values(), key=lambda item: item["delivered_at"], reverse=True),
        }
        path = self._path_for_chat(chat_id)
        tmp = path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        tmp.replace(path)
        return payload
```

- [ ] **步骤 4：补充损坏文件兜底单测并跑通**

```python
def test_returns_empty_workspace_for_corrupt_json(tmp_path: Path) -> None:
    service = SessionWorkspaceService(tmp_path)
    path = tmp_path / ".nanobot_channel_webui" / "workspaces" / "chat-1.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("{broken", encoding="utf-8")

    workspace = service.load_workspace("chat-1")

    assert workspace["chat_id"] == "chat-1"
    assert workspace["files"] == []
```

运行：

```bash
cd /Users/brian/Documents/Project/nanobot/nanobot-channel-webui && pytest tests/test_session_workspace.py -q
```

预期：PASS

- [ ] **步骤 5：Commit**

```bash
cd /Users/brian/Documents/Project/nanobot/nanobot-channel-webui && git add src/nanobot_channel_webui/session_workspace.py tests/test_session_workspace.py && git commit -m "feat(工作空间): 添加会话交付文件索引服务"
```

## 任务 2：把工作空间索引接入插件路由与最终交付链路

**文件：**
- 修改：`/Users/brian/Documents/Project/nanobot/nanobot-channel-webui/src/nanobot_channel_webui/channel.py`
- 测试：`/Users/brian/Documents/Project/nanobot/nanobot-channel-webui/tests/test_session_workspace.py`

- [ ] **步骤 1：先补失败测试，覆盖 assistant/outbound 交付写入**

```python
from nanobot_channel_webui.session_workspace import SessionWorkspaceService


def test_workspace_keeps_delivered_media_shape(tmp_path):
    service = SessionWorkspaceService(tmp_path)

    workspace = service.record_deliveries(
        "chat-2",
        [
            {
                "name": "凭证.pdf",
                "url": "/media/token-2",
                "mime": "application/pdf",
                "source": "assistant_final",
            }
        ],
    )

    assert workspace["files"][0]["mime"] == "application/pdf"
    assert workspace["files"][0]["url"] == "/media/token-2"
```

- [ ] **步骤 2：在 `channel.py` 初始化工作空间服务并注册读取路由**

```python
from .session_workspace import SessionWorkspaceService

# __init__
self._session_workspace = SessionWorkspaceService(self._sessions.workspace)

# routes
app.router.add_get("/api/workspaces/{chat_id}", self._handle_workspace)

async def _handle_workspace(self, request: Any) -> Any:
    from aiohttp import web

    allowed, resp, _user = await self._authorize_request(request)
    if not allowed:
        return resp

    chat_id = request.match_info.get("chat_id", "").strip()
    if not chat_id or not is_valid_chat_id(chat_id):
        return web.json_response({"error": "无效的会话 ID"}, status=400)

    workspace = await asyncio.to_thread(self._session_workspace.load_workspace, chat_id)
    return web.json_response({
        "chat_id": workspace["chat_id"],
        "updated_at": workspace["updated_at"],
        "file_count": len(workspace["files"]),
        "files": workspace["files"],
    })
```

- [ ] **步骤 3：在最终 assistant/outbound 文件发出点登记交付文件**

```python
def _record_workspace_media(self, chat_id: str, media: list[dict[str, Any]] | None, *, source: str) -> None:
    if not media:
        return
    normalized = [
        {
            "name": str(item.get("name", "")).strip(),
            "url": str(item.get("url", "")).strip(),
            "mime": str(item.get("mime", "")).strip(),
            "source": source,
        }
        for item in media
        if str(item.get("url", "")).strip() and str(item.get("name", "")).strip()
    ]
    if not normalized:
        return
    asyncio.create_task(asyncio.to_thread(self._session_workspace.record_deliveries, chat_id, normalized))

# send()
media_items = self._media.build_media_items(msg.media) if msg.media else None
self._record_workspace_media(msg.chat_id, media_items, source="assistant_final")

# _handle_ws command send path after uploads are attached and final outbound is emitted
self._record_workspace_media(chat_id, [self._media.build_media_item(str(a.path)) for a in attachments], source="outbound")
```

- [ ] **步骤 4：跑后端测试，确认新路由和索引逻辑没有破坏现有行为**

运行：

```bash
cd /Users/brian/Documents/Project/nanobot/nanobot-channel-webui && pytest tests/test_session_workspace.py tests/test_session_index.py tests/test_history_projection.py -q
```

预期：PASS

- [ ] **步骤 5：Commit**

```bash
cd /Users/brian/Documents/Project/nanobot/nanobot-channel-webui && git add src/nanobot_channel_webui/channel.py tests/test_session_workspace.py && git commit -m "feat(工作空间): 接入会话交付文件索引接口"
```

## 任务 3：扩展前端数据层，支持工作空间状态与 API

**文件：**
- 修改：`/Users/brian/Documents/Project/nanobot/nanobot-channel-webui/frontend/src/types.ts`
- 修改：`/Users/brian/Documents/Project/nanobot/nanobot-channel-webui/frontend/src/api.ts`
- 修改：`/Users/brian/Documents/Project/nanobot/nanobot-channel-webui/frontend/src/store.ts`
- 修改：`/Users/brian/Documents/Project/nanobot/nanobot-channel-webui/frontend/src/app-state.ts`
- 测试：`/Users/brian/Documents/Project/nanobot/nanobot-channel-webui/frontend/src/store.workspace.test.ts`

- [ ] **步骤 1：先写失败的 reducer 测试**

```ts
import { createInitialState, reducer } from './store';

it('stores loaded workspace for a chat', () => {
  const state = createInitialState({ title: 'x', authRequired: false }, '', 'chat-1');
  const next = reducer(state, {
    type: 'workspace.loaded',
    chatId: 'chat-1',
    workspace: {
      chatId: 'chat-1',
      updatedAt: '2026-05-13T20:00:00+08:00',
      files: [{ id: '1', name: '报告.docx', url: '/media/a', mime: 'application/docx', deliveredAt: '2026-05-13T20:00:00+08:00' }],
    },
  });

  expect(next.workspaceByChat['chat-1']?.files).toHaveLength(1);
});
```

- [ ] **步骤 2：新增类型和 API 读取函数**

```ts
export interface SessionWorkspaceFile {
  id: string;
  name: string;
  url: string;
  mime: string;
  deliveredAt: string;
}

export interface SessionWorkspace {
  chatId: string;
  updatedAt: string | null;
  files: SessionWorkspaceFile[];
}

export async function loadSessionWorkspace(chatId: string, token: string): Promise<SessionWorkspace> {
  const response = await fetch(`/api/workspaces/${encodeURIComponent(chatId)}`, {
    headers: authHeaders(token),
  });
  if (!response.ok) {
    throw new Error(`加载工作空间失败（${response.status}）`);
  }
  const payload = (await response.json()) as {
    chat_id: string;
    updated_at: string | null;
    files?: Array<{ id: string; name: string; url: string; mime: string; delivered_at: string }>;
  };
  return {
    chatId: payload.chat_id,
    updatedAt: payload.updated_at,
    files: (payload.files ?? []).map((file) => ({
      id: file.id,
      name: file.name,
      url: file.url,
      mime: file.mime,
      deliveredAt: file.delivered_at,
    })),
  };
}
```

- [ ] **步骤 3：扩展应用状态与 reducer**

```ts
export interface AppState {
  // ...
  workspaceByChat: Record<string, SessionWorkspace | undefined>;
  workspacePanel: {
    open: boolean;
    loading: boolean;
    error: string | null;
    chatId: string | null;
  };
}

export type Action =
  | { type: 'workspace.open'; chatId: string }
  | { type: 'workspace.loading'; chatId: string }
  | { type: 'workspace.loaded'; chatId: string; workspace: SessionWorkspace }
  | { type: 'workspace.failed'; chatId: string; error: string }
  | { type: 'workspace.close' };
```

- [ ] **步骤 4：运行前端状态测试**

运行：

```bash
cd /Users/brian/Documents/Project/nanobot/nanobot-channel-webui/frontend && npm test -- store.workspace.test.ts
```

预期：PASS

- [ ] **步骤 5：Commit**

```bash
cd /Users/brian/Documents/Project/nanobot/nanobot-channel-webui && git add frontend/src/types.ts frontend/src/api.ts frontend/src/store.ts frontend/src/app-state.ts frontend/src/store.workspace.test.ts && git commit -m "feat(工作空间): 添加前端工作空间状态与接口"
```

## 任务 4：实现工作空间面板 UI 并接入现有预览

**文件：**
- 创建：`/Users/brian/Documents/Project/nanobot/nanobot-channel-webui/frontend/src/components/chat/workspace-panel.tsx`
- 修改：`/Users/brian/Documents/Project/nanobot/nanobot-channel-webui/frontend/src/components/chat/thread-shell.tsx`
- 修改：`/Users/brian/Documents/Project/nanobot/nanobot-channel-webui/frontend/src/styles.css`
- 测试：`/Users/brian/Documents/Project/nanobot/nanobot-channel-webui/frontend/src/components/chat/workspace-panel.test.tsx`

- [ ] **步骤 1：先写失败的 UI 测试**

```tsx
import { render, screen } from '@testing-library/react';

import { WorkspacePanel } from './components/chat/workspace-panel';

it('renders delivered files in the workspace panel', () => {
  render(
    <WorkspacePanel
      open
      loading={false}
      error={null}
      workspace={{
        chatId: 'chat-1',
        updatedAt: '2026-05-13T20:00:00+08:00',
        files: [{ id: '1', name: '报告.docx', url: '/media/a', mime: 'application/docx', deliveredAt: '2026-05-13T20:00:00+08:00' }],
      }}
      onClose={() => {}}
      onOpenFile={() => {}}
    />,
  );

  expect(screen.getByText('报告.docx')).toBeInTheDocument();
});
```

- [ ] **步骤 2：实现最小工作空间面板**

```tsx
export function WorkspacePanel({ open, loading, error, workspace, onClose, onOpenFile }: Props) {
  if (!open) return null;
  return (
    <aside className="workspace-panel">
      <div className="workspace-panel-header">
        <h2>工作空间</h2>
        <button type="button" onClick={onClose}>关闭</button>
      </div>
      {loading ? <div className="workspace-state">正在加载…</div> : null}
      {error ? <div className="workspace-state error">{error}</div> : null}
      {!loading && !error && workspace && workspace.files.length === 0 ? (
        <div className="workspace-state">当前会话还没有最终交付文件</div>
      ) : null}
      <div className="workspace-file-list">
        {workspace?.files.map((file) => (
          <button key={file.id} type="button" className="workspace-file-row" onClick={() => onOpenFile(file)}>
            <span className="workspace-file-name">{file.name}</span>
            <span className="workspace-file-time">{file.deliveredAt}</span>
          </button>
        ))}
      </div>
    </aside>
  );
}
```

- [ ] **步骤 3：把入口接到 `thread-shell.tsx` 和现有 `openMedia`**

```tsx
<button
  type="button"
  className="thread-toolbar-button"
  onClick={() => openWorkspace(activeSession.chat_id)}
  disabled={!workspaceFileCount}
>
  查看工作空间
</button>

<WorkspacePanel
  open={workspacePanel.open}
  loading={workspacePanel.loading}
  error={workspacePanel.error}
  workspace={currentWorkspace}
  onClose={closeWorkspace}
  onOpenFile={(file) => openMedia({ url: file.url, name: file.name, mime: file.mime })}
/>
```

- [ ] **步骤 4：跑前端组件测试与构建**

运行：

```bash
cd /Users/brian/Documents/Project/nanobot/nanobot-channel-webui/frontend && npm test -- workspace-panel.test.tsx store.workspace.test.ts
cd /Users/brian/Documents/Project/nanobot/nanobot-channel-webui/frontend && npm run build
```

预期：PASS；`vite build` 成功产出静态资源

- [ ] **步骤 5：Commit**

```bash
cd /Users/brian/Documents/Project/nanobot/nanobot-channel-webui && git add frontend/src/components/chat/workspace-panel.tsx frontend/src/components/chat/thread-shell.tsx frontend/src/styles.css frontend/src/components/chat/workspace-panel.test.tsx && git commit -m "feat(工作空间): 添加会话交付文件面板"
```

## 任务 5：回归验证并发布本地插件包

**文件：**
- 修改：无
- 测试：复用前述测试文件

- [ ] **步骤 1：运行后端测试集合**

```bash
cd /Users/brian/Documents/Project/nanobot/nanobot-channel-webui && pytest tests/test_session_workspace.py tests/test_session_index.py tests/test_history_projection.py -q
```

预期：PASS

- [ ] **步骤 2：运行前端测试集合**

```bash
cd /Users/brian/Documents/Project/nanobot/nanobot-channel-webui/frontend && npm test
```

预期：PASS

- [ ] **步骤 3：重新构建前端**

```bash
cd /Users/brian/Documents/Project/nanobot/nanobot-channel-webui/frontend && npm run build
```

预期：PASS

- [ ] **步骤 4：发布本地插件包**

```bash
cd /Users/brian/Documents/Project/nanobot/nanobot-channel-webui && ./scripts/publish-local.sh
```

预期：本地插件包重新发布成功

- [ ] **步骤 5：最终 Commit**

```bash
cd /Users/brian/Documents/Project/nanobot/nanobot-channel-webui && git add -A && git commit -m "feat(工作空间): 支持按会话查看最终交付文件"
```

## 自检

- 规格覆盖度：
  - 会话级工作空间：任务 1、2、3、4 覆盖。
  - 只收录最终交付文件：任务 2 覆盖。
  - 插件 API：任务 2 覆盖。
  - 前端入口与面板：任务 4 覆盖。
  - 复用现有预览：任务 4 覆盖。
- 占位符扫描：
  - 本计划未使用 “TODO”“后续实现”“补充错误处理” 等占位符语句。
- 类型一致性：
  - 后端统一使用 `chat_id`、`files`、`delivered_at`。
  - 前端统一映射为 `chatId`、`files`、`deliveredAt`。
