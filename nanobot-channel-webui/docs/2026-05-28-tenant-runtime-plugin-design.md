# Tenant Runtime Plugin 设计方案

## 背景

当前 WebUI 插件已经在 HR 场景中验证了一套可行的权限链路：

- 登录用户从 PocketBase 解析出 `tenant_id`、业务角色、技能列表、通用 scopes 和资源权限。
- 插件运行时注入工具权限、技能权限和命令权限。
- 业务技能脚本读取权限文件，将 `resources[].scopes` 落实到查询、汇总和写入前校验。
- scoped 用户隔离全局 `MEMORY.md` 和 `history.jsonl`，避免跨用户、跨公司上下文污染。
- 所有允许和拒绝的工具调用写入权限审计日志。

这证明了一个方向：即使上游 Agent 框架本身偏个人工作区模型，也可以通过插件方式扩展出企业级多租户运行时能力。

本方案选择方案 B：**抽象成通用 Policy Gateway，而不是继续堆 HR 专用逻辑，也不是立即替换上游 Agent 框架。**

## 目标

构建一个可复用的 `Tenant Runtime Plugin`，作为 Nanobot 之上的企业级多租户治理层。

它需要支持：

- 多登录用户。
- 多租户 / 多业务域。
- 角色权限。
- 数据范围权限。
- 工具调用权限。
- 技能可见性和技能调用权限。
- 业务技能内的数据权限落地。
- 租户级、用户级、会话级记忆隔离。
- 工具调用和越权尝试审计。

它不负责替代 Nanobot 的 Agent Loop、LLM Provider 或基础会话能力，而是在运行时边界上补齐企业业务系统需要的治理能力。

## 非目标

- 不重写 Nanobot 上游核心。
- 不把所有业务权限硬编码进插件。
- 不让模型自行判断权限。
- 不依赖提示词作为安全边界。
- 不把 HR 规则作为框架内置规则。
- 不在第一阶段实现完整的分布式沙箱或物理租户隔离。

## 总体架构

```text
Nanobot Agent Runtime
  ↓
Tenant Runtime Plugin
  ↓
Policy Gateway
  ↓
Tool Gateway / Skill Gateway / Memory Gateway
  ↓
Tenant-aware Business Skills
  ↓
Business Data / Files / External APIs
```

插件层负责统一的运行时治理，业务技能负责把权限落实到业务数据访问上。

这对应传统后台管理系统中的分层：

```text
登录用户
  ↓
网关 / 中间件鉴权
  ↓
Controller / Service 权限判断
  ↓
Repository 数据范围过滤
  ↓
审计日志
```

Agent 场景只是把 `Controller / Service` 换成了「技能脚本」和「工具调用」。

## 核心原则

### 1. Runtime 不信任模型

模型只能提出工具调用意图，不能决定自己是否有权限。

所有工具调用、文件读取、命令执行、记忆注入，都必须经过运行时策略判断。

### 2. 插件层控制「能不能调用」

插件层负责：

- 当前用户是谁。
- 当前用户有哪些租户和业务范围。
- 当前用户能看到哪些技能。
- 当前用户能调用哪些工具。
- 当前用户能执行哪些命令形态。
- 是否需要注入 `policy_file`。
- 是否记录审计。

### 3. 技能层控制「调用后能看到什么」

业务技能必须读取策略上下文，并把权限落实到查询和写入逻辑中。

例如 HR 场景不能只校验：

```text
用户传入的 company 是否在授权范围内
```

还必须保证最终查询等价于：

```sql
WHERE company_id IN current_user.resources['hr.employee'].scopes['company']
```

尤其是统计、汇总、报表类命令，也必须按范围过滤。

### 4. 记忆必须按权限边界隔离

个人 Agent 的全局记忆在企业多租户场景中是风险源。

scoped 用户不能自动获得：

- 全局 `MEMORY.md`。
- 全局 `history.jsonl`。
- 其他用户会话里产生的事实。
- 其他租户或公司范围内的业务事实。

### 5. 审计默认开启

以下行为都需要记录：

- 工具调用被允许。
- 工具调用被拒绝。
- 命令因为敏感路径被拒绝。
- 文件读取因为越权被拒绝。
- 业务技能因为数据范围不匹配而拒绝。
- 模型尝试绕过策略。

审计日志既服务安全，也服务调试。

## 核心抽象

### TenantContext

`TenantContext` 是当前 `PolicyContext` 的通用化版本。

建议结构：

```json
{
  "user_id": "u1",
  "email": "user@example.com",
  "tenant_id": "tenant-a",
  "role": "user",
  "business_roles": ["hr_specialist"],
  "scopes": {
    "company": ["乐潮里科技有限公司", "武汉未来天空音乐文化产业有限公司"]
  },
  "allowed_skills": ["hr-db-ops"],
  "allowed_tools": ["exec", "read_file", "ask_user"],
  "data_permissions": [
    {
      "resource": "company",
      "actions": ["read"],
      "values": ["乐潮里科技有限公司"]
    }
  ],
  "session_id": "chat-id",
  "policy_file": "/path/to/policy.json"
}
```

历史 HR 的 `company_scope` 已废弃；现在统一使用 `scopes.company` 与 `resources[].scopes`。

### PolicyResolver

`PolicyResolver` 负责把登录用户记录解析成 `TenantContext`。

输入可以来自：

- PocketBase 用户字段。
- 外部 IAM。
- 本地配置文件。
- 租户权限表。
- 后续自定义权限 API。

输出必须是运行时可执行的策略，而不是提示词文本。

### Tool Gateway

`Tool Gateway` 包装上游 Tool Registry。

它负责：

- 过滤工具定义，避免模型看到无权工具。
- 拦截工具调用。
- 校验命令形态。
- 阻断 shell 拼接、重定向、敏感路径、底层数据库连接脚本等绕过方式。
- 注入 `policy_file` 环境变量。
- 写审计日志。

### Skill Gateway

`Skill Gateway` 包装上游 Skills Loader。

它负责：

- scoped 用户只看到授权技能。
- 未授权技能不能加载到上下文。
- always-on skills 也需要按权限过滤。
- 技能摘要不能暴露未授权业务能力。

### Memory Gateway

`Memory Gateway` 包装上游 Memory Store。

它负责：

- admin 保留全局记忆。
- scoped 用户默认不注入全局 `MEMORY.md`。
- scoped 用户默认不注入全局 `history.jsonl`。
- 后续支持租户记忆、用户记忆、会话记忆和 scope 记忆。

建议记忆分层：

```text
memory/global/admin
memory/tenant/{tenant_id}
memory/user/{user_id}
memory/session/{session_id}
memory/scope/{policy_hash}
```

第一阶段可以继续采用「scoped 用户禁用全局记忆」的保守策略。

### Skill Contract

每个业务技能应声明自己的权限需求。

当前实现支持每个技能目录提供 `tenant-runtime.json`，或在 `SKILL.md` 中提供
`tenant-runtime-contract` fenced JSON 块。插件层会读取这些声明来识别技能命令，
不再把 HR CLI 作为唯一可执行命令写死在通用框架里。

示例：

```json
{
  "name": "hr-db-ops",
  "resources": [
    { "resource": "hr.company", "actions": ["read", "query"], "scope_key": "company" },
    { "resource": "hr.employee", "actions": ["read", "query", "analyze", "write"], "scope_key": "company" }
  ],
  "commands": ["skills/hr-db-ops/scripts/run-hr-cli.sh"],
  "denied_commands": ["clear-business-data", "delete-employee-records"],
  "requires_confirmation": false
}
```

插件层通过 Skill Contract 识别命令权限：

- 命令必须匹配当前工作区某个授权技能的 `commands`。
- 技能必须在当前用户的 `skill_allowlist` 中。
- 技能声明的 `resources/actions/scope_key` 必须能被当前 `TenantPolicy` 覆盖。
- `denied_commands` 中声明的高风险子命令会在插件层直接拒绝。
- 插件层只判断「能不能调用」，业务技能仍然必须读取 `policy_file` 并过滤最终数据。

### Business Guard SDK

业务技能需要一套轻量 SDK 读取并执行策略。

JavaScript 示例：

```js
import { loadPolicy, assertAllowed } from "@tenant-runtime/guard";

const policy = loadPolicy();
assertAllowed(policy, {
  resource: "company",
  action: "read",
  value: companyName
});
```

Python 示例：

```python
from tenant_runtime_guard import load_policy, assert_allowed

policy = load_policy()
assert_allowed(policy, resource="company", action="read", value=company_name)
```

SDK 应提供：

- `loadPolicy()`
- `isUnrestricted()`
- `assertAllowed()`
- `filterAllowedValues()`
- `scopeQuery()`
- `auditBusinessDecision()`

## 数据流

### 普通业务查询

```text
用户发送消息
  ↓
WebUI 鉴权
  ↓
PolicyResolver 生成 TenantContext
  ↓
Runtime Wrapper 绑定 TenantContext
  ↓
Skill Gateway 过滤技能上下文
  ↓
Memory Gateway 过滤全局记忆
  ↓
模型提出工具调用
  ↓
Tool Gateway 校验并注入 policy_file
  ↓
业务技能读取 policy_file
  ↓
业务技能按 scope 查询数据
  ↓
返回结果
  ↓
审计日志记录
```

### 越权查询

```text
用户请求未授权公司
  ↓
模型调用 HR CLI
  ↓
Tool Gateway 允许合法 HR CLI 形态
  ↓
HR 技能读取 policy_file
  ↓
Business Guard 判断 company 不在 scope
  ↓
返回权限错误
  ↓
审计日志记录拒绝
```

### 上下文污染防护

```text
Agent 构建系统提示词
  ↓
Memory Gateway 检查 TenantContext
  ↓
scoped 用户返回空 Memory 和空 Recent History
  ↓
模型无法看到未授权历史事实
```

## 模块划分

建议目录：

```text
src/nanobot_channel_webui/
  tenant_runtime/
    context.py
    resolver.py
    tool_gateway.py
    skill_gateway.py
    memory_gateway.py
    contracts.py
    audit.py
    injector.py
  tenant_runtime_sdks/
    js/
    python/
  integrations/
    hr/
      resolver.py
      contracts.yaml
      README.md
```

当前 `permissions/` 包可以逐步迁移到 `tenant_runtime/`。

当前 HR 逻辑应逐步迁移到 `integrations/hr/`，避免通用框架继续增长 HR 专用判断。

## 与当前实现的映射

| 当前实现 | 目标抽象 |
|---|---|
| `PolicyContext` | `TenantContext` |
| `PolicyResolver` | 通用 `PolicyResolver` + HR resolver |
| `AuthorizingToolRegistry` | `Tool Gateway` |
| `AuthorizingSkillsLoader` | `Skill Gateway` |
| `AuthorizingMemoryStore` | `Memory Gateway` |
| `CommandPolicyGuard` | Contract-driven command guard |
| `access_policy.mjs` | JS Business Guard SDK 的雏形 |
| `hr_cli.mjs` 权限判断 | HR Skill Contract + Guard SDK |
| `permissions.jsonl` | Tenant Audit Log |

## 分阶段实施

### 阶段 1：命名和边界收敛

目标：把当前 HR MVP 的通用部分从 `permissions/` 中抽象出来。

内容：

- 新建 `tenant_runtime/` 包。
- 保留兼容导出，避免一次性大重构。
- 将通用 `PolicyContext` 改名为 `TenantContext`。
- 将工具、技能、记忆包装器命名为 Gateway。
- 保留 HR 现有行为不变。

### 阶段 2：Skill Contract

目标：从硬编码命令列表迁移到声明式权限。

内容：

- 定义 `contracts.yaml` 格式。
- 支持命令级 action、resource、scope_required、confirmation_required。
- Tool Gateway 加载 Skill Contract。
- HR 命令迁移到 `integrations/hr/contracts.yaml`。

### 阶段 3：Business Guard SDK

目标：让业务技能用统一 SDK 执行数据权限。

内容：

- 提供 JS SDK。
- 提供 Python SDK。
- HR CLI 改为使用 SDK。
- 保留现有 `access_policy.mjs` 行为兼容。

### 阶段 4：Tenant Memory

目标：从「scoped 用户禁用全局记忆」升级为多层租户记忆。

内容：

- 定义租户记忆目录结构。
- 支持 user/session/scope 级记忆注入。
- admin 可查看全局记忆。
- scoped 用户只能加载授权范围记忆。

### 阶段 5：管理和观测

目标：让多租户运行时可配置、可观测、可审计。

内容：

- 设置页展示当前用户策略摘要。
- 设置页展示 runtime injection 状态。
- 审计日志支持筛选用户、租户、会话、工具。
- 提供权限调试视图。

## 测试策略

测试需要覆盖 4 类边界：

### 1. 工具权限

- scoped 用户看不到未授权工具。
- scoped 用户不能调用 shell 拼接、重定向、敏感路径命令。
- admin 不受 scoped 限制。

### 2. 技能权限

- scoped 用户只看到授权技能。
- always-on skills 也被过滤。
- 未授权技能不能进入系统提示词。

### 3. 数据权限

- 授权公司查询成功。
- 未授权公司查询失败。
- 不带公司参数时只查询授权范围。
- 汇总和报表不返回授权范围外数据。

### 4. 记忆隔离

- scoped 用户不注入全局 `MEMORY.md`。
- scoped 用户不注入全局 `history.jsonl`。
- admin 仍保留全局记忆。
- 当前会话历史不受影响。

## 风险和约束

### 上游框架仍然偏个人工作区

Nanobot 当前更像个人 Agent 工作区，不是天然多租户 SaaS Runtime。

插件方案必须持续关注上游变更，避免运行时注入点失效。

### 插件层无法替代业务层数据权限

Tool Gateway 可以阻止明显越权，但不能保证业务脚本内部查询正确。

业务技能必须使用 Guard SDK，将权限落实到数据查询。

### 记忆隔离不能只靠后处理

如果模型已经看到未授权记忆，再删除输出已经太晚。

必须在系统提示词构建阶段阻断未授权记忆注入。

### Shell 工具天然高风险

只要允许通用 shell，就需要持续收紧命令形态。

长期应推动业务技能以结构化工具形式暴露，而不是让模型自由拼 CLI。

## 成功标准

第一阶段成功标准：

- 当前 HR 权限能力不回退。
- 通用 `TenantContext` 可以表达 HR 的公司范围权限。
- scoped 用户不会看到未授权技能、工具和全局记忆。
- HR 技能继续按授权公司范围查询。
- 审计日志能解释每次允许和拒绝。

中期成功标准：

- 新业务技能可以通过 Skill Contract 接入权限系统。
- 业务脚本可以通过 Guard SDK 实现数据权限。
- 插件层不再硬编码 HR 命令。
- 可以支持至少 2 个业务域共用同一套 Tenant Runtime。

长期成功标准：

- WebUI 插件成为企业级多租户 Agent Runtime 的基础层。
- Nanobot 上游继续作为 Agent Loop 和工具执行底座。
- 我们自己的业务权限、记忆隔离、审计和技能协议沉淀为可复用框架。
