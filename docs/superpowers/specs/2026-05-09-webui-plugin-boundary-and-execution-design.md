# WebUI Plugin Boundary And Execution Design

**Date:** 2026-05-09

## Goal

为 `nanobot-channel-webui` 建立一套可安全执行、可回滚的演进方案：

- 先在最新 `upstream/main` 上建立洁净执行基线
- 不直接在当前脏工作区上做高风险整理
- 先形成“现状快照提交”作为回滚锚点
- 再按模块边界逐步下沉通用能力、保留插件产品能力

## Current Situation

当前仓库存在几个重要事实：

1. 当前工作区是脏的，包含 `nanobot_webui/` 删除、`nanobot-channel-webui/` 新增、测试与打包文件变化等大量未提交改动。
2. 当前分支 `codex/webui-channel` 落后 `upstream/main`，而用户要求执行前先对齐最新上游。
3. `nanobot-channel-webui` 不只是一个普通 channel；它已经实现了自己的浏览器协议、事件模型、前端状态机与管理界面。
4. 插件中有一部分能力本质上属于通用 runtime 能力，但目前通过兼容层和私有实现挂接在插件里。

这决定了不能直接在当前工作区上“边同步上游边整理边重构”。那样冲突面大、历史混乱、回滚价值低。

## Architectural Decision

采用“上游洁净基线 + 独立执行分支”方案。

### Why

- 可以严格满足“先更新上游、上游代码不做任何修改”的要求
- 可以把“同步上游”和“迁移当前插件现状”拆成两个独立阶段
- 可以先形成一个仅代表“当前插件现状”的快照提交，后续所有重构都能回滚到这个锚点
- 可以避免当前脏工作区直接参与高风险 merge/rebase

## Boundary Model

### Keep In Plugin

以下能力继续保留在 `nanobot-channel-webui`：

- 浏览器 HTTP + WebSocket 服务
- WebUI 专用协议与前端状态机
- 会话侧边栏、工具详情、设置页、技能管理等产品层 UI
- 浏览器连接注册、媒体展示、前端授权细节

原因：这些能力天然是 WebUI 产品能力，不应强行塞回 `nanobot` 核心。

### Candidate For Core Extraction

以下能力属于“插件先实现、后续适合下沉”的通用 runtime 能力：

- 正式的 hook 注册入口，替代当前兼容层的动态注入
- 通用 turn lifecycle 事件模型
- 工具生命周期结构化事件
- Session 查询与只读回放辅助服务
- 媒体路径安全映射为临时 URL 的公共能力
- WebUI 音频上传接入核心转写链路

原因：这些能力不只 WebUI 会受益，放在核心更利于复用和长期维护。

## Execution Strategy

### Phase 1: Record The Design And Plan

先把边界和执行策略保存为仓库文档，作为后续操作依据。

### Phase 2: Create A Safe Baseline

在不破坏当前脏工作区的前提下，先做现场备份，然后基于最新 `upstream/main` 创建独立执行分支或 worktree。

这个执行基线必须满足：

- HEAD 指向最新 `upstream/main`
- 不携带任何本地脏改动
- 后续所有提交都发生在这个隔离执行空间里

### Phase 3: Create A Snapshot Commit

把当前 `nanobot-channel-webui` 相关改动迁移到洁净基线中，但不立即做边界重构。

这一提交的目标不是“做对”，而是“原样、安全、可回滚地落入 git 历史”。它将成为后续所有演进的回滚锚点。

### Phase 4: Execute The Refactor Plan

从最脆弱、最影响后续维护的点开始推进：

1. 先替换 runtime 注入方式
2. 再抽取通用事件层
3. 再整理 session/media 公共服务边界
4. 最后补齐配置接线与可选能力（如音频转写）

## Rollback Strategy

回滚分为两层：

- **逻辑回滚：** 回到“现状快照提交”
- **环境回滚：** 丢弃独立执行分支 / worktree，当前原始工作区保持不动

这意味着即使后续实施失败，也不会污染现有脏工作区，且能快速回到“插件迁移现状已保存”的安全点。

## Non-Goals

本轮不追求：

- 一次性把所有 WebUI 代码合并回核心
- 在方案确认前直接修改现有脏工作区
- 把插件的产品层特性削减成普通 channel
- 在“现状快照提交”阶段顺手做大规模重构

## Success Criteria

方案执行完成后，应满足：

1. 存在一个基于最新 `upstream/main` 的独立执行分支
2. 存在一个“当前插件现状”的安全快照提交
3. 后续重构步骤有明确阶段边界与回滚点
4. 插件产品层能力继续保留
5. 可复用的 runtime 能力有清晰的下沉路径
