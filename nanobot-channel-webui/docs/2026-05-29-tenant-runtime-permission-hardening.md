# Tenant Runtime 权限硬化基线

## 背景

当前插件已经从 HR 单场景权限 MVP 进入通用 Tenant Runtime 阶段。权限不能再依赖提示词、单一 `hr.employee` 资源或模型自觉选择正确命令，而要形成可迁移到其他业务域的标准机制。

本基线记录 2026-05-29 已确认的实现边界，后续改动不得破坏这些原则。

## 核心模型

权限统一表达为：

```text
subject + resource + action + scope
```

示例：

```json
{
  "resource": "hr.contract",
  "actions": ["read", "query", "analyze"],
  "scopes": [{ "key": "company", "values": ["乐潮里科技有限公司"] }]
}
```

含义是：当前用户可以在指定公司范围内读取、查询和分析合同资源。

## HR 标准资源

HR 不再把所有业务能力挂在 `hr.employee` 上，当前标准资源为：

- `hr.company`
- `hr.organization`
- `hr.department`
- `hr.employee`
- `hr.contract`
- `hr.performance`
- `hr.insurance`
- `hr.personnel_change`
- `hr.disciplinary`
- `hr.seal_usage`

数据库权限必须显式配置这些标准资源。当前产品尚未正式上线，不保留 `hr.employee` 自动展开为整个 HR 域的历史兼容逻辑。

如果一个账号只配置了 `hr.employee`，它只拥有员工资源权限，不会自动获得合同、绩效、社医保、奖惩、人事异动或用章权限。

## 运行时边界

插件层负责「能不能调用」：

- scoped 用户只能看到授权工具。
- scoped 用户只能读取授权技能。
- scoped 用户读取业务技能时，返回动态技能视图，而不是完整 `SKILL.md`。
- 动态技能视图的任务裁剪词、触发词和关联能力必须来自业务技能的 `tenant-runtime.json`，通用运行时不能硬编码 HR 或其他业务域词表。
- scoped 用户只能执行当前授权技能声明的命令入口。
- 命令必须匹配业务契约声明的标准入口，例如 `nanobot-webui-business hr ...`。
- 高风险命令、底层数据库脚本、任意 shell 探测和未授权技能入口必须被拒绝。
- 允许和拒绝都必须写入审计日志。

业务技能层负责「调用后能看到什么」：

- 技能脚本必须读取 `NANOBOT_WEBUI_POLICY_FILE`。
- 指定未授权公司时必须拒绝。
- 不传公司参数时，必须自动使用当前账号授权公司范围过滤。
- 列表、详情、跨表组合查询、统计、分析、导入预览、写入验证都必须走同一套 scope 过滤。
- 不能只校验用户输入参数，汇总结果也必须按 scope 收敛。

## 标准 business CLI

面向智能体优先暴露标准业务命令，而不是底层脚本细节：

```bash
business query <resource>
business get <resource>
business analyze <topic>
business create <resource>
business verify <resource>
```

帮助命令可以开放，但只能展示当前账号可用能力。

当前 HR 能力覆盖：

- 公司、组织、部门。
- 员工花名册、员工详情、员工履历。
- 合同查询、合同覆盖率、合同到期分析。
- 绩效记录查询和分析。
- 社医保异动查询和分析。
- 人事异动查询。
- 奖惩记录查询和分析。
- 用章记录查询。
- 需要确认的导入、维护、删除类命令。

## 回归测试边界

后续权限相关修改至少要覆盖：

- `PolicyResolver` 不会把 `hr.employee` 粗粒度资源自动展开为标准 HR 资源。
- 数据库必须显式配置账号可访问的标准资源、动作和 scope。
- 动态技能视图只显示当前账号授权能力，并显示标准资源，而不是隐藏实现命令。
- HR 主执行链路当前由 `CommandPolicyGuard`、动态技能视图、HR CLI `access_policy.mjs` 和 repository scope 兜底共同完成；`TenantGuard` 是给新业务技能复用的旁路 Guard SDK，不是当前 HR CLI 的唯一 enforcement 点。
- `TenantGuard` 作为 SDK 要能对标准资源做资源、动作、scope 校验。
- scoped 用户不能调用未授权技能命令、底层数据库脚本或敏感 shell。
- 指定未授权公司必须拒绝。
- 不带公司参数时，业务技能必须自动按当前账号授权范围过滤。
- 发布后要用普通用户账号发起真实对话，确认工具调用和返回结果都在授权范围内。

## 验证样例

普通用户在两家公司授权范围内执行：

```bash
cd /Users/brian/.nanobot/workspace && \
NANOBOT_WEBUI_POLICY_FILE=<policy.json> \
bash skills/hr-db-ops/scripts/run-hr-cli.sh business analyze performance --month 2026-03
```

预期：

- 命令允许执行。
- 不需要传 `--company`。
- 返回结果只包含当前账号授权公司。
- 审计日志记录 `tenant_contract_allowed`。

如果显式传入未授权公司，例如：

```bash
business analyze contract-coverage --company 武汉赢城文化传媒有限公司
```

预期：

- 命令拒绝。
- 错误说明当前账号无权访问该公司。
- 审计日志记录拒绝原因。
