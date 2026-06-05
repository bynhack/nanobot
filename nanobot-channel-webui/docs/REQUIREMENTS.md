# 需求清单

本文件用于跟踪产品能力、架构目标和明确需求。它和 `docs/FIXME.md` 分工不同：需求清单描述“要建设什么”，修复清单描述“当前哪里不符合预期或存在风险”。

## 状态约定

- `待设计`：方向明确，但方案未定。
- `待实现`：方案明确，可以进入开发。
- `进行中`：正在实现。
- `已完成`：已经实现、发布并完成必要验证。
- `延后`：暂不做，需要说明原因。
- `取消`：确认不再需要。

## 当前需求项

| ID | 状态 | 需求 | 目标 | 验收标准 | 备注 |
|---|---|---|---|---|---|
| REQ-001 | 进行中 | 企业级 Agent Runtime 扩展层 | 在不修改 Nanobot 上游核心代码的前提下，通过插件提供多用户、多租户、业务权限、记忆隔离、审计和业务技能沙盒。 | scoped 用户的数据访问和工具调用受控；普通技能可以组合使用；发布后本地 WebUI 可实际对话验证。 | 当前主线已经从单实例 WebUI channel 转为 WebUI 控制面 + 用户独立 gateway 子进程；后续仍围绕新业务域、权限治理和实例内能力扩展推进。 |
| REQ-002 | 进行中 | 业务技能沙盒 | 受控业务技能的内部实现、底层脚本、权限文件和数据库密钥不暴露给普通业务用户。 | 用户只看到动态技能视图；业务访问必须走声明过的 business CLI；普通技能只能消费授权 artifacts；技能包目录不承载真实业务实现脚本。 | HR 业务实现已迁入 Python runtime，技能包只保留说明和契约；上传和 artifacts 进入实例边界仍跟随 `REQ-014` 继续收口。 |
| REQ-003 | 进行中 | 普通技能自由组合 | Word、Excel、浏览器、图表、文档导出等非受控技能不被 HR 权限逻辑误伤。 | 普通技能可基于授权结果生成报告、表格或浏览器输出；不能读取受控沙盒内部和敏感运行时文件。 | 普通技能自由组合原则保持有效；与实例 artifacts 边界有关的细节随 `REQ-014` 继续跟进。 |
| REQ-004 | 已完成 | HR 标准 business CLI | HR 查询、详情、分析、录入、删除统一走 `nanobot-webui-business hr business ...` 命令面。 | 自然语言任务能稳定路由到标准 business 命令；legacy 命令只作为兼容 alias，不作为公开契约。 | 已由 `FIX-013`、`FIX-017`、`FIX-019`、`REQ-017` 收敛到标准 business surface。 |
| REQ-005 | 已完成 | HR 数据权限 | HR 数据访问按照 `resource + action + scope` 控制，常见 scope 为 `company`。 | 查询、详情、分析、写入、删除、验证都受授权公司范围限制。 | 已由 `FIX-003`、`FIX-004`、`FIX-006`、`FIX-014` 和 Python HR runtime 迁移完成主链路 hardening；后续新资源仍按同一模型扩展。 |
| REQ-006 | 已完成 | 动态技能视图 | 根据当前用户权限和当前任务，只给模型注入授权能力和相关执行规则。 | scoped 用户不能看到完整受控 `SKILL.md`；任务相关能力优先显示；业务 focus terms 来自契约。 | 已由 `FIX-009`、`FIX-028`、`FIX-031` 收敛：HR focus terms 进入 `tenant-runtime.json`，技能摘要和详情展示不再暴露隐藏实现。 |
| REQ-007 | 已完成 | fail-closed 权限默认值 | 身份、policy、policy file 或运行时注入缺失时，不得默认管理员权限。 | 只有显式 admin policy 才 unrestricted；缺失信息默认拒绝受控业务访问。 | 已由 `FIX-003`、`FIX-005` 完成，Python HR policy 缺失时 fail closed。 |
| REQ-008 | 待实现 | 权限审计 | 记录允许、拒绝、越权尝试和关键业务访问。 | 能按用户、会话、工具、命令和拒绝原因查询审计记录。 | 现有权限链路已有审计基础，但面向用户、会话、工具、命令和拒绝原因的完整查询与报表能力仍未作为已完成项验收。 |
| REQ-009 | 已完成 | 工具调用消息显示开关 | 设置中支持控制是否显示工具调用类型消息，减少业务用户干扰。 | 配置保存后对话展示符合开关状态。 | 已实现，后续只做维护。 |
| REQ-010 | 已完成 | 对话流式整体状态 | 前端按整体 turn 状态控制发送按钮和“处理中/调用工具中/已完成”状态。 | 以 `resuming: false` 作为最终完成信号，避免按单轮工具状态误判。 | 已调通。 |
| REQ-011 | 已完成 | suggestion 配置化 | 内容区 suggestion 从配置读取，并适配 HR 业务。 | 配置文件可控制默认提示建议。 | 已实现。 |
| REQ-012 | 已完成 | 完整多实例 gateway runtime | WebUI 后端可以按登录用户启动独立且完整的 Nanobot gateway 实例，每个实例使用独立 config、workspace、skills、memory、Dream、cron、session 和 websocket channel。 | 除不由用户手工启动外，托管实例应与执行 `nanobot gateway --config <instance-config.json>` 具备同等功能；实例生命周期由 WebUI 控制面管理；权限 policy 和业务环境注入到实例进程；实例配置必须强制启用 `tools.restrictToWorkspace`；授权技能包必须复制到实例 workspace 内。 | 已从 SDK 轻量 runtime 改为 `nanobot gateway --config` CLI 子进程。验证：实例日志显示 AGENTS/SOUL/HEARTBEAT/memory 模板创建、Dream/heartbeat system job 注册、cron started with 2 jobs；浏览器真实 HR 查询成功。 |
| REQ-013 | 已完成 | 多实例业务查询短路径 | 常见 HR 查询应由实例侧 business CLI 直接使用当前账号 policy，并优先通过聚合命令返回完整业务结果，避免模型读取长技能文件、探测 policy 路径或执行 N+1 查询。 | 实例 workspace 下 CLI 自动注入 policy 文件；当前账号可见公司和部门可由单条 `business query organization-tree` 返回；技能路由明确推荐聚合命令。 | 对应 `FIX-017`；后续可以继续为其他高频组合查询增加聚合 capability。 |
| REQ-014 | 部分完成 | 旧 WebUI channel 逻辑清理 | 在多实例 upstream websocket 主链路稳定后，将插件职责收敛为 WebUI 控制面，清理外层本地 `/ws` 对话通道、外层 session 存储和前端本地 channel 兼容分支。 | 前端只走 upstream websocket 协议；对话、历史、删除、会话列表来自用户实例；上传和 artifacts 进入实例边界；权限工具网关迁移或复用到实例 runtime 后再删除外层注入逻辑。 | 已完成核心旧 channel 删除：前端 upstream-only、外层 `/ws` 和本地 `/sessions` 删除、旧 WebUIHook/ConnectionRegistry/TurnAccumulator/SessionQueryService/runtime compat 删除。后续继续迁移上传/artifacts 和实例内权限 runtime。机制与清理边界见 `docs/2026-06-05-managed-instance-websocket-channel-mechanism.md`。 |
| REQ-015 | 已完成 | 自有 WebUI 控制面启动命令 | Nanobot 是本项目使用的运行时依赖，产品主入口应是插件自己的 `nanobot-webui gateway`，而不是用上游 `nanobot gateway` 启动外层控制面。 | `nanobot-webui gateway --config ~/.nanobot/config.json` 可以启动 WebUI 控制面；控制面不创建外层默认 AgentLoop；登录用户实例由控制面管理。 | 已发布并用新命令重启本地服务；`/health` 返回 control_plane。对应 `FIX-020`。 |
| REQ-018 | 已完成 | 插件专属运行时目录 | WebUI 多实例运行时不默认占用上游单实例目录 `~/.nanobot/workspace` 或 `~/.nanobot/instances`。 | 默认实例目录为 `~/.nanobot-channel-webui/instances/<user>/`；每个实例写入自己的 `config.json` 和 `workspace/`；`~/.nanobot` 只作为兼容读取控制面基础配置。 | 已验证实例目录 `~/.nanobot-channel-webui/instances/user-w4axjmqago9u6dw/`，包含 `config.json`、`logs/gateway.log` 和完整 `workspace/`。 |
| REQ-016 | 已完成 | Python HR 业务 runtime | HR 业务 CLI、权限策略、repository 和 Supabase 访问应使用插件主体一致的 Python 技术栈，不再依赖 Node/JS runtime 或打包 `node_modules`。 | `nanobot-webui-business hr business ...` 直接调用 Python runtime；发布脚本不执行 `npm install`；wheel 不包含 HR `node_modules`；权限、查询、分析、写入和删除命令保持受控。 | 已发布并验证：`./scripts/publish-local.sh` 通过，wheel 无 HR Node artifacts，实例业务探针通过。对应 `FIX-022`。 |
| REQ-017 | 已完成 | HR business CLI 公开契约收敛 | 对智能体和业务用户只暴露 `business <action> <resource>` 标准命令面，内部 command 和单独 `verify` 不作为公开契约出现。 | `help`、技能描述和 `tenant-runtime.json` capability 使用同一份公开命令矩阵；写入流程为 preview → 用户确认 → create，create 内部完成验证并返回 verification 结果；模型不再调用单独 `business verify`。 | 已发布并验证：`./scripts/publish-local.sh` 通过；安装后 `hr help` 不包含 `business verify`，并声明 create 返回内部 verification。 |
| REQ-019 | 进行中 | 移动端对话页可用性 | 移动端对话页必须能查看会话历史、收起侧边导航、回到对话区，并保持输入框高度和滚动行为可控。 | 窄屏下会话列表入口可见；侧边导航展开后可收起；右侧文件/工作区面板不遮断对话；输入框不出现多余滚动条。 | 当前已有前端修复和源码级测试覆盖，仍作为移动端体验回归项持续跟踪；具体 bug 见 `FIX-032`。 |

## 维护规则

- 新需求、产品方向或架构原则明确后，先更新本文件。
- 如果某个需求拆出具体 bug 或技术债，同步在 `docs/FIXME.md` 新增修复项。
- 完整功能完成后，将状态更新为 `已完成`，并在备注中记录发布和验证结论。
- 不确定的想法不要直接写成 `待实现`，先写 `待设计`。
