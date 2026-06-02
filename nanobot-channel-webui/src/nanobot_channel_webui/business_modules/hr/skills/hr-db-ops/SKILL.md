---
name: hr-db-ops
description: >
  Deterministic HR database operation scripts built on the local Supabase
  connector. Use for common HR database reads, matching, counts, cleanup,
  and future import previews/apply flows instead of writing ad-hoc Supabase
  queries.
---

# HR DB Ops

This skill provides stable database operations on top of the WebUI plugin's
private Supabase runtime. Prefer these scripts for common HR operations to
reduce ad-hoc query variation.

## Rules

- Use `hr-schema` first when the task needs field or relationship meaning.
- Use `hr-policy` before any write, import, clear, or delete operation.
- Use these scripts instead of creating one-off database scripts.
- Never print secrets from `.env`.
- In WebUI sessions, honor the injected `NANOBOT_WEBUI_POLICY_FILE`. The CLI
  enforces the tenant-runtime contract in `tenant-runtime.json`; do not bypass
  it with low-level database scripts.
- In WebUI scoped sessions, treat the `capabilities` declared in
  `tenant-runtime.json` as the business action catalog. Prefer one capability
  command that returns a complete structured result. Do not probe low-level or
  global commands after a capability denial.
- Prefer the standard business CLI surface in WebUI sessions:
  `business query <resource>`, `business get <resource>`, and
  `business analyze <topic>`. These commands are stable capability adapters
  over the repository layer and apply the current account's company scope.
- For scoped analysis, use scope-aware analysis commands such as
  `employee-summary`, `analyze-headcount`, `analyze-contract-coverage`, and
  `analyze-contract-expiry`; these automatically limit results to the current
  user's authorized companies when `--company` is omitted.


## Data Entry Workflow

For create, update, import, or cleanup requests, `hr-db-ops` owns the stable
business workflow. Do not depend on a separate workflow skill for HR writes.

1. Classify the target business object: employee, contract, performance,
   insurance change, personnel change, disciplinary record, seal usage, or
   organization data.
2. Build a structured JSON plan and preserve source evidence from user text or
   files.
3. Run the minimum deterministic checks needed for safety: company, department,
   parent employee, duplicate identity, and existing business records.
4. Present a concise business preview and wait for explicit user confirmation.
5. Write the confirmed plan under `.nanobot_channel_webui/runtime-inputs/<chat_id>/`.
6. Run the matching `business create ... --input <plan.json> --confirm ...`
   command.
7. Run the matching `business verify ... --input <same-plan.json>` command and
   report created, updated, unchanged, skipped, and review-required records.

For outputs that should be consumed by Word, Excel, browser, chart, or report
skills, write only authorized results under
`.nanobot_channel_webui/artifacts/<chat_id>/`. Other skills should consume those
artifacts rather than reading HR database internals.

## Business capabilities

The capability catalog is the supported surface for model-driven business
queries and analysis:

- `hr.company.list`: `business query companies`
- `hr.employee.overview`: `business analyze headcount`,
  `business analyze employee-summary`
- `hr.employee.roster`: `list-employees --company`, `employee-detail --company`,
  `find-employee`, `find-employee-like`, `business query employee`,
  `business get employee`
- `hr.contract.employee_lookup`: `business query employee-contracts`,
  `business query employee-timeline`
- `hr.contract.analysis`: `business analyze contract-coverage`,
  `business analyze contract-expiry --days <N>`
- `hr.performance.analysis`: performance query and analysis commands
- `hr.insurance.analysis`: insurance query and analysis commands
- `hr.risk.disciplinary`: disciplinary, seal usage, and personnel-change query
  commands

When the user asks a combined business question, choose the smallest set of
capability commands that answers it. Do not assemble conclusions from guessed
employee names or unrelated low-level probes.

## CLI

Run commands with:

```bash
nanobot-webui-business hr <command> [options]
```

Discover available commands with:

```bash
nanobot-webui-business hr help
```

Available commands:

- `business query companies`: list companies visible to the current account.
- `business query employee [--company "公司全称"] [--status active]`: query
  employee roster. In scoped WebUI sessions, omitting `--company` queries only
  the current account's authorized companies.
- `business get employee --name "姓名" [--company "公司全称"]`: get one
  employee's master-data detail after a unique match.
- `business query employee-contracts --name "姓名" [--company "公司全称"]`: list
  one employee's contracts.
- `business query employee-timeline --name "姓名" [--company "公司全称"]`: show one
  employee's joined HR lifecycle timeline.
- `business query departments [--company "公司全称"]`: list departments.
- `business get department --company "公司全称" --department "部门名称"`: get a
  department match.
- `business query performance --month 2026-03 [--company "公司全称"]`: list
  monthly performance records.
- `business query performance-by-employee --name "姓名" [--company "公司全称"]`:
  list one employee's performance records.
- `business query insurance --month 2026-03 [--company "公司全称"]`: list monthly
  insurance changes.
- `business query insurance-by-employee --name "姓名" [--company "公司全称"]`: list
  one employee's insurance changes.
- `business query personnel-change [--year 2026] [--reason "转正"] [--company "公司全称"]`:
  list personnel changes.
- `business query personnel-change-by-employee --name "姓名" [--company "公司全称"]`:
  list one employee's personnel changes.
- `business query disciplinary --name "姓名" [--company "公司全称"]`: list one
  employee's disciplinary records.
- `business query seal-usage [--company "公司全称"] [--from 2026-04-01] [--to 2026-04-30] [--name "姓名"]`:
  list seal usage records.
- `business analyze headcount`: analyze headcount using the current account's
  authorized data scope.
- `business analyze employee-summary`: summarize employees by company, status,
  and department using the current account's authorized data scope.
- `business analyze contract-coverage`: analyze active employee contract
  coverage using the current account's authorized data scope.
- `business analyze contract-expiry --days 180`: analyze upcoming contract
  expiry using the current account's authorized data scope.
- `business analyze performance --month 2026-03 [--company "公司全称"]`: analyze
  monthly performance.
- `business analyze low-performance --month 2026-03 [--threshold 60] [--company "公司全称"]`:
  list low performance records.
- `business analyze insurance --month 2026-03 [--company "公司全称"]`: analyze
  monthly insurance changes.
- `business analyze disciplinary [--company "公司全称"]`: analyze disciplinary
  records and missing signed attachments.
- `business create employee --input employees_preview.json --confirm 导入员工主档`:
  create employee master records from a confirmed preview plan.
- `business verify employee --input employees_preview.json`: verify employee
  master data after import.
- `business create contract --input contracts_preview.json --confirm 导入合同`:
  create contract records from a confirmed preview plan.
- `business verify contract --input contracts_preview.json`: verify contract
  records after import.
- `business preview performance --input performance_parsed_raw.json`: preview
  performance import matching.
- `business create performance --input performance_import_clean.json --confirm 导入绩效`:
  import performance records.
- `business verify performance --input performance_import_clean.json`: verify
  performance records.
- `business preview insurance --input insurance_preview_unmatched.json`: preview
  insurance import matching.
- `business create insurance --input insurance_preview.json --confirm 导入社医保异动`:
  import insurance changes.
- `business verify insurance --input insurance_preview.json`: verify insurance
  changes.
- `business create personnel-change --input personnel_changes_import_clean.json --confirm 导入人事异动`:
  import personnel changes.
- `business verify personnel-change --input personnel_changes_import_clean.json`:
  verify personnel changes.
- `business create disciplinary --input disciplinary_import_clean.json --confirm 导入奖惩记录`:
  import disciplinary records.
- `business verify disciplinary --input disciplinary_import_clean.json`: verify
  disciplinary records.
- `business create disciplinary-attachment --input disciplinary_attachment_backfill_plan.json --confirm 回填奖惩附件`:
  backfill disciplinary attachments.
- `business verify disciplinary-attachment --input disciplinary_attachment_backfill_plan.json`:
  verify disciplinary attachments.
- `business create seal-usage --input seal_usage_import_clean.json --confirm 导入用章记录`:
  import seal usage records.
- `business verify seal-usage --input seal_usage_import_clean.json`: verify seal
  usage records.
- `business create organization --input org-plan.json --confirm 创建公司和部门`:
  create organization and department seeds.
- `business update employee-nickname --input name_nickname_cleanup_plan.json --confirm 清理员工姓名花名`:
  update employee names/notes from a confirmed cleanup plan.
- `business delete employee --input employee_delete_plan.json --confirm 删除员工记录`:
  delete employee records only when the current policy has delete permission and
  the plan is explicitly confirmed.
- `count-all`: count all business tables.
- `clear-business-data --confirm 清空人事业务数据`: clear all HR business data in
  child-to-parent order.
- `list-companies`: list company names and short names.
- `list-departments --company "公司全称"`: list departments for a company.
- `find-company --name "公司全称"`: find a company by full name.
- `find-department --company "公司全称" --department "部门名称"`: find a department.
- `find-employee --id-card "证件号"`: find an employee by identity document.
- `find-employee --phone "手机号"`: find an employee by phone.
- `find-employee --name "姓名" --company "公司全称" --department "部门名称"`:
  find employee candidates using weaker business matching.
- `employee-summary [--company "公司全称"]`: summarize employees. In scoped WebUI
  sessions, omitting `--company` summarizes all companies currently authorized
  for the logged-in account.
- `employee-detail --name "姓名" --company "公司全称"`: show one employee's
  master-data detail after a unique match.
- `employee-timeline --name "姓名" --company "公司全称"`: show one employee's
  contracts, performance, insurance changes, personnel changes, and
  disciplinary records together.
- `contracts-by-employee --name "姓名" --company "公司全称"`: list one employee's
  contracts.
- `performance-by-employee --name "姓名" --company "公司全称"`: list one
  employee's performance records.
- `performance-by-month --month 2026-03 --company "公司全称"`: list performance
  records in a month, optionally filtered by company.
- `insurance-by-employee --name "姓名" --company "公司全称"`: list one employee's
  insurance-change records.
- `insurance-by-month --month 2026-03 --company "公司全称"`: list insurance
  changes in a month, optionally filtered by company.
- `personnel-changes-by-employee --name "姓名" --company "公司全称"`: list one
  employee's personnel-change records.
- `disciplinary-by-employee --name "姓名" --company "公司全称"`: list one
  employee's disciplinary records.
- `seal-usage-list --company "公司全称" --from 2026-04-01 --to 2026-04-30`:
  list seal-usage records, optionally filtered by company, date range, or
  employee name.
- `pending-review-list`: list records currently kept for HR confirmation.
- `data-quality-check`: summarize counts, employee master-data quality checks,
  employees without contracts, and pending HR review counts.
- `analyze-headcount`: analyze headcount by company, department, and status,
  with master-data quality flags.
- `analyze-contract-coverage`: analyze active employee contract coverage and
  contract type distribution.
- `analyze-contract-expiry --days 90`: list non-permanent contracts expiring in
  the next N days.
- `analyze-performance-month --month 2026-03 --company "公司全称"`: summarize
  monthly performance scores and performance pay, optionally by company.
- `analyze-low-performance --month 2026-03 --threshold 60 --company "公司全称"`:
  list performance records below a threshold.
- `analyze-insurance-month --month 2026-03 --company "公司全称"`: summarize
  monthly insurance adds/removes and status distribution.
- `analyze-disciplinary --company "公司全称"`: summarize disciplinary records by
  company and penalty type, including missing signed attachments.
- `analyze-hr-risk-dashboard`: combined HR risk dashboard covering counts,
  headcount quality, contract coverage/expiry, disciplinary attachments, and
  pending HR confirmations.
- `employee-summary`: summarize employee master data by company, status, and
  department, and report empty departments, empty identity documents, duplicate
  identity documents, and duplicate phones.
- `employees-without-contracts`: list employee master records that do not have
  any contract record, summarized by company and status.
- `apply-org-seeds --input org-plan.json --confirm 创建公司和部门`: create missing
  companies and departments from a confirmed organization seed plan.
- `delete-empty-departments --input department-delete-plan.json --confirm 删除空部门`:
  delete only departments with no employees attached.
- `apply-employees --input employees_preview.json --confirm 导入员工主档`:
  create employees from a confirmed preview plan. Existing employees are skipped.
  For confirmed cross-company history for the same person, a record may set
  `allow_duplicate_identity: true` so matching uses name plus company instead of
  blocking on an existing identity document in another company.
- `verify-employees --input employees_preview.json`: compare every imported
  employee field in the preview plan against the saved database row.
- `delete-employee-records --input employee_delete_plan.json --confirm 删除员工记录`:
  delete exactly matched employee records from a confirmed cleanup plan. The
  command skips employees with child business records unless the plan explicitly
  allows child deletion.
- `verify-employee-deletions --input employee_delete_plan.json`: verify that
  employee cleanup records no longer exist.
- `apply-contracts --input contracts_preview.json --confirm 导入合同`:
  create contract records from a confirmed preview plan. Existing matching
  contracts are skipped.
- `verify-contracts --input contracts_preview.json`: compare every imported
  contract field in the preview plan against the saved database row.
- `preview-performance-reviews --input performance_parsed_raw.json`: match
  parsed performance-review rows to employee master records and summarize rows
  that are matched, unmatched, or ambiguous.
- `apply-performance-reviews --input performance_import_clean.json --confirm 导入绩效`:
  create matched performance-review records from a confirmed preview plan.
- `verify-performance-reviews --input performance_import_clean.json`: compare
  every imported performance-review field in the preview plan against the saved
  database row.
- `preview-insurance-changes --input insurance_preview_unmatched.json`: match
  parsed insurance-change rows to employee master records and summarize rows
  that are matched, unmatched, ambiguous, or have parse issues.
- `apply-insurance-changes --input insurance_preview.json --confirm 导入社医保异动`:
  create matched insurance-change records from a confirmed preview plan.
- `verify-insurance-changes --input insurance_preview.json`: compare every
  imported insurance-change field in the preview plan against the saved database
  row.
- `apply-personnel-changes --input personnel_changes_import_clean.json --confirm 导入人事异动`:
  create matched personnel-change records from a confirmed preview plan.
- `verify-personnel-changes --input personnel_changes_import_clean.json`: compare
  every imported personnel-change field in the preview plan against the saved
  database row.
- `apply-employee-nickname-cleanup --input name_nickname_cleanup_plan.json --confirm 清理员工姓名花名`:
  update employee names to remove parenthesized nicknames and move nicknames to
  employee notes from a confirmed cleanup plan.
- `verify-employee-nickname-cleanup --input name_nickname_cleanup_plan.json`:
  compare cleaned employee names and notes against the saved database rows.
- `apply-disciplinary-records --input disciplinary_import_clean.json --confirm 导入奖惩记录`:
  create matched disciplinary records from a confirmed preview plan.
- `verify-disciplinary-records --input disciplinary_import_clean.json`: compare
  every imported disciplinary record field in the preview plan against the saved
  database row.
- `apply-disciplinary-attachments --input disciplinary_attachment_backfill_plan.json --confirm 回填奖惩附件`:
  create or reuse the HR document bucket, upload extracted disciplinary signed
  images, and update imported disciplinary records with Storage paths.
- `verify-disciplinary-attachments --input disciplinary_attachment_backfill_plan.json`:
  compare disciplinary attachment paths against saved rows and verify each
  Storage object can be downloaded.
- `apply-seal-usage --input seal_usage_import_clean.json --confirm 导入用章记录`:
  create matched seal-usage records from a confirmed preview plan.
- `verify-seal-usage --input seal_usage_import_clean.json`: compare every
  imported seal-usage field in the preview plan against the saved database row.

Organization source scan:

```bash
python3 skills/hr-db-ops/scripts/scan_org_sources.py --json
```

Department seeds come only from visible active/resigned roster sheets, not
hidden sheets or personnel change sheets. Personnel change sheets are parsed
later as business records.

## Repository

For custom code that still needs stable building blocks, import:

```js
import { HrRepository } from "./scripts/hr_repository.mjs";
```

Prefer repository functions such as `countAllTables()`,
`findCompanyByName()`, `findDepartment()`, `findEmployeeByIdCard()`,
`findEmployeeByPhone()`, `findEmployeeCandidates()`, and
`clearBusinessData({ confirm })`.
