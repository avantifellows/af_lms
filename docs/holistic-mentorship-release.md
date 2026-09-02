# Holistic Mentorship Release

This is a coordinated release, not a dark launch. The operator must stop if a
preflight blocker or smoke-test failure is unresolved. AFK automation must not
approve content, sign off, launch, or announce the feature.

## Release Order

This is a paired DB Service and AF LMS release. Follow this order; an older
checklist that deploys a separate DB Service/ETL pair before LMS is superseded.

1. In staging, deploy DB Service PR `#719` first. Verify its migrations,
   health, readiness, and Holistic write contract.
2. In staging, deploy AF LMS PR `#308` second. Pause other shared-preview
   deployments for the sign-off window.
3. After both staging deployments are healthy, manually create and open the
   approved `2026-2027` Phase Plans for Programs `74` (Punjab CoE), `88`
   (Uttarakhand CoE), and `99` (Maharashtra Coaching Test Prep) in AF LMS.
4. Run the existing approved Profile-generation operator flow after those
   Phase Plans are open. Do not add an ETL deployment to this release order.
5. Complete staging reconciliation, smoke checks, and the sign-off checklist.
6. Run and approve the read-only production preflight before changing
   production.
7. In production, deploy DB Service PR `#719` first and AF LMS PR `#308`
   second. Verify health and readiness after each deployment.
8. Manually create and open the approved `2026-2027` Phase Plans for Programs
   `74`, `88`, and `99`, then run Profile generation.
9. Engineering and Product must both record approval. Announce to Teachers only
   after production verification and both approvals.

## Local And Staging Data

Apply the sibling DB Service migrations and deterministic synthetic fixtures to
an explicit local database:

```bash
npm run holistic:setup-local -- \
  --confirm-synthetic-database \
  --program-id=<supported-holistic-program-id> \
  --env-file=.env.local \
  --db-service-path=../db-service_holistic_mentorship
```

The guard accepts local database hosts only. The command creates both Grades,
all access actors, Mapping ownership/history, Profiles, Historical Notes,
draft/submitted Notes, and locked/open/active/skipped/pending/completed states.
Its content is synthetic and must never be replaced with questionnaire text.

Database sync tooling may target local or staging only after the target name is
confirmed. Production may be a read-only source, never a sync target. Before
real Holistic data exists, a guarded production-to-staging refresh is allowed.
After any real data exists, every `public.holistic_mentorship_*` table must be
excluded from production-to-staging and production-to-local table-data syncs;
use the synthetic setup above instead. Never copy staging/local Holistic rows to
production.

## Production Preflight

Use production read credentials. The command opens a read-only PostgreSQL
transaction and queries only the two approved BigQuery Form/Session pairs.
Choose the command that matches the run: Programs `1` and `78` may use the
private, access-controlled grouped Historical export; the newly enabled live
Programs `74`, `88`, and `99` must not.

### Historical Program 1

Program 1 requires its reviewed Historical source:

```bash
npm run holistic:preflight -- \
  --confirm-production-read-only \
  --program-id=1 \
  --env-file=.env.production \
  --academic-year=2026-2027 \
  --historical-source=/secure/path/historical-grouped.json
```

### Historical Program 78

Include `--historical-source` when checking the approved EMRS Historical cohort:

```bash
npm run holistic:preflight -- \
  --confirm-production-read-only \
  --program-id=78 \
  --env-file=.env.production \
  --academic-year=2026-2027 \
  --historical-source=/secure/path/emrs-historical-grouped.json
```

The Historical Notes importer supports only Programs `1` and `78` as separate
guarded runs. A live-only Program 78 preflight may omit the source.

### Live Programs 74, 88, and 99

Run the live preflight once for each newly enabled Program. These commands
intentionally omit `--historical-source`:

```bash
npm run holistic:preflight -- \
  --confirm-production-read-only \
  --program-id=74 \
  --env-file=.env.production \
  --academic-year=2026-2027

npm run holistic:preflight -- \
  --confirm-production-read-only \
  --program-id=88 \
  --env-file=.env.production \
  --academic-year=2026-2027

npm run holistic:preflight -- \
  --confirm-production-read-only \
  --program-id=99 \
  --env-file=.env.production \
  --academic-year=2026-2027
```

Do not pass a Historical source for Programs `74`, `88`, or `99`; they have no
approved Historical snapshot or baseline.

Save the aggregate JSON report with the release record. It must reconcile
dynamic Schools in the selected Program; eligible Grade 11/12 Students; Teacher seats;
Holistic and global Admin accounts; exact BigQuery User-to-Student identity;
approved Form, Session, 34-question position, and five-set structure; the
Historical cohort; and every excluded row. Missing, ambiguous, wrong-scope, or
malformed candidates block release. Incomplete active-configuration Profile
coverage is a visible warning, not a blocker.

For Historical import, reconcile the approved worked counts before execution:
42 safe candidates, 39 written records, 3 empty-answer skips, 10 nullable Mentor
attributions, and 11 unmatched source IDs quarantined. Record the current source
fingerprint and verify that a no-op rerun changes zero rows.

Program 1 keeps that fixed baseline. For Program 78, first prepare the reviewed
11-Student EMRS cohort from the same approved private CSV snapshot:

```bash
npm run holistic:prepare-history -- \
  --source-csv=/secure/path/mentorship-form-responses.csv \
  --reviewed-student-ids=/secure/path/approved-emrs-student-ids.json \
  --program-id=78 \
  --output=/secure/path/emrs-historical-grouped.json
```

Then run the filtered EMRS export in dry-run mode:

```bash
npm run holistic:import-history -- \
  --source=/secure/path/emrs-historical-grouped.json \
  --program-id=78 \
  --env-file=.env.production \
  --dry-run
```

After the Program 78 counts are reviewed, provide them in
`safe/substantive/empty/nullable/unmatched` order for apply:

```bash
npm run holistic:import-history -- \
  --source=/secure/path/emrs-historical-grouped.json \
  --program-id=78 \
  --approved-counts=<safe/substantive/empty/nullable/unmatched> \
  --actor-user-id=<admin-user-id> \
  --source-snapshot=<approved-snapshot-id> \
  --env-file=.env.production \
  --apply
```

Prepare the private grouped input deterministically from the reviewed CSV snapshot
and private 53-ID JSON allowlist before dry-run/apply. The preparer validates the
expanded Sheet shape, retains source timestamps in the grouped provenance, writes
the output with owner-only permissions, and prints only aggregate counts plus the
snapshot hash:

```bash
npm run holistic:prepare-history -- \
  --source-csv=/secure/path/mentorship-form-responses.csv \
  --reviewed-student-ids=/secure/path/approved-student-ids.json \
  --output=/secure/path/historical-grouped.json
```
For Profiles, compare eligible Student IDs, exact BigQuery identities, approved
Form structure, successful active-configuration Profiles, and failed/skipped
generation counts. Investigate every difference; do not fill gaps manually.

The first Mapping rollover apply happens only at the next Academic Year. Run the
aggregate-only dry-run first, review its carried/skipped/ineligible counts, then
apply with a canonical operator User ID and verify an immediate no-op rerun:

```bash
npm run holistic:rollover -- \
  --from=2026-2027 --to=2027-2028 \
  --program-id=<supported-holistic-program-id> \
  --actor-user-id=<operator-user-id> --env-file=.env.production

npm run holistic:rollover -- \
  --from=2026-2027 --to=2027-2028 --apply \
  --program-id=<supported-holistic-program-id> \
  --actor-user-id=<operator-user-id> --env-file=.env.production
```

The script carries only still-eligible same-School pairs in the selected Program. Any Mapping
history already present in the target year is skipped, including a carried
Mapping that a Teacher later removed, so a rerun cannot undo Teacher action.
Keep the prior-year rows unchanged and do not commit Student-level output.

## Staging Sign-Off

Keep the shared-preview deployment paused while Engineering and Product run and
record this checklist:

- Teacher: open an eligible School in each supported Program on desktop and mobile, assign an
  unowned Student, Submit Notes, correct the submitted Notes, and confirm a
  former Mentor's stale link returns `404`.
- Holistic Admin: configure Phase state, inspect progress and read-only Student
  drill-down, inspect the downloaded CSV, and request Profile regeneration.
- Cross-repo: observe the regeneration complete in `etl-next`, then confirm the
  new active Profile appears in AF LMS without exposing raw answers.
- Cross-repo eligibility: move a mapped disposable Student to another School or
  Program through db-service. Confirm the Mapping remains stored until the next
  Holistic roster or direct-page request, then closes with
  `end_source = 'af_lms_student_eligibility'`; the former Mentor must receive
  `404` without Profile, Context, or Notes content being returned.
- Global Admin: verify role management and approved deletion gates. On a
  disposable Student, confirm Profile, Post-Session, and Historical answer
  content is erased once, the immutable content-free tombstone remains, and
  regeneration cannot restore content. Verify the Holistic Admin cannot use
  either global-only gate.
- Excluded program manager, program admin, and passcode actors: verify direct API
  requests return server-side `403` on desktop and mobile, with no hidden or
  overlapping controls.

Engineering signs off migrations, preflight output, automated checks, access
denials, logs, and rollback readiness. Product signs off Phase/Prompt content,
Profile presentation, CSV, and the Teacher walkthrough. A release owner records
both approvals; neither role may sign for the other.

## First-Week Monitoring

Reuse existing logs and health surfaces; do not add a monitoring platform.

- Alert on Holistic API error rate/status/duration using safe route/action codes,
  DB Service health/readiness failures, and ETL failed or stuck runs.
- Review daily aggregate counts for eligible Students with a successful active
  Profile, active Mappings, submitted Notes, and failed Profile regenerations.
- Do not alert on normal missing Context, intentional import/generation skips,
  read traffic, or incomplete Profile coverage alone.
- Never log Profile/Note content, source answers, Student identity exports, or
  GPS coordinates.

## Non-Destructive Rollback

1. Pause Holistic writes, imports, Profile generation/regeneration, and Teacher
   communication. Preserve the incident window and aggregate evidence.
2. Roll AF LMS back first, then `etl-next`, then `db-service`, using each
   application's last known good revision. Confirm older callers tolerate the
   additive schema before rolling back the service.
3. Preserve all Holistic schema and data. Do not run down-migrations, restore a
   database snapshot, truncate tables, or bulk overwrite records.
4. Restore the last-known-good Prompt Configuration as the active configuration;
   retain failed and superseded attempts for attribution.
5. Reconcile in-flight writes/imports by idempotency key and source fingerprint.
   Apply only targeted, reviewed, audited corrections, then rerun the read-only
   preflight and smoke checklist before resuming.
