# WebUI Plugin Boundary And Execution Plan

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 在最新 `upstream/main` 上为 `nanobot-channel-webui` 建立洁净执行基线，先形成可回滚的现状快照提交，再按模块边界逐步推进重构。

**架构：** 不在当前脏工作区上直接同步上游或大规模整理，而是先备份现场，再基于最新上游创建隔离执行分支。先迁移插件现状形成快照提交，随后按“runtime 通用能力下沉、WebUI 产品层保留”的边界逐阶段实施。

**技术栈：** git, worktree/branch workflow, Python, nanobot runtime, aiohttp/WebSocket plugin, frontend static bundle

---

### 任务 1：冻结现场并记录输入状态

**文件：**
- 修改：`docs/superpowers/specs/2026-05-09-webui-plugin-boundary-and-execution-design.md`
- 修改：`docs/superpowers/plans/2026-05-09-webui-plugin-boundary-and-execution-plan.md`
- 生成：工作区补丁与状态快照文件（路径执行时确定）

- [ ] **步骤 1：记录当前 git 状态**

运行：`git status --short --branch`
预期：输出当前分支名以及未提交改动列表，确认当前工作区仍是脏状态。

- [ ] **步骤 2：记录当前分支与上游提交**

运行：`git rev-parse --abbrev-ref HEAD && git rev-parse HEAD && git rev-parse upstream/main`
预期：得到当前分支名、本地 HEAD、最新 `upstream/main` 提交哈希。

- [ ] **步骤 3：导出安全补丁**

运行：`git diff > ../nanobot-webui-plugin-prebaseline.patch`
预期：生成当前未提交改动的统一 diff 补丁文件，作为外部安全备份。

- [ ] **步骤 4：导出未跟踪文件清单**

运行：`git ls-files --others --exclude-standard > ../nanobot-webui-plugin-untracked.txt`
预期：生成未跟踪文件清单，避免新文件在迁移时被遗漏。

- [ ] **步骤 5：Commit 文档变更**

```bash
git add docs/superpowers/specs/2026-05-09-webui-plugin-boundary-and-execution-design.md docs/superpowers/plans/2026-05-09-webui-plugin-boundary-and-execution-plan.md
git commit -m "docs: add webui plugin boundary and execution design"
```

### 任务 2：建立上游洁净执行基线

**文件：**
- 创建：独立执行 worktree 目录（执行时确定）
- 修改：无仓库内容修改，纯 git/worktree 操作

- [ ] **步骤 1：获取最新上游**

运行：`git fetch upstream --prune`
预期：`upstream/main` 更新到最新远程提交。

- [ ] **步骤 2：确认当前分支未直接跟随最新上游**

运行：`git log --oneline --decorate -n 1 upstream/main`
预期：输出最新上游头提交，作为后续洁净基线目标。

- [ ] **步骤 3：创建独立执行分支**

运行：`git branch codex/webui-plugin-exec upstream/main`
预期：创建一个从最新 `upstream/main` 派生的新分支，不修改当前工作区。

- [ ] **步骤 4：创建独立执行 worktree**

运行：`git worktree add ../nanobot-webui-plugin-exec codex/webui-plugin-exec`
预期：在 `../nanobot-webui-plugin-exec` 生成一个洁净工作树，内容与最新上游一致。

- [ ] **步骤 5：验证洁净基线**

运行：`git -C ../nanobot-webui-plugin-exec status --short --branch`
预期：显示 `codex/webui-plugin-exec` 分支且工作区干净，没有未提交改动。

### 任务 3：把当前插件现状迁移为快照提交

**文件：**
- 创建：`nanobot-channel-webui/**`
- 删除：`nanobot_webui/**`（若现状确实要求迁移替换）
- 修改：`pyproject.toml`
- 修改：相关测试与锁文件（以现状为准）

- [ ] **步骤 1：在洁净 worktree 中导入补丁**

运行：`git -C ../nanobot-webui-plugin-exec apply --reject --whitespace=fix ../nanobot-webui-plugin-prebaseline.patch`
预期：尽可能把当前变更迁移到独立执行 worktree；若有 `.rej`，说明需要手动处理冲突。

- [ ] **步骤 2：补齐未跟踪文件**

运行：`rsync -a --files-from=../nanobot-webui-plugin-untracked.txt ./ ../nanobot-webui-plugin-exec/`
预期：将当前工作区中未跟踪的新文件同步到洁净 worktree。

- [ ] **步骤 3：检查迁移后的状态**

运行：`git -C ../nanobot-webui-plugin-exec status --short`
预期：看到迁移后的插件现状文件变化，且无意外缺失。

- [ ] **步骤 4：处理因上游更新带来的最小冲突**

运行：`git -C ../nanobot-webui-plugin-exec diff --stat`
预期：确认差异集中在插件迁移相关文件，而非大面积污染上游无关模块。

- [ ] **步骤 5：创建“现状快照提交”**

```bash
git -C ../nanobot-webui-plugin-exec add .
git -C ../nanobot-webui-plugin-exec commit -m "feat: snapshot standalone webui channel plugin state"
```

### 任务 4：替换脆弱的 runtime 注入方式

**文件：**
- 修改：`nanobot-channel-webui/src/nanobot_channel_webui/compat/runtime.py`
- 修改：`nanobot-channel-webui/src/nanobot_channel_webui/channel.py`
- 可能修改：`nanobot/agent/loop.py`
- 测试：新增或修改与 runtime hook 相关测试

- [ ] **步骤 1：编写失败的集成测试**

目标：验证 WebUI hook 的挂载不依赖 `gc` 搜索和 monkey patch。

- [ ] **步骤 2：运行测试验证失败**

运行：与新增测试对应的 `pytest` 单测命令
预期：失败点明确显示当前实现依赖兼容层注入。

- [ ] **步骤 3：实现正式 hook 注册接口**

目标：让核心 runtime 或 channel 初始化阶段能显式注册 WebUI hook。

- [ ] **步骤 4：运行测试验证通过**

运行：新增测试及相关回归测试
预期：WebUI 事件链照常工作，且不再依赖运行时扫描。

- [ ] **步骤 5：Commit**

```bash
git -C ../nanobot-webui-plugin-exec add .
git -C ../nanobot-webui-plugin-exec commit -m "refactor: replace webui runtime monkey patch hook"
```

### 任务 5：抽取通用 lifecycle 事件边界

**文件：**
- 修改：`nanobot-channel-webui/src/nanobot_channel_webui/channel.py`
- 可能修改：`nanobot/utils/progress_events.py`
- 可能新增：核心 runtime events 模块
- 测试：WebUI tool lifecycle / turn lifecycle 相关测试

- [ ] **步骤 1：梳理现有 WebUI 私有事件模型**

目标：明确 `turn.phase`、`tools.started`、`tools.finished` 中哪些字段属于通用 runtime 事件。

- [ ] **步骤 2：编写失败测试**

目标：验证核心可产出结构化 lifecycle 数据，而不要求 WebUI 自己从 hook context 现场拼装。

- [ ] **步骤 3：实现通用事件载荷**

目标：把可复用部分下沉，WebUI 只负责协议映射和前端展示。

- [ ] **步骤 4：运行测试验证通过**

运行：相关 pytest 命令
预期：生命周期事件既能驱动 WebUI，也保持核心接口稳定。

- [ ] **步骤 5：Commit**

```bash
git -C ../nanobot-webui-plugin-exec add .
git -C ../nanobot-webui-plugin-exec commit -m "refactor: extract shared agent lifecycle events"
```

### 任务 6：统一 session 与 media 公共服务边界

**文件：**
- 修改：`nanobot-channel-webui/src/nanobot_channel_webui/sessions.py`
- 修改：`nanobot-channel-webui/src/nanobot_channel_webui/media.py`
- 对照：`nanobot/channels/websocket.py`
- 测试：session/media 读取与 URL 签发相关测试

- [ ] **步骤 1：识别与上游 websocket channel 的重复点**

目标：明确哪些逻辑适合公共化，哪些继续保留插件私有实现。

- [ ] **步骤 2：编写失败测试**

目标：覆盖只读会话加载、媒体 URL 生成、失效 token 等关键场景。

- [ ] **步骤 3：整理公共边界并最小重构**

目标：降低重复实现，同时不破坏当前插件协议与前端契约。

- [ ] **步骤 4：运行测试验证通过**

运行：session/media 对应测试命令
预期：行为与当前插件一致，但公共边界更清晰。

- [ ] **步骤 5：Commit**

```bash
git -C ../nanobot-webui-plugin-exec add .
git -C ../nanobot-webui-plugin-exec commit -m "refactor: clarify shared webui session and media services"
```

### 任务 7：补齐配置接线与可选增强能力

**文件：**
- 修改：`nanobot-channel-webui/src/nanobot_channel_webui/config.py`
- 修改：`nanobot-channel-webui/src/nanobot_channel_webui/channel.py`
- 可能修改：前端设置页面与类型定义
- 可选修改：上传与音频处理相关文件

- [ ] **步骤 1：确定哪些全局 channel 配置要在插件里显式尊重**

目标：至少明确 `sendProgress` / `sendToolHints` 是否要作为 WebUI 事件展示开关，以及 `transcription*` 是否接入。

- [ ] **步骤 2：编写失败测试**

目标：覆盖配置关闭后不展示对应 UI 事件、音频上传走转写链路等场景。

- [ ] **步骤 3：实现配置接线**

目标：让插件在保留增强能力的前提下，对核心全局配置有清晰、一致、可预期的响应。

- [ ] **步骤 4：运行测试验证通过**

运行：配置与上传相关测试
预期：配置语义清晰，行为稳定。

- [ ] **步骤 5：Commit**

```bash
git -C ../nanobot-webui-plugin-exec add .
git -C ../nanobot-webui-plugin-exec commit -m "feat: wire webui plugin to shared channel settings"
```

## 自检

- 规格覆盖度：本计划已覆盖“方案落盘、上游洁净基线、现状快照提交、后续分阶段实施”四大目标。
- 占位符扫描：没有使用 “TODO / 后续补充 / 类似上一步” 之类的占位描述；执行目录已统一为 `../nanobot-webui-plugin-exec`。
- 类型一致性：统一使用“现状快照提交”“runtime hook 注册”“lifecycle 事件”“session/media 公共服务边界”这些固定术语，避免前后漂移。

## 执行交接

计划已完成并保存到 `docs/superpowers/plans/2026-05-09-webui-plugin-boundary-and-execution-plan.md`。两种执行方式：

**1. 子代理驱动（推荐）** - 每个任务调度一个新的子代理，任务间进行审查，快速迭代

**2. 内联执行** - 在当前会话中使用 executing-plans 执行任务，批量执行并设有检查点
