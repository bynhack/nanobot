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
nanobot-webui-business hr business <query|get|analyze|preview|create|preview-update|update|delete> <resource|topic> [options]
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
- 写入、删除、导入、清理必须先 preview，向用户确认后再 create、update 或 delete；create/update/delete 返回结果已经包含内部 verification。
- 写入或更新具体资源前，先运行 `business schema <resource> --workflow create|update` 获取这个资源的 plan 字段定义、字段解释、可接受别名和示例；不要为了写常规 plan 先读取长篇 `hr-schema`。
- `hr-schema` 是字段排查兜底：只有遇到 schema 命令无法覆盖的约束、迁移、跨表映射或技术排查时才读取。
- 确认前必须已经完成业务 preview：先写 JSON plan，再运行 `business preview` 或 `business preview-update`，再基于 CLI preview 的实际返回请求用户确认。
- 不要只根据用户原始文本口头列字段就请求确认；没有 CLI preview 结果时，不能要求用户确认 create/update。
- 必须把 preview 返回的 records、matched、skipped、diffs 或风险摘要展示给用户确认，而不是只展示模型自己整理的字段清单。
- 对业务用户不要暴露 `CLI`、`preview`、`预览`、`系统预览` 等内部术语；应表达为“请确认以下拟录入信息”或“请确认以下拟更新信息”。
- 写入流程中的任何可见回复都不能说“预览”；如果需要说明正在处理，只说“我先整理拟录入信息”或“我先整理拟更新信息”。
- 多资源写入或更新也一样适用：不要说“所有预览都通过了”，不要用英文暴露内部 preview 过程，只说“以下拟录入信息已整理完成，请确认”或“以下拟更新信息已整理完成，请确认”。
- 员工姓名必须按用户原文完整保留；例如“新增员工张三”“新增员工：张三”“员工叫张三”中的姓名片段都不能被截断、改写或自行缩短。不确定姓名边界时，先把拟录入姓名展示给用户确认，不要执行 create/update。
- 新增记录必须走 `business preview <resource>` → 用户确认 → `business create <resource>`；不要用 `preview-update/update` 创建不存在的记录。
- 修改已有记录必须走 `business preview-update <resource>` → 用户确认 → `business update <resource>`；`preview-update` 应匹配到唯一已有记录。
- 除非用户明确要求回读、复查或二次查询，不要在成功 create/update/delete 后再自动运行 get/query/analyze 做二次验证。
- 更新失败不能自动改走删除重建；删除重建必须等待用户单独明确确认，不能复用“确认修改”的确认语义。
- 删除是逻辑删除：普通 HR 账号在授权公司范围内、且具备对应资源 `delete` 权限时可以执行；不要把逻辑删除描述成只有管理员能做。
- `business query employee` 返回员工花名册完整主档字段；用户要“员工所有信息”“花名册明细”时不要再逐个调用 `business get employee`。

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
| 逻辑删除审计 | `nanobot-webui-business hr business query deleted-records --resource <resource>` |

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
| 逻辑删除审计 | `business query deleted-records --resource employee|contract|performance|insurance|personnel-change|disciplinary|seal-usage [--company "公司全称"]` |

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
2. 运行 `business schema <resource> --workflow create|update`。例如 `business schema performance --workflow create`、`business schema seal-usage --workflow update`。根据返回的 `fields`、`accepted_aliases` 和 `plan_example` 生成 JSON plan。
3. 根据用户文本或附件生成 JSON plan。只写一次 JSON plan 文件，优先使用下面的扁平对象结构；如果一次包含多条记录，再使用 `{"records":[...]}`。
   - 从自然语言提取姓名、公司、部门、岗位等字段时，必须保持用户原文值，不要为了“像姓名”而截断长姓名或测试姓名。
4. 新增数据运行 `business preview <resource> --input <plan.json>`；更新数据运行
   `business preview-update <resource> --input <plan.json>`。
   - 如果用户是在新增员工相关记录，例如新增合同、绩效、社医保、人事异动、奖惩或用章，即使员工主档已经存在，也仍然是该子资源的新增，必须使用 `preview/create`。
   - 只有用户要修改已存在的合同、绩效、社医保、人事异动、奖惩或用章记录时，才使用 `preview-update/update`。
   - 如果 preview 返回 plan 结构错误，再按错误信息修改同一个文件一次；不要连续尝试多种 wrapper 格式。
   - 如果更新匹配失败，向用户说明失败并请求补充唯一匹配条件；不要自行尝试 delete/create。
5. 用业务语言说明 preview 实际返回的将创建或更新、跳过、需确认和存在风险的记录；确认信息必须来自 preview 结果，但对用户只说“拟录入信息”或“拟更新信息”，不要说内部 `CLI`、`preview`、`预览`、`系统预览`。
6. 等用户明确确认。
7. 运行 `business create <resource> --input <plan.json>`、
   `business update <resource> --input <plan.json>`，或必要时运行
   `business delete <resource> --input <plan.json>`。
8. `create`、`update` 和 `delete` 结果会包含 verification 或写入结果，模型不要再调用单独的 verify 命令；除非用户明确要求回读，不要再自动调用 get/query/analyze 做二次验证。

最小 JSON plan 示例：

```json
{
  "company": "公司全称",
  "name": "张三",
  "department": "行政部",
  "position": "人事专员",
  "phone": "13800000000",
  "hire_date": "2026-06-10",
  "employment_status": "在职",
  "employee_type": "正式"
}
```

```json
{
  "company": "公司全称",
  "employee_name": "张三",
  "type": "固定期限",
  "start_date": "2026-06-10",
  "expiry_date": "2029-06-09"
}
```

常用写入命令：

公开命令包含 preview/create 和 preview-update/update；verify 是 create/update 内部步骤。

| 类型 | 新增预览 | 新增执行 | 更新预览 | 更新执行 |
|---|---|---|---|---|
| 组织和部门 | `business preview organization --input plan.json` | `business create organization --input plan.json` | `business preview-update organization --input plan.json` | `business update organization --input plan.json` |
| 员工 | `business preview employee --input plan.json` | `business create employee --input plan.json` | `business preview-update employee --input plan.json` | `business update employee --input plan.json` |
| 合同 | `business preview contract --input plan.json` | `business create contract --input plan.json` | `business preview-update contract --input plan.json` | `business update contract --input plan.json` |
| 绩效 | `business preview performance --input plan.json` | `business create performance --input plan.json` | `business preview-update performance --input plan.json` | `business update performance --input plan.json` |
| 社医保 | `business preview insurance --input plan.json` | `business create insurance --input plan.json` | `business preview-update insurance --input plan.json` | `business update insurance --input plan.json` |
| 人事异动 | `business preview personnel-change --input plan.json` | `business create personnel-change --input plan.json` | `business preview-update personnel-change --input plan.json` | `business update personnel-change --input plan.json` |
| 奖惩 | `business preview disciplinary --input plan.json` | `business create disciplinary --input plan.json` | `business preview-update disciplinary --input plan.json` | `business update disciplinary --input plan.json` |
| 用章 | `business preview seal-usage --input plan.json` | `business create seal-usage --input plan.json` | `business preview-update seal-usage --input plan.json` | `business update seal-usage --input plan.json` |

常用逻辑删除命令：

| 类型 | 删除执行 |
|---|---|
| 员工 | `business delete employee --input plan.json` |
| 合同 | `business delete contract --input plan.json` |
| 绩效 | `business delete performance --input plan.json` |
| 社医保 | `business delete insurance --input plan.json` |
| 人事异动 | `business delete personnel-change --input plan.json` |
| 奖惩 | `business delete disciplinary --input plan.json` |
| 用章 | `business delete seal-usage --input plan.json` |

`business create`、`business update` 和 `business delete` 会由 CLI 自动补内部确认语义；模型不要让业务用户理解底层 `--confirm` 短语。`business delete` 只设置 `is_deleted = true`，不会物理删除数据库记录。

## Result Handling

- 给 HR 或管理者回复时，不展示原始 JSON，除非用户要求技术细节。
- 报告类任务先写授权结果到 `.nanobot_channel_webui/artifacts/<chat_id>/`，
  再交给 Word、Excel、图表或浏览器技能消费。
- 不要让普通技能读取 HR runtime、policy、数据库配置或会话历史。
