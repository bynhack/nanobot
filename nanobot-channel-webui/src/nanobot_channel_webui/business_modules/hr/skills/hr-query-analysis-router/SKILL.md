---
name: "hr-query-analysis-router"
description: "默认 HR 只读入口。Use first for natural-language HR query/analyze requests: 员工详情、组织架构、可见公司部门、花名册汇总、合同、绩效、社医保、奖惩、用章、风险提示和报表类问题。写入、导入、清理和删除再转交 hr-db-ops。"
---

# HR Query Analysis Router

本技能把 HR 人员的自然语言问题路由到标准业务 CLI。优先使用确定性的业务命令，
不要探索脚本、runtime、policy 文件或数据库连接信息。

标准入口固定为：

```bash
nanobot-webui-business hr business <query|get|analyze> <resource|topic> [options]
```

默认不要传 `--company`，让当前登录账号的 policy 自动限定授权公司范围。只有用户明确指定
某家公司时才传 `--company "公司全称"`。

## Required Order

1. 判断请求是只读查询/分析，还是新增、修改、导入、清理、删除等写入类意图。
2. 只读请求使用 `references/query-routing-map.md` 选择最接近的 `business query`、
   `business get` 或 `business analyze` 命令。
3. 能用一条汇总或分析命令回答时，不拆成多条逐行明细查询。
4. 执行命令后先用 HR 业务语言给结论，再按需要展示关键数据。
5. 写入类请求转到 `hr-db-ops` 的写入流程：先 preview，用户确认后执行，再 verify。

## Fast Paths

- 花名册汇总、员工概况、人员结构、各公司人数、按公司、部门和在职状态汇总：
  直接运行 `nanobot-webui-business hr business analyze headcount`。不要先运行
  `business query employee` 拉取逐行员工明细，也不要先运行 `list-employees`，除非用户明确
  要求查看花名册明细、导出明细或点名查人。
- 当前账号可见公司和部门：
  直接运行 `nanobot-webui-business hr business query organization-tree`。
- 员工资料质量、重复身份证、重复手机号：
  直接运行 `nanobot-webui-business hr business analyze employee-summary`。
- 合同覆盖率、在职员工缺合同：
  直接运行 `nanobot-webui-business hr business analyze contract-coverage`。
- 未来 N 天合同到期：
  直接运行 `nanobot-webui-business hr business analyze contract-expiry --days N`。

## Forbidden Routes

- 不要运行 `which`、`find`、`ls` 或 `cat` 来查找或确认已知 CLI。
- 不要读取 `runtime/`、`scripts/`、`tenant-runtime.json`、policy 文件、数据库配置、会话历史、
  audit 日志或 private 文件。
- 不要通过 memory、workspace 文件或底层数据文件推断用户公司范围。
- 不要使用原始数据库、SQL、Supabase 客户端或未授权脚本绕过标准业务 CLI。
- 不要用 `count-all`、`data-quality-check`、`analyze-hr-risk-dashboard` 回答 scoped 用户的普通
  业务问题；优先使用当前可授权的标准 `business` 命令。

## Response Rules

- 面向 HR 或管理者时，默认使用业务语言，不展示原始 JSON、SQL、内部字段名或数据库 ID。
- 命中多人时，展示候选人并请用户补充公司、部门、手机号或证件号。
- 大结果集先总结，再展示最相关记录。
- 分析类回答先给结论，再给关键数字和建议动作。
- 只有当命令能力限制影响答案时，才解释限制。

## Routing Map

使用 `references/query-routing-map.md` 选择具体命令和参数。
