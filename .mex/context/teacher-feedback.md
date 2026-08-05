---
name: teacher-feedback
description: Student feedback about teachers — centre/programme scoping, the two copies of the form, and why the report scores by text. Load before touching teacher-feedback setup, the form config, or the report.
triggers:
  - "teacher feedback"
  - "feedback round"
  - "feedback form"
  - "lms_teacher_feedback"
  - "setup_run_id"
  - "all_responses_form_level"
  - "FEEDBACK_QUESTIONS"
edges:
  - target: context/data-access.md
    condition: when deciding which backend a feedback write goes to
  - target: context/cms-quiz-sessions.md
    condition: when the question is about quiz sessions generally, not feedback
  - target: context/permissions.md
    condition: when gating a feedback route
last_updated: 2026-08-04
---

# Teacher Feedback

A PM picks a **centre** → its teachers + class batches → a window → Create. One
form-session per teacher lands on the students' Gurukul; responses come back
through the quiz ETL and are scored per teacher.

Three repos: **af_lms** owns the form config, UI and API; **db-service** owns the
`lms_teacher_feedback` DDL (the LMS writes the rows directly); **etl-data-flow**'s
sessionCreator Lambda builds the quiz and fills the session's links.

## Scope by programme, not by school

A school can host a CoE **and** a Nodal centre, each running its own cohorts. So a
round's batches are `(school_id, centres.program_id)` — see
`teacher-feedback-batches.ts`. Scoping by school alone offers the sibling centre's
batches, which means students rating a teacher who never taught them.

No production school has two active centres sharing a programme, so this is
unambiguous. It **fails closed** when a centre has no `program_id` (a few
online/foundation centres): return no batches rather than falling back to all of
the school's.

`centre_batch` exists in prod but is only partially seeded and has at least one
cross-school row, so it is deliberately unused. `batch.metadata->>'centre'` was
never backfilled.

## group / auth_type come from the FK, never the batch_id prefix

`meta_data.group` (what Gurukul filters on) and `auth_type` (which
portal-frontend honours over the auth_group's own) must come from
`batch.auth_group_id` via `resolveBatchGroups()`. About a quarter of production
batches have a `batch_id` prefix that is **not** their auth_group name (e.g.
`EMRS-11-25-P01`). Deriving from the prefix silently produced a group Gurukul
never matches *and* missed the auth_group row, defaulting `auth_type` to `"ID"` so
students could not log in.

## The form lives in two places

`FEEDBACK_QUESTIONS` (here) and `teacher_feedback_form.py` (sessionCreator) are
the same form in two languages. `npm run teacher-feedback:bundle` generates the
Python from the TypeScript and a unit test pins the output, so an edit to one
alone fails CI. **The copy into etl-data-flow is manual** and the Lambda must be
deployed for a change to reach students.

## The report scores by text, not position

`all_responses_form_level` carries `question_position_index`, but that index is a
walk over the quiz doc's `question_sets` — and the same form is built into two
shapes: one flat set of 16 (the pilot script) or eight themed sets
(sessionCreator groups by Theme). They agree only because the themes happen to be
contiguous; add a question mid-theme and the themed build shifts every later
index while the flat one doesn't. Nothing in a response row says which shape
produced it. Staging rows already show position 14 holding an open-ended question
in some quizzes and a scored one in others.

There is no id to join on instead: no `source_id` column, `question_id` is a
per-quiz Mongo ObjectId, and `option.metadata.score` is null in the docs
sessionCreator writes. So the report matches `question_text` and scores
`user_response_labels`. Renaming a question or an option is therefore the
dangerous edit — reordering is safe.

Transitional. Once the form lives in the CMS with real question ids this becomes
an id join and both copies of the form go away.

## Gotchas

- **`session_pk` and `centre_id` are bigints**, so pg returns them as strings.
  Coerce before using one as a Map key — a raw lookup misses and the UI sits on
  "Generating links…" forever.
- **`meta_data.grade` must be a string.** sessionCreator forwards it into the
  quiz-backend `/quiz` body, whose `metadata.grade` is typed as a string; a number
  422s the whole quiz build and the Lambda then dies before writing `platform_id`.
- **Times differ by store.** `lms_teacher_feedback` keeps the window in UTC; the
  db-service `session` row keeps it in IST. Never compare the two raw.
- **No per-batch breakdown in the report.** BigQuery's `batch` column is
  `meta_data.parent_id` — the shared *quiz* batch, not the class batch the PM
  picked.
- **A Lambda failure is invisible to the PM**: setup returns 201, the row reads
  `created`, and only CloudWatch says the quiz build failed.

## Known debt

- **No double-submit protection.** `setup_run_id` is minted per request, so the
  unique index on `(setup_run_id, teacher_order)` only stops a repeat *within* one
  run — two submits create two full sets of sessions. A real fix needs a
  client-supplied idempotency key. The quiz-session create path has the same gap,
  so fix both together or neither.
- **Routes authorize at school level**, not seat level, so a seated PM can act on
  any centre at a school they can reach. Matches every other tab; see PR #227's
  D32.
- **Unfilled seats are invisible** — many active `centre_positions` rows have a
  null `user_id`, so the teacher picker silently shows only the filled subset.
