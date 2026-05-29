# WebUI 插件运行稳定性阶段发布说明

## 发布范围

本阶段发布仅覆盖 [`/Users/brian/Documents/Project/nanobot/nanobot-channel-webui`](</Users/brian/Documents/Project/nanobot/nanobot-channel-webui>)，未修改插件目录外的任何实现代码。

## 本阶段目标

在不破坏当前已可运行功能的前提下，提升 `nanobot-channel-webui` 的运行稳定性，重点收敛以下 3 类风险：

- runtime 接入脆弱
- 流式 / 工具 / 完成态时序错乱
- 会话历史重建逻辑与原始消息格式过度耦合

## 已完成内容

### 1. runtime 接入状态显式化

新增：

- [`src/nanobot_channel_webui/compat/runtime_state.py`](</Users/brian/Documents/Project/nanobot/nanobot-channel-webui/src/nanobot_channel_webui/compat/runtime_state.py>)

调整：

- [`src/nanobot_channel_webui/compat/runtime.py`](</Users/brian/Documents/Project/nanobot/nanobot-channel-webui/src/nanobot_channel_webui/compat/runtime.py>)

效果：

- 避免重复包装 `AgentLoop._process_message`
- 避免 hook 重复注册导致的隐式状态漂移
- attach 失败时明确降级为兼容模式，不再表现为“半 attach”

### 2. 后端 turn 生命周期统一

新增：

- [`src/nanobot_channel_webui/turns.py`](</Users/brian/Documents/Project/nanobot/nanobot-channel-webui/src/nanobot_channel_webui/turns.py>)

调整：

- [`src/nanobot_channel_webui/channel.py`](</Users/brian/Documents/Project/nanobot/nanobot-channel-webui/src/nanobot_channel_webui/channel.py>)
- [`src/nanobot_channel_webui/protocol.py`](</Users/brian/Documents/Project/nanobot/nanobot-channel-webui/src/nanobot_channel_webui/protocol.py>)

效果：

- 一个 turn 只完成一次
- 流式输出和最终完成态不再由多个零散条件共同决定
- `turn.completed` 事件补充了更稳定的 `streamId`

### 3. 前端 active turn 状态机拆分

新增：

- [`frontend/src/turn-state.ts`](</Users/brian/Documents/Project/nanobot/nanobot-channel-webui/frontend/src/turn-state.ts>)
- [`frontend/src/turn-state.test.ts`](</Users/brian/Documents/Project/nanobot/nanobot-channel-webui/frontend/src/turn-state.test.ts>)

调整：

- [`frontend/src/store.ts`](</Users/brian/Documents/Project/nanobot/nanobot-channel-webui/frontend/src/store.ts>)
- [`frontend/src/types.ts`](</Users/brian/Documents/Project/nanobot/nanobot-channel-webui/frontend/src/types.ts>)

效果：

- 迟到的 `turn.phase` 不再污染已完成 turn
- active turn 的状态转移更集中，便于后续继续增强
- 保持现有 UI 行为兼容

### 4. 会话历史投影层拆分

新增：

- [`src/nanobot_channel_webui/history_projection.py`](</Users/brian/Documents/Project/nanobot/nanobot-channel-webui/src/nanobot_channel_webui/history_projection.py>)
- [`tests/test_history_projection.py`](</Users/brian/Documents/Project/nanobot/nanobot-channel-webui/tests/test_history_projection.py>)

调整：

- [`src/nanobot_channel_webui/sessions.py`](</Users/brian/Documents/Project/nanobot/nanobot-channel-webui/src/nanobot_channel_webui/sessions.py>)

效果：

- `sessions.py` 回归为 session service
- 历史重建逻辑集中到独立投影器
- 后续如果 upstream 消息格式变化，适配面更集中

### 5. 补齐前端 markdown 旧失败

调整：

- [`frontend/src/markdown.ts`](</Users/brian/Documents/Project/nanobot/nanobot-channel-webui/frontend/src/markdown.ts>)

效果：

- 修复 `normalizeInlineArtifacts` 对中文语境内联粗体的处理
- 完整前端测试集恢复全绿

## 验证结果

以下命令已在本地重新执行：

### Python 测试

```bash
/Users/brian/Documents/Project/nanobot/.venv/bin/python -m pytest /Users/brian/Documents/Project/nanobot/nanobot-channel-webui/tests -q
```

结果：`10 passed`

### 前端测试

```bash
cd /Users/brian/Documents/Project/nanobot/nanobot-channel-webui/frontend && bun run test
```

结果：`8` 个测试文件全部通过，`24 passed`

### Python 源码编译检查

```bash
python3 -m compileall /Users/brian/Documents/Project/nanobot/nanobot-channel-webui/src
```

结果：通过

### 前端构建

```bash
cd /Users/brian/Documents/Project/nanobot/nanobot-channel-webui/frontend && bun run build
```

结果：通过，静态产物已更新到 `static/`

## 对使用方的影响

本阶段不要求修改现有配置结构，也不要求调整插件启用方式。对使用方来说，主要收益是：

- runtime attach 更稳
- 流式响应更不容易乱序
- 工具执行完成态更稳定
- 历史会话恢复逻辑更可靠

## 发布建议

如果你准备手动发布这一阶段，建议按以下顺序执行：

```bash
cd /Users/brian/Documents/Project/nanobot/nanobot-channel-webui/frontend && bun run test
/Users/brian/Documents/Project/nanobot/.venv/bin/python -m pytest /Users/brian/Documents/Project/nanobot/nanobot-channel-webui/tests -q
cd /Users/brian/Documents/Project/nanobot/nanobot-channel-webui/frontend && bun run build
```

然后按你自己的发布流程安装或分发插件 wheel。

## 下一阶段建议

下一阶段建议继续只在插件内推进，重点转向：

- 可观测性与运行诊断
- 发布流程一致性
- 静态资源与构建产物管理
- 端到端使用路径验证
