# PocketBase 账号系统实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 在 `nanobot-channel-webui` 插件内部接入外部独立运行的 `PocketBase`，使用其内置 auth 完成管理员 / 普通用户账号系统，并让新会话、上传文件、运行数据都进入用户隔离模型。

**架构：** 插件新增一个轻量 `PocketBase` 客户端层和认证上下文层，所有新会话先写 `PocketBase chat_sessions` 索引，再继续落本地真实消息文件；前端新增登录流和角色分流视图；普通用户只读写自己的新数据，管理员全看。旧会话不迁移、不进入新账号列表。

**技术栈：** Python 3.11、aiohttp、PocketBase REST auth、React、TypeScript、现有 nanobot session 文件体系

---

## 文件结构

**创建：**

- `src/nanobot_channel_webui/pocketbase.py`
  - 统一封装 PocketBase 配置、登录、当前用户解析、`chat_sessions` 索引读写。
- `src/nanobot_channel_webui/user_context.py`
  - 在 HTTP / WebSocket 请求处理中维护当前用户上下文。
- `src/nanobot_channel_webui/session_index.py`
  - 负责 `chat_sessions` 的创建、列表过滤、删除同步。
- `tests/test_pocketbase_client.py`
  - 覆盖 PocketBase 客户端与角色解析。
- `tests/test_session_index.py`
  - 覆盖会话索引写入、查询与权限过滤。
- `frontend/src/auth-store.ts`
  - 管理前端登录态、当前用户和角色。
- `frontend/src/login-page.tsx`
  - 最小可用登录页。
- `frontend/src/auth.test.ts`
  - 覆盖登录态切换和角色判断。

**修改：**

- `src/nanobot_channel_webui/config.py`
  - 增加 PocketBase 配置项。
- `src/nanobot_channel_webui/auth.py`
  - 增加 PocketBase 认证与登录态校验辅助。
- `src/nanobot_channel_webui/channel.py`
  - 新增登录 / 退出 / 当前用户接口；给 `/sessions`、`/uploads`、`/api/settings/runtime` 等入口挂权限边界。
- `src/nanobot_channel_webui/sessions.py`
  - 改为优先通过 `chat_sessions` 索引查询新会话。
- `src/nanobot_channel_webui/uploads.py`
  - 上传目录切换到 `user_id/chat_id` 结构。
- `src/nanobot_channel_webui/management.py`
  - runtime 信息按角色过滤。
- `frontend/src/api.ts`
  - 增加登录、退出、读取当前用户等 API。
- `frontend/src/types.ts`
  - 增加用户、角色、登录态、PocketBase 相关类型。
- `frontend/src/store.ts`
  - 补登录后会话初始化路径。
- `frontend/src/ws-client.ts`
  - 让 WebSocket 带上登录态。
- `frontend/src/app.tsx`
  - 登录前后视图切换、管理员 / 普通用户差异化入口。
- `frontend/src/settings-page.tsx`
  - 根据角色收缩设置入口。
- `frontend/src/components/settings/tabs/GeneralTab.tsx`
  - 展示当前用户和角色。
- `README.md`
  - 补 PocketBase 外部依赖和最小配置示例。

**测试：**

- `tests/test_pocketbase_client.py`
- `tests/test_session_index.py`
- `tests/test_runtime_compat.py`
- `tests/test_history_projection.py`
- `frontend/src/auth.test.ts`
- `frontend/src/store.ask-user.test.ts`
- `frontend/src/turn-state.test.ts`
- `frontend/src/ask-user.test.ts`

## 任务 1：定义 PocketBase 配置与最小客户端

**文件：**

- 创建：`src/nanobot_channel_webui/pocketbase.py`
- 修改：`src/nanobot_channel_webui/config.py`
- 测试：`tests/test_pocketbase_client.py`

- [ ] **步骤 1：编写失败的 PocketBase 配置与角色测试**

```python
from nanobot_channel_webui.config import WebUIConfig
from nanobot_channel_webui.pocketbase import PocketBaseUser, role_from_record


def test_webui_config_accepts_pocketbase_settings() -> None:
    config = WebUIConfig.model_validate({
        "enabled": True,
        "pocketbaseUrl": "http://127.0.0.1:8090",
        "pocketbaseUsersCollection": "users",
        "pocketbaseSessionsCollection": "chat_sessions",
    })

    assert str(config.pocketbase_url) == "http://127.0.0.1:8090/"
    assert config.pocketbase_users_collection == "users"
    assert config.pocketbase_sessions_collection == "chat_sessions"


def test_role_from_record_defaults_to_user() -> None:
    assert role_from_record({"id": "u1"}) == "user"
    assert role_from_record({"id": "u1", "role": "admin"}) == "admin"
```

- [ ] **步骤 2：运行测试验证失败**

运行：

```bash
/Users/brian/Documents/Project/nanobot/.venv/bin/python -m pytest /Users/brian/Documents/Project/nanobot/nanobot-channel-webui/tests/test_pocketbase_client.py -q
```

预期：`FAIL`，因为 `pocketbase.py` 与相关配置字段尚不存在。

- [ ] **步骤 3：实现最小 PocketBase 配置项**

在 `config.py` 中新增字段：

```python
pocketbase_url: str = ""
pocketbase_users_collection: str = "users"
pocketbase_sessions_collection: str = "chat_sessions"
```

同时保留 camelCase 兼容。

- [ ] **步骤 4：实现最小 PocketBase 客户端骨架**

在 `pocketbase.py` 中新增：

```python
from dataclasses import dataclass
from typing import Any, Literal

UserRole = Literal["admin", "user"]


@dataclass(slots=True)
class PocketBaseUser:
    id: str
    email: str
    role: UserRole
    token: str = ""


def role_from_record(record: dict[str, Any]) -> UserRole:
    return "admin" if str(record.get("role", "")).strip() == "admin" else "user"
```

- [ ] **步骤 5：运行测试验证通过**

运行：

```bash
/Users/brian/Documents/Project/nanobot/.venv/bin/python -m pytest /Users/brian/Documents/Project/nanobot/nanobot-channel-webui/tests/test_pocketbase_client.py -q
```

预期：`PASS`

- [ ] **步骤 6：Commit**

```bash
git add /Users/brian/Documents/Project/nanobot/nanobot-channel-webui/src/nanobot_channel_webui/config.py \
        /Users/brian/Documents/Project/nanobot/nanobot-channel-webui/src/nanobot_channel_webui/pocketbase.py \
        /Users/brian/Documents/Project/nanobot/nanobot-channel-webui/tests/test_pocketbase_client.py
git commit -m "feat(webui-plugin): add PocketBase config and client skeleton"
```

## 任务 2：建立认证上下文与登录 / 退出接口

**文件：**

- 创建：`src/nanobot_channel_webui/user_context.py`
- 修改：`src/nanobot_channel_webui/auth.py`
- 修改：`src/nanobot_channel_webui/channel.py`
- 修改：`frontend/src/api.ts`
- 修改：`frontend/src/types.ts`
- 创建：`frontend/src/auth-store.ts`
- 创建：`frontend/src/login-page.tsx`
- 测试：`tests/test_pocketbase_client.py`
- 测试：`frontend/src/auth.test.ts`

- [ ] **步骤 1：编写失败的后端认证测试**

```python
from nanobot_channel_webui.pocketbase import PocketBaseUser


def test_parse_current_user_from_login_payload() -> None:
    user = PocketBaseUser(id="u1", email="admin@example.com", role="admin", token="abc")

    assert user.id == "u1"
    assert user.role == "admin"
    assert user.token == "abc"
```

- [ ] **步骤 2：编写失败的前端登录态测试**

```ts
import { describe, expect, test } from 'vitest';
import { createAuthState } from './auth-store';

describe('auth-store', () => {
  test('starts unauthenticated', () => {
    const state = createAuthState();
    expect(state.status).toBe('anonymous');
  });
});
```

- [ ] **步骤 3：运行测试验证失败**

运行：

```bash
/Users/brian/Documents/Project/nanobot/.venv/bin/python -m pytest /Users/brian/Documents/Project/nanobot/nanobot-channel-webui/tests/test_pocketbase_client.py -q
cd /Users/brian/Documents/Project/nanobot/nanobot-channel-webui/frontend && bun run vitest run src/auth.test.ts
```

预期：均 `FAIL`

- [ ] **步骤 4：实现后端当前用户上下文**

在 `user_context.py` 中定义：

```python
from contextvars import ContextVar
from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class CurrentUser:
    id: str
    email: str
    role: str
    token: str
```

并提供 `get_current_user()` / `set_current_user()` / `clear_current_user()`。

- [ ] **步骤 5：在 `channel.py` 中新增最小 auth API**

新增接口：

- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`

要求：

- 登录时调用 PocketBase auth API
- 成功后返回当前用户
- 退出时清理插件登录态
- `me` 返回当前用户或未登录状态

- [ ] **步骤 6：实现前端登录壳层**

在前端新增：

- `auth-store.ts` 管理 `anonymous / authenticated / loading`
- `login-page.tsx` 只做 email / password 登录
- `app.tsx` 在未登录时渲染登录页

- [ ] **步骤 7：运行测试验证通过**

运行：

```bash
/Users/brian/Documents/Project/nanobot/.venv/bin/python -m pytest /Users/brian/Documents/Project/nanobot/nanobot-channel-webui/tests/test_pocketbase_client.py -q
cd /Users/brian/Documents/Project/nanobot/nanobot-channel-webui/frontend && bun run vitest run src/auth.test.ts
```

预期：`PASS`

- [ ] **步骤 8：Commit**

```bash
git add /Users/brian/Documents/Project/nanobot/nanobot-channel-webui/src/nanobot_channel_webui/user_context.py \
        /Users/brian/Documents/Project/nanobot/nanobot-channel-webui/src/nanobot_channel_webui/auth.py \
        /Users/brian/Documents/Project/nanobot/nanobot-channel-webui/src/nanobot_channel_webui/channel.py \
        /Users/brian/Documents/Project/nanobot/nanobot-channel-webui/frontend/src/api.ts \
        /Users/brian/Documents/Project/nanobot/nanobot-channel-webui/frontend/src/types.ts \
        /Users/brian/Documents/Project/nanobot/nanobot-channel-webui/frontend/src/auth-store.ts \
        /Users/brian/Documents/Project/nanobot/nanobot-channel-webui/frontend/src/login-page.tsx \
        /Users/brian/Documents/Project/nanobot/nanobot-channel-webui/frontend/src/auth.test.ts
git commit -m "feat(webui-plugin): add PocketBase login flow"
```

## 任务 3：新增 `chat_sessions` 索引层并接入会话列表

**文件：**

- 创建：`src/nanobot_channel_webui/session_index.py`
- 修改：`src/nanobot_channel_webui/pocketbase.py`
- 修改：`src/nanobot_channel_webui/sessions.py`
- 修改：`src/nanobot_channel_webui/channel.py`
- 测试：`tests/test_session_index.py`

- [ ] **步骤 1：编写失败的会话索引测试**

```python
from nanobot_channel_webui.session_index import build_session_index_payload


def test_build_session_index_payload_for_new_chat() -> None:
    payload = build_session_index_payload(
        owner_id="u1",
        chat_id="chat-1",
        session_key="webui_plugin:chat-1",
        title="新对话",
        preview="hello",
    )

    assert payload["owner"] == "u1"
    assert payload["chat_id"] == "chat-1"
    assert payload["session_key"] == "webui_plugin:chat-1"
```

- [ ] **步骤 2：运行测试验证失败**

运行：

```bash
/Users/brian/Documents/Project/nanobot/.venv/bin/python -m pytest /Users/brian/Documents/Project/nanobot/nanobot-channel-webui/tests/test_session_index.py -q
```

预期：`FAIL`

- [ ] **步骤 3：实现会话索引 payload 与查询骨架**

在 `session_index.py` 中新增：

```python
def build_session_index_payload(*, owner_id: str, chat_id: str, session_key: str, title: str, preview: str) -> dict[str, object]:
    return {
        "owner": owner_id,
        "chat_id": chat_id,
        "session_key": session_key,
        "title": title,
        "preview": preview,
    }
```

并补索引创建 / 删除 / 按角色查询的服务函数。

- [ ] **步骤 4：让会话列表改为以 PocketBase 索引为准**

要求：

- 普通用户仅查询自己的 `owner`
- 管理员查询全部
- 再将索引映射回本地 session 文件
- 旧会话不进入列表

- [ ] **步骤 5：新会话创建时同步写索引**

在聊天消息首次建立新会话时，同步写入 `chat_sessions`。

- [ ] **步骤 6：运行测试验证通过**

运行：

```bash
/Users/brian/Documents/Project/nanobot/.venv/bin/python -m pytest /Users/brian/Documents/Project/nanobot/nanobot-channel-webui/tests/test_session_index.py -q
```

预期：`PASS`

- [ ] **步骤 7：Commit**

```bash
git add /Users/brian/Documents/Project/nanobot/nanobot-channel-webui/src/nanobot_channel_webui/session_index.py \
        /Users/brian/Documents/Project/nanobot/nanobot-channel-webui/src/nanobot_channel_webui/pocketbase.py \
        /Users/brian/Documents/Project/nanobot/nanobot-channel-webui/src/nanobot_channel_webui/sessions.py \
        /Users/brian/Documents/Project/nanobot/nanobot-channel-webui/src/nanobot_channel_webui/channel.py \
        /Users/brian/Documents/Project/nanobot/nanobot-channel-webui/tests/test_session_index.py
git commit -m "feat(webui-plugin): add PocketBase session index"
```

## 任务 4：上传文件与运行数据进入用户隔离模型

**文件：**

- 修改：`src/nanobot_channel_webui/uploads.py`
- 修改：`src/nanobot_channel_webui/channel.py`
- 修改：`src/nanobot_channel_webui/management.py`
- 修改：`frontend/src/components/settings/tabs/RuntimeTab.tsx`
- 修改：`frontend/src/components/settings/tabs/GeneralTab.tsx`
- 测试：`tests/test_runtime_compat.py`

- [ ] **步骤 1：编写失败的上传路径隔离测试**

```python
from pathlib import Path
from nanobot_channel_webui.uploads import next_upload_path


def test_next_upload_path_is_user_scoped(tmp_path: Path) -> None:
    path = next_upload_path(tmp_path, "user-1", "chat-1", "report.pdf")

    assert "user-1" in str(path)
    assert "chat-1" in str(path)
```

- [ ] **步骤 2：运行测试验证失败**

运行：

```bash
/Users/brian/Documents/Project/nanobot/.venv/bin/python -m pytest /Users/brian/Documents/Project/nanobot/nanobot-channel-webui/tests/test_runtime_compat.py -q
```

预期：`FAIL`，因为现有签名还没有 `user_id`

- [ ] **步骤 3：实现上传目录用户隔离**

将：

```python
next_upload_path(workspace, chat_id, filename)
```

扩展为：

```python
next_upload_path(workspace, user_id, chat_id, filename)
```

并落到：

```text
.nanobot_webui_uploads/<user_id>/<chat_id>/
```

- [ ] **步骤 4：按角色收缩运行数据**

要求：

- 管理员看到完整运行视图
- 普通用户只看到自己可见范围
- 普通用户不看到其他用户上传目录和全局会话数据

- [ ] **步骤 5：在 General / Runtime 页展示当前用户与角色**

前端要求：

- General 页显示当前用户 email 与 role
- Runtime 页根据 role 缩放数据视图

- [ ] **步骤 6：运行测试验证通过**

运行：

```bash
/Users/brian/Documents/Project/nanobot/.venv/bin/python -m pytest /Users/brian/Documents/Project/nanobot/nanobot-channel-webui/tests/test_runtime_compat.py -q
```

预期：`PASS`

- [ ] **步骤 7：Commit**

```bash
git add /Users/brian/Documents/Project/nanobot/nanobot-channel-webui/src/nanobot_channel_webui/uploads.py \
        /Users/brian/Documents/Project/nanobot/nanobot-channel-webui/src/nanobot_channel_webui/channel.py \
        /Users/brian/Documents/Project/nanobot/nanobot-channel-webui/src/nanobot_channel_webui/management.py \
        /Users/brian/Documents/Project/nanobot/nanobot-channel-webui/frontend/src/components/settings/tabs/RuntimeTab.tsx \
        /Users/brian/Documents/Project/nanobot/nanobot-channel-webui/frontend/src/components/settings/tabs/GeneralTab.tsx \
        /Users/brian/Documents/Project/nanobot/nanobot-channel-webui/tests/test_runtime_compat.py
git commit -m "feat(webui-plugin): isolate uploads and runtime data by user"
```

## 任务 5：前端会话初始化、权限分流与回归验证

**文件：**

- 修改：`frontend/src/app.tsx`
- 修改：`frontend/src/ws-client.ts`
- 修改：`frontend/src/store.ts`
- 修改：`README.md`
- 测试：`frontend/src/auth.test.ts`
- 测试：`frontend/src/store.ask-user.test.ts`
- 测试：`frontend/src/turn-state.test.ts`

- [ ] **步骤 1：编写失败的前端权限分流测试**

```ts
import { describe, expect, test } from 'vitest';
import { canViewAdminRuntime } from './auth-store';

describe('role guards', () => {
  test('admin can view admin runtime', () => {
    expect(canViewAdminRuntime('admin')).toBe(true);
    expect(canViewAdminRuntime('user')).toBe(false);
  });
});
```

- [ ] **步骤 2：运行测试验证失败**

运行：

```bash
cd /Users/brian/Documents/Project/nanobot/nanobot-channel-webui/frontend && bun run vitest run src/auth.test.ts
```

预期：`FAIL`

- [ ] **步骤 3：实现前端角色守卫与会话初始化**

要求：

- 登录成功后加载当前用户
- 用当前 token 初始化 WebSocket
- 只显示当前角色可见的设置与运行页面
- 未登录直接渲染登录页

- [ ] **步骤 4：补最小配置说明**

在 `README.md` 中补：

- 外部 `PocketBase` 运行要求
- 插件新增配置项
- `role` 字段说明
- 第一版只支持新会话进入账号系统

- [ ] **步骤 5：运行完整插件验证**

运行：

```bash
/Users/brian/Documents/Project/nanobot/.venv/bin/python -m pytest /Users/brian/Documents/Project/nanobot/nanobot-channel-webui/tests -q
cd /Users/brian/Documents/Project/nanobot/nanobot-channel-webui/frontend && bun run test
cd /Users/brian/Documents/Project/nanobot/nanobot-channel-webui/frontend && bun run build
python3 -m compileall /Users/brian/Documents/Project/nanobot/nanobot-channel-webui/src
```

预期：

- Python 测试全部通过
- 前端测试全部通过
- 前端构建通过
- Python 源码编译通过

- [ ] **步骤 6：Commit**

```bash
git add /Users/brian/Documents/Project/nanobot/nanobot-channel-webui/frontend/src/app.tsx \
        /Users/brian/Documents/Project/nanobot/nanobot-channel-webui/frontend/src/ws-client.ts \
        /Users/brian/Documents/Project/nanobot/nanobot-channel-webui/frontend/src/store.ts \
        /Users/brian/Documents/Project/nanobot/nanobot-channel-webui/frontend/src/auth.test.ts \
        /Users/brian/Documents/Project/nanobot/nanobot-channel-webui/README.md
git commit -m "feat(webui-plugin): finish PocketBase auth flow"
```

---

## 自检结果

- 规格覆盖度：
  - PocketBase 外部接入 → 任务 1、2
  - 管理员 / 普通用户角色 → 任务 2、5
  - `chat_sessions` 会话索引 → 任务 3
  - 上传文件用户隔离 → 任务 4
  - 运行数据按角色过滤 → 任务 4
  - 旧会话不迁移、新会话才进入列表 → 任务 3、README in 任务 5
- 占位符扫描：计划未使用 “TODO”“后续补充”“类似任务 N” 等占位描述。
- 类型一致性：
  - `role` 统一为 `"admin" | "user"`
  - `chat_sessions` 统一作为 PocketBase 会话索引 collection 名
  - 当前用户上下文统一通过 `CurrentUser` 暴露

计划已完成并保存到 [`/Users/brian/Documents/Project/nanobot/nanobot-channel-webui/docs/2026-05-10-pocketbase-auth-plan.md`](</Users/brian/Documents/Project/nanobot/nanobot-channel-webui/docs/2026-05-10-pocketbase-auth-plan.md>)。

两种执行方式：

**1. 子代理驱动（推荐）** - 每个任务调度一个新的子代理，任务间进行审查，快速迭代

**2. 内联执行** - 在当前会话中使用 `executing-plans` 执行任务，批量执行并设有检查点

选哪种方式？
