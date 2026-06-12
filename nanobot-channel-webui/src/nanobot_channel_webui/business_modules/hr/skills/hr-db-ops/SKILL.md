---
name: "hr-db-ops"
description: "HR 写入和数据维护操作手册。Use only for preview/create/update/delete/import style HR tasks, confirmation workflows, cleanup requests, and maintenance operations through the WebUI business runtime."
---

# HR DB Ops

本技能只描述模型可使用的 HR 标准业务工具面。真实实现位于插件内
Python HR runtime，模型不要读取、导入或调用 runtime 内部文件。

## First Rule

在 WebUI 多实例会话中，模型默认使用结构化 `hr_business` 工具：

```text
hr_business(action="<list|get|analyze|preview|create|preview-update|update|delete|schema|capabilities>", resource="<resource|topic>", ...)
```

CLI 只作为人工排障和兼容 fallback，不要通过 `exec` 调用 HR business CLI：

```bash
nanobot-webui-business hr business <list|get|analyze|preview|create|preview-update|update|delete|schema|capabilities> <resource|topic> [options]
```

不要运行 `which`、`find`、`ls`、`cat` 或读取技能目录来寻找 CLI。不要访问
`runtime/`、`private/`、`policies/`、sessions、audit、数据库配置或底层连接信息。

## Execution Rules

- 默认使用 `hr_business` 工具，不优先使用 legacy 命令或 shell `exec`。
- 命令参数是严格校验的；不要猜测参数名。未知参数会被拒绝，`--input`、
  `--company`、`--days`、`--threshold` 等 value 参数必须带有效值。
- 不确定参数时先运行 `business capabilities` 或 `business help`，不要试错多个拼写。
- 裸 `list` 使用分页，默认 `page-size` 为 100；可用 `--page` 和 `--page-size` 翻页。
- 带业务过滤条件的 `list` 返回完整匹配结果；过滤列表不要使用 `--limit`。
- 所有 `list` 记录都会返回 `id`，后续精确读取使用 `business get <resource> --id <id>`。
- 默认省略 `--company`，让当前登录账号的 policy 自动限定授权公司范围。
- 只有用户明确要求某一家公司时才传 `--company "公司全称"`。
- 能用一个聚合命令回答时，不拆成多条明细查询。
- 概况、汇总、分析请求不要先拉取逐行员工明细。
- 人数、人员结构和合同覆盖率使用 `business analyze roster` / `business analyze contract-coverage`
  的 summary、groups、findings 和 consistency，不要从 records 自行计数。
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
- 除非用户明确要求回读、复查或二次查询，不要在成功 create/update/delete 后再自动运行读取命令做二次验证。
- create/update/delete 是逐条处理，不是数据库事务。若 CLI 返回 `ok:false` 且包含
  `partial_results` 和 `failed`，必须先说明哪些记录已经成功、存在或跳过，以及哪一条失败；
  不要盲目整批重试。
- 更新失败不能自动改走删除重建；删除重建必须等待用户单独明确确认，不能复用“确认修改”的确认语义。
- 删除是逻辑删除：普通 HR 账号在授权公司范围内、且具备对应资源 `delete` 权限时可以执行；不要把逻辑删除描述成只有管理员能做。
- `business list employee` 返回员工花名册主档字段和稳定 `id`；用户要单个员工完整信息时，先定位 id，再调用 `business get employee --id <id>`。

## About `id`

`id` 是 HR 表里最稳定的锚点；它在 list / get / update / delete plan 之间统一使用。

首选用法：

- list/get 拿到 id 后，update / delete plan 用 `match_id: "<id>"` 精确指认目标行。
- preview-update / delete 按 id 精确匹配，不会模糊命中多条。
- `business get <resource> --id <id>` 用于读取完整详情。

兼容用法：

- 智能体未先查询时仍可用旧业务键匹配，如 `match_phone`、`match_id_card_number`。
- 旧业务键可能命中多条或错条；如果已经拿到 id，必须用 `match_id`，不要降级。

新增 plan 不需要 `match_id`：记录还不存在，没有什么可匹配。

## Read Commands

| 类型 | 命令 |
|---|---|
| 公司 | `business list company` |
| 部门 | `business list department [--company "公司全称"]` |
| 员工列表 | `business list employee [--company "公司全称"] [--department "部门"] [--status "状态"] [--name "姓名"] [--id-card "证件号"] [--phone "手机号"]` |
| 员工详情 | `business get employee --id <id>` |
| 合同 | `business list contract [--company "公司全称"] [--employee "姓名"] [--type "类型"] [--expiry-before YYYY-MM-DD] [--expiry-after YYYY-MM-DD]` |
| 合同详情 | `business get contract --id <id>` |
| 绩效 | `business list performance --month YYYY-MM [--company "公司全称"] [--employee "姓名"]` |
| 绩效详情 | `business get performance-review --id <id>` |
| 社医保 | `business list insurance --month YYYY-MM [--company "公司全称"] [--employee "姓名"] [--status "状态"]` |
| 社医保详情 | `business get insurance-change --id <id>` |
| 人事异动 | `business list personnel-change [--year YYYY] [--reason "原因"] [--employee "姓名"] [--company "公司全称"]` |
| 人事异动详情 | `business get personnel-change --id <id>` |
| 奖惩 | `business list disciplinary [--employee "姓名"] [--penalty-type "类型"] [--year YYYY] [--company "公司全称"]` |
| 奖惩详情 | `business get disciplinary-record --id <id>` |
| 用章 | `business list seal-usage [--company "公司全称"] [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--applicant "姓名"]` |
| 用章详情 | `business get seal-usage --id <id>` |
| 逻辑删除审计 | `business list deleted-records --resource employee|contract|performance|insurance|personnel-change|disciplinary|seal-usage [--company "公司全称"]` |

裸 `list` 用 `--page-size N` 控制每页明细数量；返回中的 `pagination.total` 是匹配总数，
`records` 只包含当前页。

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

## Write Workflow

### 新增（create）

1. 识别业务对象：organization、employee、contract、performance、insurance、
   personnel-change、disciplinary、seal-usage。
2. 运行 `business schema <resource> --workflow create`。例如 `business schema performance --workflow create`。根据返回的 `fields`、`accepted_aliases` 和 `plan_example` 生成 JSON plan。
3. 根据用户文本或附件生成 JSON plan；新增 plan 不写 `match_id`。从自然语言提取姓名、公司、部门、岗位等字段时，必须保持用户原文值，不要为了“像姓名”而截断长姓名或测试姓名。
4. 运行 `business preview <resource> --input <plan.json>`。
   - 如果用户是在新增员工相关记录，例如新增合同、绩效、社医保、人事异动、奖惩或用章，即使员工主档已经存在，也仍然是该子资源的新增，必须使用 `preview/create`。
5. 用业务语言说明 preview 实际返回的将创建、跳过、需确认和存在风险的记录；对用户只说“拟录入信息”，不要说内部 `CLI`、`preview`、`预览`、`系统预览`。
6. 等用户明确确认。
7. 运行 `business create <resource> --input <plan.json>`。

### 更新 / 删除（id-centric）

1. 识别业务对象。
2. 运行 `business schema <resource> --workflow update`。例如 `business schema seal-usage --workflow update`。
3. 定位目标记录：
   - 已知 id（来自前一轮 list/get）→ 直接进入下一步。
   - 未知 id → `business list <resource> --filter` 缩小范围。
   - 单条命中 → 使用该行 id；多条命中 → 展示候选让用户挑；零条命中 → 告诉用户找不到，不要降级到 create。
4. 写 plan：`{"match_id": "<id from step 3>", ...新值字段}`。
5. 更新运行 `business preview-update <resource> --input <plan.json>`；删除没有单独 preview 命令，必须先用 list/get 定位唯一 id，再把拟删除记录给用户确认。
6. 用业务语言说明拟更新或拟删除信息；更新确认信息必须来自 preview-update 结果，删除确认信息必须来自 list/get 定位结果。
7. 等用户明确确认。
8. 运行 `business update <resource> --input <plan.json>` 或 `business delete <resource> --input <plan.json>`。

为什么先查再写：plan 用 `match_id` 后，CLI 按 id 精确匹配，不会再有“匹配多条 / 匹配错条”风险。

通用要求：只写一次 JSON plan 文件；如果 preview 返回 plan 结构错误，再按错误信息修改同一个文件一次；不要连续尝试多种 wrapper 格式。create/update/delete 结果会包含 verification 或写入结果，不要再调用单独的 verify 命令；除非用户明确要求回读，不要再自动调用读取命令做二次验证。

## Conversational Workflow Recipes

当用户使用 HR 口语动作时，先按下面的原子资源拆解，不要自由拼装隐藏命令：

| 口语动作 | 原子资源和节奏 |
|---|---|
| 入职 | employee create |
| 转正 | list/get employee 拿 id → employee update plan 使用 match_id；后接 personnel-change create |
| 续签 | contract create；续签是新增合同，不要覆盖旧合同 |
| 内部调动 | list/get employee 拿 id → employee update plan 使用 match_id；后接 personnel-change create |
| 离职 | list/get employee 拿 id → employee update plan 使用 match_id；如涉及停缴，再追加 insurance create |

每个原子资源都遵循 `schema -> preview 或 preview-update -> 用户确认 -> create/update/delete`
节奏。其他业务动作（如补录、调薪、绩效追评、单纯调岗等）也按 8 个原子资源拆解：
organization、employee、contract、performance、insurance、personnel-change、disciplinary、
seal-usage。多资源联动时分别按各自节奏跑，不要试图把多个资源合并成一个 plan。

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

## Error Recovery

CLI 返回 `ok:false` 时，按错误类型差异化处理：

| 错误形态 | 含义 | 处理 |
|---|---|---|
| `结果集超过 5000 行...suggested_filters: --company, --department, ...` | 过滤太宽 | 按 suggested_filters 加 filter 重试；不要退到裸 list，裸 list 没 filter，结果更宽 |
| `带过滤的 list 不支持 --limit` | 误用 `--limit` | 移除 `--limit`；如果想限制返回行数，改用裸 list + `--page-size` |
| `当前账号无权访问公司数据` | 跨权限边界 | 告诉用户该 id 对应的记录不在当前授权公司范围；不要重试、不要换命令 |
| `指定 id 不存在、已删除或无权访问` | `match_id` 找不到 / 越权 / 已删 | 让用户重新 list 拿当前 id；不要试探不同 id 推断原因 |
| `<resource> record not found` | id 不存在 | 让用户确认 id；可先 list 再次确认 id |
| `Option --page-size must be between 1 and 500` | 参数越界 | 调整 `--page-size` 到合法范围，默认 100 |
| `partial_results` + `failed` | 批量逐条失败 | 必须先汇报哪些成功、已存在、跳过，再处理失败那条；不要盲目整批重试 |

错误信息已经是给模型读的；不要忽略错误文案，不要兜底换命令，不要把错误吞掉只回“查询失败”。

## Result Handling

- 给 HR 或管理者回复时，不展示原始 JSON，除非用户要求技术细节。
- 报告类任务先写授权结果到 `.nanobot_channel_webui/artifacts/<chat_id>/`，
  再交给 Word、Excel、图表或浏览器技能消费。
- 不要让普通技能读取 HR runtime、policy、数据库配置或会话历史。
