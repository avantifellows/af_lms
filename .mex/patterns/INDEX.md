---
name: pattern-index
last_updated: 2026-10-22
---

# Pattern Index

Lookup table for all pattern files in this directory. Check here before starting any task — if a pattern exists, follow it.

<!-- This file is populated during setup (Pass 2) and updated whenever patterns are added.
     Each row maps a pattern file (or section) to its trigger — when should the agent load it?

     Format — simple (one task per file):
     | [filename.md](filename.md) | One-line description of when to use this pattern |

     Format — anchored (multi-section file, one row per task):
     | [filename.md#task-first-task](filename.md#task-first-task) | When doing the first task |
     | [filename.md#task-second-task](filename.md#task-second-task) | When doing the second task |

     Example (from a Flask API project):
     | [add-api-client.md](add-api-client.md) | Adding a new external service integration |
     | [debug-pipeline.md](debug-pipeline.md) | Diagnosing failures in the request pipeline |
     | [crud-operations.md#task-add-endpoint](crud-operations.md#task-add-endpoint) | Adding a new API route with validation |
     | [crud-operations.md#task-add-model](crud-operations.md#task-add-model) | Adding a new database model |

     Keep this table sorted alphabetically. One row per task (not per file).
     If you create a new pattern, add it here. If you delete one, remove it. -->

| Pattern | Use when |
|---------|----------|
| [add-api-route.md](add-api-route.md) | Adding any endpoint under `src/app/api/` (gate + read/write) |
| [add-component.md](add-component.md) | Adding a React component + its colocated Vitest/RTL test |
| [add-student-enrolment-field.md](add-student-enrolment-field.md) | Adding a Student field — choosing between Edit Student and the enrolment form, and the AF LMS + DB Service pair enrolment needs |
| [add-user-role.md](add-user-role.md) | Adding a `user_permission` role — matrix column, deny-point or pin, Admin Users, Staff Management, Dev Login |
| [add-visit-action-type.md](add-visit-action-type.md) | Adding a new PM visit action type (the ~8-file registry change) |
| [create-ralph-slices.md](create-ralph-slices.md) | Publishing or refreshing Ralph AFK sub-issues and native blocking edges |
| [db-service-write.md](db-service-write.md) | Writing students/batches/quiz-sessions/documents (proxy to the DB Service) |
| [debug-access-denied.md](debug-access-denied.md) | Diagnosing unexpected 401/403, empty lists, or wrongly-granted access |
| [debug-bulk-workbook.md](debug-bulk-workbook.md) | Diagnosing XLSX/CSV upload parsing, encryption, or row-validation failures |
| [debug-curriculum-progress.md](debug-curriculum-progress.md) | Diagnosing teacher LMS curriculum updates not appearing in manager LMS |
| [debug-e2e-fixtures.md](debug-e2e-fixtures.md) | Diagnosing Playwright failures caused by stale local fixtures or app flow drift |
| [debug-holistic-progress.md](debug-holistic-progress.md) | Diagnosing empty 500 responses, JSON parse errors, or slow Holistic Admin progress |
| [deploy-staging-pr.md](deploy-staging-pr.md) | Setting up a reviewed LMS PR on shared staging for QA |
| [holistic-privacy-erasure.md](holistic-privacy-erasure.md) | Extending Holistic privacy erasure across immutable content and audit tables |
| [load-blended-learning-links.md](load-blended-learning-links.md) | Loading or refreshing Blended Learning Profile Doc / Screener Links (and the optional legacy last-contact seed) from the Profile Dashboard workbook |
| [local-browser-qa.md](local-browser-qa.md) | Running a PR branch from a worktree on a spare port and QA-ing it in headless Chromium |
| [local-enrollment-repair.md](local-enrollment-repair.md) | Rehearsing audit-derived enrollment repairs on a dedicated local snapshot |
| [mirror-db-service-schema-in-e2e.md](mirror-db-service-schema-in-e2e.md) | Mirroring db-service tables missing from `db-dump.sql` into an e2e fixture migration, proven identical by `pg_dump` diff |
| [merge-roster-changes.md](merge-roster-changes.md) | Merging overlapping school/centre roster queries and SQL bindings |
| [presigned-s3-upload.md](presigned-s3-upload.md) | Letting the browser upload a large file straight to S3 with a presigned PUT, then recording it server-side |
| [reconcile-local-scaffold.md](reconcile-local-scaffold.md) | Cleaning up local .mex notes left on an older branch after related PRs merge |
| [refresh-ralph-prd.md](refresh-ralph-prd.md) | Refreshing an existing GitHub issue PRD in a Ralph workspace |
