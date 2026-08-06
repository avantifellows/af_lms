---
name: router
description: Session bootstrap and navigation hub. Read at the start of every session before any task. Contains project state, routing table, and behavioural contract.
edges:
  - target: context/architecture.md
    condition: when working on system design, integrations, or understanding how components connect
  - target: context/stack.md
    condition: when working with specific technologies, libraries, or making tech decisions
  - target: context/conventions.md
    condition: when writing new code, reviewing code, or unsure about project patterns
  - target: context/decisions.md
    condition: when making architectural choices or understanding why something is built a certain way
  - target: context/setup.md
    condition: when setting up the dev environment or running the project for the first time
  - target: context/permissions.md
    condition: when gating a route, debugging a 403, or reasoning about roles/scope
  - target: context/data-access.md
    condition: when reading or writing data and unsure which backend to use
  - target: context/visits.md
    condition: when working on PM school visits or visit action types
  - target: context/student-addition.md
    condition: when working on self-service student addition, bulk upload, lateral entry, or school-facing edit/delete rollout
  - target: context/cms-quiz-sessions.md
    condition: when working on quiz-session create/edit/regenerate, session timing, or CMS chapter tests
  - target: context/teacher-feedback.md
    condition: when working on teacher feedback setup, the feedback form, or its report
  - target: patterns/INDEX.md
    condition: when starting a task — check the pattern index for a matching pattern file
last_updated: 2026-08-07
---

# Session Bootstrap

If you haven't already read `AGENTS.md`, read it now — it contains the project identity, non-negotiables, and commands.

Then read this file fully before doing anything else in this session.

## Current Project State

**Working:**

- Dual auth (Google OAuth + school passcode) with dev-login personas in non-prod.
- Student enrollment CRUD (reads direct from Postgres; writes proxied to the DB Service) + school dashboard, search, grade filtering, document uploads (S3).
- Permission system: feature×role matrix, 3-level school scope, program/NVS gating, `read_only` downgrade, additive centre-seat scope.
- PM school visits: GPS-tracked lifecycle + 7 visit action types (registry pattern), scoped by `visits-policy`; PM completion requires six Action Types, while Admin and Program Admin completion permits zero Actions; Program Admins manage their own in-progress Visits while retaining scoped read access; teacher pickers use the Staff Management Visit Teacher roster.
- Curriculum tracking, quiz sessions + quiz analytics (BigQuery), performance dashboard (DynamoDB), admin of users/schools/batches/centres/staff.
- CMS-sourced quiz sessions (new-CMS chapter tests) full lifecycle, created synchronously by af_lms rather than the legacy SNS → etl-data-flow Lambda: create applies the form's shuffle/show-scores/show-answers to the quiz doc and sends the window end for answer-visibility gating; edit writes the session row, its single `session_occurrence` (what portal actually gates on) and the quiz doc directly; regenerate re-ingests a corrected test in place via `PUT /quiz/{id}/from-cms`, preserving quiz/question ids so submitted attempts stay linked, refusing a 409 structure change, and confirming that existing attempts are **not** re-scored. See `context/cms-quiz-sessions.md` — settings live in two stores and the wrong one is invisible to students.
- Teacher Feedback: a PM sets up per-teacher student feedback for a centre; batches are scoped by `(school, centre programme)`, one form-session is created per teacher via the sessionCreator Lambda, and the report scores BigQuery responses by question text. See `context/teacher-feedback.md` — the form exists in two repos and renaming a question breaks scoring.
- Staff Management seat roles: subject seats (physics/chemistry/maths/biology + `subject_tbd`), `apc`, and the PM tiers (apm/pm/spm/ph). APC is a teacher record seated with role `apc`; that seat role is independent of the optional `teacher.subject_id`. The roster Role field shows "APC" and Add User can create one directly (Type = APC, subject optional).
- Academic Mentorship is temporarily disabled for every role through the `academic_mentorship` feature matrix. Its UI, routes, APIs, mappings, and Staff Management data safeguards remain in place so the original role access can be restored without database changes.
- Holistic Mentorship: dedicated `holistic_mentorship_admin` role and a Program allowlist covering JNV CoE (`1`) and EMRS CoE (`78`), separate School-page Academic/Holistic tabs, Admin yearly Phase Plan configuration (with prior-year copy offered only when that Program's prior Plan exists), and an Admin Academic Year selector that shows the current year plus only earlier years with Plan or Mapping data in the selected Program. Teacher self-service Mentor-Mentee Mapping claim/takeover/removal, stable Student/Phase workspaces with derived progress, live Context, draft autosave, Submit/correction flows, and a read-only Admin progress workspace with filtering, CSV export, and drill-down; global Admins also have a read-only School assignment coverage view for eligible assigned and unassigned Students, with Student drill-down returning to the School tab. Current-year Holistic eligibility, Notes, progress, assignment, and Student detail use one unambiguous Centre roster Grade and fail closed on conflicting Grades or ambiguous Program scope; historical progress keeps the yearly Grade enrollment fallback. Plans, Mappings, progress, profiles, Notes, reconciliation, CSV exports, and rollover are Program-scoped. Student Context loads imported Historical Notes for both Programs; the guarded operator import selects Program 1 or 78, keeps the fixed Program 1 baseline, and requires reviewed Program 78 dry-run counts before apply. Live eligibility remains the access boundary, while demand-driven AF LMS reconciliation is current-year only, closes stale Mappings, and erases drafts before protected Holistic work. Phase configuration audits require the authenticated email and optionally link a canonical User ID, so permission-only Admins can configure Phases without creating a User row. Profile summaries, regeneration status, safe failure reasons, automatic status polling, and the Admin regeneration action live in the first-Phase Student Context rather than a separate Profile panel. The Admin Student/Phase drill-down is prototype-aligned (back icon-button header with "Admin read-only view" subtitle, underline Phase tabs, panelled Context/Guidance, and Admin-only Notes visibility notices). Guarded operator commands import Historical Notes and roll Mappings into a new Academic Year; global Admins can execute approved content erasure with an immutable Student tombstone that prevents content restoration. Staff lifecycle cleanup ends Mappings and erases drafts. Release readiness includes local-only synthetic fixtures, a read-only production preflight, release Playwright workflows, and a non-destructive operator runbook.
- Holistic Mentorship Teacher and Admin workspaces link to role-specific, LMS-hosted tutorials in a new tab. The tutorial route reuses `roster_view` with the Teacher's School or `program_read` for Admins instead of adding a separate tutorial permission.
- Deploy via AWS Amplify; 3150 unit tests (Vitest/RTL) + 71 E2E (Playwright).

**Not yet built / in progress:**

- Centre rollout is mid-migration: `PROGRAM_IDS` is still hand-maintained in `src/lib/constants.ts` (target is reading `program` from the DB); non-JNV centre programs are being onboarded.
- Student Addition #197/#228/#231 follow-up is in progress. One-by-one, mixed-grade bulk, existing-Student Edit, audited NVS Dropout undo, combined Grade/Stream filtering, and NVS roster export use Centre-free NVS authorization. Program-specific Dropout keeps existing Centre-based programs working. Add/bulk serve the approved static workbook; example rows are removed before limits, validation, totals, rejected-row output, and writes; PEN accepts exact 11-digit text including a leading zero; empty dropout views return to Active. The final bulk error contract names duplicate identifiers on screen and in rejected CSVs, rejects every row sharing an in-file identifier, and aligns LMS and DB Service conflict messages. Blank formatting records are removed from uploaded worksheet XML before ExcelJS parsing, while the 200-nonblank-row limit remains unchanged. Bulk files are sent once, while DB Service processes independent rows concurrently after duplicate pre-scan to stay within the gateway timeout. The matching DB Service work is maintained in its own PR and must deploy with the LMS change.

- Curriculum improvements #252 are in progress on `feat/issue-252-improvements-to-curriculum-logging-curriculum`. LMS Curriculum Logs now carry a `log_type` (`regular`, `class_cancelled`, `doubt_solving`) plus a nullable `chapter_id`, and `duration_minutes` is nullable. Class Cancelled and Doubt Solving are live end to end in the shared Add Log modal, history, edit, and soft-delete lifecycle. Doubt Solving requires Date + one in-syllabus Chapter + positive duration, writes no topics or Chapter Completion changes, leaves Actual Hours / coverage / Curriculum Progress on `log_type = 'regular'`, and accrues a separate active Doubt Solving time total. Class Cancelled requires Date + one in-syllabus Chapter, rejects duration/topics, and blocks duplicates per scope + Chapter + date both proactively and on the partial unique index. A saved log's type is immutable. Shared Subject/Exam Track validation rejects Biology with JEE Main/Advanced and Maths with NEET for Curriculum Log create/update and Curriculum Config create/edit; the Config Add UI hides those combinations. Curriculum Summary has Region but no State/District filters; all multi-value filters use searchable checkbox lists with explicit Apply, and choosing Schools never auto-selects downstream filters. The production migration is owned by db-service; `e2e/fixtures/migrations/20260806120000_add_lms_curriculum_log_types.sql` mirrors it and the curriculum schema preflight (`log_type`, `chapter_id`) 503s until production catches up.
- Curriculum uses one fixed five-code Exam Track vocabulary: JEE Main, JEE Advanced, NEET, CET, and Math Foundation. CET and Math Foundation have no curriculum content yet, so content-requiring APIs return a controlled validation error; Quiz Session CMS remains on its explicit three-Track subset. The matching production check-constraint migration remains db-service-owned and is mirrored by `e2e/fixtures/migrations/20260807000000_widen_curriculum_exam_tracks.sql`.
- Centre Management now reads and writes independent Grade 11 and Grade 12 Centre Exam Track mappings from that fixed five-code vocabulary. Assignments are current-state rows in `centre_exam_tracks`; unassignment hard-deletes rows, the unique Centre + Grade + Track key makes reassignment idempotent, and Centre schema preflight covers the table. `npm run centres:import-exam-tracks` provides the one-off local-file dry-run/apply import with typed blockers and no legacy Stream inference. The legacy Centre Stream column, option set, import mapping, and UI are removed; production still requires the matching db-service migrations mirrored by `e2e/fixtures/migrations/20260807010000_add_centre_exam_tracks.sql` and `20260807030000_remove_legacy_centre_stream.sql`.
- Curriculum Log resolves exactly one active physical Centre for the selected School + Program and derives Grade-specific Exam Track choices only from that Centre's mappings. Missing/ambiguous Centres, unmapped Grades, and mapped Tracks without in-syllabus config fail closed with distinct UI states; Program and Grade changes refresh/prune Track choices, and create validation rejects stale or forged unmapped Tracks. E2E fixture Centres/mappings live in `20260807020000_seed_curriculum_centre_exam_tracks.sql`.
- Curriculum Summary rows now follow the same current Centre Exam Track mappings instead of globally configured Tracks. Mapped Tracks with content keep normal metrics and Chapter expansion, mapped Tracks without content render one non-expandable unavailable row, and missing/ambiguous physical Centres render per-School + Program configuration-error rows without blocking valid combinations. Downstream filter options are the mapped union for the selected Schools, and changing Schools prunes only selections outside that union without applying the form.
- Expanded Curriculum Summary Chapter rows show active Class Cancellation Count and Doubt Solving Hours for the selected scope and date range; parent, unavailable, and configuration-error rows remain unchanged, and Regular Class metrics keep their existing calculation.

**Known issues:**

- Two write paths exist — sending a student/batch/quiz-session write to Postgres instead of the DB Service is a real bug (see `context/data-access.md`).
- Regenerating a CMS quiz does **not** re-score already-submitted attempts (scoring happens only at attempt time); they keep their scores against the old answer key. The UI confirms this before proceeding. Related: no `DELETE /quiz` means a partial create leaves an orphan quiz, and regenerate's writes are un-transactioned — see `context/cms-quiz-sessions.md`.
- The Graphify knowledge graph is generated locally and not committed; rebuild it with `/graphify --update` after significant changes.
- Deploy is CI-only via `.github/workflows/deploy-amplify.yml` (main → prod, PRs → shared staging URL). There is no local deploy script.

## Routing Table

Load the relevant file based on the current task. Always load `context/architecture.md` first if not already in context this session.

| Task type                                                                  | Load                                             |
| -------------------------------------------------------------------------- | ------------------------------------------------ |
| Understanding how the system works                                         | `context/architecture.md`                        |
| Working with a specific technology                                         | `context/stack.md`                               |
| Writing or reviewing code                                                  | `context/conventions.md`                         |
| Making a design decision                                                   | `context/decisions.md`                           |
| Setting up or running the project                                          | `context/setup.md`                               |
| Gating a route / access control / 403s                                     | `context/permissions.md`                         |
| Reading or writing data (Postgres / DB Service / BigQuery / DynamoDB / S3) | `context/data-access.md`                         |
| PM school visits or visit action types                                     | `context/visits.md`                              |
| Student addition / bulk upload / lateral entry                             | `context/student-addition.md`                    |
| Quiz-session create/edit/regenerate, session timing, CMS chapter tests     | `context/cms-quiz-sessions.md`                   |
| Teacher feedback setup / form / report                                     | `context/teacher-feedback.md`                    |
| Any specific task                                                          | Check `patterns/INDEX.md` for a matching pattern |

## Behavioural Contract

For every task, follow this loop:

1. **CONTEXT** — Load the relevant context file(s) from the routing table above. Check `patterns/INDEX.md` for a matching pattern. If one exists, follow it. Narrate what you load: "Loading architecture context..."
2. **BUILD** — Do the work. If a pattern exists, follow its Steps. If you are about to deviate from an established pattern, say so before writing any code — state the deviation and why.
3. **VERIFY** — Load `context/conventions.md` and run the Verify Checklist item by item. State each item and whether the output passes. Do not summarise — enumerate explicitly.
4. **DEBUG** — If verification fails or something breaks, check `patterns/INDEX.md` for a debug pattern. Follow it. Fix the issue and re-run VERIFY.
5. **GROW** — After meaningful work, run this binary checklist:
   - **Ground:** What changed in reality? Name the changed behavior, system, command, dependency, or workflow.
   - **Record:** If project state changed, update the "Current Project State" section above. If documented facts changed, update the relevant `context/` file surgically.
   - **Orient:** If this task can recur and no pattern exists, create one in `patterns/` using `patterns/README.md`, then add it to `patterns/INDEX.md`. If a pattern exists but you learned a gotcha, update it.
   - **Write:** Bump `last_updated` in every scaffold file you changed. If the why matters, run `mex log --type decision "<what changed and why>"` or `mex log "<note>"`.
