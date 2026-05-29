# Tenant Runtime 业务技能接入规范

## 目的

业务技能接入 Tenant Runtime 时，不应该重新发明权限逻辑。每个技能只需要完成三件事：

1. 声明自己需要的资源、动作、命令入口和高风险子命令。
2. 在执行脚本中读取插件注入的 `NANOBOT_WEBUI_POLICY_FILE`。
3. 在查询、汇总、写入前使用 Guard SDK 做数据范围过滤或拒绝。

插件层负责「能不能调用」，业务技能层负责「调用后能看到什么」。

## 技能契约

每个业务技能目录建议放置 `tenant-runtime.json`：

```json
{
  "name": "example-business-ops",
  "kind": "business",
  "resources": [
    { "resource": "example.account", "actions": ["read", "query"], "scope_key": "company" },
    { "resource": "example.record", "actions": ["read", "query", "write"], "scope_key": "company" }
  ],
  "commands": ["skills/example-business-ops/scripts/run-example-cli.sh"],
  "denied_commands": ["clear-data", "delete-records"],
  "requires_confirmation": false
}
```

规则：

- `name` 必须等于技能名，并且要出现在当前用户的技能授权列表中。
- `kind` 默认为 `business`；纯文档技能可用 `reference`，公共辅助技能可用 `support`。
- `commands` 是插件层允许 scoped 用户执行的命令入口。
- `denied_commands` 是即使命令入口合法，也要由插件层直接拒绝的高风险子命令。
- `resources` 描述技能脚本必须落实的数据权限。
- `scope_key` 是业务范围维度，比如 `company`、`project`、`store`、`department`。

## JS 技能脚本接入

Node/JS 技能脚本可以复用插件提供的 `tenant_runtime/guard.mjs`。

核心函数：

- `loadPolicyFromEnv()`
- `loadPolicyFromFile(path)`
- `isUnrestricted(policy)`
- `allows(policy, requirement)`
- `assertAllowed(policy, requirement)`
- `filterAllowedValues(policy, resource, action, values, { scopeKey })`
- `scopeRows(policy, resource, action, rows, { scopeKey, field, getValue })`

示例：

```js
import {
  loadPolicyFromEnv,
  assertAllowed,
  scopeRows,
} from "./tenant_runtime_guard.mjs";

const policy = loadPolicyFromEnv();

assertAllowed(policy, {
  resource: "example.record",
  action: "query",
  scopeKey: "company",
  scopeValue: companyName,
});

const visibleRows = scopeRows(policy, "example.record", "query", rows, {
  scopeKey: "company",
  field: "company",
});
```

## Python 技能脚本接入

Python 脚本可以复用 `TenantGuard`：

```python
from nanobot_channel_webui.tenant_runtime.guard import TenantGuard

guard = TenantGuard.from_environment()

guard.require(
    "example.record",
    "query",
    scope_key="company",
    scope_value=company_name,
)

visible_rows = guard.scope_rows(
    "example.record",
    "query",
    rows,
    scope_key="company",
    field="company",
)
```

## 底线

- 不能只检查用户传入的参数，汇总和列表结果也必须按 scope 过滤。
- 不能使用提示词作为权限边界。
- 不能在 scoped 用户下读取全局记忆来推断未授权业务事实。
- 不能通过底层数据库脚本绕过 `tenant-runtime.json` 声明的命令入口。
- 写入类命令必须同时做 scope 校验和确认校验。

## 推荐接入顺序

1. 给技能添加 `tenant-runtime.json`。
2. 把脚本入口加入 `commands`。
3. 把高风险子命令加入 `denied_commands`。
4. 在脚本启动时读取 `NANOBOT_WEBUI_POLICY_FILE`。
5. 所有查询、汇总、写入都经过 Guard SDK。
6. 用普通用户账号验证只能看到授权 scope。
7. 用管理员账号验证全局查询仍然可用。

## 用户策略字段

PocketBase 用户记录可以使用通用字段，不再要求业务都伪装成 HR：

```json
{
  "tenant_id": "tenant-a",
  "business_role": "business_specialist",
  "skills": ["example-business-ops"],
  "scopes": {
    "company": ["乐潮里科技有限公司"],
    "project": ["project-a"]
  },
  "resources": [
    {
      "resource": "example.record",
      "actions": ["read", "query"],
      "scopes": [{ "key": "company", "values": ["乐潮里科技有限公司"] }]
    }
  ]
}
```

如果用户记录中直接提供 `tenant_policy`，运行时会优先使用该策略；否则会从
`tenant_id`、`skills`、`scopes`、`resources` 组装策略。

通用模型不再读取 `company_scope`、`companyScope`、`companies` 等历史兼容字段。
业务范围必须写入 `scopes` 或 `resources[].scopes`，否则 scoped 用户默认没有数据范围。
