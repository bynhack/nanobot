# nanobot_webui 对话区交互式组件方案

> 版本: 2.0  
> 日期: 2026-04-09  
> 状态: 可落地设计  
> 约束: **不动 nanobot 核心代码，仅在 webchannel 内实现**

---

## 1. 目标

目标不是做一个独立设置弹窗系统，而是让 **当前对话内容区** 支持交互式内容。

也就是说：
- AI 可以在对话过程中请求用户确认、选择、输入
- 这些交互直接渲染在聊天消息流里
- 用户在聊天区完成交互
- 交互结果作为工具返回值继续交给 AI 推理

约束：
- 不修改 nanobot core
- 不修改 core 的 tool executor 流程
- 仅在 `nanobot_webui` 内扩展

---

## 2. 为什么原方案需要调整

旧方案的核心思路是：
- 在 `WebUIChannel` 里拦截工具执行
- 通过 `_execute_tool()` 接管 `interactive_*` 工具

这个思路与当前代码结构不匹配。

原因：
- 工具执行发生在 `AgentRunner` / `AgentLoop` / `ToolRegistry`
- `WebUIChannel` 只负责：
  - `_handle_message()` 把浏览器消息送入 bus
  - `send()` / `send_delta()` / `WebUIHook` 接收 agent 输出
- `WebUIChannel` 并不位于工具执行链上

所以“在 channel 中拦截任意工具执行”不可直接落地。

---

## 3. 最终方案

采用三层方案：

1. **WebUI 专属交互工具**
2. **WebSocket 交互协议**
3. **聊天区内联交互组件**

核心原则：
- 交互仍然是一种标准 tool call
- 工具实现放在 `nanobot_webui`，不是 core
- channel 负责传输和会话上下文
- 前端负责把交互渲染为对话内容区中的可操作块

---

## 4. 总体架构

```text
┌─────────────────────────────────────────────────────────────┐
│ nanobot core                                               │
│ - AgentRunner / ToolRegistry 正常执行工具                  │
│ - 不修改 executor，不修改 BaseChannel 契约                │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ 调用 interactive_* 工具
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ nanobot_webui interactive tools                            │
│ - interactive_confirm                                       │
│ - interactive_select                                        │
│ - interactive_input                                         │
│                                                             │
│ 工具内部：                                                  │
│ - 读取当前 WebUI route context                              │
│ - 创建 pending interaction                                  │
│ - 发 interactive.request 到前端                             │
│ - await 用户响应                                            │
│ - 返回结构化结果给 AI                                       │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ WebUI Channel / WebSocket                                   │
│ - 负责 interactive.request / response / cancel 传输         │
│ - 维护 interaction registry                                 │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ Frontend                                                    │
│ - 把交互请求渲染成聊天流中的内联交互块                      │
│ - 用户点击/输入后通过 interactive.response 回传             │
│ - 交互块变成已完成态                                        │
└─────────────────────────────────────────────────────────────┘
```

---

## 5. 为什么这是更好的方案

相比“channel 拦截工具执行”，这个方案更符合 nanobot 现有结构：

- 工具逻辑仍留在工具层
- channel 负责连接与消息传输
- runtime 负责暴露当前会话上下文
- 前端只负责渲染和回传结果

优点：
- 不需要 monkey patch tool executor
- 不改 core
- 不破坏其他 channel
- 容易分阶段落地
- 未来可以逐步扩展更多交互类型

---

## 6. 第一阶段支持的交互类型

第一阶段只做 3 种：

| 工具名 | 用途 | 返回值 |
|--------|------|--------|
| `interactive_confirm` | 确认操作 | `{ confirmed: boolean }` |
| `interactive_select` | 单选/多选 | `{ selected: string \| string[] }` |
| `interactive_input` | 文本输入 | `{ value: string }` |

暂不建议第一阶段实现：
- `interactive_form`
- `interactive_code`
- `interactive_progress`

原因：
- 表单和代码编辑复杂度明显更高
- progress 更像 UI 状态，不像真正需要阻塞等待用户输入的工具

---

## 7. 交互工具定义

### 7.1 `interactive_confirm`

```typescript
interface ConfirmArgs {
  title: string;
  message: string;
  confirm_text?: string;
  cancel_text?: string;
  variant?: "info" | "warning" | "danger";
}

interface ConfirmResult {
  confirmed: boolean;
}
```

### 7.2 `interactive_select`

```typescript
interface SelectArgs {
  title: string;
  description?: string;
  options: Array<{
    label: string;
    value: string;
    description?: string;
    disabled?: boolean;
  }>;
  multiple?: boolean;
  searchable?: boolean;
  placeholder?: string;
}

interface SelectResult {
  selected: string | string[];
}
```

### 7.3 `interactive_input`

```typescript
interface InputArgs {
  title: string;
  description?: string;
  placeholder?: string;
  multiline?: boolean;
  password?: boolean;
  validation?: {
    pattern?: string;
    min_length?: number;
    max_length?: number;
    required?: boolean;
  };
}

interface InputResult {
  value: string;
}
```

---

## 8. 后端设计

### 8.1 新增目录建议

```text
nanobot_webui/
├── channel.py
├── protocol.py
├── runtime.py
├── interactive/
│   ├── __init__.py
│   ├── registry.py
│   ├── tools.py
│   └── types.py
```

### 8.2 `InteractionRegistry`

新增一个待处理交互注册表：

职责：
- 创建 interaction
- 保存 `Future`
- 超时管理
- 响应回填
- 取消清理

建议结构：

```python
@dataclass
class PendingInteraction:
    id: str
    chat_id: str
    kind: str
    payload: dict[str, Any]
    future: asyncio.Future
    created_at: float
```

建议接口：

```python
class InteractionRegistry:
    def create(chat_id: str, kind: str, payload: dict[str, Any]) -> PendingInteraction: ...
    def resolve(interaction_id: str, result: Any) -> bool: ...
    def cancel(interaction_id: str) -> bool: ...
    def cleanup_expired(timeout_s: int) -> None: ...
```

### 8.3 WebUI 专属交互工具

关键点：
- 交互不是由 `channel.py` 直接执行
- 而是由 `nanobot_webui.interactive.tools` 中的工具来执行

工具执行流程：

1. 调用 `current_route_context()`
2. 如果当前不是 WebUI 会话，直接返回错误
3. 创建 pending interaction
4. 通过 `ConnectionRegistry.emit_to_chat()` 发 `interactive.request`
5. 等待 future
6. 返回结构化结果

示意：

```python
async def interactive_confirm_tool(args: dict[str, Any]) -> dict[str, Any]:
    route = current_route_context()
    if not route or route.message.channel != "webui":
        return {
            "status": "error",
            "error": "interactive_not_supported",
            "message": "interactive tools are only supported in webui",
        }

    pending = registry.create(route.chat_id, "confirm", args)
    await registry.emit_request(pending)
    result = await asyncio.wait_for(pending.future, timeout=300)
    return {"status": "ok", "result": result}
```

### 8.4 channel.py 需要做的事

`WebUIChannel` 不负责执行交互逻辑，只负责：
- 持有 `InteractionRegistry`
- 处理 websocket 上行命令：
  - `interactive.response`
  - `interactive.cancel`
- 通过 `ConnectionRegistry` 把交互请求广播到当前 chat

也就是说，`channel.py` 的新增职责只是：
- “交互事件桥”
- 不是“交互工具执行器”

---

## 9. 协议设计

### 9.1 新增前端命令

在 `protocol.py` 中扩展：

```python
ClientCommandType = Literal[
    "message.send",
    "message.cancel",
    "session.new",
    "session.switch",
    "interactive.response",
    "interactive.cancel",
]
```

### 9.2 新增服务端事件

```python
def interactive_request_event(
    chat_id: str,
    interaction_id: str,
    kind: str,
    payload: dict[str, Any],
) -> dict[str, Any]:
    return {
        "type": "interactive.request",
        "chatId": chat_id,
        "id": interaction_id,
        "kind": kind,
        "payload": payload,
    }
```

### 9.3 前端响应结构

```json
{
  "type": "interactive.response",
  "id": "int_xxxxxxxx",
  "result": {
    "confirmed": true
  }
}
```

取消：

```json
{
  "type": "interactive.cancel",
  "id": "int_xxxxxxxx"
}
```

---

## 10. 前端设计

### 10.1 关键原则

交互组件不要做成弹窗，应该做成 **聊天流中的内联消息块**。

原因：
- 更符合“对话内容区支持交互式内容”的目标
- 操作上下文不跳出当前对话
- 完成后能保留完整交互记录
- 更适合后续历史回放

### 10.2 新增消息类型

建议新增：

```typescript
type HistoryMessage =
  | { type: 'user'; ... }
  | { type: 'assistant'; ... }
  | { type: 'tools'; ... }
  | { type: 'outbound'; ... }
  | {
      type: 'interactive';
      id: string;
      kind: 'confirm' | 'select' | 'input';
      payload: Record<string, unknown>;
      status: 'pending' | 'completed' | 'cancelled' | 'timeout';
      result?: Record<string, unknown>;
    };
```

### 10.3 推荐渲染方式

在 assistant 文本之后插入一个交互块：

```text
Assistant: 我需要你确认是否继续。

[交互卡片]
标题：确认删除？
说明：删除后无法恢复
[取消] [确认]
```

完成后变成：

```text
[交互卡片 - 已完成]
确认删除？
结果：已确认
```

### 10.4 前端组件建议

```text
frontend/src/components/interactive/
├── ConfirmBlock.tsx
├── SelectBlock.tsx
├── InputBlock.tsx
└── InteractiveRenderer.tsx
```

建议先做消息块，而不是弹窗：
- `ConfirmBlock`
- `SelectBlock`
- `InputBlock`

---

## 11. 状态管理建议

### 11.1 Store 扩展

在 `store.ts` 中新增：

```typescript
interactiveByChat: Record<string, InteractiveState[]>
```

或者更简单：
- 直接把 `interactive.request` 转成 `HistoryMessage`
- 放进 `messagesByChat[chatId]`

我更建议第二种：
- 更符合“交互也是消息流的一部分”
- 历史回放更自然
- 不需要维护额外的并行状态树

### 11.2 事件处理

收到 `interactive.request`：
- 追加一条 `type: 'interactive'` 消息

收到用户响应：
- 更新对应消息的 `status` 和 `result`

---

## 12. 执行流程

### 12.1 正常交互流程

```text
AI 调用 interactive_confirm
    ↓
WebUI 专属工具创建 pending interaction
    ↓
WebSocket 下发 interactive.request
    ↓
前端在聊天区渲染 ConfirmBlock
    ↓
用户点击确认
    ↓
WebSocket 上发 interactive.response
    ↓
后端 registry.resolve(...)
    ↓
Future 完成
    ↓
工具返回 { confirmed: true }
    ↓
AI 继续执行
```

### 12.2 取消流程

```text
用户点击取消
    ↓
interactive.cancel
    ↓
registry.cancel(...)
    ↓
工具收到 CancelledError 或结构化取消结果
    ↓
AI 决定后续行为
```

### 12.3 超时流程

```text
交互发起后超过 timeout
    ↓
future timeout
    ↓
工具返回 error / timeout
    ↓
前端交互块标记为 timeout
```

---

## 13. 边界条件

必须考虑：

### 13.1 非 WebUI 会话

如果当前不是 `webui` channel：
- 交互工具直接返回错误
- 不尝试发交互请求

### 13.2 每个 chat 同时只允许一个 pending interaction

第一阶段建议限制：
- 一个 `chat_id` 同时只允许一个未完成交互

理由：
- 实现简单
- 减少前端状态冲突
- 更符合自然对话节奏

### 13.3 页面刷新 / websocket 重连

第一阶段建议：
- 不做 interaction 恢复
- 如果断开，等待超时

后续再考虑：
- 把 pending interaction 写入内存态可恢复结构

### 13.4 只读会话

当前 WebUI 已支持查看其他 channel 会话。

这些会话必须保持：
- 只读
- 不允许 interactive tools
- 不允许在其上继续输入

---

## 14. 推荐的落地顺序

### 第一阶段

- `interactive_confirm`
- 后端 registry
- `interactive.request / response / cancel`
- 聊天区 `ConfirmBlock`
- 单 chat 单 pending

### 第二阶段

- `interactive_select`
- `interactive_input`
- 完成态显示

### 第三阶段

- 历史回放保留交互块结果
- 更复杂组件：
  - `interactive_form`
  - `interactive_code`

---

## 15. 与当前代码的契合点

这套方案直接复用当前已有能力：

- `runtime.current_route_context()`
- `ConnectionRegistry.emit_to_chat()`
- `WebSocketClient`
- `store.ts`
- 当前对话区消息渲染体系

所以它不是推翻式重构，而是一个增量方案。

---

## 16. 最终结论

最合适的实现方式是：

- 不做“channel 拦截 executor”
- 做“WebUI 专属交互工具”
- 用 websocket 事件桥接前后端
- 把交互组件渲染在对话内容区内联消息中

这样最符合当前 nanobot 和 `nanobot_webui` 的架构，也最容易在不修改 core 的前提下落地。
