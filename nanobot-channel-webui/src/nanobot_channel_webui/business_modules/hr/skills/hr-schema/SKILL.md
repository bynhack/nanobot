---
name: hr-schema
description: >
  Human-resources database schema skill. Use when the task needs understanding of
  HR tables, fields, Excel column mapping, required fields, foreign-key
  relationships, uniqueness, cascade risk, or Supabase Storage buckets before
  querying, importing, or writing HR data.
---

# HR Schema

This skill is the source of truth for HR database meaning. It explains what the
data is, where it belongs, and how tables relate. It does not execute database
writes.

## Read Order

Load only what the task needs:

1. `references/schema-summary.md` for table groups, core relationships, and
   high-level import decisions.
2. `references/database-schema-zh.md` for field meanings, Excel column mapping,
   business notes, and Storage bucket mapping.
3. `references/all-migrations-zh.sql` only for exact constraints, triggers, RLS,
   defaults, indexes, or cascade behavior.

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
