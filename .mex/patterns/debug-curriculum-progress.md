---
name: debug-curriculum-progress
description: Diagnose teacher LMS curriculum updates not appearing in manager LMS curriculum views.
triggers:
  - "curriculum not reflecting"
  - "teacher LMS"
  - "manager LMS"
  - "topics covered"
  - "curriculum progress"
  - "curriculum logs"
edges:
  - target: context/data-access.md
    condition: before checking Postgres or adding curriculum reads/writes
  - target: context/permissions.md
    condition: when the mismatch depends on user role, school scope, program ids, or centre seats
  - target: patterns/debug-access-denied.md
    condition: when the symptom is an empty view, 403, or wrong school/program scope
last_updated: 2026-07-06
---

# Debug Curriculum Progress

## Context
Curriculum writes are LMS-owned direct Postgres writes. Teacher logs live in
`lms_curriculum_logs` + `lms_curriculum_log_topics`; explicit chapter completion
lives in `lms_curriculum_chapter_completions`.

Manager and teacher views use the same APIs, but selected `program_id` matters.
A seated manager can reach a school through `centre_positions`; the program list
must include both explicit `program_ids` and seat-derived `scope.programs`.

## Steps
1. Load `context/data-access.md` and `context/permissions.md`.
2. Confirm the school row by `school.code` and `school.udise_code`.
3. Check active curriculum logs for the exact scope: `school_code`, `program_id`,
   `grade_id`, `subject_id`, `exam_track`, `deleted_at IS NULL`.
4. Check the viewer's active `user_permission` row, then active centre seats:
   `user_permission.user_id` -> `centre_positions` -> `centres.program_id` and
   linked school.
5. If the user sees the school through a seat, verify code uses
   `getResolvedPermission` and `getProgramContextSync(permission).programIds`
   instead of raw `permission.program_ids`.
6. If a screenshot shows a modal date, verify an actual saved log exists for that
   `log_date` or `inserted_at`; the modal date can just be today's default.

## Gotchas
- Empty progress can be a program-scope bug, not missing teacher logs.
- A topic marked "covered" in the log modal comes from loaded progress; it is not
  proof that the current modal was saved.
- Chapter completion is separate from topic coverage. `0/11 chapters completed`
  can be correct even when topics are covered.
- Use `BEGIN READ ONLY` when checking prod manually. Do not run writes in prod.

## Verify
- Focused API tests for `options`, `chapters`, `progress`, `logs`, and completion
  still pass after scope changes.
- For the reported school/user, the program list includes the program that owns
  the existing logs.

## Update Scaffold
- [ ] Update `context/permissions.md` if a new seat/program-scope gotcha was found.
- [ ] Add the pattern to `.mex/patterns/INDEX.md`.
