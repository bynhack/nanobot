---
name: "hr-db-ops"
description: "HR 写入和数据维护操作手册。Use only for preview/create/update/delete/import style HR tasks, confirmation workflows, cleanup requests, and maintenance operations through the WebUI business runtime."
---

# HR DB Ops

本技能只描述模型可使用的 HR 标准业务命令面。真实实现位于插件内
Python HR runtime，模型不要读取、导入或调用 runtime 内部文件。

## First Rule

在 WebUI 多实例会话中，已知入口固定为：

```bash
nanobot-webui-business hr business <query|get|analyze|preview|create|delete> <resource|topic> [options]
```

不要运行 `which`、`find`、`ls`、`cat` 或读取技能目录来寻找 CLI。不要访问
`runtime/`、`private/`、`policies/`、sessions、audit、数据库配置或底层连接信息。

## Execution Rules

- 默认使用标准 `business` 命令，不优先使用 legacy 命令。
- 默认省略 `--company`，让当前登录账号的 policy 自动限定授权公司范围。
- 只有用户明确要求某一家公司时才传 `--company "公司全称"`。
- 能用一个聚合命令回答时，不拆成多条明细查询。
- 概况、汇总、分析请求不要先拉取逐行员工明细。
- 逐行花名册、手机号、身份证号等 PII 明细，只在用户明确要求明细、导出或点名查询时返回。
- 查询结果要先用业务语言总结，再按需要展示关键记录。
- 写入、删除、导入、清理必须先 preview，向用户确认后再 create、update 或 delete，最后 verify。

## Fast Paths

| 用户意图 | 直接命令 |
|---|---|
| 当前账号能看哪些公司和部门 | `nanobot-webui-business hr business query organization-tree` |
| 花名册汇总、人员结构、各公司人数、按部门和状态汇总 | `nanobot-webui-business hr business analyze headcount` |
| 员工概况和质量提示 | `nanobot-webui-business hr business analyze employee-summary` |
| 某员工详情 | `nanobot-webui-business hr business get employee --name "姓名"` |
| 某员工完整 HR 时间线 | `nanobot-webui-business hr business query employee-timeline --name "姓名"` |
| 某员工合同 | `nanobot-webui-business hr business query employee-contracts --name "姓名"` |
| 合同覆盖率 | `nanobot-webui-business hr business analyze contract-coverage` |
| 未来 N 天合同到期 | `nanobot-webui-business hr business analyze contract-expiry --days N` |
| 月度绩效分析 | `nanobot-webui-business hr business analyze performance --month YYYY-MM` |
| 低绩效名单 | `nanobot-webui-business hr business analyze low-performance --month YYYY-MM --threshold 60` |
| 月度社医保异动 | `nanobot-webui-business hr business analyze insurance --month YYYY-MM` |
| 奖惩风险和附件缺失 | `nanobot-webui-business hr business analyze disciplinary` |
| 用章记录 | `nanobot-webui-business hr business query seal-usage [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--name "姓名"]` |

## Read Commands

| 类型 | 命令 |
|---|---|
| 公司 | `business query companies` |
| 组织树 | `business query organization-tree` |
| 部门 | `business query departments [--company "公司全称"]` |
| 员工列表 | `business query employee [--company "公司全称"] [--status "状态"]` |
| 员工详情 | `business get employee --name "姓名" [--company "公司全称"]` |
| 员工时间线 | `business query employee-timeline --name "姓名" [--company "公司全称"]` |
| 合同 | `business query employee-contracts --name "姓名" [--company "公司全称"]` |
| 绩效 | `business query performance --month YYYY-MM [--company "公司全称"]` |
| 员工绩效 | `business query performance-by-employee --name "姓名" [--company "公司全称"]` |
| 社医保 | `business query insurance --month YYYY-MM [--company "公司全称"]` |
| 员工社医保 | `business query insurance-by-employee --name "姓名" [--company "公司全称"]` |
| 人事异动 | `business query personnel-change [--year YYYY] [--reason "原因"] [--company "公司全称"]` |
| 员工人事异动 | `business query personnel-change-by-employee --name "姓名" [--company "公司全称"]` |
| 奖惩 | `business query disciplinary [--name "姓名"] [--company "公司全称"]` |
| 用章 | `business query seal-usage [--company "公司全称"] [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--name "姓名"]` |

## Analysis Commands

| 类型 | 命令 |
|---|---|
| 人数和人员结构 | `business analyze headcount` |
| 员工质量和重复信息 | `business analyze employee-summary` |
| 合同覆盖率 | `business analyze contract-coverage` |
| 合同到期 | `business analyze contract-expiry --days 90` |
| 月度绩效 | `business analyze performance --month YYYY-MM [--company "公司全称"]` |
| 低绩效 | `business analyze low-performance --month YYYY-MM [--threshold 60] [--company "公司全称"]` |
| 社医保异动 | `business analyze insurance --month YYYY-MM [--company "公司全称"]` |
| 奖惩 | `business analyze disciplinary [--company "公司全称"]` |

## Write Workflow

写入类任务统一使用以下节奏：

1. 识别业务对象：organization、employee、contract、performance、insurance、
   personnel-change、disciplinary、seal-usage。
2. 根据用户文本或附件生成 JSON plan。
3. 运行 `business preview <resource> --input <plan.json>`。
4. 用业务语言说明将创建、跳过、需确认和存在风险的记录。
5. 等用户明确确认。
6. 运行 `business create <resource> --input <plan.json>`，或必要时运行
   `business delete employee --input <plan.json>`。
7. `create` 结果会包含 verification，模型不要再调用单独的 verify 命令。

常用写入命令：

公开命令只包含 preview 和 create；verify 是 create 内部步骤。

| 类型 | 预览 | 执行 |
|---|---|---|
| 组织和部门 | `business preview organization --input plan.json` | `business create organization --input plan.json` |
| 员工 | `business preview employee --input plan.json` | `business create employee --input plan.json` |
| 合同 | `business preview contract --input plan.json` | `business create contract --input plan.json` |
| 绩效 | `business preview performance --input plan.json` | `business create performance --input plan.json` |
| 社医保 | `business preview insurance --input plan.json` | `business create insurance --input plan.json` |
| 人事异动 | `business preview personnel-change --input plan.json` | `business create personnel-change --input plan.json` |
| 奖惩 | `business preview disciplinary --input plan.json` | `business create disciplinary --input plan.json` |
| 用章 | `business preview seal-usage --input plan.json` | `business create seal-usage --input plan.json` |

`business create` 和 `business delete` 会由 CLI 自动补内部确认语义；模型不要让业务用户理解底层 `--confirm` 短语。

## Result Handling

- 给 HR 或管理者回复时，不展示原始 JSON，除非用户要求技术细节。
- 报告类任务先写授权结果到 `.nanobot_channel_webui/artifacts/<chat_id>/`，
  再交给 Word、Excel、图表或浏览器技能消费。
- 不要让普通技能读取 HR runtime、policy、数据库配置或会话历史。
