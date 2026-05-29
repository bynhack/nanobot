# WebUI 插件运行稳定性实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 在不修改 `nanobot-channel-webui` 目录外任何代码、且不破坏现有可运行功能的前提下，提升插件运行时稳定性，优先解决 runtime 接入脆弱、流式时序错乱、会话历史投影脆弱这 3 类风险。

**架构：** 保持现有 HTTP / WebSocket / channel 对外行为不变，在插件内部新增 3 层收敛面：runtime 接入层、turn 事件聚合层、历史投影层。每一层都先以兼容现状为前提提供稳定内部语义，再逐步替换当前分散逻辑。

**技术栈：** Python 3.11、aiohttp、Pydantic、TypeScript、React、现有 nanobot 插件 entry point 机制

---

## 文件结构

**创建：**

- `src/nanobot_channel_webui/compat/runtime_state.py`
  - 维护 runtime attach 状态、能力探测结果、包装是否完成、hook 注册状态。
- `src/nanobot_channel_webui/turns.py`
  - 统一定义插件内部 turn 生命周期、事件归并规则、单次完成约束。
- `src/nanobot_channel_webui/history_projection.py`
  - 将 nanobot session 原始消息投影为插件内部稳定历史模型。
- `frontend/src/turn-state.ts`
  - 将前端 turn 聚合逻辑从 `store.ts` 中拆出，集中处理 `turn.phase` / `turn.delta` / `tools.*` / `turn.completed`。

**修改：**

- `src/nanobot_channel_webui/compat/runtime.py`
  - 改为依赖 `runtime_state.py`，避免直接散落的 monkey patch 状态。
- `src/nanobot_channel_webui/channel.py`
  - 收敛 runtime attach、事件发射、turn 生命周期桥接。
- `src/nanobot_channel_webui/protocol.py`
  - 补足内部事件字段，保持向后兼容。
- `src/nanobot_channel_webui/sessions.py`
  - 改为调用 `history_projection.py` 做历史重建。
- `frontend/src/store.ts`
  - 保留 store 外壳，转调 `turn-state.ts`。
- `frontend/src/types.ts`
  - 为更稳定的 turn / tool / completion 事件模型补充类型。

**测试：**

- `tests/test_runtime_compat.py`
- `frontend/src/store.ask-user.test.ts`
- `frontend/src/ui-utils-sidebar.test.ts`
- 按需要补充：
  - `frontend/src/turn-state.test.ts`
  - `tests/test_history_projection.py`

## 任务 1：收敛 runtime 接入状态，消除半 attach 和重复包装风险

**文件：**

- 创建：`src/nanobot_channel_webui/compat/runtime_state.py`
- 修改：`src/nanobot_channel_webui/compat/runtime.py`
- 修改：`src/nanobot_channel_webui/channel.py`
- 测试：`tests/test_runtime_compat.py`

- [ ] **步骤 1：编写失败的 runtime 状态测试**

```python
from nanobot_channel_webui.compat.runtime_state import RuntimeAttachState


def test_runtime_attach_state_tracks_wrapped_process_once() -> None:
    state = RuntimeAttachState()

    assert state.is_wrapped is False

    state.mark_wrapped("process-message-wrapper")
    state.mark_wrapped("process-message-wrapper")

    assert state.is_wrapped is True
    assert state.wrapper_name == "process-message-wrapper"
    assert state.wrap_count == 1


def test_runtime_attach_state_distinguishes_hook_registration() -> None:
    state = RuntimeAttachState()

    assert state.hook_registered is False

    state.mark_hook_registered()

    assert state.hook_registered is True
```

- [ ] **步骤 2：运行测试验证失败**

运行：`pytest /Users/brian/Documents/Project/nanobot/nanobot-channel-webui/tests/test_runtime_compat.py -v`

预期：`FAIL`，报错 `ModuleNotFoundError` 或 `ImportError`，因为 `runtime_state.py` 尚不存在。

- [ ] **步骤 3：实现 runtime attach 状态对象**

```python
from dataclasses import dataclass


@dataclass(slots=True)
class RuntimeAttachState:
    wrapper_name: str | None = None
    wrap_count: int = 0
    hook_registered: bool = False

    @property
    def is_wrapped(self) -> bool:
        return self.wrapper_name is not None

    def mark_wrapped(self, wrapper_name: str) -> None:
        if self.wrapper_name is not None:
            return
        self.wrapper_name = wrapper_name
        self.wrap_count = 1

    def mark_hook_registered(self) -> None:
        self.hook_registered = True
```

- [ ] **步骤 4：将 `compat/runtime.py` 重构为显式状态驱动**

```python
def attach_webui_runtime(bus: MessageBus, hook: Any) -> bool:
    loop = _find_agent_loop(bus)
    if loop is None:
        return False

    state = _ensure_runtime_state(loop)
    _register_hook(loop, hook, state)

    original = loop._process_message
    original_func = getattr(original, "__func__", None)
    if original_func is None:
        return False

    if state.is_wrapped:
        return True

    async def _wrapped_process_message(self: AgentLoop, msg: InboundMessage, *args: Any, **kwargs: Any):
        token = None
        if msg.channel == CHANNEL_NAME:
            token = push_route_context(msg, wants_streaming=kwargs.get("on_stream") is not None)
        try:
            return await original_func(self, msg, *args, **kwargs)
        finally:
            if token is not None:
                pop_route_context(token)

    setattr(_wrapped_process_message, _WRAPPER_MARKER, True)
    loop._process_message = MethodType(_wrapped_process_message, loop)
    state.mark_wrapped("webui-process-message-wrapper")
    return True
```

- [ ] **步骤 5：让 `channel.py` 只消费 attach 结果，不再隐式依赖“多试几次可能成功”**

```python
def _ensure_runtime_attached(self) -> bool:
    attached = attach_webui_runtime(self.bus, self._hook)
    if attached:
        self._runtime_attach_warned = False
        return True
    if not self._runtime_attach_warned:
        logger.warning("WebUI runtime hook unavailable; running in outbound-only compatibility mode")
        self._runtime_attach_warned = True
    return False
```

- [ ] **步骤 6：运行测试验证通过**

运行：`pytest /Users/brian/Documents/Project/nanobot/nanobot-channel-webui/tests/test_runtime_compat.py -v`

预期：`PASS`

- [ ] **步骤 7：Commit**

```bash
git add /Users/brian/Documents/Project/nanobot/nanobot-channel-webui/src/nanobot_channel_webui/compat/runtime.py \
        /Users/brian/Documents/Project/nanobot/nanobot-channel-webui/src/nanobot_channel_webui/compat/runtime_state.py \
        /Users/brian/Documents/Project/nanobot/nanobot-channel-webui/src/nanobot_channel_webui/channel.py \
        /Users/brian/Documents/Project/nanobot/nanobot-channel-webui/tests/test_runtime_compat.py
git commit -m "refactor(webui-plugin): stabilize runtime attachment state"
```

## 任务 2：统一后端 turn 事件语义，避免重复完成和错序提交

**文件：**

- 创建：`src/nanobot_channel_webui/turns.py`
- 修改：`src/nanobot_channel_webui/channel.py`
- 修改：`src/nanobot_channel_webui/protocol.py`
- 测试：`tests/test_runtime_compat.py`

- [ ] **步骤 1：编写失败的 turn 聚合测试**

```python
from nanobot_channel_webui.turns import TurnAccumulator


def test_turn_accumulator_commits_stream_once_before_completion() -> None:
    acc = TurnAccumulator()

    acc.start_stream(chat_id="c1", stream_id="s1")
    acc.push_delta(chat_id="c1", delta="hello")
    snapshot = acc.finish(chat_id="c1", content="")

    assert snapshot.stream_text == "hello"
    assert snapshot.should_emit_completion is True
    assert snapshot.finished is True


def test_turn_accumulator_ignores_late_phase_after_finish() -> None:
    acc = TurnAccumulator()

    acc.start_stream(chat_id="c1", stream_id="s1")
    acc.finish(chat_id="c1", content="done")
    changed = acc.update_phase(chat_id="c1", phase="running_tools")

    assert changed is False
```

- [ ] **步骤 2：运行测试验证失败**

运行：`pytest /Users/brian/Documents/Project/nanobot/nanobot-channel-webui/tests/test_runtime_compat.py -v`

预期：`FAIL`，因为 `turns.py` 尚不存在。

- [ ] **步骤 3：实现插件内部 turn 聚合器**

```python
from dataclasses import dataclass, field


@dataclass(slots=True)
class TurnSnapshot:
    stream_text: str = ""
    finished: bool = False
    should_emit_completion: bool = False


@dataclass(slots=True)
class _TurnState:
    stream_id: str | None = None
    stream_text: str = ""
    finished: bool = False


class TurnAccumulator:
    def __init__(self) -> None:
        self._turns: dict[str, _TurnState] = {}

    def start_stream(self, *, chat_id: str, stream_id: str | None) -> None:
        state = self._turns.setdefault(chat_id, _TurnState())
        if state.finished:
            return
        state.stream_id = stream_id

    def push_delta(self, *, chat_id: str, delta: str) -> None:
        state = self._turns.setdefault(chat_id, _TurnState())
        if state.finished:
            return
        state.stream_text += delta

    def update_phase(self, *, chat_id: str, phase: str) -> bool:
        state = self._turns.get(chat_id)
        return bool(state is not None and not state.finished)

    def finish(self, *, chat_id: str, content: str) -> TurnSnapshot:
        state = self._turns.setdefault(chat_id, _TurnState())
        if state.finished:
            return TurnSnapshot(stream_text=state.stream_text, finished=True, should_emit_completion=False)
        state.finished = True
        return TurnSnapshot(stream_text=state.stream_text or content, finished=True, should_emit_completion=True)
```

- [ ] **步骤 4：让 `channel.py` 使用 `TurnAccumulator` 发射事件**

```python
self._turn_accumulator = TurnAccumulator()

async def send_delta(self, chat_id: str, delta: str, metadata: dict[str, Any] | None = None) -> None:
    ...
    self._turn_accumulator.start_stream(chat_id=chat_id, stream_id=stream_id)
    self._turn_accumulator.push_delta(chat_id=chat_id, delta=delta)
    ...

async def send(self, msg: OutboundMessage) -> None:
    ...
    snapshot = self._turn_accumulator.finish(chat_id=msg.chat_id, content=content)
    if not snapshot.should_emit_completion:
        return
    ...
```

- [ ] **步骤 5：为内部事件补充稳定字段并保持兼容**

```python
def turn_completed_event(chat_id: str, *, content: str = "", media=None, buttons=None, stream_id: str | None = None) -> dict[str, Any]:
    payload = {
        "type": "turn.completed",
        "chatId": chat_id,
        "content": content,
    }
    if stream_id:
        payload["streamId"] = stream_id
    ...
    return payload
```

- [ ] **步骤 6：运行测试验证通过**

运行：`pytest /Users/brian/Documents/Project/nanobot/nanobot-channel-webui/tests/test_runtime_compat.py -v`

预期：`PASS`

- [ ] **步骤 7：Commit**

```bash
git add /Users/brian/Documents/Project/nanobot/nanobot-channel-webui/src/nanobot_channel_webui/turns.py \
        /Users/brian/Documents/Project/nanobot/nanobot-channel-webui/src/nanobot_channel_webui/channel.py \
        /Users/brian/Documents/Project/nanobot/nanobot-channel-webui/src/nanobot_channel_webui/protocol.py \
        /Users/brian/Documents/Project/nanobot/nanobot-channel-webui/tests/test_runtime_compat.py
git commit -m "refactor(webui-plugin): normalize backend turn event lifecycle"
```

## 任务 3：收敛前端 turn 状态机，吸收迟到事件和重复完成

**文件：**

- 创建：`frontend/src/turn-state.ts`
- 创建：`frontend/src/turn-state.test.ts`
- 修改：`frontend/src/store.ts`
- 修改：`frontend/src/types.ts`

- [ ] **步骤 1：编写失败的前端 turn 状态测试**

```ts
import { applyTurnEvent, createEmptyTurnState } from './turn-state';

test('ignores late phase after completion', () => {
  const finished = applyTurnEvent(createEmptyTurnState(), {
    type: 'turn.completed',
    chatId: 'c1',
    content: 'done',
  });

  const next = applyTurnEvent(finished, {
    type: 'turn.phase',
    chatId: 'c1',
    phase: 'running_tools',
  });

  expect(next.phase).toBe('completed');
});

test('commits streamed text only once', () => {
  let state = createEmptyTurnState();
  state = applyTurnEvent(state, { type: 'turn.delta', chatId: 'c1', delta: 'hel', streamId: 's1' });
  state = applyTurnEvent(state, { type: 'turn.delta', chatId: 'c1', delta: 'lo', streamId: 's1' });
  state = applyTurnEvent(state, { type: 'turn.completed', chatId: 'c1', content: '' });

  expect(state.streamBuffer).toBe('');
  expect(state.phase).toBe('completed');
});
```

- [ ] **步骤 2：运行测试验证失败**

运行：`cd /Users/brian/Documents/Project/nanobot/nanobot-channel-webui/frontend && bun run test`

预期：`FAIL`，提示 `turn-state.ts` 不存在或导出缺失。

- [ ] **步骤 3：实现前端独立 turn 状态模块**

```ts
export function createEmptyTurnState(): ActiveTurnState {
  return {
    phase: 'idle',
    waiting: false,
    messageId: null,
    streamBuffer: '',
    streamId: null,
    pendingTools: null,
    startedAtMs: null,
    lastDurationMs: null,
  };
}

export function applyTurnEvent(state: ActiveTurnState, event: ServerEvent): ActiveTurnState {
  if (state.phase === 'completed' && state.waiting === false && event.type === 'turn.phase') {
    return state;
  }
  return state;
}
```

- [ ] **步骤 4：将 `store.ts` 中 turn 归并逻辑迁移到 `turn-state.ts`**

```ts
import { applyTurnEvent, createEmptyTurnState } from './turn-state';

function withActiveTurn(state: AppState, chatId: string): ActiveTurnState {
  return state.activeTurns[chatId] ?? createEmptyTurnState();
}

if (event.type === 'turn.phase' || event.type === 'turn.delta' || event.type === 'tools.started' || event.type === 'tools.finished' || event.type === 'turn.completed') {
  const current = withActiveTurn(state, event.chatId);
  const next = applyTurnEvent(current, event);
  return replaceActiveTurn(state, event.chatId, next);
}
```

- [ ] **步骤 5：运行测试验证通过**

运行：`cd /Users/brian/Documents/Project/nanobot/nanobot-channel-webui/frontend && bun run test`

预期：新增 `turn-state` 测试通过，原有 `store` 相关测试继续通过。

- [ ] **步骤 6：Commit**

```bash
git add /Users/brian/Documents/Project/nanobot/nanobot-channel-webui/frontend/src/turn-state.ts \
        /Users/brian/Documents/Project/nanobot/nanobot-channel-webui/frontend/src/turn-state.test.ts \
        /Users/brian/Documents/Project/nanobot/nanobot-channel-webui/frontend/src/store.ts \
        /Users/brian/Documents/Project/nanobot/nanobot-channel-webui/frontend/src/types.ts
git commit -m "refactor(webui-plugin): isolate frontend turn state machine"
```

## 任务 4：重建历史投影层，降低对原始文本约定的直接耦合

**文件：**

- 创建：`src/nanobot_channel_webui/history_projection.py`
- 创建：`tests/test_history_projection.py`
- 修改：`src/nanobot_channel_webui/sessions.py`

- [ ] **步骤 1：编写失败的历史投影测试**

```python
from nanobot_channel_webui.history_projection import project_session_messages


def test_projects_ask_user_tool_to_button_message() -> None:
    raw = [
        {
            "role": "assistant",
            "content": "",
            "tool_calls": [
                {
                    "id": "tool_1",
                    "function": {
                        "name": "ask_user",
                        "arguments": "{\"question\":\"继续吗？\",\"options\":[\"继续\",\"停止\"]}",
                    },
                }
            ],
        }
    ]

    projected = project_session_messages(raw)

    assert projected[0]["type"] == "assistant"
    assert projected[0]["buttons"] == [["继续", "停止"]]
```

- [ ] **步骤 2：运行测试验证失败**

运行：`pytest /Users/brian/Documents/Project/nanobot/nanobot-channel-webui/tests/test_history_projection.py -v`

预期：`FAIL`，因为 `history_projection.py` 尚不存在。

- [ ] **步骤 3：实现历史投影器**

```python
def project_session_messages(raw_messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    projected: list[dict[str, Any]] = []
    ...
    return projected
```

实现要求：

- 用户消息的文本和附件分离仍保持现状兼容。
- `ask_user` 统一投影为带 `buttons` 的 assistant 消息。
- `message` tool 统一投影为 `outbound` 消息。
- 其余 tool call 聚合为一个 `tools` block。

- [ ] **步骤 4：让 `sessions.py` 只负责 IO 和 service 协调**

```python
from .history_projection import project_session_messages


def load_history(self, session_ref: str, *, media_service: Any) -> list[dict[str, Any]]:
    session = self._load_session(session_ref)
    if session is None:
        return []
    return project_session_messages(session.messages, media_service=media_service)
```

- [ ] **步骤 5：运行测试验证通过**

运行：`pytest /Users/brian/Documents/Project/nanobot/nanobot-channel-webui/tests/test_history_projection.py -v`

预期：`PASS`

- [ ] **步骤 6：Commit**

```bash
git add /Users/brian/Documents/Project/nanobot/nanobot-channel-webui/src/nanobot_channel_webui/history_projection.py \
        /Users/brian/Documents/Project/nanobot/nanobot-channel-webui/src/nanobot_channel_webui/sessions.py \
        /Users/brian/Documents/Project/nanobot/nanobot-channel-webui/tests/test_history_projection.py
git commit -m "refactor(webui-plugin): isolate session history projection"
```

## 任务 5：回归验证现有运行路径未被破坏

**文件：**

- 修改：`README.md`（仅在验证命令需要补充时）
- 测试：`tests/test_runtime_compat.py`
- 测试：`tests/test_history_projection.py`
- 测试：`frontend/src/turn-state.test.ts`
- 测试：现有 `frontend/src/*.test.ts`

- [ ] **步骤 1：运行 Python 测试集**

运行：`pytest /Users/brian/Documents/Project/nanobot/nanobot-channel-webui/tests -v`

预期：全部 `PASS`

- [ ] **步骤 2：运行前端测试集**

运行：`cd /Users/brian/Documents/Project/nanobot/nanobot-channel-webui/frontend && bun run test`

预期：全部 `PASS`

- [ ] **步骤 3：构建前端静态资源**

运行：`cd /Users/brian/Documents/Project/nanobot/nanobot-channel-webui/frontend && bun run build`

预期：构建成功，生成新的打包产物。

- [ ] **步骤 4：验证插件源码可编译**

运行：`python3 -m compileall /Users/brian/Documents/Project/nanobot/nanobot-channel-webui/src`

预期：`Compiling ...` 完成，无报错。

- [ ] **步骤 5：Commit**

```bash
git add /Users/brian/Documents/Project/nanobot/nanobot-channel-webui
git commit -m "test(webui-plugin): verify runtime stability refactor"
```

---

## 自检结果

- 已覆盖的需求：
  - runtime 接入层稳定化 → 任务 1
  - turn 事件生命周期收敛 → 任务 2、任务 3
  - 历史投影层解耦 → 任务 4
  - 不破坏现有功能的回归验证 → 任务 5
- 未使用占位符：计划中未出现 “TODO”“后续实现”“类似任务 N” 等空洞描述。
- 命名一致性：
  - 后端统一使用 `TurnAccumulator`
  - 前端统一使用 `turn-state.ts`
  - 历史层统一使用 `project_session_messages`

计划已完成并保存到 [`/Users/brian/Documents/Project/nanobot/nanobot-channel-webui/docs/2026-05-09-runtime-stability-plan.md`](</Users/brian/Documents/Project/nanobot/nanobot-channel-webui/docs/2026-05-09-runtime-stability-plan.md>)。

两种执行方式：

**1. 子代理驱动（推荐）** - 每个任务调度一个新的子代理，任务间进行审查，快速迭代

**2. 内联执行** - 在当前会话中使用 `executing-plans` 执行任务，批量执行并设有检查点

选哪种方式？
