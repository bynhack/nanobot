---
name: hr-query-analysis-router
description: >
  Route HR natural-language read, query, summary, analysis, dashboard, risk,
  and reporting questions to deterministic HR business module query and analysis
  commands. Use when HR staff ask questions such as employee detail, contract
  status, performance analysis, insurance changes, pending confirmations,
  headcount, risk dashboard, or data quality. Read-only by default.
---

# HR Query Analysis Router

This skill maps HR staff's natural-language read and analysis questions to
stable `HR business module` commands. It is read-only. For create, update, delete, import,
or cleanup requests, use `hr-data-entry-workflow` instead.

## Required Order

1. Identify whether the request is read-only or write-like.
2. If read-only, choose the closest deterministic `HR business module` query or analysis
   command.
3. If the user asks for a report-style answer, run one or more commands and
   synthesize in business language.
4. If no wrapper exists, prefer adding a reusable `HR business module` query wrapper
   before using low-level ad-hoc Supabase access.
5. In WebUI sessions, rely on the injected tenant policy and the
   `tenant-runtime.json` contract. Do not use memory, files, or raw database
   access to infer or bypass company scope.

## Routing Map

Use `references/query-routing-map.md` for command mapping and examples.

## Response Rules

- Use HR/business language by default.
- Do not expose raw IDs, SQL, JSON, or internal field names unless the user
  explicitly asks.
- If the match is ambiguous, show the candidate employees and ask the user to
  clarify.
- For large result sets, summarize first and show the most relevant records.
- Mention the command-level limitation only when it affects the answer.
- For analysis, lead with the conclusion, then show supporting figures and
  action items.

## Common Patterns

- "我管理的公司 / 我负责的公司": first use `list-companies` to read the current
  account's scoped companies. For employee overview, use `employee-summary`
  without `--company`; under scoped WebUI accounts it returns only the authorized
  company scope. Do not search memory, user files, or low-level workspace files
  to infer identity.
- "查某个人": resolve by ID card, phone, or name/company, then use
  `employee-detail` or `employee-timeline`.
- "有没有合同 / 合同什么时候到期": use `contracts-by-employee`,
  `analyze-contract-coverage`, or `analyze-contract-expiry`.
- "绩效怎么样 / 低绩效有哪些": use `performance-by-employee`,
  `analyze-performance-month`, or `analyze-low-performance`.
- "这个月社保增减员": use `insurance-by-month` or
  `analyze-insurance-month`.
- "还有哪些要人事确认 / 有什么风险": use `pending-review-list`,
  `data-quality-check`, or `analyze-hr-risk-dashboard`.
