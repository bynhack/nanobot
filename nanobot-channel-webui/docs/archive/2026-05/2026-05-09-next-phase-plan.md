# WebUI 插件下一阶段计划

## 阶段主题

运行可观测性与发布完整性

## 阶段目标

在当前运行稳定性已经收敛的基础上，继续只在插件目录内部推进下一阶段优化，目标不是再大改 runtime 主链路，而是让插件：

- 更容易判断“当前到底在什么状态”
- 更容易定位线上或本地复现问题
- 更容易稳定发布和验证

## 边界约束

- 只允许修改 [`/Users/brian/Documents/Project/nanobot/nanobot-channel-webui`](</Users/brian/Documents/Project/nanobot/nanobot-channel-webui>)
- 不修改 `nanobot/`、`webui/`、`bridge/` 等插件外代码
- 不破坏当前已验证可运行的会话、流式、工具展示、历史恢复能力

## 建议范围

### 1. 运行可观测性增强

优先在插件已有 API 之上增强，而不是另起系统。

候选方向：

- 为 runtime attach 暴露更明确的状态摘要
- 为当前活跃会话、活跃连接、活跃 turn 提供更清晰的只读视图
- 为 turn 生命周期增加轻量级事件快照，而不是依赖分散日志推断

建议落点：

- `src/nanobot_channel_webui/management.py`
- `src/nanobot_channel_webui/channel.py`
- `src/nanobot_channel_webui/compat/runtime.py`
- `frontend/src/settings-page.tsx`

### 2. 发布完整性收敛

当前发布流程可用，但仍有几个值得收口的点：

- `frontend/build` 到 `static/` 再到 `src/.../static/` 的同步路径要更清晰
- 静态资源更新时，最好能减少“哪些文件需要提交”的心智负担
- 本地发布脚本要能更明确地告诉使用者当前安装了哪个 wheel

建议落点：

- `scripts/publish-local.sh`
- `scripts/install-last-wheel.sh`
- `README.md`

### 3. 端到端验证路径固化

这一阶段不把测试体系扩成很重，但建议把最关键的手工验证路径沉淀下来。

候选方向：

- 明确最小回归验证命令
- 明确发布前检查顺序
- 明确“当前阶段不通过则不建议发布”的门槛

建议落点：

- `README.md`
- `docs/`

## 优先级建议

如果下一阶段只做一轮，我建议按这个顺序：

1. 运行可观测性增强
2. 发布脚本与产物同步收口
3. 发布前验证路径文档化

原因是：第一项最能直接提升你调试和判断状态的效率；第二项能减少发布时的手误；第三项能把“现在脑子里知道怎么发”变成“下次也稳定能发”。

## 不建议此阶段做的事

这一阶段先别碰这些：

- 再次大改 runtime 主链路
- 改 upstream 会话格式
- 引入插件外依赖的复杂发布编排
- 重做前端整体 UI 风格

这些都不属于当前最短路径。

## 建议执行方式

下一阶段适合继续用“小步快跑”的方式推进：

1. 先补运行状态只读信息
2. 再收脚本和产物同步
3. 最后补发布前最小检查说明

如果你确认这个方向，我下一轮可以直接开始做第一个子阶段：插件运行可观测性增强。*** End Patch
