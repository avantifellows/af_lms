---
name: merge-roster-changes
description: Resolve overlapping school and centre roster changes without losing SQL bindings.
last_updated: 2026-09-07
---

# Merge roster changes

Read `context/architecture.md` and `context/student-addition.md`. Inspect both sides of changes to `src/lib/school-students.ts`, including automatically merged code.

The shared `STUDENT_COLUMNS` projection is used by both school and centre queries. Every placeholder in that projection must be bound by both callers. Keep NVS phone-cohort program ID at `$3` and school-only program attribution order at `$4`; they have different SQL types. Preserve the centre roster membership view and school dropout fallback.

Verify both query parameter arrays and SQL placeholder assertions in `school-students.test.ts`, plus school-page, PM roster, and DynamoDB tests. Run the full unit suite, lint, and production build. If a removed route still appears in `.next/dev/types/validator.ts`, move those stale generated types outside the repository and rebuild.

Record any changed roster contract in the student-addition context and router.
