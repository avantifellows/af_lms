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
