# AGENTS.md

本文件约束在 `nanobot-channel-webui` 插件项目中工作的 AI Agent。目标是让后续修改保持一致、可发布、可验证，并且不破坏已经验证过的业务边界。

## 项目定位

`nanobot-channel-webui` 是 Nanobot 的 WebUI 插件项目，不是 Nanobot 上游核心项目。

当前产品方向是：在 Nanobot 个人工作区式 Agent Runtime 之上，通过插件方式扩展出支持多用户、多租户、业务权限控制、记忆隔离和审计的企业级 Agent Runtime 底层框架。

当前实现状态是：WebUI channel、登录与会话隔离、Tenant Runtime、权限网关、动态技能视图、HR 业务模块和 HR 标准 business CLI 已经作为插件能力存在。HR 是第一个业务域，用来验证通用机制；后续业务域应复用同一套契约和运行时边界，而不是把业务逻辑硬编码进通用层。

## 工作边界

- 默认只修改本插件目录：`/Users/brian/Documents/Project/nanobot/nanobot-channel-webui`。
- 不修改 Nanobot 上游核心代码，除非用户明确要求并确认风险。
- 运行时增强优先通过插件注入、包装器、兼容层完成。
- HR 业务技能和 HR Node runtime 当前已打包在插件内：`src/nanobot_channel_webui/business_modules/hr/`。不要再假设 HR 受控技能一定来自 `~/.nanobot/workspace/skills/`。
- 工作区技能 `~/.nanobot/workspace/skills/` 仍可能存在，但属于用户工作区运行时内容；修改前要先确认它是否由插件打包、用户手工维护或其他流程生成。
- 受控业务能力优先通过插件内 business module 和 `tenant-runtime.json` 契约交付；普通技能可以继续作为工作区技能或外部技能存在。
- 不回退用户或其他 Agent 已经做出的改动。

## 发布原则

- 当用户提出的功能或修改需求清晰且完整时，任务必须执行到本地发布完成。
- 完整功能修改完成后运行：`./scripts/publish-local.sh`。
- 发布脚本已包含 Python 测试、前端测试、构建、静态资源同步和本地 wheel 安装。
- 如果只是纯前端修改，发布到本地后按变更风险决定是否做浏览器冒烟测试；涉及关键交互时要由 Agent 自己测，不要只交给用户。
- 如果修改涉及 Python 后端、插件运行时、权限注入、会话服务、API 或其他需要重新加载的服务端逻辑，发布到本地后必须由 Agent 使用 `tmux` 重启 `nanobot gateway --config ~/.nanobot/config.json`，不要让用户手动重启。
- 文档-only 修改不需要发布到本地，除非用户明确要求。
- 发布完成后明确告诉用户是否已经重启服务，以及可以直接刷新页面或重新测试。

## 测试原则

- 不为简单文档或低风险配置修改单独运行测试。
- 简单修改不额外测试，避免影响执行效率。
- 涉及运行时、权限、前端逻辑、Python 逻辑、发布产物的完整功能修改，通过 `./scripts/publish-local.sh` 验证。
- 涉及登录、权限、设置页、对话页、工具调用展示或其他关键 WebUI 交互时，发布后优先使用 Codex in-app browser 做自动化冒烟测试；测试账号由用户在对话中临时提供，不写入仓库文档。
- 完整功能完成后不要只告诉用户“可以测试了”。Agent 要根据变更类型自己完成必要验证：发布、必要时重启服务、健康检查、权限探针、CLI 直调探针或浏览器真实对话测试。只有涉及真实 WebUI 交互、登录态、自然语言权限流程时，才必须实际登录并发送对话验证。
- 权限和 HR CLI 相关修改至少要覆盖两层：插件运行时网关是否拒绝、业务 CLI 或 repository 直调是否拒绝，避免只靠单层兜底。
- 发现 bug 时先定位根因，再修复；不要用猜测式补丁掩盖症状。

## 多租户与权限原则

- 不依赖提示词作为权限边界。
- 插件权限层负责控制「能不能调用」。
- 业务 CLI 和 repository 层负责控制「调用后能看到什么」。
- 权限模型必须使用「资源、动作、scope」三元组表达，例如 `hr.contract:analyze` scoped by `company`。
- 不要把一个业务域全部挂在单一资源上；HR 当前至少拆分为 `hr.company`、`hr.organization`、`hr.department`、`hr.employee`、`hr.contract`、`hr.performance`、`hr.insurance`、`hr.personnel_change`、`hr.disciplinary`、`hr.seal_usage`。
- 数据库权限必须显式配置标准资源；不要在运行时把 `hr.employee` 自动展开成整个 HR 资源包。
- 权限必须落实到数据查询条件、写入校验、删除校验、汇总报表过滤、导入预览和验证中。
- 不带 `--company` 参数的业务查询和分析，必须由业务脚本自动使用当前账号授权范围过滤；不能退化为全局查询，也不能要求模型自己补 `--company` 才安全。
- scoped 用户不能注入全局 `MEMORY.md` 或全局 `history.jsonl`。
- 工具调用、文件读取、命令执行必须经过 Policy Gateway。
- 越权尝试、允许调用、拒绝调用都要审计。
- 普通业务用户不应通过 memory、workspace 文件或底层数据脚本推断未授权信息。
- 敏感运行时文件包括但不限于 `~/.nanobot/config.json`、sessions、tool-results、audit、private、policies、数据库连接配置和受控业务技能内部实现。

## 业务技能原则

- 业务技能应读取插件注入的 policy 文件或环境变量。
- 业务技能应使用统一 Guard SDK 或等价逻辑执行权限判断。
- HR 只是第一个业务集成，不应继续把 HR 专用逻辑硬编码进通用框架层。
- 新业务技能应通过 `tenant-runtime.json` / Skill Contract 声明资源、动作、scope、capability、focus terms、关联能力、recipe 和确认要求。
- 面向智能体暴露时，优先暴露标准 business CLI，例如 `business query <resource>`、`business get <resource>`、`business analyze <topic>`、`business preview <resource>`、`business create <resource>`、`business delete <resource>`。
- scoped 用户读技能说明时必须看到动态技能视图，不能看到完整 `SKILL.md` 中隐藏的底层脚本、全量数据库命令或历史实现细节。
- 帮助命令可以开放，但只能展示当前账号被授权的标准能力。
- 数据查询层必须承担最终过滤责任：列表、详情、跨表查询、统计、分析、导入预览、写入、删除和验证都要用同一份 policy。
- 受控业务技能产出的可复用结果应写入授权 artifacts 空间，例如 `.nanobot_channel_webui/artifacts/<chat_id>/`；普通 Word、Excel、浏览器、图表等技能只消费 artifacts，不读取受控沙盒内部。
- `TenantGuard` 是新业务技能可复用 SDK；当前 HR 主链路由 Command/Tool/Skill Gateway、动态技能视图、HR CLI `access_policy.mjs` 和 repository scope 兜底共同完成。

## 前端原则

- 保持现有设计系统和交互风格，不做无关视觉重构。
- UI 修改要避免引起布局闪烁、回行挤压、画布尺寸抖动。
- 业务人员使用场景优先，专业调试信息默认不要干扰主流程。
- 工具调用消息、调试信息和专业细节应默认可隐藏或弱化，避免干扰业务用户。

## 文档原则

- 顶层 `docs/` 只保留当前仍有指导价值的设计和索引。
- 历史阶段计划、迁移过程文档和已完成发布说明放入 `docs/archive/`。
- 重要架构决策写入 `docs/`，避免只留在对话里。
- 项目级问题修复跟踪使用 `docs/FIXME.md`。发现 bug、安全风险、评审意见或技术债时，先新增或更新对应条目；开始修复前标记为 `进行中`；修复、发布和验证完成后标记为 `已修复` 并记录证据。
- 项目级需求跟踪使用 `docs/REQUIREMENTS.md`。用户提出清晰的新需求、产品原则或架构目标时，先新增或更新需求条目；如果需求拆出具体问题，同步登记到 `docs/FIXME.md`。
- 执行需求或修复时，不要只依赖对话上下文记忆；应让 `docs/FIXME.md` 和 `docs/REQUIREMENTS.md` 反映当前状态，方便后续审查和接续。
- 中文文档遵循中英文之间加空格、中文语境使用全角标点的排版规范。

## 常用命令

```bash
# 本地发布
./scripts/publish-local.sh

# 启动 Nanobot gateway
nanobot gateway --config ~/.nanobot/config.json

# 前端开发
cd frontend && bun run dev

# 前端测试
cd frontend && bun run test

# Python 测试
pytest

# 权限测试
../.venv/bin/python -m pytest tests/test_permissions.py -q
```

## 当前关键文档

- `README.md`
- `docs/README.md`
- `docs/FIXME.md`
- `docs/REQUIREMENTS.md`
- `docs/2026-05-29-tenant-runtime-permission-hardening.md`
- `docs/2026-05-27-runtime-permission-injection-design.md`
- `docs/2026-05-28-tenant-runtime-plugin-design.md`
- `docs/2026-05-28-tenant-runtime-skill-integration.md`
