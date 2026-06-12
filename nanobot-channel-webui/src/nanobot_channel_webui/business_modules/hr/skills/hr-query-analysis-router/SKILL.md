---
name: "hr-query-analysis-router"
description: "默认 HR 只读入口。Use first for natural-language HR read requests: 员工详情、可见公司部门、花名册明细、合同、绩效、社医保、奖惩、用章和报表类问题。写入、导入、清理和删除再转交 hr-db-ops。"
---

# HR Query Analysis Router

本技能把 HR 人员的自然语言问题路由到标准 `hr_business` 工具。优先使用确定性的业务动作，
不要探索脚本、runtime、policy 文件或数据库连接信息。

模型默认入口：

```text
hr_business(action="<list|get|analyze|schema|capabilities>", resource="<resource|topic>", ...)
```

CLI 只作为人工排障和兼容 fallback，不要通过 `exec` 调用 HR business CLI：

```bash
nanobot-webui-business hr business <list|get|analyze|preview|create|preview-update|update|delete|schema|capabilities> <resource|topic> [options]
```

默认不要传 `--company`，让当前登录账号的 policy 自动限定授权公司范围。只有用户明确指定
某家公司时才传 `--company "公司全称"`。

## Required Order

1. 判断请求是只读查看，还是新增、修改、导入、清理、删除等写入类意图。
2. 只读请求使用 `references/query-routing-map.md` 选择最接近的 `hr_business` `list`、
   `get` 或 `analyze` 动作。
3. 裸 `list` 使用分页；需要明细时传 `--page-size`，需要完整匹配时先加业务过滤条件。
4. 执行命令后先用 HR 业务语言给结论，再按需要展示关键数据。
5. 写入类请求转到 `hr-db-ops` 的写入流程：先整理拟录入或拟更新信息，用户确认后执行。

## Fast Paths

- 用户明确要求“员工所有信息”“花名册明细”“员工主档明细”时，调用
  `hr_business(action="list", resource="employee", page_size=100)`。
- 用户要求人数、人员结构、花名册汇总、员工资料风险、合同覆盖率、合同到期、月度绩效、月度社保、人事异动、奖惩统计或用章统计等分析口径时，优先运行
  `business analyze roster`、`business analyze contract-coverage`、`business analyze contract-expiry`、
  `business analyze performance-month`、`business analyze insurance-month`、`business analyze personnel-change`、
  `business analyze disciplinary`、`business analyze seal-usage` 或 `business analyze employee-profile`，
  不要先拉取 records 再自行计数。
- 查某个员工时，先用 `business list employee --name "姓名"`、`--phone` 或 `--id-card`
  定位候选记录，再用 `business get employee --id <id>` 读取精确记录。
- 当前账号可见公司：运行 `business list company`；公司下部门运行
  `business list department --company "公司全称"`。
- 合同明细运行 `business list contract --employee "姓名"`；绩效明细运行
  `business list performance --month YYYY-MM`；社医保异动运行
  `business list insurance --month YYYY-MM`。

## When to fall back to bare list

带过滤的 `business list <resource> --filter` 是首选，但以下场景应退到裸 list 翻页和上下文挑选：

1. 带过滤 list 返回空，但用户对话明确指向某条记录：可能是姓名拼写不一致、口语缩写、
   繁简体差异。裸 list 翻页让模型自己用上下文判断。
2. 用户描述模糊，例如“上个月那个新来的”：没有可靠 filter 时，裸 `list employee`
   配合 `hire_date` 上下文，比反复猜 filter 更准。
3. 多 filter 命中多条：先窄 filter 缩范围；命中过多则补 filter，或退到裸 list 让
   模型挑。

裸 list 默认 `--page-size 100`；翻页用 `--page N`。每页都返回 id，模型挑出目标 id
后用 `business get <resource> --id <id>` 精确读取。

## Forbidden Routes

- 不要运行 `which`、`find`、`ls` 或 `cat` 来查找或确认已知 CLI。
- 不要读取 `runtime/`、`scripts/`、`tenant-runtime.json`、policy 文件、数据库配置、会话历史、
  audit 日志或 private 文件。
- 不要通过 memory、workspace 文件或底层数据文件推断用户公司范围。
- 不要使用原始数据库、SQL、Supabase 客户端或未授权脚本绕过标准业务 CLI。
- 不要用 `count-all`、`data-quality-check` 或 HR 风险看板回答 scoped 用户的普通业务问题；
  优先使用当前可授权的标准 `business` 命令。

## Response Rules

- 面向 HR 或管理者时，默认使用业务语言，不展示原始 JSON、SQL、内部字段名或数据库 ID。
- 命中多人时，展示候选人并请用户补充公司、部门、手机号或证件号。
- 大结果集先总结，再展示最相关记录。
- 只有当命令能力限制影响答案时，才解释限制。

## Routing Map

使用 `references/query-routing-map.md` 选择具体命令和参数。
