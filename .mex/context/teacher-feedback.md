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
last_updated: 2026-10-09
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

## Extend a round, and who has responded

- **Extend applies to the whole round** (`POST /api/teacher-feedback/cycles/:setupRunId/extend`).
  Each teacher needs three writes: the db-service `session` and its single
  `session_occurrence` (both IST), then `lms_teacher_feedback.end_time` (UTC). The
  portal gates on the *occurrence*, so patching only the session does nothing.
  Per-teacher failures are named in the error; the rest still extend.
- **Responses** (`GET .../responses`): roster = current, non-dropout
  `enrollment_record`s in the round's class batches *today*, not at the time of
  the round. BigQuery responders (`user_id` = `user.id`) are matched against it, so
  a responder who has since left the batch drops out of the count. Returns
  names of non-responders only; never which student said what.
- **Responders outside the roster are counted separately** (`outsideBatches`), as
  Analysis still scores them. Across 114 rounds (Oct 2026) it was 55 of 3,731:
  mostly dropouts and batch moves, plus one Punjab round (7 Sep, `4eaf7760`) where
  a 40-student N002 class was handed the C001 links in one sitting.
- **The portal link does not check batch.** portal-backend
  `verify_student_comprehensive` only checks the student is in the session's auth
  *group* (e.g. all of PunjabStudents), plus DOB when `auth_type` has it. Gurukul's
  home list does filter by batch. So a shared link works for any student in the
  programme; the batch scoping is only as good as who the link is given to.
- **"Admin test" submits as `test_admin`**; both BigQuery queries exclude it.
- **Monthly nudge at setup is per batch**: a round whose start falls in the
  current IST month and shares any picked batch triggers "extend it instead?".
  Two rounds in one month for *different* batches (Kurnool's 2027 and 2028
  cohorts) are normal.

## Analysis (report)

- Code: `src/components/teacher-feedback/` (`TeacherFeedbackTab` → `CycleCard` per
  round, `TeacherCard` per teacher; `AnalysisModal`; `SetupModal`), scoring in
  `src/lib/teacher-feedback-bq.ts`, round context + history in
  `src/lib/teacher-feedback-history.ts`.
- Each parameter and question gets a %, and each question its option counts.
  Overall % per teacher card comes from `getTeacherFeedbackSummaries` (one
  BigQuery query for many quizzes).
- **History** = the teacher's rounds at the same school *and centre*, matched by
  `teacher_id`, falling back to name only when either side has no id. Rounds with
  zero responses (abandoned duplicate set-ups) are dropped.
- **A round's trend is that round's batches only**: earlier rounds that *share a
  batch* with it, up to its month. "Shares", not "same", because PMs regroup
  batches between months (24701: all four, then pairs). The teacher's other
  batches belong to a teacher-level view (planned: a "Rounds | Teachers" toggle in
  this tab, PM-facing). "▲ vs <month>" uses the same rule.
- **One BigQuery scan per screen**: the report route fetches the teacher's rounds
  from Postgres first, then scans once for this quiz plus history; opening a
  round scans once for responders and scores (`getRoundResults`). The table is
  clustered on session_id, not test_id (~107 MB per scan).
- **Gender split** (`user.gender`, lower-cased; only male/female) is sent only
  when *both* groups have ≥ 5 responses — enforced server-side. Sending one group
  alone would let the other be derived from the overall score.
- **"Nothing"-style comments** ("nothing", "no comments", "nothing sir") are
  counted, not listed; they used to bury the real suggestions. Only English text
  is judged (regional-language comments are always kept), and "all good" counts
  as nothing only under "improve" — under "liked" it's praise.
- **Setup flags a batch** that already had a round in the month being set up,
  on the batch row itself, with "Extend that round instead". Still pickable: a
  second round in a month is sometimes deliberate.
- Ended rounds say "didn't respond", live ones "pending".

## LLM summary (issue #316 item 3)

- **Written by etl-next** `teacher_feedback_summaries_flow` (daily, seeded
  disabled) onto `lms_teacher_feedback.summary` (+ `summary_prompt_version`,
  `summary_fingerprint`, `summary_generated_at`) through db-service
  `GET/PUT /api/teacher-feedback-summary`. The columns' migration lives in
  db-service, like the table's.
- **Only closed rounds** with ≥ 5 responders. The flow finds rounds in BigQuery
  (`airbyte.session` meta_data carries the feedback teacher/school/batches), so it
  needs no LMS reads. A fingerprint of answers + prompt version skips unchanged
  rounds: a quiet day makes no LLM calls; late answers after an Extend regenerate
  once the round closes again.
- **Shape**: `{highlights[], concerns[{text, serious, recurring}], response_count,
  model}`. "recurring" = also in the same teacher's earlier rounds sharing a batch.
  Gemini via OpenRouter with zero-data-retention routing (Holistic Profiles' key).
- **LMS reads it as `to_jsonb(tf) -> 'summary'`**, so af_lms works before the
  db-service migration runs. Analysis shows it (or "after the round closes" /
  "prepared daily"); the teacher card shows "⚑ N serious concerns".
- No regenerate button and no job tables by design: re-run the flow with
  `force` or bump `PROMPT_VERSION`.

## Gotchas

- **`session_pk` and `centre_id` are bigints**, so pg returns them as strings.
  Coerce before using one as a Map key — a raw lookup misses and the UI sits on
  "Generating links…" forever.
- **`meta_data.grade` must be a string.** sessionCreator forwards it into the
  quiz-backend `/quiz` body, whose `metadata.grade` is typed as a string; a number
  422s the whole quiz build and the Lambda then dies before writing `platform_id`.
- **Times differ by store.** `lms_teacher_feedback` keeps the window in UTC; the
  db-service `session` row keeps it in IST. Never compare the two raw.
- **No per-batch breakdown within a round.** BigQuery's `batch` column is
  `meta_data.parent_id` — the shared *quiz* batch, not the class batch the PM
  picked. Across rounds the batch is known (each round has its own batches), so
  the month trend is batch × month.
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
