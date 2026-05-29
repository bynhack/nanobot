# WebUI 运行时权限注入设计

> 历史设计文档：本文记录的是第一版 HR 权限注入方案，其中 `company_scope`
> 已被后续通用 Tenant Runtime 模型替换。当前实现以 PocketBase 用户记录中的
> `tenant_id`、`skills`、`scopes`、`resources` 或完整 `tenant_policy` 为准。

## 目标

在不修改 Nanobot 上游代码的前提下，由 `nanobot-channel-webui` 插件在运行时注入一套通用权限框架，控制不同登录用户可见的技能、可调用的工具、可执行的 CLI 命令，以及可访问的业务数据范围。

第一阶段以 HR 场景落地：人事专员只能查询或操作授权公司范围内的数据，人事经理可以查询和操作所有公司数据。

## 核心原则

1. 不修改上游 Nanobot core。
2. 不依赖提示词作为权限边界，提示词只做行为引导。
3. 权限必须在工具执行前硬拦截。
4. 普通用户的 `exec` 默认拒绝，只放行业务白名单命令。
5. HR 数据权限最终必须落到 HR CLI / repository 层，避免模型绕过自然语言约束。
6. 权限框架保持业务无关，HR 只是第一个 policy provider。
7. 所有允许和拒绝的关键决策都要审计。

## 当前上游能力判断

上游已有能力主要是外围安全护栏：

- channel `allow_from` 和 group policy：控制谁能把消息发进来。
- `disabled_skills`：全局禁用技能，不支持按用户动态控制。
- `tools.exec.enable`：全局开关 shell 工具。
- `tools.restrict_to_workspace`：限制工具访问工作区边界。
- `tools.exec.allow_patterns` / `deny_patterns`：对 shell 命令做静态正则过滤。
- `tools.exec.sandbox = "bwrap"`：用 bubblewrap 做 workspace sandbox。
- MCP server `enabled_tools`：限制单个 MCP server 注册工具。

这些不是业务权限系统。它们不能表达“当前登录用户只能访问某几家公司 HR 数据”。因此 WebUI 插件需要注入自己的运行时权限层。

## 总体架构

```text
PocketBase 当前用户
  ↓
WebUI CurrentUser
  ↓
PolicyResolver
  ↓
PolicyContext
  ↓
RuntimePermissionInjector
  ├─ AuthorizingToolRegistry
  ├─ AuthorizingSkillsLoader
  ├─ CommandPolicyGuard
  └─ AuditLogger
  ↓
Nanobot AgentLoop 原执行链路
  ↓
HR CLI / repository 数据范围硬校验
```

## 运行时注入点

WebUI 插件启动后通过现有 runtime attach 能力拿到 AgentLoop，再进行一次幂等注入。

注入前：

```text
loop.tools = ToolRegistry
loop.context.skills = SkillsLoader
```

注入后：

```text
loop.tools = AuthorizingToolRegistry(original=ToolRegistry)
loop.context.skills = AuthorizingSkillsLoader(original=SkillsLoader)
```

注入必须满足：

- 幂等，多次 attach 不重复包装。
- 可探测包装状态，方便 runtime 设置页显示。
- 保留原对象接口，避免影响上游调用方。
- 管理员默认透传原能力。
- 普通用户按当前 `PolicyContext` 动态决策。

## PolicyContext

`PolicyContext` 是一次 WebUI 用户请求的权限上下文。

建议字段：

```json
{
  "user_id": "pb_user_id",
  "email": "hr@example.com",
  "role": "hr_staff",
  "is_admin": false,
  "business_role": "hr_specialist",
  "company_scope": ["武汉赢城文化传媒有限公司"],
  "skill_allowlist": [
    "hr-schema",
    "hr-policy",
    "hr-query-analysis-router",
    "hr-data-entry-workflow",
    "hr-db-ops"
  ],
  "exec_mode": "deny_by_default",
  "data_domain": "hr"
}
```

人事经理：

```json
{
  "role": "hr_manager",
  "company_scope": ["*"],
  "exec_mode": "deny_by_default"
}
```

管理员：

```json
{
  "role": "admin",
  "is_admin": true,
  "company_scope": ["*"],
  "exec_mode": "allow"
}
```

## PolicyResolver

`PolicyResolver` 负责从当前用户解析权限。

第一版数据来源：

- PocketBase user record 的 `role`。
- PocketBase user record 或扩展 collection 中的 `company_scope`。
- 插件内置默认策略。

建议第一阶段先支持两类 HR 业务角色：

| 业务角色 | 数据范围 | 读 | 分析 | 写 | 危险操作 | 系统配置 |
| --- | --- | --- | --- | --- | --- | --- |
| `hr_specialist` | 指定公司 | 允许 | 允许 | 允许，需确认 | 禁止 | 禁止 |
| `hr_manager` | 所有公司 | 允许 | 允许 | 允许，需确认 | 默认禁止 | 禁止 |
| `admin` | 所有公司 | 允许 | 允许 | 允许 | 允许 | 允许 |

## AuthorizingSkillsLoader

职责：

- 控制技能摘要是否出现在模型上下文。
- 控制技能详情是否允许被加载。
- 防止普通用户加载底层数据库技能。

需要包装的方法：

- `list_skills`
- `load_skill`
- `load_skills_for_context`
- `build_skills_summary`
- `get_always_skills`
- `get_skill_metadata`

普通 HR 用户默认允许：

- `hr-schema`
- `hr-policy`
- `hr-query-analysis-router`
- `hr-data-entry-workflow`
- `hr-db-ops`

普通 HR 用户默认禁止：

- `supabase-base`
- 任何未授权业务域技能
- 未来新增的开发调试类技能

注意：技能过滤只是减少模型误用，不是最终安全边界。最终安全边界在工具执行和业务 CLI。

## AuthorizingToolRegistry

职责：

- 动态过滤模型可见工具定义。
- 在 `prepare_call` 阶段做硬拦截。
- 在 `execute` 阶段做兜底拦截。
- 记录审计日志。

需要保持兼容的接口：

- `register`
- `unregister`
- `get`
- `has`
- `get_definitions`
- `prepare_call`
- `execute`
- `tool_names`
- `__len__`
- `__contains__`

核心规则：

1. 管理员默认透传。
2. 普通用户只能看到允许工具。
3. 普通用户调用无权工具时返回明确错误。
4. `exec` 必须进入命令级策略。
5. 所有拒绝都不应让模型反复尝试绕过，应返回“这是权限边界，不是临时错误”的提示。

## CommandPolicyGuard

`exec` 是最大风险点，因此普通用户模式下必须默认拒绝。

第一版规则：

```yaml
exec:
  default: deny
  allow:
    - kind: hr_cli
      pattern: '^skills/hr-db-ops/scripts/run-hr-cli\.sh\s+'
    - kind: hr_org_scan
      pattern: '^python3\s+skills/hr-db-ops/scripts/scan_org_sources\.py(\s|$)'
  deny:
    - 'skills/supabase-base/'
    - 'SUPABASE_SERVICE'
    - 'SUPABASE_SERVICE_ROLE_KEY'
    - 'supabase_connector'
    - 'scripts/.env'
    - '\.env'
```

`hr_cli` 子命令再映射风险等级：

| 命令类型 | 示例 | 人事专员 | 人事经理 | 管理员 |
| --- | --- | --- | --- | --- |
| read | `employee-detail`, `contracts-by-employee` | 授权公司内允许 | 允许 | 允许 |
| analysis | `analyze-headcount`, `analyze-hr-risk-dashboard` | 授权公司内允许 | 允许 | 允许 |
| write | `apply-employees`, `apply-contracts` | 授权公司内允许，需确认 | 允许，需确认 | 允许 |
| danger | `clear-business-data`, `delete-employee-records` | 禁止 | 默认禁止 | 允许 |
| dev | `supabase-base`, inline node query | 禁止 | 禁止 | 允许 |

## HR 数据范围硬校验

工具层拦截仍不能替代业务数据层校验。HR CLI 必须读取 policy scope，并在 repository 层强制执行。

WebUI 插件在每次 WebUI 用户请求中生成 policy 文件：

```text
~/.nanobot/workspace/.nanobot_channel_webui/policies/<chat_id>.json
```

并通过环境变量传递：

```bash
NANOBOT_WEBUI_POLICY_FILE=/path/to/policy.json
NANOBOT_WEBUI_USER_ID=...
NANOBOT_WEBUI_USER_EMAIL=...
```

HR CLI 启动时读取 policy：

```js
const policy = loadPolicyFromEnv();
```

Repository 层统一提供：

```js
assertCompanyAllowed(companyName)
filterCompanies(queryBuilder)
assertRowsAllowed(rows)
redactForbiddenFields(record)
```

规则：

- `company_scope = ["*"]` 表示允许所有公司。
- 查询命令有 `--company` 时，必须在 scope 内。
- 查询命令没有 `--company` 时，自动按 scope 过滤。
- 写入命令逐条校验记录公司。
- 写入记录缺少公司时拒绝，要求补充公司。
- 危险命令只允许管理员。

## 提示词约束的位置

提示词只能作为用户体验优化，不作为权限边界。

可以注入：

```text
当前用户只能处理以下公司范围内的 HR 数据：
- 武汉赢城文化传媒有限公司

如果用户请求其他公司数据，直接说明无权访问。
如果用户没有说明公司，只能在授权公司范围内查询，或者要求用户补充公司。
```

但即使没有这段提示词，工具层和 HR CLI 层也必须能拦截越权访问。

## 审计日志

建议第一版写入 workspace JSONL：

```text
~/.nanobot/workspace/.nanobot_channel_webui/audit/permissions.jsonl
```

记录结构：

```json
{
  "ts": "2026-05-27T21:00:00+08:00",
  "user_id": "pb_user_id",
  "email": "hr@example.com",
  "chat_id": "uuid",
  "tool": "exec",
  "command": "skills/hr-db-ops/scripts/run-hr-cli.sh employee-detail --company ...",
  "decision": "deny",
  "reason": "company_not_in_scope",
  "company_scope": ["武汉赢城文化传媒有限公司"]
}
```

后续可同步到 PocketBase，支持设置页查看。

## 插件内文件规划

建议新增：

```text
src/nanobot_channel_webui/permissions/
  __init__.py
  context.py
  resolver.py
  injector.py
  tool_registry.py
  skills_loader.py
  command_policy.py
  audit.py
```

HR 技能侧建议新增：

```text
~/.nanobot/workspace/skills/hr-db-ops/scripts/access_policy.mjs
```

并修改：

```text
~/.nanobot/workspace/skills/hr-db-ops/scripts/hr_cli.mjs
~/.nanobot/workspace/skills/hr-db-ops/scripts/hr_repository.mjs
```

## MVP 实施范围

第一版只做：

1. WebUI 插件运行时注入。
2. 当前用户 `PolicyContext`。
3. 普通用户技能过滤。
4. 普通用户 `exec` 默认拒绝，只允许 HR CLI。
5. HR CLI 子命令风险等级判断。
6. HR CLI 公司范围 policy 文件传递。
7. HR CLI 查询和写入的公司范围硬校验。
8. 权限审计 JSONL。

暂不做：

- 完整通用 RBAC UI。
- 多业务域可视化配置。
- 字段级脱敏。
- PocketBase 审计查询界面。
- 非 HR 业务 provider。

## 风险和约束

1. Runtime patch 依赖上游对象结构，需要启动时做兼容探测。
2. 多 channel 共用 AgentLoop 时，必须只对有 `PolicyContext` 的 WebUI 请求启用普通用户限制；非 WebUI 或无用户上下文场景不能误拦管理员/系统任务。
3. 普通用户如果仍能跑任意 `exec`，权限模型不成立，因此普通用户必须 exec default deny。
4. 如果 Supabase service key 暴露给普通用户可执行路径，仍有绕过风险。因此普通用户不能访问 `supabase-base`，HR CLI 必须成为唯一数据库入口。
5. HR CLI 必须做数据层硬校验，否则插件层命令正则只能算外围护栏。

## 验收标准

1. 普通 HR 用户看不到 `supabase-base` 技能。
2. 普通 HR 用户调用 `exec` 执行非 HR CLI 命令会被拒绝。
3. 普通 HR 用户查询授权公司数据成功。
4. 普通 HR 用户查询未授权公司数据失败。
5. 普通 HR 用户写入授权公司数据成功，但仍需业务确认。
6. 普通 HR 用户写入未授权公司数据失败。
7. 人事经理可以查询和操作所有公司。
8. 管理员不受普通用户策略限制。
9. 所有 allow/deny 决策有审计记录。
10. 不修改 Nanobot 上游代码。
