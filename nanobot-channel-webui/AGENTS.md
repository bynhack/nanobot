# AGENTS.md

本文件约束在 `nanobot-channel-webui` 插件项目中工作的 AI Agent。目标是让后续修改保持一致、可发布、可验证，并且不破坏已经验证过的业务边界。

## 项目定位

`nanobot-channel-webui` 是 Nanobot 的 WebUI 插件项目，不是 Nanobot 上游核心项目。

当前产品方向是：在 Nanobot 个人工作区式 Agent Runtime 之上，通过插件方式扩展出支持多用户、多租户、业务权限控制、记忆隔离和审计的企业级 Agent Runtime 底层框架。

## 工作边界

- 默认只修改本插件目录：`/Users/brian/Documents/Project/nanobot/nanobot-channel-webui`。
- 不修改 Nanobot 上游核心代码，除非用户明确要求并确认风险。
- 运行时增强优先通过插件注入、包装器、兼容层完成。
- 工作区技能位于 `~/.nanobot/workspace/skills/`，属于运行时业务技能；修改前要明确它不是插件 wheel 的一部分。
- 不回退用户或其他 Agent 已经做出的改动。

## 发布原则

- 当用户提出的功能或修改需求清晰且完整时，任务必须执行到本地发布完成。
- 完整功能修改完成后运行：`./scripts/publish-local.sh`。
- 发布脚本已包含 Python 测试、前端测试、构建、静态资源同步和本地 wheel 安装。
- 如果只是纯前端修改，发布到本地后即可交给用户测试。
- 如果修改涉及 Python 后端、插件运行时、权限注入、会话服务、API 或其他需要重新加载的服务端逻辑，发布到本地后必须由 Agent 使用 `tmux` 重启 `nanobot gateway --config ~/.nanobot/config.json`，不要让用户手动重启。
- 文档-only 修改不需要发布到本地，除非用户明确要求。
- 发布完成后明确告诉用户是否已经重启服务，以及可以直接刷新页面或重新测试。

## 测试原则

- 不为简单文档或低风险配置修改单独运行测试。
- 简单修改不额外测试，避免影响执行效率。
- 涉及运行时、权限、前端逻辑、Python 逻辑、发布产物的完整功能修改，通过 `./scripts/publish-local.sh` 验证。
- 涉及登录、权限、设置页、对话页、工具调用展示或其他关键 WebUI 交互时，发布后优先使用 Codex in-app browser 做自动化冒烟测试；测试账号由用户在对话中临时提供，不写入仓库文档。
- 完整功能完成后不要只告诉用户“可以测试了”。Agent 必须自己完成端到端验证：发布、必要时重启服务、用浏览器登录测试账号、实际发送业务问题、检查智能体工具调用后的业务结果和权限边界，再把结论告诉用户。
- 发现 bug 时先定位根因，再修复；不要用猜测式补丁掩盖症状。

## 多租户与权限原则

- 不依赖提示词作为权限边界。
- 插件权限层负责控制「能不能调用」。
- 业务技能脚本负责控制「调用后能看到什么」。
- 权限模型必须使用「资源、动作、范围」三元组表达，例如 `hr.contract:analyze` scoped by `company`。
- 不要把一个业务域全部挂在单一资源上；HR 当前至少拆分为 `hr.company`、`hr.organization`、`hr.department`、`hr.employee`、`hr.contract`、`hr.performance`、`hr.insurance`、`hr.personnel_change`、`hr.disciplinary`、`hr.seal_usage`。
- 历史粗粒度权限只能在运行时规范化展开，不能作为新功能继续依赖的模型。
- 权限必须落实到数据查询条件、写入校验、汇总报表过滤中。
- 不带 scope 参数的业务查询，必须由业务脚本自动使用当前账号授权范围过滤；不能退化为全局查询，也不能要求模型自己补 `--company` 才安全。
- scoped 用户不能注入全局 `MEMORY.md` 或全局 `history.jsonl`。
- 工具调用、文件读取、命令执行必须经过 Policy Gateway。
- 越权尝试、允许调用、拒绝调用都要审计。
- 普通业务用户不应通过 memory、workspace 文件或底层数据脚本推断未授权信息。

## 业务技能原则

- 业务技能应读取插件注入的 policy 文件或环境变量。
- 业务技能应使用统一 Guard SDK 或等价逻辑执行权限判断。
- HR 只是第一个业务集成，不应继续把 HR 专用逻辑硬编码进通用框架层。
- 新业务技能应通过 Skill Contract 声明资源、动作、scope 要求和确认要求。
- 面向智能体暴露时，优先暴露标准 business CLI，例如 `business query <resource>`、`business get <resource>`、`business analyze <topic>`、`business create <resource>`。
- scoped 用户读技能说明时必须看到动态技能视图，不能看到完整 `SKILL.md` 中隐藏的底层脚本、全量数据库命令或历史实现细节。
- 帮助命令可以开放，但只能展示当前账号被授权的标准能力。
- 数据查询层必须承担最终过滤责任：列表、详情、跨表查询、统计、分析、导入预览和写入验证都要用同一份 policy。

## 前端原则

- 保持现有设计系统和交互风格，不做无关视觉重构。
- UI 修改要避免引起布局闪烁、回行挤压、画布尺寸抖动。
- 业务人员使用场景优先，专业调试信息默认不要干扰主流程。

## 文档原则

- 顶层 `docs/` 只保留当前仍有指导价值的设计和索引。
- 历史阶段计划、迁移过程文档和已完成发布说明放入 `docs/archive/`。
- 重要架构决策写入 `docs/`，避免只留在对话里。
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
```

## 当前关键文档

- `docs/README.md`
- `docs/2026-05-29-tenant-runtime-permission-hardening.md`
- `docs/2026-05-27-runtime-permission-injection-design.md`
- `docs/2026-05-28-tenant-runtime-plugin-design.md`
- `docs/2026-05-28-tenant-runtime-skill-integration.md`
