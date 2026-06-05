# AGENTS.md

本文件约束在 `nanobot-channel-webui` 插件项目中工作的 AI Agent。它是给 Agent 看的项目操作手册，优先写当前事实、目录边界、命令、禁止事项和验证规则；历史设计细节放到 `docs/`。

## 当前项目事实

- 本项目是 `nanobot-ai` 的 WebUI 插件项目，不是 Nanobot 上游核心仓库。
- 当前架构是：WebUI 控制面 + 用户独立 Nanobot gateway 子进程 + 上游 `websocket` channel。
- 产品入口命令是 `nanobot-webui gateway --config ~/.nanobot/config.json`。
- 用户实例默认目录是 `~/.nanobot-channel-webui/instances/<user>/`。
- 浏览器对话连接用户实例内的上游 websocket channel；旧的外层 `/ws` 本地对话逻辑只作为兼容参考，不作为主链路扩展。
- HR 是第一个业务域，用来验证通用业务权限、动态技能视图和标准 business CLI。
- HR runtime 当前是 Python runtime，不是 Node runtime；不要再引入 HR `node_modules`、`.mjs` 主链路或 JS repository。

## 技术栈

- Python：`>=3.11`，包入口由 `pyproject.toml` 管理。
- 后端：`aiohttp`、`pydantic`、`loguru`，通过 Nanobot channel 插件机制启动控制面。
- 前端：React 19 + TypeScript + Vite 6。
- 样式：`frontend/src/styles.css`，Tailwind CSS 4 通过 Vite 插件接入。
- Chat UI：`@assistant-ui/react`。
- 图标：`lucide-react`。
- 包管理：前端使用 `bun`；不要改用 `npm`、`pnpm` 或 `yarn`。
- 本地发布：`./scripts/publish-local.sh`，会验证、构建、同步静态资源并安装本地 wheel。

## 目录结构

```text
nanobot-channel-webui/
  frontend/                         # React WebUI 源码
    src/
      components/chat/              # 对话页、侧边栏、工作区面板
      components/settings/          # 设置页组件
      components/assistant-ui/      # assistant-ui 适配组件
      preview-workspace/            # 文档、表格、PDF、PPT 预览
      styles.css                    # 全局样式和响应式布局
  src/nanobot_channel_webui/
    channel.py                      # WebUI 控制面 channel 和 HTTP API
    cli.py                          # nanobot-webui 命令入口
    instances/                      # 用户独立 gateway 实例编排
    permissions/                    # 权限解析、动态技能视图和审计
    tenant_runtime/                 # Tenant Runtime 公共契约和 Guard SDK
    business_modules/hr/            # Python HR 业务 runtime 和技能包
    static/                         # 发布后的前端静态资源
  scripts/                          # 验证、发布、静态资源同步
  tests/                            # Python 测试
  docs/                             # 当前架构、需求和修复记录
```

## 工作边界

- 默认只修改本插件目录：`/Users/brian/Documents/Project/nanobot/nanobot-channel-webui`。
- 不修改 Nanobot 上游核心代码，除非用户明确要求并确认风险。
- 不回退用户或其他 Agent 已经做出的改动。
- 运行时增强优先通过插件注入、实例编排、兼容层、Tenant Runtime 契约和业务 CLI 完成。
- 受控业务技能优先通过插件内 business module 和 `tenant-runtime.json` 契约交付。
- 普通工作区技能可能存在于实例 workspace 或用户手工维护路径；修改前必须确认来源。
- 不把真实账号、密钥、token、服务角色 key、测试凭证写入仓库文件或持久记忆。

## 发布与验证

- 代码、前端、运行时或发布产物相关修改完成后必须发布到本地；不发布就视为当前运行环境未同步。
- 文档-only 修改不需要发布，除非用户明确要求。
- 完整功能修改完成后运行：

```bash
./scripts/publish-local.sh
```

- 如果修改涉及 Python 后端、插件运行时、权限注入、会话服务、API、实例编排或其它服务端逻辑，发布后必须用 `tmux` 重启：

```bash
nanobot-webui gateway --config ~/.nanobot/config.json
```

- 发布完成后明确告诉用户是否已经重启服务，以及用户是否可以直接刷新页面测试。
- 简单 CSS、文案、小布局修复不使用 TDD，不新增回归测试，也不默认做浏览器冒烟。
- 需要使用浏览器时，应由用户主动提出，或任务本身明确属于关键交互、完整功能验收、登录态流程。
- `./scripts/publish-local.sh` 内置测试属于发布验收，不等同于要求每个小修改都先写测试。
- 权限、租户边界、会话状态、运行时协议、数据过滤和跨模块行为变化，需要按风险补测试或探针。
- 权限和 HR CLI 相关修改至少覆盖两层：入口是否拒绝，以及 business CLI 或 repository 直调是否拒绝。
- 发现 bug 时先定位根因，再修复；不要用猜测式补丁掩盖症状。

## 常用命令

```bash
# 本地发布
./scripts/publish-local.sh

# 本地验证，不安装
./scripts/verify-local.sh

# 启动 WebUI 控制面
nanobot-webui gateway --config ~/.nanobot/config.json

# 前端构建和测试
cd frontend && bun run build
cd frontend && bun run test

# Python 测试
pytest

# 权限测试
../.venv/bin/python -m pytest tests/test_permissions.py -q
```

## 前端规则

- 保持现有设计系统和交互风格，不做无关视觉重构。
- UI 修改要避免布局闪烁、回行挤压、画布尺寸抖动和移动端遮挡。
- 对话页和工作区布局优先保证移动端可回到会话、可看到历史、可正常输入。
- 输入框、侧边栏、右侧工作区、文件预览和设置页属于关键交互区域，修改时要特别控制高度、滚动和覆盖层。
- 工具调用消息、调试信息和专业细节默认弱化或可隐藏，不干扰业务用户主流程。
- 图标优先使用 `lucide-react`，不要手写可替代的 SVG 图标。
- 不在组件内裸写大段内联样式；优先使用已有 CSS 结构和 class。

## 多实例与权限规则

- 不依赖提示词作为权限边界。
- 当前隔离边界由多层共同完成：控制面鉴权、用户独立实例、实例 workspace、策略文件、动态技能视图、command policy、business CLI 和 repository scope guard。
- 插件控制「能不能调用」；业务 CLI 和 repository 控制「调用后能看到什么」。
- 权限模型使用「资源、动作、scope」三元组表达，例如 `hr.contract:analyze` scoped by `company`。
- 不带 `--company` 参数的业务查询和分析，必须自动使用当前账号授权范围过滤。
- 显式传入未授权 company 时必须拒绝。
- 缺少身份、缺少 policy、缺少 policy file 或运行时注入失败时默认拒绝。
- scoped 用户不能读取或注入全局 `MEMORY.md`、全局 `history.jsonl`、全局 workspace 或其它用户实例数据。
- 工具调用、文件读取、命令执行、技能可见性和业务 CLI 都必须经过权限治理。
- 越权尝试、允许调用、拒绝调用都要审计。
- 敏感运行时文件包括但不限于 `~/.nanobot/config.json`、实例 config、sessions、tool-results、audit、private、policies、数据库连接配置和受控业务技能内部实现。

## HR 与业务技能规则

- HR runtime 位于 `src/nanobot_channel_webui/business_modules/hr/runtime/`。
- HR 业务入口是：

```bash
nanobot-webui-business hr business <query|get|analyze|preview|create|delete> <resource|topic> [options]
```

- 旧命令只能作为兼容 alias，不作为模型优先入口展示。
- 新业务域应通过 `tenant-runtime.json` / Skill Contract 声明资源、动作、scope、capability、focus terms、关联能力、recipe 和确认要求。
- scoped 用户读取受控技能时必须看到动态技能视图，不能看到完整 `SKILL.md` 中隐藏的底层脚本、全量数据库命令或历史实现细节。
- 帮助命令可以开放，但只能展示当前账号被授权的标准能力。
- 数据查询层必须承担最终过滤责任：列表、详情、跨表查询、统计、分析、导入预览、写入、删除和验证都要使用同一份 policy。
- 普通 Word、Excel、浏览器、图表等技能只能消费授权 artifacts，不读取受控沙盒内部、权限文件、数据库密钥或其它敏感运行时文件。
- `TenantGuard` 是新业务技能可复用 SDK；当前 HR 主链路由 command policy、动态技能视图、Python HR CLI 和 repository scope guard 共同完成。

## 文档规则

- 顶层 `docs/` 只保留当前仍有指导价值的设计和索引。
- 历史阶段计划、迁移过程文档和已完成发布说明放入 `docs/archive/`。
- 重要架构决策写入 `docs/`，避免只留在对话里。
- 项目级需求跟踪使用 `docs/REQUIREMENTS.md`，用于记录「要建设什么」：产品方向、架构目标、明确需求、验收标准和完成证据。
- 项目级问题修复跟踪使用 `docs/FIXME.md`，用于记录「当前哪里不符合预期」：bug、安全风险、技术债、评审意见、涉及位置、验收标准和修复证据。
- 用户提出清晰的新需求、产品原则或架构目标时，先新增或更新 `docs/REQUIREMENTS.md`；如果需求拆出具体 bug 或技术债，同步在 `docs/FIXME.md` 建项。
- 发现 bug、安全风险、评审意见或技术债时，先确认 `docs/FIXME.md` 是否已有条目；没有则新增，已有则更新。
- 开始执行需求或修复前，把对应条目标记为 `进行中`；完成实现、发布和必要验证后，再更新为 `已完成` 或 `已修复`。
- 完成项必须在备注中记录关键证据，例如发布命令、测试/探针结果、健康检查、重启状态或关联提交。
- 如果需求变化或问题不再处理，应标记为 `延后` 或 `取消` 并说明原因，不要直接删除历史条目。
- 执行需求或修复时，不要只依赖对话上下文记忆；必须让 `docs/REQUIREMENTS.md` 和 `docs/FIXME.md` 反映当前进度。
- 中文文档遵循中英文之间加空格、中文语境使用全角标点的排版规范。
- 文档-only 修改不需要发布，也不需要测试。

## Never 规则

- Never 修改 Nanobot 上游核心代码，除非用户明确要求。
- Never 回退、覆盖或清理与当前任务无关的用户改动。
- Never 把 HR runtime 改回 Node 主链路，或重新引入 HR `node_modules` 作为发布依赖。
- Never 把旧外层 `/ws` 本地对话逻辑当作企业多用户主链路继续扩展。
- Never 把 `~/.nanobot/workspace` 当作当前用户实例的默认 workspace。
- Never 绕过 `nanobot-webui-business hr business ...` 直接让模型访问 HR 底层数据库脚本。
- Never 在缺少 policy、身份或 scope 时默认放行。
- Never 让 scoped 用户读取全局 memory、全局 history、其它用户 workspace 或敏感运行时文件。
- Never 把一个业务域全部挂在单一资源上；HR 至少拆分为 company、organization、department、employee、contract、performance、insurance、personnel_change、disciplinary、seal_usage。
- Never 为简单 CSS、文案、小布局修复强行 TDD、强行新增测试或默认浏览器冒烟。
- Never 在未发布的情况下告诉用户运行环境已经同步。
- Never 把真实凭证、密钥、token 或测试账号写进仓库文档。
- Never 修改 `frontend/node_modules/`、构建产物缓存或其它依赖安装目录。

## 当前关键文档

- `README.md`
- `docs/README.md`
- `docs/REQUIREMENTS.md`
- `docs/FIXME.md`
- `docs/2026-06-05-managed-instance-websocket-channel-mechanism.md`
- `docs/2026-06-05-python-hr-runtime-migration.md`
- `docs/2026-05-29-tenant-runtime-permission-hardening.md`
- `docs/2026-05-28-tenant-runtime-plugin-design.md`
- `docs/2026-05-28-tenant-runtime-skill-integration.md`
