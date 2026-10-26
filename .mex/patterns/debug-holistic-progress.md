---
name: debug-holistic-progress
description: Trace empty HTTP 500 responses and database timeouts in Holistic Admin progress.
last_updated: 2026-09-25
---

# Debug Holistic Admin progress

## Steps

1. Read architecture, data-access context, and the progress route. Record request filters, response status/body length, and timestamp. Check the deployed Amplify commit against local source.
2. Read production CloudWatch logs for the screenshot timestamp; distinguish PostgreSQL statement timeout (`57014`) from connection timeout, auth errors, and infrastructure failures. An `Error from cloudfront` header alone does not identify the root cause.
3. Trace `listHolisticProgress`: reconciliation runs first, then the main SELECT, then route filter/coverage/year queries. **Do not invoke this function against production as a read-only probe:** its reconciliation can end Mappings and erase drafts.
4. Capture SQL with database calls replaced locally, then execute only SELECT/EXPLAIN through the existing DB helper inside an explicitly READ ONLY transaction. To inspect reconciliation, isolate its candidate SELECT and remove `FOR UPDATE` and all mutation CTEs. Keep the production timeout; never EXPLAIN ANALYZE a mutation.
5. Inspect the live `centre_students` definition and query plan. Correlated eligibility EXISTS can repeatedly expand roster membership for every Mapping after view changes. Compare a query-local materialized Program/year roster in both eligibility and Grade lookup; preserve authorization and historical behavior. Never replace the production view for diagnosis.
6. Check client error handling separately: parsing an empty 500 body as JSON masks the server error, while reset counters may falsely look like zero Students.
7. A slow School link can come from the canonical roster rather than Holistic progress. School and centre roster queries now materialize only `student_program_dropout` audits once, then retain the existing per-Student lateral aggregate over that reduced set. Verify the base-table CTE scan has one loop; repeated in-memory CTE scans are expected. Keep `can_undo_nvs_dropout` on the complete audit table because it also needs undo records and changed-value metadata.

## Verify

- For navigation fixes, test the entire nested journey: program progress → School → Student → another Phase → School → program progress. Checking only the first School Back misses return URLs rebuilt by the Student route. Verify ordinary School entry separately; fixed origin context must survive phase links and locked-phase redirects without changing access checks.
- Production probes are read-only, with credentials kept in memory and no Student/Notes rows printed.
- Identify the failing query separately from the reconciliation candidate check.
- Clearly label proposed-query timing versus shipped behavior; matching row counts alone do not establish full result parity.
- For a fix, test permissions, current/historical year semantics, conflicting Grades, filters, pagination/counts/CSV, and empty/non-JSON server failures, plus representative query performance.
- For roster performance changes, compare complete same-snapshot row digests for school and centre queries and run positive SQL fixtures for duplicate/nonempty dropout Programs, current membership, null/missing identifiers, casts, and undo behavior. Keep the read-only transaction, 15-second timeout, and no-row-output guardrails.
- Record findings in ROUTER.md and data-access context; bump changed scaffold dates and run mex log.

## Additional diagnosis and QA checks

- For phase-label reports, compare real phase ID, stored position, Grade, title and
  state across Setup, Progress and Student detail. The old synthetic Grade 12
  placeholders were removed in #332; use the current implementation as the baseline.
  Missing profiles do not establish that a source form was never submitted.
- Browser error assertions should target the progress error text within an alert;
  Next.js also renders an unrelated route announcer with that role.
- Use `REPEATABLE READ READ ONLY` for same-snapshot SQL comparisons. `READ ONLY`
  alone at the default READ COMMITTED isolation does not share a snapshot across
  successive SELECTs. Compare complete rows in memory, retaining counts/digests only.
- Measure Program selection, School response completion, and visible-list readiness
  separately. Streamed 200 headers are not response completion. Keep all samples
  and disclose readiness outliers without inventing a cause.
- Verify header Back and native browser Back independently. After an in-app
  Student-to-School return, native Back visits the Student; the School header is
  the explicit return to Program progress. If staging lacks incident-Program phases,
  disclose that limit and test the shared nested route with configured data.

## Coverage and Unassigned list (#340)

The invariants (coverage adds up and matches the Teacher roster, which filters it follows, the Unassigned list = roster unowned IDs, 422 rules, CSV shape, PM/PA scope, view-state resets and the header-Back journey) are asserted in `e2e/tests/holistic-progress.spec.ts`, `ProgressWorkspace.test.tsx` and `holistic-progress.test.ts`. Read those for the expected behaviour. Things that aren't obvious:

- The Teacher roster (`GET /api/holistic-mentorship/mappings`) needs a Teacher session. Admin roles get 403 there, so parity checks use two sessions.
- To seed exclusions locally, mutate only the **Unassigned** fixture Student (dropout, or an extra current Grade 12 `enrollment_record` for conflicting Grades) so reconciliation cannot end fixture Mappings. End Mappings directly in SQL and restore the exact rows. Do not deactivate the fixture Centre: reconciliation would end every fixture Mapping and erase draft answers.
- A School whose active Mappings all end leaves `options.schools` and coverage but stays in `coverageSchools`.
- `counts.total === coverage.unassigned` under Unassigned only without `phase_id`; a Phase narrows the list, not coverage.
- Quoted CSV answer cells can contain line breaks. Parse the CSV instead of splitting lines.
- "Clear filters" in the Unassigned empty state keeps Progress = Unassigned; the toolbar "Clear filters" resets to All Assigned.
- The browser journey asserts the header link "Back to Students and Progress", not native browser Back.
- Batch `enrollment_record.group_id` holds `batch.id`; see `patterns/debug-e2e-fixtures.md`.
