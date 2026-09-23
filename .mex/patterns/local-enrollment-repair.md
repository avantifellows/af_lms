---
name: local-enrollment-repair
description: Rehearse audited enrollment repairs on a dedicated local production snapshot.
triggers:
  - "local enrollment repair"
last_updated: 2026-09-23
---

# Local enrollment repair rehearsal

Read `context/student-addition.md` for the currently approved cohort and the DB
Service utility README for its actual safeguards. Each chart box is separate.

1. Use only the existing DB Service `utils/fetch-data.sh` for production access
   when the user limits access to that script. Put source credentials in a private
   override file; never print or commit them. Choose a fresh local target and a
   pg_dump/psql version compatible with the local PostgreSQL server.
2. Keep the restored database unchanged. Clone it for apply tests.
3. Recount the cohort locally before proposing changes. Separate box count from
   eligible count; a School mismatch alone is not a status-repair exclusion.
4. Derive year/start date from original audited Batch and Grade enrollment rows.
   LMS creation audits themselves do not contain these fields. Normal audited
   Batch replacement does not reset the original status start date.
5. Generate a private bounded manifest, review it, then apply its hash-bound
   contents only to the QA clone. Verify reruns do not duplicate rows and stale
   batches roll back. Keep original insertion dates distinct from repair time.
6. Compare complete existing Student, enrollment, and audit rows against the
   untouched snapshot. Confirm only the intended rows/audits were added.
7. Run relevant integration tests and repository checks; distinguish existing
   failures from regressions. Archive counts and QA findings without row-level
   personal data. Update ROUTER and student-addition context.

The first-box utility currently accepts only loopback connections to dedicated
`dbservice_status_repair_*` databases. Never use a tunnel to a remote database.
Do not infer production apply authorization from local rehearsal authorization.

For confirmed accidental dropout/undo cases, use the separate correction utility,
not the missing-row insert utility. Preserve existing status row IDs/inserted_at
and original audits; capture before/after in a correction audit. Compare all
non-target enrollment rows exactly, then verify only allowed fields changed on
targets. A same-day mistake may need no start_date change. Coordinate any later
historical timestamp repair with the correction logs before applying it.

For the single-dropout/no-undo box, add a non-current enrolled period ending on
the audited dropout date. Keep the existing current dropout row and memberships
unchanged. Only reconstruct the pre-dropout Batch/Grade state in memory for
validation; do not reactivate anything. The repeated-cycle and missing-audit
cases are outside this utility.

A repeated dropout/undo/dropout cycle needs separately validated initial and
post-undo enrolled periods while retaining both dropout rows. Same-day periods
may have equal start/end dates. A missing dropout audit must stay report-only
under the audit-source rule even when current DB dates agree; present the exact
inferred period and request a policy decision before treating it as history.

If the user approves a DB-evidence exception, restrict it to the specific Student
and source records/dates, reject newly available contradictory evidence, and
record the fallback explicitly in a new repair audit. Never invent the missing
original audit. An approved singleton does not authorize a generic audit bypass.

After status cleanup, generate fresh timestamp reports and coverage. Valid
accidental correction audits produce preserve_status_correction for the status
row while unchanged memberships can still receive their actual operation time.
Invalid/duplicated/mismatched correction snapshots produce unresolved_status_correction.
Run all stages on the same local clone, verify one matching current status per
Student, then prove timestamp apply preserves new/corrected status rows and all
non-timestamp fields. Never reuse old manifests across these stages.
