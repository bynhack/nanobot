# WebUI Plugin Boundary And Execution Design

**Date:** 2026-05-09

## Goal

为 `nanobot-channel-webui` 建立一套可安全执行、可回滚的演进方案：

- 先在最新 `upstream/main` 上建立洁净执行基线
- 先形成“现状快照提交”作为回滚锚点
- 后续只在插件目录内推进重构，不修改 upstream 核心代码
- 用插件自持的 `compat/` 层承接 runtime 兼容，而不是反向把扩展点打进核心

## Current Situation

当前仓库存在几个重要事实：

1. 当前工作区是脏的，包含 `nanobot_webui/` 删除、`nanobot-channel-webui/` 新增、测试与打包文件变化等大量未提交改动。
2. 当前分支 `codex/webui-channel` 落后 `upstream/main`，而用户要求执行前先对齐最新上游。
3. `nanobot-channel-webui` 不只是一个普通 channel；它已经实现了自己的浏览器协议、事件模型、前端状态机与管理界面。
4. 插件中有一部分能力本质上属于通用 runtime 能力，但目前通过兼容层和私有实现挂接在插件里。

这决定了不能直接在当前工作区上“边同步上游边整理边重构”。那样冲突面大、历史混乱、回滚价值低。

## Architectural Decision

采用“上游洁净基线 + 当前仓库独立执行”方案。

### Why

- 可以严格满足“先更新上游、上游代码不做任何修改”的要求
- 可以把“同步上游”和“保存当前插件现状”拆成两个独立阶段
- 可以先形成一个仅代表“当前插件现状”的快照提交，后续所有重构都能回滚到这个锚点
- 可以避免为了执行方案再引入额外 worktree 或并行目录，减少误操作面

## Boundary Model

### Keep In Plugin

以下能力继续保留在 `nanobot-channel-webui`：

- 浏览器 HTTP + WebSocket 服务
- WebUI 专用协议与前端状态机
- 会话侧边栏、工具详情、设置页、技能管理等产品层 UI
- 浏览器连接注册、媒体展示、前端授权细节

原因：这些能力天然是 WebUI 产品能力，不应强行塞回 `nanobot` 核心。

### Keep In Plugin Compat Layer

以下能力继续保留在插件自己的 `compat/` 层，不作为本轮上游改造目标：

- 对 `AgentLoop` 的定位与附着
- `gc` 搜索与 `_process_message` 包裹
- WebUI 专用 route context 的建立与清理
- 对上游私有字段 `_extra_hooks` 的最小依赖与防御性检查

原因：用户已明确要求本轮不能修改 upstream 核心，因此兼容性债务必须封装在插件自己内部，而不是转嫁给主仓库。

## Execution Strategy

### Phase 1: Record The Design And Plan

先把边界和执行策略保存为仓库文档，作为后续操作依据。

### Phase 2: Create A Safe Baseline

在不破坏当前工作区历史的前提下，先做现场备份并同步最新 `upstream/main`，然后直接在当前分支里落“现状快照提交”。

这个执行基线必须满足：

- HEAD 指向最新 `upstream/main`
- 存在一个可回滚的插件现状快照提交
- 后续所有改动都以该快照为基础，且改动范围限制在插件目录内

### Phase 3: Create A Snapshot Commit

把当前 `nanobot-channel-webui` 相关改动迁移到洁净基线中，但不立即做边界重构。

这一提交的目标不是“做对”，而是“原样、安全、可回滚地落入 git 历史”。它将成为后续所有演进的回滚锚点。

### Phase 4: Execute The Refactor Plan

从最脆弱、最影响后续维护的点开始推进，但所有实现都停留在插件边界内：

1. 先加固 plugin-owned runtime compat shim
2. 再整理 WebUI 私有 lifecycle 事件与协议边界
3. 再整理 session/media 服务边界
4. 最后补齐配置接线与可选能力（如音频转写）

## Rollback Strategy

回滚分为两层：

- **逻辑回滚：** 回到“现状快照提交”
- **提交回滚：** 丢弃后续插件目录内提交，upstream 对齐后的基线保持不变

这意味着即使后续实施失败，也只会影响插件自己的提交链，不会污染 upstream 核心代码。

## Non-Goals

本轮不追求：

- 一次性把所有 WebUI 代码合并回核心
- 在方案确认前直接修改现有脏工作区
- 把插件的产品层特性削减成普通 channel
- 在“现状快照提交”阶段顺手做大规模重构

## Success Criteria

方案执行完成后，应满足：

1. 当前分支已同步到最新 `upstream/main`
2. 存在一个“当前插件现状”的安全快照提交
3. 后续重构步骤有明确阶段边界与回滚点
4. 插件产品层能力继续保留
5. 所有新增实现都限制在 `nanobot-channel-webui/` 内
