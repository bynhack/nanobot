---
name: "hr-schema"
description: "HR 数据结构解释技能。Use only for 字段映射、Excel 导入规划、必填字段、外键关系、唯一性、级联风险、约束、触发器、索引或 Supabase Storage bucket 解释；不是普通 HR 信息请求入口。"
---

# HR Schema

本技能只负责解释 HR 数据含义、字段归属和表关系。它不是查询入口，也不是权限入口；
查询和分析使用 `hr-query-analysis-router`，写入、导入和删除使用 `hr-db-ops`。
日常 create/update 写 plan 时，优先通过 `hr_business(action="schema", resource="<resource>", workflow="create|update")`
获取资源级 plan 契约；本技能是字段排查兜底。

## Read Order

Load only what the task needs:

1. `references/schema-summary.md` for table groups, core relationships, and
   high-level import decisions.
2. `references/database-schema-zh.md` for field meanings, Excel column mapping,
   business notes, and Storage bucket mapping.
3. `references/all-migrations-zh.sql` only for exact constraints, triggers, RLS,
   defaults, indexes, or cascade behavior.

## Boundaries

- 不运行 CLI，不执行 SQL，不直接访问 Supabase 或数据库。
- 不要读取 runtime、scripts、tenant-runtime、policy、会话、audit 或 private 文件。
- 不根据 schema 推断用户能看哪些公司；公司范围由标准业务 CLI 和 policy 自动过滤。
- 只有在做字段映射、导入规划、约束解释或技术排查时，才展示表名和字段名。

## Schema Responsibilities

Use this skill to answer:

- Which HR object a source column belongs to.
- Whether a field is part of employee master data or a child business record.
- Which parent record must exist before a child record can be imported.
- Which business fields identify an existing company, department, employee,
  job posting, or child record.
- Which deletes can cascade.
- Which fields store files and which Storage bucket they use.

## Core Matching Facts

- Company: match by full company name.
- Department: match by company plus department name.
- Employee: match by identity document number first, phone second, then name
  plus company and/or department.
- Employee child records: import only after an employee is confidently matched
  or created.
- Recruiting: import or match the job posting before importing interviews.
- Seal usage: applicant and seal user are two distinct employee references.

## Output

When talking to HR staff, translate schema facts into business terms. Show raw
table names and field names only when the user asks for technical detail or when
building/importing a technical mapping.
