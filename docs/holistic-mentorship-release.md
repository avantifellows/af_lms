# Holistic Mentorship Program 1 Release

This is a coordinated release, not a dark launch. The operator must stop if a
preflight blocker or smoke-test failure is unresolved. AFK automation must not
approve content, sign off, launch, or announce the feature.

## Release Order

1. In staging, deploy `db-service` issue `#615`, then `etl-next` issue `#113`,
   then this AF LMS branch. Pause all other shared-preview deployments for the
   sign-off window and complete staging reconciliation and smoke checks.
2. Run and approve the read-only production preflight before changing
   production.
3. Deploy `db-service` `#615`; verify migrations, health, readiness, and the
   Holistic write contract.
4. Deploy `etl-next` `#113` inactive and verify its environment and health.
5. Activate the approved Prompt Configuration and reconcile Profile results.
6. Dry-run, apply, reconcile, and no-op rerun the Historical Notes import.
7. Deploy AF LMS, configure the current Phase Plan, and run the critical role
   and workflow smoke checks.
8. Engineering and Product must both record approval. Announce to Teachers only
   after production verification and both approvals.

## Local And Staging Data

Apply the sibling DB Service migrations and deterministic synthetic fixtures to
an explicit local database:

```bash
npm run holistic:setup-local -- \
  --confirm-synthetic-database \
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

Use production read credentials and the private, access-controlled grouped
Historical export. The command opens a read-only PostgreSQL transaction and
queries only the two approved BigQuery Form/Session pairs.

```bash
npm run holistic:preflight -- \
  --confirm-production-read-only \
  --env-file=.env.production \
  --academic-year=2026-2027 \
  --historical-source=/secure/path/historical-grouped.json
```

Save the aggregate JSON report with the release record. It must reconcile
dynamic Program 1 Schools; eligible Grade 11/12 Students; Teacher seats;
Holistic and global Admin accounts; exact BigQuery User-to-Student identity;
approved Form, Session, 34-question position, and five-set structure; the
Historical cohort; and every excluded row. Missing, ambiguous, wrong-scope, or
malformed candidates block release. Incomplete active-configuration Profile
coverage is a visible warning, not a blocker.

For Historical import, reconcile the approved worked counts before execution:
42 safe candidates, 39 written records, 3 empty-answer skips, 10 nullable Mentor
attributions, and 11 unmatched source IDs quarantined. Record the current source
fingerprint and verify that a no-op rerun changes zero rows.
For Profiles, compare eligible Student IDs, exact BigQuery identities, approved
Form structure, successful active-configuration Profiles, and failed/skipped
generation counts. Investigate every difference; do not fill gaps manually.

## Staging Sign-Off

Keep the shared-preview deployment paused while Engineering and Product run and
record this checklist:

- Teacher: open an eligible Program 1 School on desktop and mobile, assign an
  unowned Student, Submit Notes, correct the submitted Notes, and confirm a
  former Mentor's stale link returns `404`.
- Holistic Admin: configure Phase state, inspect progress and read-only Student
  drill-down, inspect the downloaded CSV, and request Profile regeneration.
- Cross-repo: observe the regeneration complete in `etl-next`, then confirm the
  new active Profile appears in AF LMS without exposing raw answers.
- Global Admin: verify role management and approved deletion gates. Verify the
  Holistic Admin cannot use either global-only gate.
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
