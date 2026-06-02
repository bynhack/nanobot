# 修复清单

本文件用于跟踪已经确认的问题、风险和技术债。任何代码修复前应先确认本清单是否已有对应条目；没有则新增，修复完成后更新状态、证据和后续项。

## 状态约定

- `待处理`：已确认，需要修复。
- `进行中`：当前正在处理。
- `已修复`：代码已修改并通过必要验证。
- `延后`：暂不处理，需要说明原因。
- `取消`：确认不再需要处理，需要说明原因。

## 优先级约定

- `P0`：安全边界、数据泄露、权限绕过、服务不可用，必须优先处理。
- `P1`：稳定性、重要流程一致性、可维护性问题，近期处理。
- `P2`：整理、重构、文档同步、体验优化，可排期处理。

## 当前修复项

| ID | 优先级 | 状态 | 问题 | 涉及位置 | 验收标准 | 备注 |
|---|---|---|---|---|---|---|
| FIX-001 | P0 | 已修复 | scoped 用户下通用工具层存在默认放行链路，`read_file`、`list_dir`、`exec` 和未知工具的边界需要重新收口，同时保留普通办公技能自由组合能力。 | `src/nanobot_channel_webui/permissions/tool_registry.py`、`src/nanobot_channel_webui/permissions/command_policy.py` | scoped 用户不能读取敏感文件、枚举敏感目录或通过 shell 绕过受控业务 CLI；Word、Excel、浏览器等普通技能仍可基于授权 artifacts 正常使用。 | 已发布验证：权限测试通过；敏感 `read_file/list_dir/exec` 被拒绝，普通 `create_docx` 透传。 |
| FIX-002 | P0 | 已修复 | 敏感路径保护不完整，`~/.nanobot/config.json`、sessions JSONL、audit、private、policies、配置文件等需要纳入读取/列目录边界。 | `src/nanobot_channel_webui/permissions/tool_registry.py` | scoped 用户无法通过 `read_file` 或 `list_dir` 获取敏感配置、会话历史、权限文件、审计文件和私有运行时文件。 | 已发布验证：`~/.nanobot/config.json`、workspace root、sessions/audit/private/policies 均被拒绝。 |
| FIX-003 | P0 | 已修复 | 权限上下文存在 fail-open 默认值：无用户、缺 role、缺 policy file、JS 无 `NANOBOT_WEBUI_POLICY_FILE` 时可能退化为 admin/unrestricted。 | `src/nanobot_channel_webui/permissions/context.py`、`src/nanobot_channel_webui/permissions/resolver.py`、`src/nanobot_channel_webui/permissions/command_policy.py`、`src/nanobot_channel_webui/business_modules/hr/skills/hr-db-ops/scripts/access_policy.mjs` | scoped 或身份缺失场景默认拒绝受控业务访问；只有显式 admin policy 才 unrestricted；已认证 admin 保持 unrestricted。 | 已发布验证：fail-closed 默认值保持不变；`resolve(None)` 非特权；已认证 admin 分支显式构造 `role=admin/business_role=admin`，回归测试 `test_policy_resolver_admin_is_unrestricted` 已覆盖；`./scripts/publish-local.sh` 通过。 |
| FIX-004 | P0 | 已修复 | 身份证号和手机号查询没有强制 company scope，可能导致跨公司 PII 泄露。 | `src/nanobot_channel_webui/business_modules/hr/skills/hr-db-ops/scripts/hr_repository.mjs`、`src/nanobot_channel_webui/business_modules/hr/skills/hr-db-ops/scripts/hr_cli.mjs` | 使用身份证号或手机号查询时，无论是否显式传 `--company`，结果都必须限制在当前账号授权公司范围内。 | 已修复：证件号和手机号查询统一下推 `companyName/companyNames`，显式公司也会校验 scope。 |
| FIX-005 | P1 | 已修复 | 权限运行时注入失败时可能静默降级，scoped 请求仍继续执行。 | `src/nanobot_channel_webui/permissions/injector.py`、`src/nanobot_channel_webui/channel.py` | scoped 请求在权限 runtime 未 attached 时硬失败；管理端观测信息能明确显示注入状态。 | 已修复：tenant runtime 注入失败时 runtime 标记失败，scoped message/cancel 请求直接拒绝。 |
| FIX-006 | P1 | 已修复 | 写入 scope 只在 CLI 入口扫描 JSON plan，repository 最终写入层不感知授权 scope。 | `src/nanobot_channel_webui/business_modules/hr/skills/hr-db-ops/scripts/access_policy.mjs`、`src/nanobot_channel_webui/business_modules/hr/skills/hr-db-ops/scripts/hr_repository.mjs` | 写入、删除、验证在 repository 层也能基于授权公司范围做最终校验。 | 已修复：repository 写入、删除、验证入口统一调用 plan 公司范围兜底校验；CLI 入口仍保留第一道权限校验。 |
| FIX-007 | P1 | 已修复 | scoped 用户的工具定义仍可能暴露完整工具表，和实际权限边界不一致。 | `src/nanobot_channel_webui/permissions/tool_registry.py` | 模型看到的工具定义和 scoped 用户可执行能力一致；普通办公工具保留，敏感工具或敏感参数面不暴露。 | 已修复：scoped 工具定义隐藏 `grep/edit_file/spawn/my/cron/long_task/notebook_edit` 等敏感运行时工具；普通办公类工具继续透传。 |
| FIX-008 | P1 | 已修复 | `business delete` 流程没有和 create/update 一样统一补内部确认语义，自然语言删除流程不稳定。 | `src/nanobot_channel_webui/business_modules/hr/skills/hr-db-ops/scripts/hr_cli.mjs` | 删除类 business 命令走统一 preview/确认/执行/验证流程，用户不需要理解底层 `--confirm`。 | 已修复：`business delete employee` 自动补内部确认语义。 |
| FIX-009 | P2 | 已修复 | HR 任务聚焦词硬编码在通用权限层，影响多业务域通用性。 | `src/nanobot_channel_webui/permissions/skill_view.py`、各业务 `tenant-runtime.json` | 业务术语、focus terms 和 related capabilities 由业务契约声明，通用运行时只读取契约。 | 已修复：新增 capability `focus_terms` 契约字段，HR 词表迁入 HR `tenant-runtime.json`，通用动态视图渲染器不再硬编码 HR 词表。 |
| FIX-010 | P2 | 已修复 | `permissions` 与 `tenant_runtime` 双模块命名和再导出较多，长期维护成本高。 | `src/nanobot_channel_webui/permissions/`、`src/nanobot_channel_webui/tenant_runtime/` | 明确主模块边界，减少重复导出和兼容别名。 | 已修复：明确 `tenant_runtime` 为新公共命名层，`permissions` 为当前实现和兼容导入层；不做破坏性删除，避免影响已有 import。 |
| FIX-011 | P2 | 已修复 | `TenantGuard` 当前是旁路 SDK，有测试和导出，但未进入 HR 主执行链路，文档表述容易误导。 | `src/nanobot_channel_webui/tenant_runtime/guard.py`、`docs/` | 文档准确描述当前 enforcement 主链路；若保留 SDK，要说明适用场景。 | 已修复：权限硬化文档已明确 HR 主链路由命令网关、动态技能视图、HR CLI 和 repository scope 兜底共同完成；`TenantGuard` 是新业务技能可复用 SDK。 |
| FIX-012 | P2 | 已修复 | 存在重复 JS guard 文件和 `__pycache__`、旧 `case_graph` 缓存残留。 | `src/nanobot_channel_webui/tenant_runtime/*.mjs`、`src/**/__pycache__`、`src/nanobot_channel_webui/case_graph/` | 重复文件和缓存残留清理完成，打包产物不包含无关缓存。 | 已修复：删除重复 `tenant_runtime_guard.mjs`，清理缓存，并在发布验证脚本编译后自动删除 `__pycache__`。 |
| FIX-013 | P2 | 已修复 | help 输出仍混有 legacy 命令和 business 命令，容易让模型执行绕路。 | `src/nanobot_channel_webui/business_modules/hr/skills/hr-db-ops/scripts/hr_cli.mjs` | 面向智能体的 help 只暴露标准 business surface；legacy 命令仅作为内部兼容 alias。 | 已修复：默认 `help` 输出标准 business surface；legacy 命令保留为兼容 alias 和特定命令帮助。 |
| FIX-014 | P0 | 已修复 | HR CLI 直调 `count-all` 必须走 JS 层授权，不能只依赖 Python exec 网关的 `denied_commands` 兜底。 | `src/nanobot_channel_webui/business_modules/hr/skills/hr-db-ops/scripts/hr_cli.mjs`、`src/nanobot_channel_webui/business_modules/hr/skills/hr-db-ops/scripts/access_policy.mjs`、`tests/test_permissions.py` | scoped 用户直调 `hr_cli.mjs count-all` 时被 JS policy 拒绝；拒绝发生在数据库访问前；admin/unrestricted 仍可执行全局统计。 | 已修复并补回归测试：`count-all` case 调用 `authorizeHrCommand`，命中 `SCOPED_GLOBAL_DENY_COMMANDS`；`test_hr_cli_count_all_is_denied_by_js_policy_for_scoped_user` 覆盖 CLI 直调。 |

## 维护规则

- 新发现 bug、评审意见或安全风险时，先新增或更新本文件。
- 处理前将状态改为 `进行中`。
- 修复完成后改为 `已修复`，并在备注中记录验证方式、发布时间或关联提交。
- 如果需求发生变化，应标记 `延后` 或 `取消`，不要直接删除历史问题。
