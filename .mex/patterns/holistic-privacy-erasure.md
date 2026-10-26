---
name: holistic-privacy-erasure
description: Extend Holistic erasure without weakening immutable content or audit rules.
triggers:
  - "privacy erasure"
  - "privacy tombstone"
edges:
  - target: ../context/data-access.md
    condition: when changing the erasure transaction or schema contract
  - target: ../context/permissions.md
    condition: when reasoning about the disabled privacy endpoint
last_updated: 2026-10-26
---

# Holistic privacy erasure

## Context

The LMS endpoint and `privacy_delete` policy deny every role. The helper is dormant;
changing it does not enable an operational erasure flow. db-service owns the schema,
LMS owns the helper, and the coordinated external erasure process must separately
adopt the contract below. Do not infer permission to erase live data from a code fix.

## Steps

1. Read the original privacy and Follow-up migrations in db-service. Preserve the
   existing tombstone and submitted-history protections.
2. In one transaction, take `pg_advisory_xact_lock(studentId, 0)` before row locks,
   then validate the active writable global Admin and Student.
3. Clear profile summaries, historical answers and post-session answers **before**
   inserting the tombstone: their update guards reject writes after a tombstone.
   Post-session target Notes are those with answer rows **or** Challenge Category rows
   (`holistic_mentorship_post_session_note_challenges`); delete both in the same statement,
   and audit `privacy_content_erased` for every target Notes. Return both counts from that
   statement: the tombstone's `post_session_answers_erased` counts answer rows only and
   `post_session_challenges_erased` counts Category rows (db-service migration `20261026101410`),
   so a Categories-only Note is never recorded as nothing erased.
   Category inserts after the tombstone are rejected by the shared privacy trigger.
4. Insert the immutable tombstone with the four content counts, or keep the existing
   one. Finish this statement before updating Follow-up answers so its trigger
   sees the tombstone.
5. For pending Follow-up rows, replace every non-null answer with the exact erased
   marker, preserving nulls and all metadata. Use a materialized row-locking CTE
   and return pre-update pending-field counts from the update; sum actual changes.
6. For a positive count, insert `holistic_mentorship_follow_up_erasures`, linked
   uniquely to the tombstone with the current actor, reason and answer count.
   Any failure or missing audit must throw, causing complete rollback. An unchanged
   repeat returns zero without another audit.

## Gotchas

- Do not add a later repair count to the original immutable tombstone. A companion
  audit preserves its original actor/date/reason/counts while recording the repair.
- Marker-only rows must be excluded from the update: no-op edits are rejected too.
- Preserve `updated_at`, identity, author and all other metadata. The database
  compares the complete old/new row apart from the three answer columns, protecting
  future columns as well. Existing answer constraints already permit the marker.
- Do not combine tombstone insertion and Follow-up update into sibling CTEs:
  dependent statements need the new tombstone visible to the trigger.
- A resolved callback commits in `withTransaction`. Throw for any failure after
  mutations; returning an error object would commit partial work.
- Existing tombstones with residual Follow-up text are handled by the same helper,
  but this change does not automatically run it or audit other content families'
  historical residual-data handling. Assess any live cohort separately, using
  counts-only checks before a separately authorized repair.

## Verify

- Run helper unit tests and disabled endpoint/policy regression tests.
- Run db-service Follow-up schema tests, including audit immutability, all forbidden
  mutations, null slots, another Student's tombstone, and post-erasure insert blocking.
- On an explicitly disposable local database, run the opt-in actual-helper tests
  for multi-phase content, Challenge Category rows (including Categories-only Notes and
  the post-tombstone insert rejection), the three draft-erasure paths, old tombstones,
  replay, rollback and both insertion-race orders. The database must include db-service
  #806 (`holistic_mentorship_post_session_note_challenges`) and migration `20261026101410`
  (`post_session_challenges_erased`). Never point these synthetic-fixture tests at production or staging.
- After db-service has migrated `dbservice_test_lms412`, run from LMS:

  ```sh
  HOLISTIC_PRIVACY_TEST_DATABASE=dbservice_test_lms412 DATABASE_HOST=localhost \
    DATABASE_PORT=5432 DATABASE_USER=postgres DATABASE_PASSWORD=postgres \
    npx vitest run src/lib/holistic-privacy.integration.test.ts
  ```

  Without the explicit opt-in, the suite skips without importing the database.
  Its immutable synthetic fixtures remain in the disposable database; temporary
  test triggers are removed. Recreate that database when fixtures are no longer needed.
- Deploy the schema before LMS: db-service migration `20261026101410` must be live before
  this LMS release, or every erasure fails on the missing tombstone column. For code rollback, revert LMS first and keep the
  additive schema. Test migration down/reapply only on disposable databases: down
  drops the new audit history and cannot recover erased text. Use forward fixes
  once real audit records exist.

## Update Scaffold

- Update `ROUTER.md`, data-access and permissions context when behavior changes.
- Bump `last_updated`; record material audit/ordering decisions with `mex log`.
