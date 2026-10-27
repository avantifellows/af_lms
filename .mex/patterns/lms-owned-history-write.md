---
name: lms-owned-history-write
description: Write a status change plus an append-only history row to an LMS-owned table (intervention-flag updates, Visit Concern events). Use when a user action changes a record's status and must leave a permanent history entry.
triggers:
  - "resolve"
  - "reopen"
  - "add a note"
  - "history table"
  - "append-only"
edges:
  - target: patterns/add-api-route.md
    condition: for the route gate and response conventions
  - target: patterns/db-service-write.md
    condition: when the table is DB Service-owned instead (students, batches, quiz sessions, documents)
  - target: context/visits.md
    condition: for the Visit Concern events route and its status matrix
  - target: context/permissions.md
    condition: when deciding the gate (feature edit vs. read_only)
last_updated: 2026-10-27
---

# LMS-owned status change + history write

## Context
Some tables are owned by the LMS (or written by the LMS alongside a db-service flow) and are not
in the DB Service write rule: intervention flags (`lms_student_intervention_flags` +
`…_flag_updates`) and Visit Concerns (`lms_visit_concerns` + `lms_visit_concern_events`). These
are written directly with a `withTransaction` client. References: `addFlagUpdate` in
`src/lib/intervention-flags.ts`, `resolveConcern` / `commentOnConcern` / `reopenConcern` in
`src/lib/visit-concern-events.ts`.

## Steps
1. **Route gate first:** session → feature `edit` (so `read_only` is refused) → any extra
   visibility rule. Validate the id and body (trim; enforce the length limit) before any DB read.
2. **Visibility lookup** outside the transaction with `query()`: return nothing for missing,
   out-of-scope or hidden records alike, and answer 404 so existence never leaks.
3. **In one `withTransaction`:** `SELECT … FOR UPDATE` the record, check kind/status (wrong state →
   a typed error the route maps to 409), `UPDATE` status and `updated_at` when it changes, then
   `INSERT` the history row. All with `$n` params, timestamps as `NOW() AT TIME ZONE 'UTC'`,
   emails lower-cased.
4. **Respond 201** with the record's fresh state read after commit.
5. **Client:** put limits and action names in a client-safe `*-types.ts` module; validate before
   posting, keep the typed text on failure, `router.refresh()` on success.

## Gotchas
- The history table is append-only (a trigger rejects UPDATE/DELETE); never "fix" a row, add one.
- Another writer (db-service auto-reopen for concerns) locks the same row: always lock before
  reading the status you check.
- Keep the page's control flag (`canAct`/`canEdit`) on the same predicate the API enforces.

## Verify
- Route Vitest with mocked `query`/`withTransaction`: full status matrix, length boundary,
  writes only on the transaction client, lock first.
- Real-matrix test (`vi.importActual("@/lib/permissions")`) for page controls + POST.
- E2E on a fixture record no other test reads, since the history can't be undone.
