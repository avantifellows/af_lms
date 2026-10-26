---
name: data-access
description: The five data backends and the reads-vs-writes split — when to use Postgres directly, the DB Service proxy, BigQuery, DynamoDB, or S3. Load before any read or write.
triggers:
  - "database"
  - "query"
  - "write"
  - "read"
  - "db service"
  - "bigquery"
  - "dynamodb"
  - "s3"
  - "fetch"
  - "sql"
edges:
  - target: context/architecture.md
    condition: when seeing how data access fits the overall request flow
  - target: context/conventions.md
    condition: when writing the SQL / route code around the access
  - target: patterns/db-service-write.md
    condition: when adding a write that must proxy to the DB Service
  - target: patterns/add-api-route.md
    condition: when adding a route that reads or writes
last_updated: 2026-10-24
---

# Data Access

Five backends. Picking the wrong one for a write is a real bug — read this before touching data.

## 1. PostgreSQL — `query()` (the default)
`import { query } from "@/lib/db"` → `query<RowType>(sql, params)`. Returns `rows`.
- **All reads** (lists, dashboards, detail pages, scope resolution).
- **Direct writes** for LMS-owned tables only: PM visits (`lms_pm_school_visits`, `lms_pm_school_visit_actions`), curriculum (including Curriculum Plans: `lms_curriculum_plans`, `lms_curriculum_plan_chapters`, `lms_curriculum_plan_assignments`, written through `src/lib/curriculum-plans.ts` (Plan Assignments, by plan and by Centre, plus Centre coverage through `src/lib/curriculum-plan-assignments.ts`) in `withTransaction()` with the plan row locked `FOR UPDATE`; the plan schema preflight (`checkCurriculumPlansSchema`) lists every column those writes use, audit columns included, so a partly applied migration 503s; db-service owns their migrations, mirrored by `e2e/fixtures/migrations/20261019120000_add_lms_curriculum_plans.sql` and `20261023091700_widen_lms_curriculum_plan_exam_tracks.sql`, which lets `exam_tracks` include `cet` and indexes the remaining foreign keys), permissions/centre tables, Academic Mentor-Mentee Mappings, Holistic Mentorship product records, and intervention flags (`lms_student_intervention_flags` + append-only `lms_student_intervention_flag_updates`; a DB trigger allows only clearing `body`).
- Holistic Profile regeneration first records an attributable request atomically in Postgres, then calls the configured ETL collection endpoint at `/{request_key}/enqueue` with the matching `APP_ENV` in the body. No Student data is sent. Ambiguous network outcomes remain queued for retry; confirmed rejection is recorded as failed without replacing the previous Profile.
- Curriculum eligible Centres (#417) have one definition: `src/lib/curriculum-eligible-centres.ts`. `ELIGIBLE_CENTRE_TRACKS_FROM_SQL` (`centres c` + `school s` + `centre_exam_tracks cet`) and `ELIGIBLE_CENTRE_SQL` (active, physical, JNV) are static fragments. Plan assignment (by plan, by Centre, Centre coverage) and the Curriculum Summary's `scoped_centres` both build their queries from them, so the Centres you can assign match the Centres the Summary shows. `loadTracksWithContent(db, { gradeIds } | { gradeNumbers })` returns the Grade's in-syllabus LMS Chapter Exam Config tracks, keyed by Grade number. Change the rule there, never in a copy.
- Multi-statement writes: `withTransaction(async (client) => { ... })` (no nesting — it throws).
- Pool is a singleton (10 conns, 15s `statement_timeout`, 5s connect timeout). **Always `$1` placeholders.** This module is server-only — never import it (transitively) into a client component.
- DB naming: Ecto — `inserted_at`/`updated_at`, snake_case, server TZ UTC. Derive IST dates in SQL: `(NOW() AT TIME ZONE 'Asia/Kolkata')::date`.

## 2. DB Service (Elixir/Phoenix) — proxied writes
External HTTP API. **Student, batch, quiz-session, and document writes go here**, never direct to Postgres.
```ts
const res = await fetch(`${process.env.DB_SERVICE_URL}/student/${id}`, {
  method: "PATCH",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.DB_SERVICE_TOKEN}` },
  body: JSON.stringify(fields),
});
if (!res.ok) { const text = await res.text(); /* surface upstream error */ }
```
- Pattern lives in routes like `src/app/api/student/[id]/route.ts`, `src/app/api/batches/[id]/route.ts`.
- Multi-entity updates (e.g. student fields + grade + batch enrollment) issue **separate** DB Service calls and accumulate per-call `errors`/`warnings` — partial success returns `{ ...results, warnings }`.
- The Service owns the canonical write validations for the shared schema; the repo is separate (`/Users/deepanshmathur/Documents/AF/db-service`), including its migrations.
- **`/student-exam-record` (exam registrations, #434):** `POST` doubles as an upsert keyed on
  (`student_id`, `application_number`) — *not* on the exam — so posting a number the Student
  already has on another exam would move that row. The LMS therefore tracks record ids,
  `PATCH`es by id, deletes removals before writing, and refuses a number already stored
  against another of that Student's exams. `application_number` is required by the Service's
  changeset. `sessions_applied` (integer array, stored sorted and deduped, `[]` → NULL) comes
  from the db-service `feat/student-exam-record-sessions-applied` branch and must be deployed
  before the LMS Exams tab.

## 3. BigQuery — quiz analytics reads (read-only)
`src/lib/bigquery.ts`, lazy singleton `getBigQueryClient()`. Credentials via `GOOGLE_SERVICE_ACCOUNT_JSON` (string) or `GOOGLE_APPLICATION_CREDENTIALS` (file). Used by `/api/quiz-analytics/*`. Read-only; uses `CURRENT_ACADEMIC_YEAR` from constants.
- **Student key — always `enrollment_user_id`:** count, group, filter and join students on `enrollment_user_id`, never on `fk_student_id` / `pk_student_id`. Those are NULL for a student who has only an APAAR ID (most of them JNV NVS; in AY 2026-27, 2,185 of 279,229 `dim_student` rows), and `COUNT(DISTINCT …)` skips NULLs. `dim_student.enrollment_user_id` is never NULL. Until 14 Oct 2026, `getBatchOverviewData` counted takers by `fk_student_id` and enrolment by `pk_student_id`, and `getCumulativeALData` filtered `fk_student_id IS NOT NULL` and joined `dim_student` on `pk_student_id`. At JNV Barabanki, Grade 12 showed 8 enrolled against 75. Both now key on `enrollment_user_id`. `CumulativeALRow.student_id` now holds the `enrollment_user_id` as a row key, not the business Student ID. `getStudentQuestionLevelData` and `getStudentTimeSpentData` already used `enrollment_user_id`.
- **NVS batch overview:** when the program is JNV NVS (`isNvsProgram()` in `src/lib/constants.ts` — the one client-safe place that compares the label), `getBatchOverviewData`'s test-list query adds the static literal `AND test_purpose = 'system_wide_mandated'`. Enrollment counts, params, and the response shape don't change. On the client, `usePerformanceFilters` exposes `isNvs`; `BatchOverview` then lists every returned test (no Chapter/Full split, no subject/test-grade filters) and uses the empty state "No system-wide mandated tests yet for this grade/stream". A single-program school's program is derived from the grades response (never written to the URL), so the first overview render is already scoped (#352, #392).
- **Batch-overview stream options (PR #376):** `getBatchOverviewData`'s enrolment query (`GROUP BY student_stream`) doesn't filter by stream, so the returned `streams` always lists every stream at the School and grade. The Performance Stream filter therefore keeps all its options after one is picked. `summariseEnrolment` applies the selected stream to `totalEnrolled` and `enrolledByStream` in JS, with the same `LOWER(stream) = @stream` semantics as before; the test-list query still filters by stream.
- **NVS Student Results:** `StudentResultsTable` hides the AL and On Track columns when `isNvsProgram(program)` is true, exactly as it does for Advanced tests (`showALColumns`). Its header cells are built as one list, and the expanded row's `colSpan` is `headerCells.length`. So to add a column, add it to that list (#353).
- **Student Results row identity:** `StudentResultsTable` identifies each row by `studentKey()`: `enrollment_user_id`, or `student_name` only when the id is null (with `id:` / `name:` prefixes, so the two never collide). The row `key`, the expanded-row state and the rank map all use it. Sorting and display still use the name. Two Students with the same name in one test are common in large Schools, so never key a Student on the name.
- **NVS Performance filters:** for JNV NVS, `effectiveSelection()` in `src/components/performance/usePerformanceFilters.ts` forces the effective `testCategory="full"`, `fullTestView="per_test"`, and no subject/testGrade, so the overview never gets a subject or test grade and the Cumulative AL table never renders. `PerformanceFilterBar` gets `isNvs` and renders only Grade and Stream. The raw selection and URL are left as they are: `?view=cumulative&category=chapter&subject=…&testGrade=…` is ignored on NVS, not rewritten.
- **Performance filter history (#392):** `usePerformanceFilters` reads every raw selection (program, grade, stream, subject, testGrade, category, view, session) from the URL on each render, so Back/Forward rehydrates the mounted tab in place. Deliberate choices `router.push` one entry each with `scroll: false`, carrying their resets atomically (Program clears grade/session/stream/subject/testGrade; Grade clears session/stream/subject/testGrade; Category clears testGrade, and subject when leaving Chapter). Reselecting is a no-op. Automatic Grade reconciliation uses `replace`. Patches compose against the latest *intended* query, but navigations go to the router one at a time (the App Router drops a pending navigation when another starts, which would lose a history entry); any other URL landing is Back/Forward and discards the queue. Grades and `BatchOverview` responses are keyed to their request, so obsolete success/failure/option publications are inert. Report open/close: see #393 below.
- **Performance report history (#393):** opening a report pushes `session` (one step, `scroll: false`); `TestDeepDiveView` is keyed by session, so a new report starts fresh and nameless until its own data names it. "Back to overview" calls `router.back()` only when the hook's transient trail (in `usePerformanceUrl`, in memory per mount) proves the current entry was pushed by the tab directly on top of its own overview (same query without `session`). The trail follows Back/Forward by matching exactly one neighbouring entry's URL; an ambiguous or unrelated URL, a replace of the entry, a reload, a direct link or a remount leaves nothing proven, and then the in-page Back replaces away only `session`. No storage. `SchoolTabs` derives the visible tab from `?tab=` (absent/invalid → `defaultTab` if visible, else the first tab), so history to `tab=performance` remounts Performance from its URL. A tab click synchronously uses native `history.replaceState`, preserving every unrelated query parameter and the hash before its content mounts; this prevents a fast automatic Grade replace from erasing `tab=performance`. Performance loading frames keep the previous settled height only while data reloads, then release it to the new content's natural height or the minimum needed to keep the current non-zero scroll valid. Scrolling upward can only shrink that floor, while downward scrolling cannot grow it; stale interactive content is never kept on screen. On report-to-overview transitions, if the shorter natural overview is entirely above the current viewport, the frame releases the report height and scrolls only as far as the last viewport that intersects the overview. Normal filter/history transitions and report exits that already overlap the viewport keep their scroll position.
- **Deep-dive response ownership (#393):** `TestDeepDive` aborts an obsolete request and also marks its lifecycle inactive, so a fetch implementation that resolves or rejects after abort cannot publish stale report data, errors, loading state, or the report-name callback over the current session.
- **NVS Time Spent (#357):** `getStudentTimeSpentData()` reads `MAX(total_time_spent)` (INT64 seconds) from `fact_student_test_results_overall`, grouped by `enrollment_user_id` + `LOWER(section)`. Its filters are the same as `getStudentQuestionLevelData` (udise, student grade, session, current year, optional program/stream, `enrollment_user_id IS NOT NULL`). It returns `Map<id, { overall, bySection }>`. The `test-deep-dive` route calls it only when `isNvsProgram(program)`, in parallel with the DynamoDB read, and merges `time_spent_seconds` onto each student (overall) and each subject score (`subject.toLowerCase()`). Unmatched students get null. If the lookup fails, the route logs only the error message and returns the deep dive with null times; DynamoDB failures still return 500/404. `StudentResultsTable` shows a sortable "Time Spent (min)" column after Attempt Rate (`Math.round(s/60)` or "—", nulls last in both directions), a subject-row time cell, and a blank chapter cell. Non-NVS payloads have no time fields.

## 4. DynamoDB — performance dashboard reads (read-only)
`src/lib/dynamodb.ts`, lazy singleton via `@aws-sdk/lib-dynamodb` `DynamoDBDocumentClient`. Holds test deep-dive reports keyed by school student identifiers (cross-referenced against Postgres rosters). Read-only.

## 5. S3 — document files
`src/lib/s3.ts` (`@aws-sdk/client-s3` + presigner). Student document uploads/reads via presigned URLs; bucket shared with prod (`S3_DOCS_*`). Document **metadata** writes still proxy through the DB Service.

(SNS — `src/lib/sns.ts` — publishes session-creation messages, not a data store.)

## Decision table
| Operation | Backend |
|-----------|---------|
| Any read / list / dashboard | Postgres `query()` |
| Visit / curriculum / permissions / centre / Academic or Holistic Mentorship write | Postgres `query()` / `withTransaction()` (direct) |
| Student / batch / quiz-session / document-metadata write | DB Service `fetch` (Bearer token) |
| Quiz analytics read | BigQuery (`bigquery.ts`) |
| Performance deep-dive read | DynamoDB (`dynamodb.ts`) |
| Document file bytes | S3 (`s3.ts`) |

## Gotchas
- **Never write students/batches/quiz-sessions directly to Postgres** — it bypasses the DB Service's invariants. Read them direct; write them through the Service.
- **Never interpolate SQL** — `$1` placeholders only.
- A missing-schema error (42P01/42703) means the connected DB lacks a DB-Service migration — fix it there, not by adding columns here.
- Don't add a second `pg.Pool` — reuse the `query()` singleton.

## Holistic progress query performance

The September 11, 2026 production Admin progress request for Program 1 / 2026–2027 hit PostgreSQL `57014` after the configured 15-second timeout (CloudWatch at 09:32:52 UTC). The live `centre_students` EXISTS membership view from DB Service #727 expanded repeatedly within the per-Mapping eligibility check. The empty HTTP 500 then surfaced as a client JSON parsing error; reset counters did not indicate zero mapped Students.

`listHolisticProgress` now materializes the selected current-year Program roster once and reuses it in both eligibility and Grade lookup. Keep both references on the same snapshot. Program, Academic Year, current-year, and Grade 11/12 constraints live in the snapshot; its consumers retain Student/School matching and the single-Grade check without repeating those filters. The snapshot carries only Centre ID, User ID, and Grade. The existing School predicate still scopes Mapping history before first-start/latest-Mapping selection; the single-Grade HAVING check and historical enrollment fallback remain intact. Do not replace the shared membership view or increase the database timeout to fix this consumer.

The progress route catches failures after preserving its auth/permission gates, returning a safe JSON 503 for statement cancellation/timeouts and 500 for other failures; logs contain only an error code. The client handles empty/non-JSON bodies and permits Refresh to recover, without surfacing errors from aborted requests. Local E2E fixtures mirror the current DB Service view so they exercise the same roster rules. Read-only production timing of the final SQL was approximately 1.1 seconds for 50 rows / 1,670 mapped Students; the previous query timed out. See the fix PR for final local and staging verification.

## Holistic Students & Progress coverage query (#343)

`listHolisticProgress` returns `coverage: { eligible, assigned, unassigned }` only for the current Academic Year with no Mentor filter and not for the CSV (`all`) read; otherwise `null`. It runs after reconciliation, in parallel with the list query. Shape:

- `holisticMenteeSchoolsCte` — in-scope Schools with at least one active current-year Mapping in the Program. The current-year School dropdown in `getHolisticProgressOptions` uses the same fragment, so selectable Schools and coverage cannot drift. The School scope predicate is applied here (`mapping_school` alias). The past-year dropdown still uses latest-Mapping history.
- `CURRENT_ELIGIBLE_ROSTER_CTES` — a query-local `MATERIALIZED` Program/year `centre_students` snapshot (Grades 11/12), joined to the Program's active Centres and grouped by (School, Student User) with exactly one Grade, then restricted to mentee Schools, non-dropout Students, `school_code`, Grade and Student search. The Unassigned-list slice reuses this building block.
- A pair is Assigned when an active current-year Mapping exists for that Student at that School and Program, exactly like School Assignment Coverage.

The Mapping module's `ELIGIBLE_ROSTER_CTE_SQL` is untouched; parity is enforced by `holistic-progress.spec.ts` against the Teacher roster API. `EXPLAIN (ANALYZE, BUFFERS)` inside `BEGIN READ ONLY` on a local production-derived snapshot (September 24, 2026; 1,808 / 191 active Mappings): coverage 231 ms (Program 1) and 14 ms (Program 78). The current-year School options query measured 2.4 ms (Program 1) and 0.8 ms (Program 78) on the snapshot. The snapshot is a local clone, not live production; never invoke `listHolisticProgress` against production, because its reconciliation mutates.

## Holistic Unassigned Student list (#344)

`listHolisticProgress` dispatches on `filters.progress`. Every value except `unassigned` runs the assigned-Mentee query (SQL text unchanged). `unassigned` runs `listUnassignedStudents`: `holisticMenteeSchoolsCte` + `CURRENT_ELIGIBLE_ROSTER_CTES` (reused, not copied), keeping pairs with no active current-year Mapping for that Student at that School and Program. Each row carries its Grade's `activePhaseId`: the highest-position `open` Phase for that Grade in the Program/year Plan (same rule as the School roster). With `phase_id`, rows are limited to that Phase's Grade within this Program/year Plan, so an unknown or foreign Phase gives an empty list. Sorts reuse `progressOrder`; the CTE exposes `NULL` Mentor, Phase and Progress columns, so those sorts fall back to the tie-breakers. Rows are paged at 50; CSV (`all`) returns every row. Under Unassigned, `counts.total` is the list total and the four progress counts are 0. Reconciliation still runs first, and coverage still ignores `progress`. The route rejects `progress=unassigned` with a past year or `mentor_user_id` (422, before authorization).

On the same local snapshot (September 24, 2026), the Unassigned SELECT took 22–37 ms warm (279 ms cold) for a 50-row Program 1 page, 24 ms for all rows, and 20 ms for Program 78. It is a local clone, not live production.

## Holistic Grade 12 phase labels

Student detail now returns only real current Grade 12 phases when no continuing Grade 11 history applies; it no longer invents four placeholder tabs or forces numbering to start at 5. Existing plan-wide numbering is retained (the reported Maharashtra plan displays Grade 12 as Phase 2). Continuing prior-year history, phase IDs, context precedence, permissions and database access are unchanged. Missing generated profiles do not change numbering and do not establish source-form completion. No schema/data repair is involved.

## September investigation and verification record

These are dated findings, not fresh production measurements:

- DB Service #727 changed Centre membership to existence of a matching Centre
  Program batch. September 10 read-only validation added three expected Punjab
  memberships and removed none, with no observed dual-Centre students. This does
  not prohibit future multi-Program membership: consumer scoping and global active
  Mentorship Mapping uniqueness still need care. The earlier synthetic review
  concerns were not observed production blockers.
- LMS #321 merged September 11 as `b8c22901dad18f79a0f6ecba6de3c27230c0fb32`.
  Exact production Amplify job 151 passed; the reported Admin request returned
  200 in 1.585 seconds with 1,670 mapped Students. Filter, pagination, CSV,
  historical-year, auth and error-recovery checks passed without changing the
  recorded Mapping/Notes/audit aggregate counts. This was a smoke test, not a load test.
- LMS #332 staging job 537 verified real Maharashtra Grade 12 Phase 2 and Grade 11
  Phase 1, including missing/available profiles, for Admin and Teacher. No configured
  locked phase was available for the staging check; local tests covered it.
- LMS #334 addressed the hidden full Enrollment roster loaded by ordinary Admins
  even on a Holistic School tab. Same-snapshot full-row comparisons preserved
  360 School / 123 Centre results while query time improved from 5.68s to 0.45s
  and 2.05s to 0.24s respectively. Staging job 539 measured the incident School
  click at a 755ms median across three fresh browser contexts. One separate direct
  navigation readiness outlier remained unexplained; do not call every fresh
  browser context a cold server measurement.

#332/#334 merged September 18. Broader request-amplification follow-up is LMS
issue #333; a measured DB Service audit-index migration plus LMS query change is
tracked separately in #336. No audit index was applied during these investigations.
Production deployment of the September 18 stack was not established by these notes.
Evidence: sibling `release-records/holistic-phase-label-20260917/` and
`release-records/punjab-nodal-list-investigation-20260917/`.

## Holistic Mentor write scope (#378)

Mentor-owned Holistic writes (Post-Session Notes and Follow-up Notes) share one
guard in `src/lib/holistic-mentor-write-scope.ts`. `loadHolisticMentorWriteScope(client, { studentId, phaseId, schoolId, programId, academicYear })`
runs inside the caller's transaction and takes `FOR UPDATE OF mapping, phase`. It requires
an active Mapping, a non-dropout Student, a single current Grade 11/12 roster Grade, no
privacy tombstone, and an applicable Phase: current-year, or a prior-year Grade 11 Phase
for a Grade 12 Mentee with prior-year Mapping history. It derives the prior Academic Year
itself. `checkHolisticMentorWriteScope(scope, actorUserId)` returns 404 `Not found` for
missing scope or a non-Mentor actor, and 422 `Phase is not Open` otherwise. Do not copy the query into new writers; call the helper so guard semantics and lock order stay identical.

## Holistic Follow-up Notes (#377)

- **Table ownership:** `holistic_mentorship_follow_up_notes` is created by the db-service
  migration `20260930120000_create_holistic_mentorship_follow_up_notes`, but LMS reads and
  inserts rows directly (ADR 0005).
- **Immutable:** triggers reject ordinary `UPDATE` and every `DELETE`; a correction is another
  row. The only update exception is the complete privacy erasure described below. The
  insert trigger takes the per-Student privacy advisory lock, rejects a tombstoned Student, and
  requires submitted Post-Session Notes for the Student and Phase.
- **Write path:** `POST .../phases/{phaseId}/follow-up-notes` authorizes `follow_up_note_add`,
  normalises answers with `normalizeHolisticFollowUpAnswers`, then `addHolisticFollowUpNote`
  runs one transaction: the per-Student privacy advisory lock first (same order as privacy
  deletion), then the shared Mentor write-scope loader's `FOR UPDATE` on Mapping/Phase
  (404/422), then a submitted Post-Session Notes check (422), then `INSERT ... RETURNING id`.
  The trigger re-takes the same advisory lock. Success is 201 `{ id }`; the UI refreshes server
  data.
- **Read audience:** the same as submitted Post-Session Notes. `getHolisticStudentPhase` loads
  `selectedPhase.followUpNotes` for the open selected Phase only, newest first. Locked Phase
  summaries, Student Context, progress, and the CSV never read this table.
- **Privacy (#412):** a tombstone hides Follow-up Notes on read (same-query `NOT EXISTS`) and
  blocks new inserts. The companion db-service migration allows only a full replacement of
  non-null answers with `Content erased under approved privacy request` for that tombstoned
  Student; null slots and all metadata remain unchanged. Ordinary updates and deletes still fail.
  `deleteHolisticStudentContent` takes the Student advisory lock, clears the original content
  families, inserts the original tombstone, then erases Follow-up answers in a separate statement.
  It counts changed answer fields from their pre-update values and records a positive count in
  the immutable `holistic_mentorship_follow_up_erasures` audit, with the actual actor and reason.
  Existing tombstones use the same path without changing their original audit facts; repeats
  return zero and add no audit. Any erasure/audit failure rolls back the entire transaction.
  Deploy the schema before this LMS helper. Privacy erasure remains disabled in the endpoint
  and action policy; the external erasure process must adopt this contract separately. This
  change does not repair historical data or enable a production caller. See
  `patterns/holistic-privacy-erasure.md` for ordering, verification and rollback limits.
- **Code:** `src/lib/holistic-follow-up-notes.ts` (write), `src/lib/holistic-student-phase.ts`
  (read), `src/lib/holistic-follow-up-questions.ts` (client-safe question keys, text, and
  normaliser), `src/lib/holistic-mentor-write-scope.ts` (shared scope guard).

## Holistic Challenge Categories (#457)

- **Catalogue:** `src/lib/holistic-challenge-categories.ts` (client-safe) is the single source of
  the 16 fixed Categories (6 Academic, 10 Non-academic; codes `academic.*` / `non_academic.*` are
  stored and stable, labels may change, ADR-0004), the group labels, validation, grouping, toggling,
  Question placement and the heatmap percent. Import its helpers; never restate a rule.
- **Storage:** `holistic_mentorship_post_session_note_challenges` (db-service #806), one row per
  code, unique `(notes_id, category_code)`, no DB CHECK on codes. Its insert/update trigger shares
  the post-session privacy guard (Student advisory lock, rejects tombstoned Students). Raw SQL (ADR-0005).
  **Deploy db-service #806 first**: without the table every Notes read, write and erasure fails.
- **Validation order:** the student-phase PATCH requires `challenge_categories: string[]` in every
  mode (else 422 `Invalid Notes`). `validateHolisticChallengeCategories(codes, { final: false })` runs
  in the route and again in `saveHolisticNotes` for every mode (trimmed; unknown/duplicate → `Unknown
  Challenge Category`; No major issue mixed in its group → 422). Submit / Edit notes then check
  tokens, state, every answer, and only last ≥1 Category per group (`final: true`).
  A Notes tab left open across the release sends the old payload and gets 422 on its next
  autosave until reloaded; say so in release notes.
- **Writes:** Categories are replaced (delete + insert the validated set) in the same transaction as
  the answers. **Has content** = any answer row **or** any Category row: it drives erased-draft
  claiming on write and read, and a Categories-only first draft creates Notes and freezes the Phase.
- **Erasure:** Category rows are Notes content, deleted with the draft answers on Mapping end,
  Mapping-scoped removal/reassignment and reconciliation, and by `deleteHolisticStudentContent`
  (before the tombstone; the tombstone still counts answers only).
  See `patterns/holistic-privacy-erasure.md`.
- **Reads:** codes are returned in catalogue order with unknown stored codes dropped, wherever
  `answers` is (drafts to their author only). Students & Progress rows and CSV
  (`Academic Challenges` / `Non-Academic Challenges` before `Notes Author Name`) use submitted Notes
  only. MCP's `redactHolisticProgress` hides `challengeCategories` with `answers` unless
  `include_notes=true`: add any new Notes-content field there too. Submitted Notes without
  Categories read "Categories not recorded"; Student Context carries them only when Notes-based.
- **Heatmap:** `GET /api/holistic-mentorship/challenge-categories` (`program_id` number or `all`,
  `academic_year`, `grade` 11|12, optional `phase_id`, optional `format=csv`) gates on `program_read`
  (Teachers 403); bad filters, an off-Plan Phase, or `all` with a Phase are 422. One SQL aggregation
  counts each Student once per code over `submitted` Notes with ≥1 Category, under the latest
  Mapping **after** the School-scope predicate (`started_at DESC, id DESC`), across all requested
  Programs. Schools are keyed by id (`school.code` may be null or shared). `total` is over the same
  Students; hidden Schools = in-scope Mapping Schools with n = 0. Counts only, no Student identity.
  The CSV reuses the grid's percent and `csvCell`; its filename encodes year, Grade, Program, Phase.
- **Tests:** `holistic-challenge-categories.test.ts`, `holistic-notes.test.ts` and
  `holistic-notes.integration.test.ts` (opt-in `HOLISTIC_NOTES_TEST_DATABASE`),
  `holistic-privacy.integration.test.ts`, `holistic-progress.test.ts`, the MCP route test,
  `holistic-challenge-category-heatmap{,.integration}.test.ts` (opt-in
  `HOLISTIC_HEATMAP_TEST_DATABASE`), the heatmap route test, and the Holistic Playwright specs. The
  e2e fixture seeds one categorized Grade 12 Phase 4 Note; see `patterns/debug-e2e-fixtures.md`.

## Blended Learning Mentee list (#442), Mentor cards (#452), Flags feed (#453), detail (#444), logging (#445), Action Items (#446), Mentor Flags (#447), photos (#448), Call Recording drafts (#449, retry/discard #450, review and save #451), playback (#454) and the links load script (#455)

- **Tables:** the `blended_learning_*` tables are created by db-service (Mappings:
  `20260921120000` + its ensure migration; the other eight: PR #804,
  `20261022120000`–`20261022120700`). af_lms reads and writes them directly over SQL (ADR 0005)
  through `query()`/`withTransaction`, never through DB Service HTTP.
- **Mapping source:** active Mappings for `CURRENT_ACADEMIC_YEAR` with `ended_at IS NULL`,
  written once as `activeBlendedMappingSql(alias, yearParam)` in
  `src/lib/blended-learning-access.ts`. `canAccessBlendedStudent` and `listMentees` both use it.
- **Read model:** `listMentees({ access, mentorUserId?, studentId?, today })` in
  `src/lib/blended-learning-mentees.ts`. One query per list: grade from the current grade
  enrollment (`enrollment_record`, `group_type = 'grade'`, `is_current`), program from the
  active Mapping, the latest Conversation and latest Attempt (`(occurred_on, id)` DESC, through
  `LATERAL`), `blended_learning_student_links.legacy_last_contact_on`, and the open draft
  state (`transcribing|ready|failed`). A Mentor always gets their own Mentees, whatever
  `mentorUserId` says; a Mentor without a Mentor user id gets an empty list without a query.
  Rows are grouped (Talk to First = any reason) and sorted in JS by the pure policy.
- **Mentor cards (#452):** `listMentorCards(access, today)` in the same module, for
  `view_mentors` only (anyone else gets `[]`). It reuses the list's query unnarrowed (one row
  per active current-year Mapping, with the Mentor's `user` name, else email) and counts per
  `mentor_user_id`: `assigned`, `grade12`, `grade13`, `talkedLast7` (`talkedToInLastWeek`) and
  `notSpoken30Plus` (`thirtyDaysOrMore`, so no Last Contact counts). Same Last Contact as the
  list, so Attempts and drafts never count. Cards sort A–Z by name.
- **Talk to First policy:** `src/lib/blended-learning-talk-to-first.ts`, pure and client-safe:
  `talkToFirst`, `latestEntryKind`, `lastContactOf`, `compareTalkToFirst`,
  `talkedToInLastWeek`, `thirtyDaysOrMore` (days_since ≥ 30 or no Last Contact). IST calendar dates as `YYYY-MM-DD`. Last Contact is the latest
  Conversation, else the exact `legacy_last_contact_on` (the Profile Doc's latest dated
  conversation), else none (`no_contact`). Drafts never feed it.
- **Search and filters (#443):** client-side in `src/app/blended-learning/FilteredMenteeList.tsx`
  over the already grouped and sorted `MenteeList` (about 46 Mentees per Mentor, so no server
  pagination). Name search is a trimmed, case-insensitive substring match. Gender and Program
  options come from the list itself; Grade is fixed to 12/13. "30 days or more" uses the
  policy's `thirtyDaysOrMore(daysSince)`, so no Last Contact counts and a legacy date counts from
  its day. Filters combine (AND), keep both groups and their order, and are not in the URL.
  When nothing matches, one empty-state card replaces both groups. The mockup was not available
  to this slice; control copy follows the PRD ("Search by name", Gender, Grade, Program,
  "30 days or more", "Clear filters").
- **Mentee detail (#444):** `src/lib/blended-learning-mentee-detail.ts`. `getMenteeDetail(access,
  studentId)` checks `canAccessBlendedStudent`, then reads the profile from the active Mapping
  (program), the current grade enrollment, `user.phone`/`user.whatsapp_phone` (WhatsApp is
  dropped when its last ten digits match the phone; `student.father_phone`/`mother_phone`/
  `guardian_phone` are never selected), `blended_learning_student_links` and the open draft.
  History is every `blended_learning_conversations` row for the Student, `occurred_on DESC, id
  DESC`, with a photo count and `has_notes` flag (the notes HTML itself is not sent to the
  page); Action Items (by `position`) and Mentor Flags (Emotional Well-being, Physics,
  Chemistry, Maths) are fetched per Student and grouped in JS. `getConversationNotes` and
  `getConversationPhotos` resolve the Conversation's Student first, so an Attempt id, a missing
  id or an out-of-scope Student all read as null → 404. Photos are presigned with the existing
  `presignDocumentPage` at a 5-minute TTL; the route logs only the error name on a presign
  failure (502), never the key. Notes render from stored HTML as-is; the write path sanitises
  before insert (#445).
- **Logging a Conversation or Attempt (#445):** `logEntry(access, studentId, body, today)` in
  `src/lib/blended-learning-log-entry.ts`, behind `POST /api/blended-learning/students/[id]/entries`
  (401 / 403 for other roles and read-only / 404 out of scope or malformed id / 422 validation with
  `{ error, fieldErrors }` / 201 `{ entry, mentee }`). Validation runs before the transaction
  (`validateEntry` in `src/lib/blended-learning-log-entry-input.ts`; the session-detail checks it
  shares with draft creation live in `src/lib/blended-learning-session-details.ts`):
  `occurredOn` a real `YYYY-MM-DD` not after today IST; a Conversation needs mode
  `call|in_person`, spoke-with `student|parent_or_sibling|both`, an integer 1–240 duration and a
  non-blank summary; an Attempt takes only an optional note (blank → `NULL`). One
  `withTransaction` re-reads the active Mapping `FOR SHARE` (none, or another Mentor's for a
  Mentor → 404) and inserts the row with the Mapping's `mentor_user_id`, `program_id` and
  `academic_year`, plus `logged_by_email` = the actor (an admin logging on a Mentor's behalf
  keeps the mapped Mentor). `23514` (checks, the Conversation append-only trigger) and `23505`
  map to 409. After commit, `mentee` is the Student's `listMentees` row (`studentId` filter), so
  the confirmation shows exactly what the list now says. Draft save (#451) runs inside the same
  transaction (below).
- **Action Items (#446):** only `kind: "conversation"` accepts `actionItems[]` (`{ owner:
  student|mentor|parent, text }`; a missing owner or blank text gives a 422 keyed
  `actionItems.<i>.<field>`) and `completeActionItemIds[]` (positive
  integers, de-duplicated). Either key on an Attempt is a 422. Inside the same transaction the
  new items are inserted with `position` 1..n after the Conversation. The ticks are one
  `UPDATE … SET status = 'done', completed_by_conversation_id, completed_by_email, completed_at,
  updated_at WHERE id = ANY($3::bigint[]) AND status = 'open' AND student_id = $4`. Fewer
  returned rows than ids (an id already done, unknown or another Student's) throws, so the
  whole save rolls back and returns 409. af_lms makes only that open → done change, and
  `bl_action_items_completion_check` keeps the completion columns consistent. `getMenteeDetail`
  returns each item's `owner` and `openActionItems` (open items, newest Conversation first, with `agreedOn`). There are no
  reminders, overdue logic or item editing.
- **Mentor Flags (#447):** only `kind: "conversation"` accepts `flags[]` (`{ recipient:
  emotional_wellbeing|physics|chemistry|maths, comment? }`; blank comment → `NULL`). An unknown
  recipient, a non-text comment or the same recipient twice gives a 422 keyed
  `flags.<i>.recipient|comment` before the transaction (the `(conversation_id, recipient)`
  unique index would otherwise give 23505 → 409, never 500); `flags` on an Attempt is a 422.
  Flags insert after the Action Items with `raised_by_email` = the actor. After commit,
  `logEntry` awaits `notifyWellbeingFlag(flagId)` (`src/lib/blended-learning-wellbeing-notifier.ts`,
  server-only, `@aws-sdk/client-ses` `SendEmail`) for each Emotional Well-being flag only; a
  rollback calls nothing. The notifier never throws: it skips when SES or the recipients are
  unconfigured (no SES call), or when the flag is not well-being; it reads the Student, grade, program (the Conversation's), mapped
  Mentor and date by `query()`, never the comment, summary or notes; it sends one text email
  from `no-reply@avantifellows.org` to `BLENDED_LEARNING_WELLBEING_EMAILS` with an absolute
  `{NEXTAUTH_URL}/blended-learning/students/{id}` link, once, after commit. It writes nothing
  back: there is no resend path. An SES failure logs only the flag id and the error's name and the save stays 201; no retry in v1.
  Physics, Chemistry and Maths flags notify no one. The log form shows four switches
  (`role="switch"`), each revealing an optional comment; labels come from
  `students/[id]/flagRecipients.ts`, shared with the history chips.
- **Photos (#448):** the log form's picker (`students/[id]/log/PhotoPicker.tsx`, state held by
  the form so Attempt ↔ Conversation keeps it) downscales each picked image with
  `downscaleImage` and POSTs it alone as multipart `photo` to
  `POST /api/blended-learning/students/[id]/photos` → `uploadConversationPhoto(access, studentId,
  file)` in `src/lib/blended-learning-photos.ts` (401 / 403 other roles and read-only / 404 out of
  scope or malformed id / 422 not `image/jpeg|png|webp|heic`, empty or over 10 MiB / 502 S3
  failure, logging only the error name / 201 `{ s3Key, contentType, byteSize }`). The key is
  `{S3_DOCS_PREFIX}/blended-learning/photos/{studentId}/{uuid}.{ext}` (`blendedLearningPhotoPrefix`
  + `uploadObject` in `src/lib/s3.ts`). Only `kind: "conversation"` accepts `photoKeys[]`
  (strings). Before the transaction: more than five → 422 `photoKeys`; a key not exactly this
  Student's prefix + UUID + `jpg|png|webp|heic`, or a repeat → 422 `photoKeys.<i>`; then
  `HeadObject` per key (`headObject`), and a missing object → 422 `photoKeys.<i>`. The row's
  `content_type` comes from the extension and `byte_size` from S3, never from the client. Rows
  insert after the Action Items with `position` 1..n. The form refuses to save while a photo is
  uploading or failed. Orphaned objects from abandoned forms stay in S3 in v1. E2E has no S3, so
  `blended-learning-photos.spec.ts` answers the upload and save requests itself (it never saves);
  saved photos are covered by inserted rows in the detail spec.
- **Call Recordings and Conversation Drafts (#449):** `src/lib/blended-learning-drafts.ts`
  (server-only). The log form's "Call Recording (optional)" section
  (`students/[id]/log/RecordingUpload.tsx`, Conversation only, replaced by a note while the
  Mentee has an open draft) runs three steps; see `patterns/presigned-s3-upload.md`.
  1. `POST /api/blended-learning/students/[id]/recordings/upload-url` → `issueRecordingUpload`
     (401 / 403 other roles and read-only / 404 out of scope / 422 extension not
     `mp3|m4a|wav` (case-insensitive; the browser MIME type is ignored, so an empty one is fine)
     or size not 1 byte–200 MiB / 409 an open draft / 200 `{ uploadUrl, s3Key, contentType }`).
     The type comes from the extension (`audio/mpeg|audio/mp4|audio/wav`); the URL is a 15-minute
     presigned `PutObject` with that `ContentType` signed (`presignUpload` in `src/lib/s3.ts`); the
     key is `{S3_DOCS_PREFIX}/blended-learning/recordings/{studentId}/{uuid}.{ext}`
     (`blendedLearningRecordingPrefix`).
  2. The browser PUTs the file straight to S3 with XHR (`Content-Type` = the returned type),
     showing a progress bar. "Retry upload" restarts from step 1 after a failed PUT, or repeats
     only step 3 when the PUT finished; 403/404/409 refusals offer no retry.
  3. `POST /api/blended-learning/students/[id]/drafts` → `createDraft(access, studentId, body,
     today)` (401 / 403 / 404 as above / 422 `fieldErrors.s3Key` for a key that is not exactly
     this Student's prefix + UUID + `mp3|m4a|wav`, or when `HeadObject` finds no object or a size
     other than `byteSize`; 422 for optional session details: `occurredOn` a real date not after
     today IST, `mode`, `spokeWith`, integer 1–240 `durationMinutes`; blank → `NULL` /
     201 `{ draftId }`). One `withTransaction` re-reads the active Mapping `FOR SHARE`
     and inserts the draft (`transcribing`, the Mapping's Mentor/program/year,
     `created_by_email` = actor, content type from the key; S3's size is checked, not stored)
     and a `queued` Transcription Request with a server-generated UUID `request_key`; the
     open-draft unique index (`23505`) → 409. After commit it awaits `wakeTranscription`.
  - **Waking etl-next:** `wakeTranscription(requestKey)` mirrors Holistic Profile regeneration:
    `POST {BLENDED_LEARNING_ETL_URL}/api/internal/blended-learning/transcription-requests/{key}/enqueue`,
    Bearer `BLENDED_LEARNING_ETL_TOKEN`, body `{"environment": APP_ENV}`, 15 s timeout. No fetch
    when the URL or token is blank or `APP_ENV` is not staging/production. It returns nothing and
    never writes: on a network error or timeout the request stays queued; a non-2xx response is
    logged with its status only. etl-next runs each request under
    `blended-learning-{env}-{request_key}`, so a repeated wake is a no-op. Nothing logs the
    request key or S3 key.
  - **Status and polling:** `GET /api/blended-learning/drafts/[id]` → `getDraftStatus` (any
    Blended Learning user who can see the Student, read-only included; 404 out of scope or
    missing) returns `{ id, state, retryOffered }`. Retry is offered, to users who may
    `manage_draft`, for a `failed` draft or a `transcribing` one whose active request is still
    `queued` more than 10 minutes after it was created (`request_stale`; a younger one is waiting
    its turn in etl-next's sequential queue). The detail page's
    `students/[id]/DraftStatus.tsx` polls it every 15 s while the draft is `transcribing` and
    stops on ready/failed or when the page closes; a draft no longer open disappears. Each poll
    also refreshes `retryOffered`, and the page loads its first value via `getDraftStatus`.
  - **Retry and discard (#450):** `POST /api/blended-learning/drafts/[id]/retry` →
    `retryDrafting(access, draftId)`: a `transcribing` draft whose active request is still
    `queued` after 10 minutes is woken again with the **same** `request_key` (no new row); a
    `failed` draft gets, in one `withTransaction`, `UPDATE … SET state = 'transcribing' WHERE
    state = 'failed'` and a new `queued` request (new UUID key, the actor as
    `requested_by_email`), then `wakeTranscription`; 200 `{ id, state, retryOffered }`. Any other
    state (a queued request under 10 minutes old included), a lost race or the active-request unique index (`23505`) → 409.
    `POST …/discard` → `discardDraft`: `UPDATE … SET state = 'discarded', discarded_at = now()
    WHERE state IN ('transcribing', 'ready', 'failed')`, 200 `{ id, state: "discarded" }`, no
    rows → 409; the active request is left alone (db-service ignores a discarded draft when ETL
    finishes). Both need `manage_draft` (read-only → 403) and `canAccessBlendedStudent` (404).
    `DraftStatus` shows "Retry" on a failed draft, "Retry drafting" on a stuck one and "Discard"
    (after `window.confirm`, then `router.refresh()`) on every open draft, only when the page
    passes `canManage`. Discarding removes the panel and the list's "Draft ready to review" chip,
    and frees the Mentee for a new upload.
  - Drafts never change Last Contact, Talk to First, counts or flags: those read Conversations
    only. Abandoned uploads (no draft) stay in S3 until the lifecycle rule expires them.
  - E2E has no S3 or etl-next (both ETL vars are `" "`), so `blended-learning-recordings.spec.ts`
    checks the control (Mentor yes, read-only and open-draft Mentee no) and polling with
    `page.clock` over a draft it inserts and deletes for Ira (A1); upload and wake outcomes are
    route-tested. `blended-learning-draft-retry-discard.spec.ts` inserts `failed`/`ready` drafts
    for Ira (deleting her requests and drafts after each test) to cover Retry, Discard and the
    chip, and checks Rohan's fixture failed draft read-only (no buttons, POSTs 403).
  - **Review and save (#451):** the list's "Draft ready to review" chip (a link; on mobile cards
    it sits below the card's link, since links can't nest) and the detail panel's "Review draft"
    (only when the page passes `reviewHref`, i.e. the user can `log`) open
    `/blended-learning/students/[id]/log`. There `getDraftForReview(access, studentId)` (`log`
    permission + `canAccessBlendedStudent`) reads the `ready` draft's session details and
    `draft_summary`, `draft_action_items` (`[{text, owner}]`) and `draft_notes`
    (`[{heading, points[]}]`). The page prefills `LogEntryForm` (`draft` prop) with the drafted
    summary and Action Items; notes go through `draftNotesToHtml` (`src/lib/blended-learning-draft-notes.ts`,
    client-safe: `<h3>` + `<ul><li>`, every `& < > " '` escaped) into the Tiptap editor, which
    reports its normalised HTML on create. The kind choice and the recording upload are hidden. Saving posts `draftId`:
    `logEntry` locks `… WHERE id = $1 AND student_id = $2 FOR UPDATE` (missing, another
    Student's, or not `ready` → 409 "no longer ready", whole save rolled back), inserts the
    Conversation with the draft's `call_recording_s3_key`, `transcript_s3_key` and
    `source_draft_id` (the only link between the two), and last sets the draft `saved` (`WHERE
    state = 'ready'`, else 409). `draftId` on an Attempt or a non-integer is 422. Hand-logged rows store
    `NULL` in the three draft columns. `blended-learning-draft-review.spec.ts` inserts a full
    `ready` draft for Mentor C's never-contacted F1 (desktop) / F2 (mobile), saves it, and
    checks that a second save of the same draft is 409.
- **Recording playback and transcript (#454, ADR 0010):** admin only, in
  `src/lib/blended-learning-mentee-detail.ts`. History Conversations carry `hasRecording` /
  `hasTranscript` (key columns `IS NOT NULL`); the detail page renders
  `students/[id]/ConversationRecording.tsx` only when `canBlendedLearning(access,
  "play_recording")`, so Mentors (the uploader included) never see it. Both load on click.
  `GET /api/blended-learning/conversations/[id]/recording` → `getRecordingPlayback`:
  `HeadObject` NotFound → `{ expired: true }` ("Recording expired"); anything else, a non-404
  HEAD failure included (logged by error name only), → `{ expired: false, url }`, a 5-minute
  presigned GET. `GET …/transcript` → `getTranscript` reads etl-next's raw ElevenLabs Scribe
  JSON (`getObjectText` in `src/lib/s3.ts`, `NoSuchKey` → `{ expired: true }`) and returns
  `{ expired: false, turns: [{ speaker, text }] }`: non-spacing `words[]` grouped into
  consecutive runs by `speaker_id`, labelled "Speaker N" in first-speaking order (as etl-next's
  `speaker_text` numbers them); no words, or any word without a speaker, → one turn of the
  trimmed `text` with `speaker: null`. Mentor or other role → 403; a keyless Conversation, an
  Attempt or out of scope → 404; S3/JSON failure → 502. Neither route logs keys or transcript
  text. No app code deletes recordings (S3 lifecycle, 180 days). Ira's Conversation 20 days ago
  is seeded with both keys; `blended-learning-recording-playback.spec.ts` stubs the two routes,
  since e2e has no S3.
- **Flags feed (#453):** `src/lib/blended-learning-flags.ts`, all behind `view_flags` (Blended
  Learning Admins, read-only included). `listFlags(access, { mentorUserId?, recipient?, cursor }, cutoff)`
  reads every `blended_learning_mentor_flags` row joined to its Conversation (the Mentor is the
  Conversation's snapshot `mentor_user_id`, the program its `program_id`), the Student's `user`
  (contact via `contactNumbers`, shared with the detail page), current grade and links; newest
  first by `(inserted_at, id)`, 50 per page. The cursor is the last flag's id and the next page
  is the keyset `(inserted_at, id) < (that flag's)`, so ties on the second-precision
  `inserted_at` never duplicate or skip. `isNew` and `newCount` (`countNewFlags`, all flags,
  whatever the filters) compare `inserted_at >` the **visit's cutoff**: the viewer's previous
  `blended_learning_flag_views.last_seen_at` (no row → everything is new). A visit starts when
  the tab is opened without `?since=`: the page reads the cutoff (`readFlagsCutoff`, the
  timestamp(0) wall-clock value as `YYYY-MM-DDTHH:MM:SS`, never zone-shifted, or `never`) and
  renders `MarkFlagsSeen`, which POSTs `/api/blended-learning/flags/seen` → `recordFlagsSeen`
  (upsert `ON CONFLICT ((lower(viewer_email)))`, `last_seen_at = now()`). The filter form and
  the Older/Newest links carry `since=<cutoff>` (`flagsCutoffParam` / `parseFlagsCutoff`), so
  filter and page changes keep the same New flags and record nothing (QA-12); a malformed
  `since` starts a new visit. Opening the tab again (its tab link has no `since`) is the next
  visit. Each card's `inScope` is an active current-year Mapping for the Student: without
  one the name is plain text and "Show notes" is hidden, since both would 404 through
  `canAccessBlendedStudent`. `listFlagMentors` lists the Mentors on flagged Conversations for
  the filter. The fixture's feed flags
  are on Conversations older than each Mentee's latest entry, so no list or card fact changes.
- **Notes sanitiser (#445):** `sanitiseNotesHtml` in `src/lib/blended-learning-notes-sanitiser.ts`
  (server-only, `sanitize-html`) is the only path to `notes_html`: allowlist `p, h3, b, i, ul, ol,
  li, table, tr, th, td, br`, no attributes, no links (an `<a>` keeps its text), `strong→b`,
  `em→i`, script/style bodies dropped, other tags unwrapped (an editor's `tbody`/`colgroup` go),
  output with no text → `NULL`, input over 100 KB (UTF-8 bytes) → 422. The editor
  (`students/[id]/log/NotesEditor.tsx`, Tiptap StarterKit + TableKit, heading level 3 only, no
  link/underline/strike/code/blockquote/rule) sends untrusted HTML; table controls show from
  1024 px only.
- **E2E fixture schema:** `e2e/fixtures/migrations/20261022130000_add_blended_learning_schema.sql`
  mirrors those 10 db-service migrations exactly. The DB is reset once per run, so specs that
  write must use their own rows: Mentor C (`e2e-blended-mentor-c@test.local`) and
  `LOGGING_MENTEES` (one set per viewport) exist only for `blended-learning-log-entry.spec.ts`;
  Mentor C's `ACTION_ITEM_MENTEES` (with `EARLIER_ACTION_ITEMS`) exist only for
  `blended-learning-action-items.spec.ts`; Mentor C's `FLAG_MENTEES` exist only for
  `blended-learning-mentor-flags.spec.ts`. Those specs' new flags are the newest in the feed, so
  `blended-learning-flags-feed.spec.ts` compares cards without Mentor C's and counts them into
  "N new". Re-diff it with
  `patterns/mirror-db-service-schema-in-e2e.md` whenever PR #804 changes.
- **Links load script (#455):** `blended_learning_student_links` is filled outside the app by the
  operator script `npm run blended:import-links` (`runBlendedLinksImport` in
  `src/lib/blended-learning-links-import.ts`); there is no in-app editing. It reads the active Mapping
  source (`activeBlendedMappingSql`), the existing links (`student_id = ANY($1::bigint[])`), and
  upserts `ON CONFLICT (student_id)` per changed Student only, so an unchanged re-run writes
  nothing. Non-`https://` values are skipped before the DB CHECK sees them; a value missing from
  the workbook keeps the stored one. `legacy_last_contact_on` is selected and written only
  with `--legacy-docs-dir` (Profile Doc HTML exports; date extraction in
  `src/lib/blended-learning-profile-doc-dates.ts`: the doc's latest dated conversation only).
  With docs, every matched Student is considered, so a stored Profile Doc link still gives a
  date when the workbook row has none; a Student with no link and no stored row gets no row.
  Runbook: `patterns/load-blended-learning-links.md`.
