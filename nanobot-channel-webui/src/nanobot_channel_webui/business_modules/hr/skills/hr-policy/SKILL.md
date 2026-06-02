---
name: hr-policy
description: >
  Human-resources data operation policy. Use for HR reads, writes, imports,
  deletes, matching ambiguity, attachment handling, confirmation summaries, and
  user-facing wording rules.
---

# HR Policy

This skill controls how HR data may be operated on. It is the safety layer above
schema understanding and database tooling.

## Read vs Write

- Read-only requests can be executed directly.
- Create, update, import, invalidate, clear, and delete actions require explicit
  user confirmation before execution.
- If a write is incomplete, ambiguous, or risky, ask for only the missing
  business information needed to continue.
- Do not guess HR facts.

## Matching Rules

- Prefer identity document number for employee matching.
- If no identity document number exists, use phone number.
- If neither exists, use weaker matches such as name plus company and/or
  department.
- If multiple records can match, stop and present candidates for user
  confirmation.

## Update Rules

- Read the existing record before updating.
- Compare incoming values field by field.
- If there is no effective change, do not write.
- Do not manually set audit timestamps maintained by the database.
- Prefer reversible status changes over hard deletion unless the user is very
  explicit.

## Import Workflow

For imports:

1. Parse the source data.
2. Use `hr-schema` to map columns to business objects and fields.
3. Use `HR business module` read/preview commands for deterministic matching where
   available.
4. Produce a concise confirmation summary.
5. Execute writes only after the user confirms the summary.

Confirmation summaries should show:

- Goal.
- Records to create.
- Records to update.
- Records checked with no changes.
- Records that cannot be matched or require a decision.

## Attachments

If a user indicates that an attachment is the source of truth for import or
structured entry, parse it before asking for missing fields that may already be
inside it. If the attachment is only context, treat it as reference material.

## User-Facing Style

The audience is HR staff and management:

- Start with a short conclusion.
- Use business language by default.
- Do not expose database IDs, raw JSON, SQL, or internal field names unless the
  user asks for technical detail.
