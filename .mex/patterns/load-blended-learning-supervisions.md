---
name: load-blended-learning-supervisions
description: Start or end a Blended Learning Supervision (a team-lead Mentor viewing another Mentor's Students, read-only) with the operator script. Dry run by default.
triggers:
  - "supervisor"
  - "supervision"
  - "team lead"
  - "reportee"
  - "blended_learning_mentor_supervisions"
  - "blended:load-supervisions"
edges:
  - target: context/permissions.md
    condition: for what a Supervision grants (view only) and where the access policy checks it
  - target: context/data-access.md
    condition: for the Supervision table and the Mapping source it mirrors
  - target: context/setup.md
    condition: for the .env files the script reads database credentials from
last_updated: 2026-11-12
---

# Load Blended Learning Supervisions

## Context
A **Supervision** (`blended_learning_mentor_supervisions`, db-service migration
`20261112120442`) lets a team-lead Mentor (`supervisor_user_id`) view another Mentor's
(`mentor_user_id`) Students for one academic year: that Mentor's Mentee list (switch on
`/blended-learning`, `?mentor=<id>`), their Mentees' pages and notes, and their flags in the
Flags tab. View only: logging, drafts, uploads and every other write stay with the mapped
Mentor (and Blended Learning Admins as before). Both people must be live `blended_mentor`
`user_permission` rows. There is no in-app editing; the program lead asks, an operator loads it.

`scripts/load-blended-learning-supervisions.ts` (`npm run blended:load-supervisions`), logic and
tests in `src/lib/blended-learning-supervisions-load.ts`. Pairs are given as emails on the command
line, never committed: af_lms is a public repo, so no staff names or emails go in code, tests,
runbooks or PR text.

## Steps
1. Deploy db-service `20261112120442` to the target environment first (the af_lms change reads
   the table on every Mentor page and fails without it).
2. Look the people up read-only and check each is a live `blended_mentor` with active Mappings:
   ```sql
   -- PGOPTIONS='-c default_transaction_read_only=on' psql service=af_db
   SELECT p.email, p.role, p.revoked_at, COALESCE(p.user_id, u.id) AS user_id,
          (SELECT count(*) FROM blended_learning_mentor_mentee_mappings m
           WHERE m.mentor_user_id = COALESCE(p.user_id, u.id) AND m.ended_at IS NULL
             AND m.academic_year = '<CURRENT_ACADEMIC_YEAR>') AS active_mentees
   FROM user_permission p LEFT JOIN "user" u ON lower(u.email) = lower(p.email)
   WHERE lower(p.email) IN (lower('<supervisor>'), lower('<mentor>'));
   ```
3. Dry run (a read-only connection; writes nothing):
   `npm run blended:load-supervisions -- --pair=<supervisor email>:<mentor email> [--pair=…] --by=<your email> --env-file=.env.production`
   (`--env=staging` reads `.env.staging`; the default is `.env.local`).
4. Read each line: `insert` (will start), `unchanged` (already running), or a blocking outcome
   (`supervisor_not_a_mentor`, `mentor_not_a_mentor`, `supervisor_no_user`, `mentor_no_user`,
   `same_person`). Any blocking pair makes `--apply` write nothing. Check the user ids and the
   Mentor's active-mentee count match step 2.
5. Apply: the same command plus `--apply` (and optionally `--reason="…"`, stored as
   `assignment_audit_reason`). One transaction; `assigned_by_email` is `--by`,
   `assignment_source` is `af_lms_script`.
6. Re-run the dry run: every pair should be `unchanged`.
7. Check in the app (or ask the supervisor): `/blended-learning` shows "My students" and
   "<Mentor>'s students"; the Mentor's list says "View only." and has no "New log for" buttons.

To **end** a Supervision (team change): the same pairs with `--end` (dry run, then `--apply`).
It sets `ended_at`, `ended_by_email`, `end_source = af_lms_script`, `end_reason =
supervision_ended`; rows are never deleted.

## Gotchas
- The user id is resolved as the app resolves it: `user_permission.user_id`, else the lowest-id
  `user` row with that email. If the Mentor's Mappings point at a different id, the supervisor
  sees an empty list: fix the permission row's `user_id`, not the Supervision.
- A supervisor who is a `blended_admin` already sees everyone; the script refuses them.
- Supervisions are per academic year (`CURRENT_ACADEMIC_YEAR`); load them again for a new year.
- `--pair` takes `supervisor:mentor` in that order. Swapping them gives the reportee view of
  the team lead's Students.

## Verify
- [ ] Dry run lists the expected pairs as `insert`, with the right user ids and mentee counts.
- [ ] After `--apply`, a second dry run reports `unchanged` for every pair.
- [ ] The supervisor sees the switch; the supervised list is view only.

## Update Scaffold
- [ ] Note the load (date, environment, pair count, never names) in `.mex/ROUTER.md` if it
      changes the project state.
