# Teacher Feedback — Implementation Plan

_Date: 2026-06-22 · Branch: `feat/teacher-feedback` (to be created off `main`)_

## Goal

A Program Manager picks a **school + batch + the teachers** to be rated. The LMS creates one
student-feedback **form-quiz per teacher** and one **session per teacher**, scoped to that batch.
Students see each teacher's feedback as its own card on Gurukul and fill them **in any order**
(finishing one conveniently auto-advances to the next, but every card is independently launchable).
Then the PM views an **analyzed report** (per-teacher %, parameter breakdown, subjective text).

This replaces the throwaway prototype (`scripts/create_teacher_feedback_pilot.py` +
`generate_teacher_feedback_report.py`) with a first-class, in-app integration.

---

## Decisions locked (from discussion)

| Decision | Choice |
|---|---|
| PM entry point | **Standalone page** (modeled on the existing quiz-sessions UI), not a visit action point |
| Quiz creation | **In-app: LMS POSTs to quiz-backend `/quiz` per teacher**, then `/session` per teacher. No SNS/Lambda/Sheet machinery. |
| Form source | **Fixed typed config in the LMS** ported from `Proposed Student Feedback Form - Final_V2.csv` |
| Chaining | **Keep `next_step_url` chain for convenience, but every session is independently launchable** (any-order start) |
| Partial responses | **Count per-teacher independently** — no "complete chain" requirement |
| Report data source | **BigQuery `avantifellows.assessments.all_responses_form_level`** (verified, see below). Reuses existing `getBigQueryClient()` — no Mongo. |
| Teacher source | **Centre-seat mapping from PRs #124/#125** (`centre_positions → centres → school`), not `/api/pm/teachers`. |
| Report format | **In-app tabular summary** reusing existing analytics styles (LLM summary deferred) |

### Why quiz-backend direct (not SNS+Lambda+Sheet)

The existing `/api/quiz-sessions` flow POSTs a session then fires SNS → the `sessionCreator` Lambda
builds the quiz in Mongo from a **CMS link / Google Sheet** in `meta_data`. The Lambda *does* support
`test_type:"form"` from a Google Sheet. But reusing it would force the LMS's code-owned form into a
maintained Google Sheet purely so the Lambda has something to read — an async hop + a Sheets
dependency to produce a quiz whose content the LMS already knows exactly. The direct path keeps the
form in one place (LMS config), is synchronous and inspectable, and is faithful to the validated
prototype. Cost: two env vars (`QUIZ_BACKEND_URL`, `QUIZ_AF_API_KEY`) **and** the responsibility to
make the session launchable ourselves (the Lambda no longer backfills `session_id`/`platform_id`/
`portal_link`/Firestore — see the meta_data contract below; we pre-fill them as the prototype did).

### Branch strategy (decided)

Branch off **`main`**, NOT stacked on #124/#125. Those PRs are a large unmerged stack; stacking would
block this feature's merge on theirs. We only need the *mapping* (schema captured above), so we own a
small teacher query gated by a `checkCentreManagementSchema()`-style probe that **falls back to the
`user_permission` teacher list** when the centre tables are absent. Result: merges independently today
(via fallback) and auto-upgrades to seat-based mapping once #124/#125 land — no rebase.

---

## Background facts established (for reviewers)

- **The LMS already creates db-service `/session` rows** — `src/app/api/quiz-sessions/route.ts`
  POSTs to `${DB_SERVICE_URL}/session` (`DB_SERVICE_URL` / `DB_SERVICE_TOKEN`). We reuse this code
  pattern and its `meta_data` shape.
- **quiz-backend `/quiz` contract** (from prototype `create_teacher_feedback_pilot.py:156`):
  `POST {QUIZ_BACKEND_URL}/quiz` with the quiz JSON body → returns `{ "id": "<quiz_id>" }`.
- **Form-quiz JSON shape** is fully worked out in the prototype `build_quiz()` / `make_question()`
  (single-choice options carry `metadata.score` 2/1/0; open-ended → `type:"subjective"`;
  `metadata.quiz_type:"form"`, `next_step_url`/`next_step_text` for chaining). We port this to TS.
- **Session `meta_data`** for a form session — **canonical quiz-creator values only** (`Options.ts`):
  `test_type:"form"`, `test_format:"questionnaire"`, `test_purpose:"one_time"` (no feedback purpose
  exists in the enum), `course`/`stream` matching the batch (or blank), `single_page_mode:true`,
  `next_step_url`, plus our own `feedback_teacher_id` / `feedback_teacher_name` / `feedback_cycle_label`
  for traceability. See the full field-by-field contract below — values were checked against the
  quiz-creator constants after confirming the prototype's non-canonical values (`teacher_feedback`,
  `course:"Teacher Feedback"`, `stream:"feedback"`) are accepted by the backend but are NOT canonical,
  so we don't reuse them.
- **Gurukul** lists each session as its own card (per-student via batch/group membership, filtered to
  **today** + active window). No chaining lives in Gurukul, so N independent sessions = N cards,
  any-order — exactly what we want. The session start/end window governs visibility.
- **School → batch** mapping: `school_batch JOIN batch` where `batch_id LIKE 'EnableStudents_%'`
  (parent = grade batch, children = class batches). Same query the quiz-sessions route uses.
- **Teacher list — centre-seat mapping (#124/#125), schema verified from the PR branch.** The chain is:
  `centre_positions cp` (cols `user_id, centre_id, role, hr_code, deleted_at`) → `centres c`
  (`id, name, school_id`) → `school s` (`id, code`), with `teacher t` (`user_id, teacher_id,
  is_af_teacher, exit_date, subject_id`) → `"user" u`. Teachers at a school:
  ```sql
  SELECT DISTINCT t.id, u.email, u.first_name, u.last_name, t.teacher_id, sub.name AS subject
  FROM centre_positions cp
  JOIN centres c ON c.id = cp.centre_id
  JOIN school  s ON s.id = c.school_id
  JOIN teacher t ON t.user_id = cp.user_id AND t.is_af_teacher = true AND t.exit_date IS NULL
  JOIN "user"  u ON u.id = t.user_id
  LEFT JOIN subject sub ON sub.id = t.subject_id
  WHERE s.code = $1 AND cp.deleted_at IS NULL
  ```
  **Critical dependency**: these tables are gated by `checkCentreManagementSchema()` and **are NOT on
  `main`** (they ship with #124/#125). The new `/api/teacher-feedback/teachers` route must run a schema
  check and **fall back to the existing `user_permission` source** (the current `/api/pm/teachers`
  query) when the centre tables are absent — so the feature works before/after those PRs merge. Note:
  even the PR's own `/api/pm/teachers` still reads `user_permission`; seats there drive *access scope*,
  not the teacher picker — so reusing the seat mapping for the picker is a deliberate, new query.
  Free-text teacher add stays as a final fallback for thin rosters.
- **Report (VERIFIED against real BQ data 2026-06-22)**: feedback answers DO land in BigQuery — in
  the form-specific table `avantifellows.assessments.all_responses_form_level` (NOT the graded
  `production_dbt_final.*` the app currently uses). Confirmed columns + values by querying with
  `etl-data-flow/flows/quizzes/avantifellows-bigquery-creds.json` (project `avantifellows`, location
  `asia-south1`):
  - `test_id` (= quiz_id we store at setup), `user_id`, `session_id`, `question_position_index`,
    `question_type`, `user_response`, `user_response_labels`, `is_answered`, `test_type='form'`,
    `grade`, `batch`, `group`, `start_quiz_time`/`end_quiz_time`.
  - **`user_response`** = option **index** as string (`'0'`/`'1'`/`'2'`) → score map `0→2, 1→1, 2→0`
    (identical to prototype `score_answer()`).
  - **`user_response_labels`** = chosen option **text** for single-choice; **raw subjective text** for
    `question_type='subjective'`.
  - Join to the V2 form config by `question_position_index` (0–13 scored, 14–15 open-ended).
  - The 3 prototype quizzes already have real multi-student data (5/3/5 users) — the prototype's
    "too sparse" caveat is stale. So the report is **pure BigQuery**, reusing `getBigQueryClient()`;
    no Mongo dependency. (`QUIZ_MONGO_URL` is stored in env as a fallback but should go unused.)

---

## Architecture

```
PM (standalone page)
  └─ pick school → batch (grade 11/12) → teachers[] → start/end window → [Set up]
        │  POST /api/teacher-feedback/setup
        ▼
   LMS server (one transaction-ish sequence, per teacher, in chain order):
     1) POST {QUIZ_BACKEND_URL}/quiz   (form JSON from teacher-feedback-form config; teacher in title;
                                        next_step_url wired to the *next* teacher's session)  → quiz_id
     2) POST {DB_SERVICE_URL}/session  (platform:quiz, platform_link:quiz_id, batch-scoped meta_data,
                                        test_type:form, feedback_teacher_id/name, next_step_url)   → session
     3) (reuse existing) attach group-session + session-occurrence so it surfaces on Gurukul
     4) record a local LMS row linking cycle ↔ school ↔ batch ↔ teacher ↔ quiz_id ↔ session_id
        ▼
   Student (Gurukul): sees N feedback cards, fills any/all in any order
        ▼
PM (report page)
   └─ GET /api/teacher-feedback/report?cycleId=…
        BigQuery all_responses_form_level WHERE test_id IN (cycle's quiz_ids)
        → per student per question: user_response idx → score; subjective text from labels
        → aggregate per teacher/param (per-teacher independent) → table + subjective
```

### Recurrence model (feedback runs ~monthly/bi-monthly)

Each round creates a **new** set of quizzes + sessions (old quizzes' windows are closed and their
responses belong to the prior period — never reuse). Identity/grouping lives in **structured fields we
own**, never the title:

- **Auto month-year cycle label.** PM does NOT type a label. On setup, stamp
  `cycle_label` = the setup month (e.g. `"Jun 2026"`) onto every `lms_teacher_feedback` row, plus a
  `setup_run_id` (uuid) + `created_at` so two rounds in the same month don't silently merge.
- **Quiz `source_id` carries the cycle**: `teacher-feedback:v2:{schoolCode}:{YYYY-MM}` → lands on every
  BQ `all_responses_form_level` row as `cms_test_id`. So a cycle's BQ rows are self-identifying even
  without the local table.
- **Report groups by `(school_code, cycle_label)`** → collapsible per-month sections (newest first).
  Past cycles always remain reportable (BQ keeps the rows; we keep the quiz_ids).
- **Title** (`Student Feedback – {cycleLabel} – {school} – {teacher}`) is human-readable only, NOT a
  join/identity key.

### Session window (PM-controlled, like quiz sessions)

Mirror the quiz-session UX: PM sets `startTime`/`endTime` at setup (the existing quiz-session create has
a ~4h default for live tests). For feedback, **default the window to ~1 day** (editable by the PM; tune
later). Once `end_time` passes, the session ages off Gurukul on its own — **no housekeeping / no
active-cycle blocking in v1**; old cycles stay readable from BQ via stored quiz_ids.

### Local persistence (new LMS table)

We need a local record so the report can find each cycle's teachers→quiz_ids without re-deriving from
db-service. Proposed table `lms_teacher_feedback` (LMS-direct, like the PM-visit tables):

```
id, school_code, batch_parent_id, batch_class_ids (text[]), grade,
cycle_label (e.g. "Jun 2026", auto-derived from setup month),
setup_run_id (uuid, shared by all teacher rows of one setup),
teacher_id (nullable), teacher_name, teacher_order,
quiz_id (quiz-backend id), session_pk (db-service id), session_id (string),
source_id (= quiz source_id / BQ cms_test_id),
created_by (email), start_time, end_time, deleted_at, inserted_at, updated_at
```
One row per teacher per setup. A **cycle** = rows sharing `setup_run_id` (and they all share the same
`(school_code, cycle_label)`); `setup_run_id` disambiguates the rare two-rounds-in-one-month case.

---

## File-by-file plan

### Form config (port the CSV → typed config)
- **`src/lib/teacher-feedback-form.ts`** (NEW)
  - Port `Proposed Student Feedback Form - Final_V2.csv`: 14 single-choice scored params (scores 2/1/0)
    grouped into 7 categories (Planning, Concept, Curiosity, Class Structure, Communication,
    Inclusive & Equitable Classroom, Learning Outcome) + 2 open-ended. `MAX_SCORE = 28`.
  - Export `buildFeedbackQuizBody({ teacherName, nextStepUrl, nextStepText, grade })` — the TS port of
    the prototype `build_quiz()`/`make_question()` producing the quiz-backend `/quiz` POST body.
  - Export scoring helpers used by the report: option-index → score, param grouping, max-per-param.
  - Colocated `teacher-feedback-form.test.ts` (config integrity, score mapping, quiz-body shape).

### quiz-backend + session clients
- **`src/lib/quiz-backend.ts`** (NEW) — thin authenticated client. **Write-only** (report uses BQ).
  - `createFormQuiz(body): Promise<{ id: string }>` → `POST {QUIZ_BACKEND_URL}/quiz` (returns `{id}`,
    confirmed via prototype `post_quiz`). Env: `QUIZ_BACKEND_URL`, `QUIZ_AF_API_KEY`. Add to
    `.env.example` + Amplify env (prod/staging URLs already in `.env.local`).
- **`src/lib/teacher-feedback-session.ts`** (NEW) — builds the db-service `/session` payload and the
  group-session / session-occurrence attach calls. Reuses `DB_SERVICE_URL`/`DB_SERVICE_TOKEN` and the
  `quiz-session-time` IST helpers.

#### Quiz `metadata` + session `meta_data` — the load-bearing contract (verified against the form ETL)

This is the part that determines whether (a) the student can launch the card, (b) the card shows on
Gurukul, and (c) the **report can filter** — because the form ETL (`etl-data-flow/flows/quizzes`
`lambda_function.py`) stamps several of these onto every BQ `all_responses_form_level` row. **Treat
this as a strict contract, not "copy the prototype".** Verified facts driving each field:

- **We use the DIRECT quiz-backend path, so the sessionCreator Lambda is NOT triggered** (no SNS
  `db_id` for these). Therefore the LMS must itself produce a *launchable* session — we cannot rely on
  the Lambda to backfill `platform_id`/`session_id`/`portal_link`/Firestore. The setup route must:
  create the quiz → then POST `/session` with `session_id = "{program}_{quiz_id}"`,
  `platform_id = quiz_id`, `platform_link = quiz_id`, `portal_link = {PORTAL_URL}?sessionId={session_id}`
  pre-filled (mirroring what the prototype `create_lms_session` set and what the Lambda would otherwise
  fill). _Open item: confirm a feedback session created this way is launchable on Gurukul/portal
  exactly like a Lambda-created one — the prototype's sessions were, so this is expected, but verify on
  staging in build step 3 before wiring UI._

- **Quiz `metadata` (POST /quiz body)** — these flow into BQ via the ETL reading the quiz doc:
  - `quiz_type: "form"`, `test_format: "questionnaire"` — selects the ETL's FORM path (writes to
    `all_responses_form_level`). **Wrong value here = answers never reach the form table.** Both are
    **canonical** quiz-creator values (`Options.ts`).
  - `source_id` — **becomes `cms_test_id` on every BQ row** (ETL line ~799). Set it to a stable,
    queryable identifier, e.g. `teacher-feedback:v2:{schoolCode}:{cycleLabel}` so a cycle's rows are
    findable even without the quiz_id list. `source: "teacher-feedback"`.
  - `next_step_url` / `next_step_text` / `next_step_autostart:false` — chaining (set to the *next*
    teacher's portal link; last teacher → "Finish", empty url). Consumed by the quiz frontend.
  - `graded:false`, `show_scores:false`, `review_immediate:true`, `single_page_mode:true`,
    `single_page_header_text` — students must NOT see a score; single-page form UX. (From prototype.)
  - Per-question `metadata.score` (2/1/0) on options, `type:"subjective"` for open-ended — already in
    the form config; this is the scoring source mirrored in `user_response` index.

- **Session `meta_data` (POST /session)** — these are what Gurukul filters on and what the ETL copies
  to BQ rows (`group/batch/grade/course/stream/test_format/test_purpose` — ETL lines ~1259-1265):
  - `group` — the program (e.g. the school's program tag). **Goes to BQ `group`**; also Gurukul filters
    `meta_data->>'group'`. Must match the batch's program so the card surfaces.
  - `batch_id` — comma-joined `classBatchIds`; **BQ `batch`**; Gurukul card scoping. `parent_id` =
    parentBatchId.
  - `grade` (int), `course`, `stream` — copied to BQ. **Use only canonical quiz-creator values**
    (`Options.ts`): `course`/`stream` **match the batch's real course/stream**, or leave **blank** if
    unknown. Do NOT invent `course:"Teacher Feedback"` / `stream:"feedback"` (the prototype did; we
    don't).
  - `test_type: "form"`, `test_format: "questionnaire"` — canonical. **`test_purpose: "one_time"`** —
    canonical; there is **no feedback purpose** in the enum, so we do NOT write `"teacher_feedback"`.
  - **Report identification (NOT via `test_purpose`)**: since no canonical purpose marks feedback, the
    report finds rows by the quiz **`source_id`** (our namespace, see quiz metadata above) + the
    `lms_teacher_feedback` quiz_id list — both owned by us, neither abusing an enum.
  - `cms_test_id` — set to the same `source_id` as the quiz for consistency (this is our marker on
    every BQ row).
  - **NEW feedback-link fields** (our additions, not consumed by ETL but stored for traceability and as
    a secondary join key): `feedback_teacher_id`, `feedback_teacher_name`, `feedback_teacher_order`,
    `feedback_cycle_label`, `feedback_school_code`. The authoritative cycle↔teacher↔quiz_id link still
    lives in the local `lms_teacher_feedback` table (below); these are redundancy for ops/debugging.
  - Launch/UX passthroughs mirrored from the working prototype: `single_page_mode:true`,
    `single_page_header_text`, `next_step_url`/`next_step_text`/`next_step_autostart`, `show_scores:false`,
    `show_answers:true`, `marking_scheme:"0,0"`, `gurukul_format_type:"qa"`, `status:"success"`,
    `created_by`, `created_from:"lms"`, `date_created`.
  - **Reconcile with the existing `/api/quiz-sessions` payload** (`route.ts:335-407`) field-by-field
    during build — keep names/casing identical where they overlap so Gurukul/ETL treat our sessions
    like any other; only diverge where "form" genuinely differs from a graded test.

### API routes
- **`src/app/api/teacher-feedback/setup/route.ts`** (NEW) — `POST`
  - Auth: PM/admin with edit access (reuse `requireQuizSessionAccess` / visits-policy actor + school
    access check). Validate school access + batch belongs to school (reuse `getBatchesForSchool` +
    `canAccessQuizSessionBatches`).
  - Body: `{ schoolCode, parentBatchId, classBatchIds[], grade, startTime, endTime,
    teachers: [{ id?, name, order }] }`. `cycleLabel` is **derived server-side** from the setup month
    (not in the body); `endTime` defaults to ~1 day after `startTime` if the client doesn't set it.
    Generate one `setup_run_id` for the whole request.
  - For each teacher in chain order (last → first so each can reference the *next* session's
    `next_step_url`, exactly like the prototype loop): create quiz → create session → attach
    group/occurrence → insert `lms_teacher_feedback` row.
  - Idempotency / partial-failure: if teacher k fails, return what succeeded + which failed; do not
    silently half-create. (Soft-deletable rows so a failed run can be retried/cleaned.)
- **`src/app/api/teacher-feedback/cycles/route.ts`** (NEW) — `GET ?schoolCode=` list past setups
  (grouped cycles) for the school; `GET /[id]` detail.
- **`src/app/api/teacher-feedback/report/[cycleId]/route.ts`** (NEW) — `GET`
  - Load the cycle's teacher rows (`lms_teacher_feedback`) → collect their `quiz_id`s →
    new `src/lib/teacher-feedback-bq.ts` function queries
    `avantifellows.assessments.all_responses_form_level WHERE test_id IN (@quizIds)` (parameterized,
    via existing `getBigQueryClient()`), returning per `(test_id, user_id, question_position_index)`
    rows of `user_response` + `user_response_labels` + `question_type`.
  - Aggregate in TS (port `generate_teacher_feedback_report.py`): map `user_response` idx → score
    (0→2/1→1/2→0) for scored qpis, group by param via the form config, collect subjective text from
    qpi 14/15 labels. **Per-teacher independent** (a student who rated 2 of 3 teachers contributes 2).
  - Return `{ teachers: [{ name, totalPct, params: {…}, responseCount, subjective: {liked[], improve[]} }],
    summary: { avgPct, responseCounts } }`.

### Pages / UI (reuse existing styles)
- **`src/app/school/[udise]/teacher-feedback/page.tsx`** (NEW, server) — gate access, render client.
- **`src/components/teacher-feedback/TeacherFeedbackSetup.tsx`** (NEW, client)
  - Batch picker (grade 11/12 + class batches) — reuse the quiz-sessions batch-select widgets.
  - Teacher multiselect — fetched from the **centre-seat mapping (#124/#125)** via a new
    `/api/teacher-feedback/teachers?schoolCode=` route (`centre_positions → centres → school`), reusing
    the chip/checkbox UI pattern from `AFTeamInteractionForm`. Allow reordering (chain order) +
    (fallback) free-text add if the seat roster is thin.
  - Start/end window inputs (IST), reusing `quiz-session-time` formatting.
  - On submit → `POST /api/teacher-feedback/setup`; show created sessions + Gurukul-visible window.
  - Past-cycles list with a "View report" link per cycle.
- **`src/components/teacher-feedback/TeacherFeedbackReport.tsx`** (NEW, client) — render the report
  using the existing analytics table styling (per-teacher total %, parameter-wise table, subjective
  list, response counts). Mirrors the prototype's markdown report structure as on-screen tables.
- **Surface the entry point**: add a tab/link on the school page (alongside the existing
  Quiz Analytics / Visits tabs) — admin/PM only, behind the same access gate as quiz-sessions.

### Tests (follow repo conventions — colocated Vitest)
- `teacher-feedback-form.test.ts` (config + scoring + quiz-body shape)
- `teacher-feedback-session.test.ts` (session payload shape)
- route tests for `setup` (mock quiz-backend + db-service fetch; assert per-teacher create + order +
  partial-failure behavior), `cycles`, `report` (mock the BQ form-level rows → assert scoring math
  matches the prototype's known JNV Palghar numbers, e.g. Manjit 19/28 = 67.86%).
- component tests for setup (teacher select, batch gating) + report (table render) — mirror existing
  `*Form.test.tsx` patterns.

---

## Prerequisites / open items to confirm before/while coding

1. **Env** — DONE: `QUIZ_BACKEND_URL` (prod/staging), `QUIZ_AF_API_KEY`, `QUIZ_MONGO_URL` are in
   `.env.local`. Still TODO: add the names to `.env.example` and Amplify env for deploy.
2. **Report data source** — RESOLVED: BigQuery `assessments.all_responses_form_level` (verified). No
   quiz-backend read / Mongo needed. ~~quiz-backend read endpoint~~.
3. **Teacher source** — RESOLVED to centre-seat mapping (#124/#125); exact schema pulled from the PR
   branch (query above). Tables are NOT on `main` and are schema-gated, so the route must fall back to
   the `user_permission` query when absent. Decide at build time whether to wait for #124/#125 to merge
   (cleaner) or ship with the fallback first. Free-text add stays as the thin-roster fallback.
4. **Marking scheme / form quiz fields**: reuse the exact prototype values (`graded:false`,
   `show_scores:false`, `single_page_mode:true`, `review_immediate:true`) — students must not see a
   score for a feedback form.
5. **BQ access at runtime**: the LMS reads BQ via `getBigQueryClient()`, which needs
   `GOOGLE_SERVICE_ACCOUNT_JSON` (or `GOOGLE_APPLICATION_CREDENTIALS`). Currently empty in `.env.local`
   — the quiz-analytics feature already depends on this, so it should be populated in deployed envs;
   confirm for local dev when building the report half.

## Suggested build order

1. `teacher-feedback-form.ts` (+ test) — pure, no deps. Validate scoring against prototype numbers.
2. `quiz-backend.ts` create path + `teacher-feedback-session.ts` (+ tests, mocked).
3. `setup` route (+ test) → manually run once against **staging** for one school/3 teachers; confirm
   (a) 3 quizzes created in quiz-backend, (b) 3 sessions created, (c) **a student can actually launch a
   card on Gurukul/portal** (the direct path skips the Lambda, so this proves our pre-filled
   `session_id`/`platform_id`/`portal_link` are sufficient), (d) after a test submission, a row appears
   in BQ `all_responses_form_level` with the expected `cms_test_id` (= our `source_id`),
   `group`/`batch`/`grade` (canonical `test_type='form'`, `test_format='questionnaire'`,
   `test_purpose='one_time'`).
4. Setup UI page + school-page entry point + `/api/teacher-feedback/teachers` (centre-seat).
5. Report: `teacher-feedback-bq.ts` + report route + report UI. (BQ source confirmed; can validate
   against the existing JNV Palghar data immediately.)

## Out of scope (v1)
- LLM qualitative summary of open-ended text (deferred; structure leaves room to add it).
- Admin-editable form (form stays fixed config).
- Mongo as a report source (BQ form-level table is sufficient).
