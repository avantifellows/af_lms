---
name: data-access
description: The data backends and the reads-vs-writes split — when to use Postgres directly, the DB Service proxy, BigQuery, DynamoDB, or S3. Load before any read or write.
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
last_updated: 2026-11-27
---

# Data Access

Five backends. Picking the wrong one for a write is a real bug — read this before touching data.

## 1. PostgreSQL — `query()` (the default)
`import { query } from "@/lib/db"` → `query<RowType>(sql, params)`. Returns `rows`.
- **All reads** (lists, dashboards, detail pages, scope resolution).
- **Direct writes** for LMS-owned tables only: PM visits (`lms_pm_school_visits`, `lms_pm_school_visit_actions`), curriculum (including Curriculum Plans: `lms_curriculum_plans`, `lms_curriculum_plan_chapters`, `lms_curriculum_plan_assignments`, written through `src/lib/curriculum-plans.ts` (Plan Assignments, by plan and by Centre, plus Centre coverage through `src/lib/curriculum-plan-assignments.ts`) in `withTransaction()` with the plan row locked `FOR UPDATE`; the plan schema preflight (`checkCurriculumPlansSchema`) lists every column those writes use, audit columns included, so a partly applied migration 503s; db-service owns their migrations, mirrored by `e2e/fixtures/migrations/20261019120000_add_lms_curriculum_plans.sql` and `20261023091700_widen_lms_curriculum_plan_exam_tracks.sql`, which lets `exam_tracks` include `cet` and indexes the remaining foreign keys), permissions/centre tables, Academic Mentor-Mentee Mappings, Holistic Mentorship product records, and intervention flags (`lms_student_intervention_flags` + append-only `lms_student_intervention_flag_updates`; a DB trigger allows only clearing `body`; mirrored for e2e, idempotently, by `e2e/fixtures/migrations/20261027130000_add_lms_student_intervention_flags.sql`), and AI Test Insights requests and sessions (`ai_test_insight_*`, db-service-owned DDL; see "AI Test Insights tables" below).
- Holistic Profile regeneration first records an attributable request atomically in Postgres, then calls the configured ETL collection endpoint at `/{request_key}/enqueue` with the matching `APP_ENV` in the body. No Student data is sent. Ambiguous network outcomes remain queued for retry; confirmed rejection is recorded as failed without replacing the previous Profile.
- Curriculum eligible Centres (#417) have one definition: `src/lib/curriculum-eligible-centres.ts`. `ELIGIBLE_CENTRE_TRACKS_FROM_SQL` (`centres c` + `school s` + `centre_exam_tracks cet`) and `ELIGIBLE_CENTRE_SQL` (active, physical, JNV) are static fragments. Plan assignment (by plan, by Centre, Centre coverage) and the Curriculum Summary's `scoped_centres` both build their queries from them, so the Centres you can assign match the Centres the Summary shows. `loadTracksWithContent(db, { gradeIds } | { gradeNumbers })` returns the Grade's in-syllabus LMS Chapter Exam Config tracks, keyed by Grade number. Change the rule there, never in a copy.
- Multi-statement writes: `withTransaction(async (client) => { ... })` (no nesting — it throws).
- Pool is a singleton (10 conns, 15s `statement_timeout`, 5s connect timeout). **Always `$1` placeholders.** This module is server-only — never import it (transitively) into a client component.
- DB naming: Ecto — `inserted_at`/`updated_at`, snake_case, server TZ UTC. Derive IST dates in SQL: `(NOW() AT TIME ZONE 'Asia/Kolkata')::date`.

**Documents are read from Postgres, written through the DB Service.** `lms_student_documents` is
read directly by `listDocumentTypesForStudents` (`src/lib/student-documents.ts`) for the Enrollment
tab's Data completeness table (#468): one `SELECT DISTINCT student_id, document_type ... WHERE
student_id = ANY($1::bigint[]) AND deleted_at IS NULL` for the whole School, behind
`GET /api/schools/[code]/document-status`. The older consent summary still asks the DB Service once
per Student in capped batches, which is why it could never answer "who is missing which of the seven
types". Uploads and deletes stay on the DB Service.

**One visible-School predicate.** `findVisibleSchool` (`src/lib/school-lookup.ts`) resolves a School
by UDISE or code as the School page does — the historical JNV set plus any School linked to an active
centre. A route that filters on `af_school_category = 'JNV'` alone 404s for the centre Schools whose
page opens fine, which is what left `% Docs` on "—" for them (#338). Both School-scoped document
routes share it.

## 2. DB Service (Elixir/Phoenix) — proxied writes
External HTTP API. **Student, batch, quiz-session, document and alumni writes go here**, never direct to Postgres. Alumni history (`alumni_journey`) is written only through `POST /alumni/:id/journey` and read from Postgres.
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
`src/lib/bigquery.ts`, lazy singleton `getBigQueryClient()`. Credentials via `GOOGLE_SERVICE_ACCOUNT_JSON` (string) or `GOOGLE_APPLICATION_CREDENTIALS` (file). Used by `/api/quiz-analytics/*`, and by the NVS Test Attendance tab's attendance read (§6). Read-only; uses `CURRENT_ACADEMIC_YEAR` from constants.
- **Student key — always `enrollment_user_id`:** count, group, filter and join students on `enrollment_user_id`, never on `fk_student_id` / `pk_student_id`. Those are NULL for a student who has only an APAAR ID (most of them JNV NVS; in AY 2026-27, 2,185 of 279,229 `dim_student` rows), and `COUNT(DISTINCT …)` skips NULLs. `dim_student.enrollment_user_id` is never NULL. Until 14 Oct 2026, `getBatchOverviewData` counted takers by `fk_student_id` and enrolment by `pk_student_id`, and `getCumulativeALData` filtered `fk_student_id IS NOT NULL` and joined `dim_student` on `pk_student_id`. At JNV Barabanki, Grade 12 showed 8 enrolled against 75. Both now key on `enrollment_user_id`. `CumulativeALRow.student_id` now holds the `enrollment_user_id` as a row key, not the business Student ID. `getStudentQuestionLevelData` and `getStudentTimeSpentData` already used `enrollment_user_id`.
- **NVS batch overview:** when the program is JNV NVS (`isNvsProgram()` in `src/lib/constants.ts` — the one client-safe place that compares the label), `getBatchOverviewData`'s test-list query adds the static literal `AND test_purpose = 'system_wide_mandated'`. Enrollment counts, params, and the response shape don't change. On the client, `usePerformanceFilters` exposes `isNvs`; `BatchOverview` then lists every returned test (no Chapter/Full split, no subject/test-grade filters) and uses the empty state "No system-wide mandated tests yet for this grade/stream". A single-program school's program is derived from the grades response (never written to the URL), so the first overview render is already scoped (#352, #392).
- **Batch-overview stream options (PR #376):** `getBatchOverviewData`'s enrolment query (`GROUP BY student_stream`) doesn't filter by stream, so the returned `streams` always lists every stream at the School and grade. The Performance Stream filter therefore keeps all its options after one is picked. `summariseEnrolment` applies the selected stream to `totalEnrolled` and `enrolledByStream` in JS, with the same `LOWER(stream) = @stream` semantics as before; the test-list query still filters by stream.
- **NVS Student Results:** `StudentResultsTable` hides the AL and On Track columns when `isNvsProgram(program)` is true, exactly as it does for Advanced tests (`showALColumns`). Its header cells are built as one list, and the expanded row's `colSpan` is `headerCells.length`. So to add a column, add it to that list (#353).
- **Student Results row identity:** `StudentResultsTable` identifies each row by `studentKey()`: `enrollment_user_id`, or `student_name` only when the id is null (with `id:` / `name:` prefixes, so the two never collide). The row `key`, the expanded-row state and the rank map all use it. Sorting and display still use the name. Two Students with the same name in one test are common in large Schools, so never key a Student on the name.
- **NVS Performance filters:** for JNV NVS, `effectiveSelection()` in `src/components/performance/usePerformanceFilters.ts` forces the effective `testCategory="full"`, `fullTestView="per_test"`, and no subject/testGrade, so the overview never gets a subject or test grade and Student support (the Cumulative view) never renders. `PerformanceFilterBar` gets `isNvs` and renders only Grade and Stream. The raw selection and URL are left as they are: `?view=cumulative&category=chapter&subject=…&testGrade=…` is ignored on NVS, not rewritten.
- **Performance filter history (#392):** `usePerformanceFilters` reads every raw selection (program, grade, stream, subject, testGrade, category, view, session) from the URL on each render, so Back/Forward rehydrates the mounted tab in place. Deliberate choices `router.push` one entry each with `scroll: false`, carrying their resets atomically (Program clears grade/session/stream/subject/testGrade; Grade clears session/stream/subject/testGrade; Category clears testGrade, and subject when leaving Chapter). Reselecting is a no-op. Automatic Grade reconciliation uses `replace`. Patches compose against the latest *intended* query, but navigations go to the router one at a time (the App Router drops a pending navigation when another starts, which would lose a history entry); any other URL landing is Back/Forward and discards the queue. Grades and `BatchOverview` responses are keyed to their request, so obsolete success/failure/option publications are inert. Report open/close: see #393 below.
- **Performance report history (#393):** opening a report pushes `session` (one step, `scroll: false`); `TestDeepDiveView` is keyed by session, so a new report starts fresh and nameless until its own data names it. "Back to overview" calls `router.back()` only when the hook's transient trail (in `usePerformanceUrl`, in memory per mount) proves the current entry was pushed by the tab directly on top of its own overview (same query without `session`). The trail follows Back/Forward by matching exactly one neighbouring entry's URL; an ambiguous or unrelated URL, a replace of the entry, a reload, a direct link or a remount leaves nothing proven, and then the in-page Back replaces away only `session`. No storage. `SchoolTabs` derives the visible tab from `?tab=` (absent/invalid → `defaultTab` if visible, else the first tab), so history to `tab=performance` remounts Performance from its URL. A tab click synchronously uses native `history.replaceState`, preserving every unrelated query parameter and the hash before its content mounts; this prevents a fast automatic Grade replace from erasing `tab=performance`. Performance loading frames keep the previous settled height only while data reloads, then release it to the new content's natural height or the minimum needed to keep the current non-zero scroll valid. Scrolling upward can only shrink that floor, while downward scrolling cannot grow it; stale interactive content is never kept on screen. On report-to-overview transitions, if the shorter natural overview is entirely above the current viewport, the frame releases the report height and scrolls only as far as the last viewport that intersects the overview. Normal filter/history transitions and report exits that already overlap the viewport keep their scroll position.
- **Deep-dive response ownership (#393):** `TestDeepDive` aborts an obsolete request and also marks its lifecycle inactive, so a fetch implementation that resolves or rejects after abort cannot publish stale report data, errors, loading state, or the report-name callback over the current session.
- **Student support (Teacher View v2, #324; physical centres only):** `src/lib/student-support.ts` replaces the Cumulative AL table (`CumulativeALTable` and the `cumulative-als` route are gone; `getCumulativeALData` and `CumulativeALRow` remain as the Score journey's per-test source). Sources: `dim_student` (`academic_level` = Mode AL, `predicted_academic_level` from etl-next #198/#204 (`predicted_jee_percentile` is not read), current year, enrolled), `dim_test_cutoffs`, `fact_student_test_results_overall` (test history, rank among everyone at the School + grade + program who sat, including leavers), and `fact_student_test_results_question_level` (pruned by the student's `hashed_session_id`s) joined to etl-next `bridge_question_chapter` (question → live new-CMS chapter; old-CMS questions via per-question tags, untagged ones dropped). Topics: `bridge_question_topic` + `dim_topic` for new-CMS questions and `curriculum.legacy_question_topic_tags` for old-CMS ones; the tag for the test's exam (JM-/JA-/NE-) wins, then primary / most confident. Each student sees only their own exam stream's tests (no stream = engineering). Retests: a session the creator flagged as a retest (session `meta_data.is_retest`, read live from Postgres by `getRetestSessionIds` in `src/lib/quiz-session-retests.ts`) is a Retest column for everyone in it, including a student who sat only the retest (programs treat them as absent from the original; the warehouse AL uses the same flag via `dim_session.session_is_retest`). A student's own repeat of a test name (`studentRetests`) is also a retest for that student; a column with no flag is marked Retest only when every sitting in it is one. Retest columns are greyed, struck through and tagged "Retest · not in AL", with a note above the table. Latest AL, the score graph and the ▲/▼ change skip the student's retests; the graph and the change also skip sittings with no level (Not Eligible, e.g. State CET / Advanced), and the change is score % minus the student's previous counted sitting of the same `test_course` (`sittingChanges`, shared by the journey row and the report's history so they agree). Listed sessions (`listedSessions`): the per-test columns and the report's test history show only sessions dated on or after 1 April of `CURRENT_ACADEMIC_YEAR` (the fact table tags some earlier-year sittings with the current year) sat by ≥ 20% of the session's cohort (everyone who sat an in-year test of the same test stream; everyone for a stream-less test) or, in the report, by the student; a student's own in-year sittings always count for their Latest AL, graph and change. MCP's `redact` drops `category` from both views. PYQ links come from Postgres `resource`/`resource_chapter`. Views are cached 15 min per server instance (`src/lib/ttl-cache.ts`), cutoffs and PYQ links 1 h. Rules live in `student-support-rules.ts`.
- **NVS Time Spent (#357):** `getStudentTimeSpentData()` reads `MAX(total_time_spent)` (INT64 seconds) from `fact_student_test_results_overall`, grouped by `enrollment_user_id` + `LOWER(section)`. Its filters are the same as `getStudentQuestionLevelData` (udise, student grade, session, current year, optional program/stream, `enrollment_user_id IS NOT NULL`). It returns `Map<id, { overall, bySection }>`. The `test-deep-dive` route calls it only when `isNvsProgram(program)`, in parallel with the DynamoDB read, and merges `time_spent_seconds` onto each student (overall) and each subject score (`subject.toLowerCase()`). Unmatched students get null. If the lookup fails, the route logs only the error message and returns the deep dive with null times; DynamoDB failures still return 500/404. `StudentResultsTable` shows a sortable "Time Spent (min)" column after Attempt Rate (`Math.round(s/60)` or "—", nulls last in both directions), a subject-row time cell, and a blank chapter cell. Non-NVS payloads have no time fields.

- **Chapter-test report (physical centres, lms-chapter-reports):** opening a single-chapter test (`test_format = chapter_test`) from the Chapter tests overview (`category=chapter`, not JNV NVS) renders `ChapterTestReport` instead of the general stats and analysis; Student Results and the combined reports are kept.
  - **Which report:** the card passes its `test_format` through `onTestClick`, so combined chapter tests and homework open the general report directly. A report reached by URL has no format yet: the chapter report loads and shows its `fallback` (the general report) when the session is not a `chapter_test`. Any load error (including 404 "no results") also shows the fallback, never a bare error.
  - **Data:** `GET /api/quiz-analytics/[udise]/chapter-test-report` (`getChapterTestReport` in `src/lib/question-analytics.ts`; 403 when the `program` sent is JNV NVS). It reads:
    - per-question stats from the question-level fact, **filtered on its partition column** `hashed_session_id = MOD(ABS(FARM_FINGERPRINT(@sessionId)), 4000) + 1` (10 MB instead of 2.4 GB);
    - topics from `bridge_question_topic` + `dim_topic` (a question with several topics counts under each);
    - overview and gender split from `fact_student_test_results_overall` (section `overall`, submitted only; class figures are combined from unrounded slices, accuracy weighted by `COUNT(accuracy)` since a student who attempted nothing has none);
    - **one cohort for every number:** when the test has a stream, only students in it count (`IN_TEST_STREAM`: `test_stream IS NULL OR student_stream = test_stream`), in the overview, gender split, per-question stats and comparison rows alike. "X of Y appeared": X = those students who submitted; Y = enrolled in that stream. The card uses the same rule (`CHAPTER_CARD_COHORT` in `bigquery.ts` for `appeared_count` and its averages);
    - enrolled from `dim_student` in the test's stream;
    - other Schools on the same `cms_test_id` (`getSchoolComparison`): same grade, same stream filter, and programs of the same model as this School's (CoEs with CoEs, Nodals with Nodals, `comparisonPrograms`); any other program gets no comparison. This School's row is replaced by the overview cohort;
    - chapter and priority from `dim_test` → `dim_chapter`.
  - **Aggregation** (by topic and difficulty; rankings) is pure and client-safe in `src/lib/question-aggregates.ts`, meant for reuse by Teacher View v2 (#324).
  - **Question content** comes from the CMS, never from Postgres: `GET /api/quiz-analytics/[udise]/question-content?grade&sessionId&program&stream&questionId` looks the CMS test up from the session server-side (`getSessionCmsTest`), then fetches `/api/service/test` with `CMS_SERVICE_TOKEN` and returns one question. `QuestionContentView` sanitises it with DOMPurify and renders the maths with KaTeX.
  - **PDFs:** `GET /api/quiz-analytics/[udise]/test-pdf` serves the paper and answer key through `serveCmsTestPdf` (`src/lib/cms-test-pdf.ts`, shared with `/api/cms/test-pdf`).
  - **Gating:** both content routes are gated on Performance access to the School, not quiz-session access.
- **Chapter-test cards:** on the Chapter tests overview (not JNV NVS), `BatchOverview` renders `ChapterTestCard`, matching the chapter-test report index exactly:
  - "code – chapter · subject" title, exam, priority;
  - "Grade · date · X of Y students appeared" (X = `appeared_count`: submitted, in the test's stream; the card's averages use the same students);
  - Attempt / Accuracy / Score;
  - no attendance block and no summary stat cards.
  - `getBatchOverviewData` adds per-test `avg_attempt_rate` / `avg_accuracy` / `avg_score` (overall rows, submitted only), `cms_test_id` and `exam` (test_course).
  - The batch-overview route adds `chapter` for new-CMS chapter tests from `dim_test` → `dim_chapter` (`getCmsTestChapters`). A failed lookup leaves the cards on the test name. Old-CMS tests (combined chapter tests still are, e.g. 2026-10-18) have no chapter.

## 4. DynamoDB — performance dashboard reads (read-only)
`src/lib/dynamodb.ts`, lazy singleton via `@aws-sdk/lib-dynamodb` `DynamoDBDocumentClient`. Holds test deep-dive reports keyed by school student identifiers (cross-referenced against Postgres rosters). Read-only.

## 5. S3 — document files
`src/lib/s3.ts` (`@aws-sdk/client-s3` + presigner). Student document uploads/reads via presigned URLs; bucket shared with prod (`S3_DOCS_*`). Document **metadata** writes still proxy through the DB Service.

## 6. NVS Test Attendance reads (Postgres + BigQuery, #517)
`src/lib/test-set-list.ts`, `getNvsTestSets()` → `{label, quizIds}[]` oldest month first; it throws when the `session` read fails. Monthly Tests come from the Postgres `session` table (#517, ADR 0014, superseding ADR 0012's Firestore read; the 5-minute cache and `google-auth-library` are gone). A Paper belongs to an NVS Monthly Test when its `session` row has `meta_data->>'test_purpose' = 'system_wide_mandated'`, `meta_data->>'group' = 'EnableStudents'`, `meta_data->>'grade'` in `11` or `12`, `is_active = true`, a non-blank `platform_id`, and `start_time` (IST wall clock) inside `CURRENT_ACADEMIC_YEAR` (1 Apr inclusive to next 1 Apr exclusive, from `academicYearBounds()`). Papers are grouped by the IST calendar month they start in (`YYYY-MM`), and the Monthly Test is named after that month (e.g. `"September"`). Nothing else knows the rule, so a future PMU calendar can still replace this module behind the same function.
- **Paper windows** (`src/lib/test-attendance-papers.ts`, `readPaperWindows(quizIds)`): Postgres `session` rows matched on `platform_id = ANY($1::text[])`. `start_time`/`end_time` hold IST wall clock: they're read as `::text` and converted with `dbIstTimestampToUtcIso`, never `new Date()`. An unreadable time is null. For several rows with one quiz id, the switched-on rows (`is_active IS NOT FALSE`, as the quiz-session list reads it) give the earliest opening, the latest closing and the grade (`meta_data->>'grade'`). The rules (`openedMonthlyTests` in `test-attendance-rules.ts`) skip a switched-off Paper, a quiz id with no row and a Paper missing either time.
- Production check, 20 Nov 2026 (read-only): the `session` rule finds exactly the switched-on NVS Papers of the former Firestore list in every month (July 7, August 7, September 14, October 14, November 18 = 60; August's 7 Grade 11 Papers are switched off, so August is Grade 12-only). Without `group = 'EnableStudents'` it returns every state's sessions; without the academic-year date bound it also returns 51 switched-on mandated NVS sessions from Sep 2025 to Jan 2026.
- **Attendance read** (`src/lib/test-attendance-warehouse.ts`, `readPaperAttendance(quizIds, userIds)`, #523): BigQuery `production_dbt_final.fact_student_test_attendance`, parameterised (`IN UNNEST(@quizIds)` / `@userIds`, both typed `STRING`). Only `attendance_status = 'Present'` rows (the Student opened the Paper). Keyed on `enrollment_user_id` = LMS user id, with `CAST(… AS STRING)` on both sides because the column's type isn't pinned (INT64 in etl-next's dbt catalog). `GROUP BY` user and quiz gives one row per Student and Paper, `submitted = LOGICAL_OR(has_submitted)`; an all-empty `has_submitted` comes back null and the rules count it as not submitted. `has_submitted` exists in production only after etl-next#238 ships; until then this read fails and the tab shows its error panel. The loader asks only about the listed Students and the usable Papers of opened Monthly Tests (`attendanceQuizIds`), and skips the read when either list is empty.
- **Last refreshed + 60-second cache** (`readSchoolAttendance(schoolId, quizIds, userIds)` in `test-attendance-warehouse.ts`, #526): alongside the attendance read, "last refreshed" is the attendance table's rebuild time from dataset table metadata — `TIMESTAMP_MILLIS(last_modified_time)` from `production_dbt_final.__TABLES__` where `table_id = 'fact_student_test_attendance'`, as PMU Live Tracking reads it (checked with the LMS service account 18 Nov 2026) — never the LMS fetch time. Both are cached together for 60 seconds (`ttlCache`, in process, at most 500 entries; a failed attendance read is not kept), keyed on the School plus a SHA-256 digest of the sorted, de-duplicated quiz ids and user ids asked about: a Student added to the roster or a Paper added to the list is read at once, never shown as not opened from an older entry, and the same ids in another order hit the cache. A failed or empty last-refreshed lookup is logged (message only) and returned as `lastRefreshed: null` ("unknown" on the tab); every other source failure is still a 500. The response is `{ monthlyTests, students, lastRefreshed, serverTime }`, with `serverTime` the time this response was built even on a cache hit.
- **Joining dates** (`readNvsJoiningDates` in `src/lib/test-attendance.ts`, #524): one extra parameterised Postgres read over the listed Students' user ids (`er.user_id = ANY($1::bigint[])`): their `enrollment_record` batch rows, current or ended, in JNV NVS batches (`batch.program_id = PMU_PROGRAM_ID`) for `CURRENT_ACADEMIC_YEAR`, the earliest `start_date` per Student taken in SQL (`to_char(MIN(er.start_date), 'YYYY-MM-DD') … GROUP BY er.user_id`, DateStyle-proof), so a later move between NVS batches never drops earlier Monthly Tests. The shared roster projection (`STUDENT_COLUMNS`) is not touched, and the joining date is never sent to the browser. A failed read throws → 500.
- **Loader** (`loadTestAttendance` in `src/lib/test-attendance.ts`; shapes in `src/types/test-attendance.ts`): the single entry point for the read route (#530 Download has no route: the browser turns the loaded response into one Excel sheet with `testAttendanceSheet` / `downloadTestAttendance` in `src/lib/test-attendance-export.ts`, so the file holds the rows on screen, never newer data). It reads the roster once (then the joining dates) and the Monthly Tests + `session` windows in parallel, then the attendance, and hands them plus "now" to `testAttendanceFrom` (rules module). Each Student gets `attendance: {[monthlyTestKey]: "not_opened" | "opened" | "submitted"}` for every Monthly Test they are counted for — their grade is one of its grades and they joined on or before the IST calendar day it closes (joining on the closing day counts; no joining date = counted) — and nothing for the others, so they drop out of every "y" and list for it. Any Paper of the Monthly Test counts, whatever its grade. The browser turns marks into statuses, tiles and the month list with the same module (`attendanceStatus`, `monthTiles`, `monthStudents`).
- If the Monthly Tests read, the `session` read, the roster or the attendance read fails, `loadTestAttendance` throws and the route answers 500. The tab shows its error panel, never zeros. On the e2e server (`GOOGLE_SERVICE_ACCOUNT_JSON=" "`), BigQuery is unavailable; because the e2e Postgres has no matching NVS mandated sessions, the attendance read skips BigQuery and the tab shows "No Monthly Tests yet".
- **Pre-launch data check** (`npm run test-attendance:check [-- --env-path=<file>]`, #531; release gate for #517): `scripts/check-test-attendance.ts` wires read-only sources into `runTestAttendanceCheck` / `formatCheckReport` (`src/lib/test-attendance-check.ts`, pure, unit-tested with stub sources). For every closed Monthly Test across all `af_school_category = 'JNV'` Schools it compares the Students `loadTestAttendance` marks `submitted` with the Students who have `has_quiz_ended = TRUE` in `fact_student_test_results_overall` for one of its Papers (`test_id` = quiz id; `session_id` there is not the quiz id), using `openedMonthlyTests` (rules) for the Papers. Each School is read once, through `loadSchoolTestAttendance` (the loader the routes use, plus each listed Student's raw Exam Preparing For and whether they have a joining date, from the same roster read; `loadTestAttendance` drops those fields, so they never reach the tab's response). Schools are read 4 at a time; the first failure stops the run. Prints per test: counted, both sides, both difference lists (LMS user ids only) and results from Students the tab doesn't count (not compared); plus unrecognised Exam Preparing For values, listed Students with no joining date, and quiz ids whose `session` row is missing or lacks a grade or a time (switched-off Papers can no longer enter Monthly Tests under ADR 0014). Postgres runs with `PGOPTIONS=-c default_transaction_read_only=on`; no DB Service call. Any failed source (incl. the attendance read before etl-next#238) exits 1. Runs under jiti with `JITI_ALIAS` for `@/` (no other script imports `@/` modules; `--env-file` is taken by Node, hence `--env-path`). Default env file `.env.production`; shell variables win. 24 Nov 2026 production run: 875 NVS Schools, 77,475 listed Students; July 38,629 counted / 31,208 submitted on the tab / 31,206 with a submitted result / 2 tab-only / 0 result-only; August 38,801 / 33,156 / 33,147 / 9 / 0; September 74,820 / 63,336 / 63,333 / 3 / 0; October 77,075 / 63,789 / 63,779 / 10 / 0; 60 quiz ids, every one with a `session` row; 0 unrecognised Exam Preparing For; 0 without a joining date.

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
| NVS Monthly Tests | Postgres `session` (`test-set-list.ts`, ADR 0014) |
| NVS Test Attendance (opened / submitted per Paper) | BigQuery `fact_student_test_attendance` (`test-attendance-warehouse.ts`) |

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

Student detail now returns only real current Grade 12 phases when no continuing Grade 11 history applies; it no longer invents four placeholder tabs or forces numbering to start at 5. Plan-wide numbering was kept at the time (the reported Maharashtra plan displayed Grade 12 as Phase 2); issue #516 replaced it, see "Holistic Phase numbers" below. Continuing prior-year history, phase IDs, context precedence, permissions and database access are unchanged. Missing generated profiles do not change numbering and do not establish source-form completion. No schema/data repair is involved.

## Holistic Phase numbers

Issue #516 (Audience: the six Holistic Mentorship Programs; nothing for NVS Schools). The displayed `Phase N` is per Grade: a Phase's place among its own Grade's Phases in Plan order, plus 3 for Grade 12. Grade 11 Phases read 1, 2, 3 and Grade 12 Phases 4, 5, 6, whatever order the Grades' Phases were added in (JNV CoE's Plan runs Grade 11, 12, 11, 12 and used to read 1, 2, 3, 4).

- One rule, in client-safe `src/lib/holistic-phase-number.ts`: `holisticPhaseNumber(grade, placeInGrade)`, `withHolisticPhaseNumbers(phases)` for rows that carry `grade` and `position`, and `holisticPhaseNumberSql(phaseAlias, gradeNumberExpr)` for the one query that sorts and pages by the number. Used by `getHolisticPhasePlan` (Phase Setup), `numberPhases` in `holistic-student-phase.ts` (student page tabs, heading, "From Phase N" context label; each Academic Year's Plan numbered on its own), `listAssignedMentees` and `getHolisticProgressOptions` in `holistic-progress.ts` (rows, Phase filter, sort by Phase, CSV, and the MCP view registered for the path `/api/holistic-mentorship/progress` in `src/lib/mcp/views.ts`, which wraps the same route), and `heatmapPhases`. Issue #536's two server messages that name a Phase, the Open Phase confirmation's closing Phase (`getHolisticPhaseOpenImpact`) and the refused out-of-order open (`validateOpenOrder`), use `holisticPhaseNumberSql` too.
- Nothing stores the number. `holistic_mentorship_phases.position` is unchanged and still drives Active (highest-position Open Phase per Grade) and Skipped: the progress query now selects `phase_position` beside `phase_number` and compares `phase_position` with `initial_active_position`.
- A Grade holds at most `HOLISTIC_PHASES_PER_GRADE` (3) Phases per Plan. `addHolisticPhase`, and `updateHolisticPhase` when the Grade changes, return 422 "Grade N already has 3 Phases" (`gradeIsFull`). Both run under the Plan row lock: add takes it in `lockPhasePlanForYear`; a definition save, a state change and a delete take it first in `lockPhasePlanForPhase` (called from `checkedPhase`) and only then lock the Phase row (`getMutablePhase`, `FOR UPDATE OF p`). That is the same Plan-then-Phase order reorder uses (`lockPhasePlanForYear`, then `loadReorderPhases`), so a Grade change, which updates the later Phases of the Plan while it holds the Plan row, cannot deadlock with another save, state change, delete or reorder: the other request waits for the Plan row and then goes on, with 409 "Phase changed" when its Phase was one the Grade change renumbered. A Grade change renumbers only never-opened Locked Phases, so that 409 reaches only Admin actions on those Phases. A Mentor write or Dictation clip cannot deadlock with it either: its write check (`loadHolisticMentorWriteScope`, #536) share-locks the Plan row before the Mapping and Phase rows, and it refuses a Locked Phase with 422. Before 25 Nov 2026 `getMutablePhase` locked the Phase row first and the Plan row with it (bare `FOR UPDATE`), and a save or state change of a later Phase racing a Grade change ended in `deadlock detected` (reproduced on local Postgres). A save that keeps the Phase's Grade is never counted, so a Plan that somehow holds more than 3 in a Grade stays editable. Copy previous year (`createHolisticPhasePlan`) refuses with 422 "The prior Plan has more than 3 Phases in Grade N" when a Grade of the source Plan is over the limit (`overfullGrade`), so a copy cannot show two Phases with one number; no production Plan had more than 3 per Grade on 20 Nov 2026.
- No change to another Phase renumbers an opened or used Phase. Add appends, Move swaps two never-opened Phases of one Grade, and Delete is refused when a later Phase was opened, so none of them renumbers one. A Grade change would (every later Phase of both Grades shifts), so `validateGradeChange` returns 422 "Changing the Grade would renumber an opened or used Phase" when a later-position Phase of the old or the new Grade is open, frozen, ever opened or has Notes. This rule never refuses the last Phase of a Plan (the 3-per-Grade limit and the frozen rule still can). A Phase whose own Grade changes, which stays possible until Notes exist and only while the Phase is Locked (an Open Phase keeps its Grade, #536), takes a number in its new Grade. An allowed Grade change adds 1 to the `revision` of the later Phases of both Grades (`bumpPhasesRenumberedByGradeChange`), as delete and reorder do for the Phases they renumber, so an Admin acting on a page that still shows the old number gets 409 "Phase changed". Each of those Phases also gets a `reordered` audit row with the same actor, in Plan order, after the changed Phase's own `definition_updated` row (the order a delete writes them in). The refusal query is unit-tested against a mocked client and was checked on a local database by hand; no automated test executes it. The reorder action keeps the Grade of every position (`validateReorder`, `loadReorderPhases` reads each Phase's Grade): a Phase that moves must land on a position that held a Phase of its own Grade, else 422 "Phases can be reordered only within their Grade". So each Grade's Phases only trade places among that Grade's positions, every Phase that does not move keeps its number (also with gaps in `position` and with more than 3 Phases in a Grade), and an opened or used Phase, which cannot move, is never renumbered by a reorder. Revisions of the whole request are checked first (409), then the Grade rule and the opened-or-used rule (422). Phase Setup only sends same-Grade swaps, so it never meets the 422; a direct API call or a stale page can.
- Phase Setup (`PhasePlanSetup.tsx`) lists the Plan in two groups, Grade 11 then Grade 12. Move up / Move down swap a Phase with its neighbour in the same Grade (`gradeNeighbour`) and send the whole Plan order to the unchanged reorder action; Add Phase starts in the first Grade with room and is off when both are full; a full Grade's button is disabled for a Phase of the other Grade (never the Grade the Phase is saved in), with the reason tied to the control by `aria-describedby`. The editor opens on the first Phase in list order (`firstListedPhase`), not the Plan's first position.
- Students & Progress lists its Phase filter options by displayed number (`getHolisticProgressOptions` sorts after numbering).
- `src/lib/holistic-phase-number.integration.test.ts` runs the SQL form on a disposable local Postgres and compares it with the JS form (opt in with `HOLISTIC_PHASE_NUMBER_TEST_DATABASE=dbservice_test_...`; its rows are rolled back). The e2e Holistic fixture orders its Plan Grade 11, 11, 11, 12, 12, 12, where old and new numbers are the same, so e2e does not cover a mixed Plan.
- No schema or data change is needed for the numbers. Phase titles that already had a number typed in ("Phase 2 - ...") are data and need a one-off title fix on production.

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
runs inside the caller's transaction in three statements: `FOR SHARE OF plan` on the Phase's Plan row
(no row, no scope: it returns null there), then the scope query with `FOR UPDATE OF mapping, phase`, then
the read of the Grade's Active Phase. Plan before Phase is the order every Phase Plan change uses. It requires
an active Mapping, a non-dropout Student, a single current Grade 11/12 roster Grade, no
privacy tombstone, and an applicable Phase: current-year, or a prior-year Grade 11 Phase
for a Grade 12 Mentee with prior-year Mapping history. It derives the prior Academic Year
itself. `checkHolisticMentorWriteScope(scope, actorUserId)` returns 404 `Not found` for
missing scope or a non-Mentor actor, 422 `Phase is not Open` for a Locked Phase, and 422
`This Phase is closed. …` (`HOLISTIC_PHASE_CLOSED_ERROR`) for a Closed one. Do not copy the query into new writers; call the helper so guard semantics and lock order stay identical.

### Closed Phases (#536)

Only the **Active Phase** of the Mentee's current Grade takes Mentor writes: the latest
ordered `open` Phase of the current Academic Year's Plan for that Grade. Every other
opened Phase is **Closed**: an earlier Open Phase of the Grade, and every prior-year Phase.
Closed is derived, never stored (`holistic_mentorship_phases.state` is still only
`locked` / `open`; no db-service change).

- **Write path:** the loader returns `phase_active`. It share-locks the Plan row in its
  **own first statement**, then locks the Mapping and Phase rows, then reads the Grade's latest
  Open Phase in a **third statement**. Every Phase state change locks the Plan row `FOR UPDATE`
  first (`checkedPhase` calls `lockPhasePlanForPhase` before `getMutablePhase`), so a write
  that raced an Admin opening the next Phase waits, then sees the new Phase and is refused.
  Keep the Active read its own statement: a subquery in the scope query would read the
  snapshot taken before the wait. A Locked Phase, or one outside the current year's Plan,
  skips that read.
- **Lock order is Plan, then Phase, everywhere:** the Mentor write scope, state change,
  definition update, reorder and delete. Locking a Phase row before the Plan row in any of
  them deadlocks a Mentor save against an Admin reorder or delete (reproduced on the first
  version of this change; Postgres aborts one side with `40P01`, a 500).
- **Current year only:** "current" is `CURRENT_ACADEMIC_YEAR`, never the `academic_year` a
  request or screen names. The write scope, `getHolisticStudentPhase` (`active` / `closed`),
  the Progress `phase_availability` and `getHolisticPhasePlan` (`active`) all use it, so a
  past year's Plan has no Active Phase and takes no Mentor writes. `active` and `closed` are
  never both true.
- **Read model:** `getHolisticStudentPhase` adds `closed` to every unlocked Phase summary and
  to the selected Phase, with the same rule; `canEditNotes` is false when closed. Mentor tabs
  read Closed instead of Open/Skipped (Completed stays Completed); the selected Phase shows a
  closed notice naming the Phase that takes Notes, read-only Notes (an author still reads
  their unsubmitted draft, labelled as not submitted before the Phase closed) and a disabled
  Add notes. Admin/PM drill-down says "Closed Phase" and "Closed without Notes".
- **A form open when its Phase closes:** the save is refused with `HOLISTIC_PHASE_CLOSED_ERROR`
  (`src/lib/holistic-phase-messages.ts`, shared with the client). `PostSessionNotesEditor`
  recognises it on autosave, Submit and Save Changes alike, stops autosave and Retry, drops the
  navigation guard, and shows what was typed read-only under an alert, so the Mentor can copy
  it and leave. It shows no Completed badge or "Submitted by" line over that text (the server
  never took it) and calls `router.refresh()` once, so the Phase tabs and the Follow-up section
  catch up while the typed text stays (it lives in client state). The editor's React key
  includes the Phase revision, so `useNotesDefinitionPinnedOnRefusal` pins the revision and
  Questions the form was loaded with before that refresh: an Admin's definition edit made
  just before the Phase closed must not rebuild the editor and drop the text. The Follow-up pop-up does the
  same on that refusal: it stays open with the text read-only, Save off, and the page refreshed.
  **Dictation (#500) in that form:** a clip refused with the same message (the Phase closed
  before any save noticed) freezes the form the same way (`useDictationRecorder`'s
  `onPhaseClosed`). Once a form is frozen its recorder is dropped (`discard()`), as when the
  Mentor leaves it: a recording stops and releases the mic without uploading, a clip being
  transcribed is ignored when its words arrive, a failed clip's Retry goes, every mic and the
  "Finish dictating first" hint go with the inputs (the pop-up's mics stay, disabled), and the
  recorder no longer holds the page's one recording slot. The frozen text is exactly what was on
  screen when it froze; the server refuses a Closed Phase's clips anyway. The freeze is also latched
  in a ref (`frozenRef`) that work already in flight reads before the frozen form renders: a clip's
  words, a draft queued behind a save in flight, and Submit after its draft flush are all dropped,
  and a frozen form releases the leave-page guard even while that flush is pending. When a refresh
  brings the Phase back Closed before this form wrote anything, the forms stay as #536 left them
  (Notes read-only unless a correction is open; the pop-up's text and Save as they were, the server
  answering Save), but Dictation stops: the recorder is dropped and no mic is offered. A pop-up
  refused for a Closed Phase keeps Add notes off ("This Phase is closed") until newer page data
  arrives (the latch is tied to the `followUpNotes` array of the data in hand at the refusal; a
  refresh brings a new one), and from then on the server's `closed` decides.
  Pinned in `StudentPhaseWorkspace.dictation.test.tsx`.
- **Progress:** `phaseState` / the CSV **Availability** column is `active` | `closed` | `locked`
  (`closed` replaced `open`). Derived Pending / Skipped / Completed progress is unchanged.
- **Phase Setup:** `setHolisticPhaseState` refuses to open a Phase ordered before an Open Phase
  of the same Grade (`validateOpenOrder`, 422). `updateHolisticPhase` refuses a Grade change
  while the Phase is Open (`HOLISTIC_OPEN_PHASE_GRADE_ERROR`, 422): it would close or reopen
  other Phases without that check or the confirmation; the screen disables the Grade control.
  `GET /api/holistic-mentorship/phase-plans?program_id=&open_impact_phase_id=`
  (gate `phase_configuration_read`) returns `getHolisticPhaseOpenImpact`: the Phase that will
  close and counts only (assigned Mentees of the Grade without submitted Notes in it, and how
  many of those hold a draft with content), over the write scope's Mentee set, built from one
  `MATERIALIZED` roster snapshot (not a roster read per Mapping, which timed out in #321).
  `PhasePlanSetup` asks on every open and names the closing Phase from the server's answer,
  because its own copy of the Plan can be stale. If the impact read fails, the prompt falls back
  to the screen's copy and to "Check Students & Progress" in place of the counts.
  The open then sends back the Phase the prompt named: `expected_closing_phase_id` (the server's
  answer, or the screen's copy when the impact read failed; null for none). `setHolisticPhaseState`
  compares it, under the Plan lock, with the Grade's latest Open Phase (`validateExpectedClosingPhase`)
  and answers 409 `HOLISTIC_CLOSING_PHASE_CHANGED_ERROR` on a mismatch, so two Admins acting
  within seconds cannot close a Phase neither was warned about; the screen reloads the Plan,
  keeps any unsaved edits to that Phase, and shows that message (a different one if the reload
  fails). The API skips the check only when the field is absent, which this screen never does.
- **Undo:** returning the unused Active Phase to Locked makes the previous Open Phase Active
  and writable again. There is no other reopen.
- **Tests:** `holistic-closed-phases.integration.test.ts` (opt-in `HOLISTIC_NOTES_TEST_DATABASE`,
  real Postgres): the racing write and the reorder deadlock both drive the real Admin function,
  paused on a Phase row held by a third connection, and wait on `pg_stat_activity` instead of a
  timer; the two-Admins case runs the impact read and both opens for real. Unit tests sit beside each module.

## Holistic answer length (#508)

Post-Session answers and Follow-up answers share one limit, `HOLISTIC_ANSWER_MAX_LENGTH`
(10,000) in the client-safe `src/lib/holistic-answer-limit.ts`. The Student Phase `PATCH`
route and `normalizeHolisticFollowUpAnswers` both reject longer answers with it, and the
Student Phase workspace shows an "N / 10,000" counter at 9,000 characters or more in every
editable answer box (draft, author's Edit, Add Follow-up Note). Read-only views show no
counter. Use this constant for any new answer-length check (e.g. Dictation, #500).

## Holistic Dictation usage records (#500, slice #509)

- **Table ownership:** `holistic_mentorship_dictation_usage_records` comes from db-service #858
  (migration `20261110151931_create_holistic_mentorship_dictation_usage_records`, plus
  `20261116113700_add_translation_to_holistic_dictation_usage_records`, a second migration because
  the first is already applied on staging); LMS inserts and updates it directly through `query()`
  (ADR 0005). Content-free: no Student, Phase, Question, text, translation or audio column, so it is
  outside Holistic privacy erasure. The second migration adds `detected_language` (Scribe's code,
  lower-cased, NULL when missing or not 1–16 characters) and `translation`
  (`not_run | skipped | ok | failed`, checked by the table). **Deploy order:** the LMS writes both
  columns on every clip, so apply `20261116113700` before deploying this LMS code (ADR 0013).
- **Write path** (`transcribeHolisticDictation` in `src/lib/holistic-dictation.ts`): limit check →
  insert `outcome='failed'`, `characters_returned=0`, `translation='not_run'`, `completed_at` NULL →
  ElevenLabs call → translation into English through OpenRouter unless already English (ADR 0013) →
  update to `ok` / `nothing_heard` / `failed` with `characters_returned` (length of the English text
  returned), `detected_language`, `translation` (`not_run` when Scribe failed or heard nothing,
  `skipped` when already English, `ok` translated, `failed` translation failed, which also makes
  the outcome `failed`), `completed_at`, and
  `audio_seconds = min(305, ceil(max(duration_ms/1000, last word end)))`. The route refuses a clip over
  305,000 ms (422) or 10 MB (413); 305 s is `HOLISTIC_DICTATION_MAX_CLIP_SECONDS` in
  `src/lib/holistic-dictation-limits.ts` (five minutes plus 5 s of timer slop, owner decision
  2026-11-13), and db-service #858 checks `audio_seconds BETWEEN 1 AND 305`. A request killed
  mid-call leaves the `failed`, uncompleted row, which still counts. The browser's cancel
  (`discard()` aborts the upload) is not passed to the provider call: the call finishes, the row
  is completed, and the seconds count. This is the agreed rule (ADR 0012: an abandoned clip
  still counts), so do not wire `request.signal` into `transcribeSpeech` or `translateToEnglish`
  without a new decision. Scribe and translation share one deadline, with a shorter cap for Scribe
  and for each translation attempt and one retry only when enough time is left (the numbers are in
  ADR 0013 and the constants in `src/lib/holistic-dictation.ts`).
  The route refuses an empty (0-byte) clip with 422 "Attach one audio clip" before this path, so
  it writes no row and makes no provider call.
- **Timestamps:** the columns are naive UTC and the shared Postgres session time zone may be
  Asia/Kolkata (the local test DBs are), so the insert writes `$now::timestamptz AT TIME ZONE 'UTC'`
  and `completed_at = now() AT TIME ZONE 'UTC'` explicitly; never rely on the `now()` default here.
- **Daily limit:** remaining = 1,800 − SUM(`audio_seconds`) of this Mentor's rows whose
  `inserted_at` is in the current Asia/Kolkata day (converted to a UTC window), floored at 0
  (`getHolisticDictationRemainingSeconds`). A clip is refused (429 `daily_limit`) when used +
  `ceil(duration_ms/1000)` > 1,805; the 429 body carries `remainingSeconds` (the real time left from
  that same used-seconds read, floored at 0) and no usage row is written. The check and insert are not atomic; racing tabs can overshoot
  by one clip each (accepted).
- **Write scope before the call:** `checkHolisticDictationScope` runs `loadHolisticMentorWriteScope`
  (plus submitted Notes for `follow_up`) in its own `withTransaction`, which commits before the
  provider calls, so no row lock is held while ElevenLabs or OpenRouter works. The loader takes
  #536's Plan share lock first (lock order Plan, then Mapping and Phase, as every Phase change), and
  its Active Phase rule refuses a clip for a Closed Phase with 422 `HOLISTIC_PHASE_CLOSED_ERROR`, uncounted.
- **Opt-in integration test:** `src/lib/holistic-dictation.integration.test.ts` with
  `HOLISTIC_DICTATION_TEST_DATABASE=dbservice_test_*` (IST day boundary, sum/floor, killed attempt,
  a five-minute clip and the 305 s cap against the table's check constraint, the
  `detected_language` / `translation` values for skipped, translated, failed and nothing-heard
  clips, and the `translation` check constraint). The disposable DB needs both db-service #858
  migrations, including `20261116113700`; ElevenLabs and OpenRouter are faked at `fetch`.

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
  (404/422, including 422 for a Closed Phase, #536), then a submitted Post-Session Notes check (422), then `INSERT ... RETURNING id`.
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
  Placement (Notes form and the Phase Setup hint): each group sits above the first Question by
  position whose text says "academic challenge" / "non-academic challenge", any case. "non
  academic" and "nonacademic" count as Non-academic too, and never as Academic; a Question naming
  both is Non-academic only.
- **Storage:** `holistic_mentorship_post_session_note_challenges` (db-service #806), one row per
  code, unique `(notes_id, category_code)`, no DB CHECK on codes. Its insert/update trigger shares
  the post-session privacy guard (Student advisory lock, rejects tombstoned Students). Raw SQL (ADR-0005).
  **Deploy db-service #806 first**, including migration `20261026101410` (the tombstone's
  `post_session_challenges_erased` column): without the table every Notes read, write and erasure
  fails, and without the column every privacy erasure fails.
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
  (before the tombstone). The tombstone records `post_session_challenges_erased` (Category rows)
  next to `post_session_answers_erased` (answer rows only), so a Categories-only Note still counts.
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
- **Mapping source:** active Mappings for `CURRENT_ACADEMIC_YEAR`, i.e. whose period contains now:
  `started_at <= (now() AT TIME ZONE 'UTC') AND (ended_at IS NULL OR ended_at > (now() AT TIME ZONE 'UTC'))`
  (columns are UTC `timestamp`; half-open, so a zero-length row contains nothing). A Mapping the
  db-service import sheet dates in the future grants nothing until it starts, though it already
  holds the partial unique index's one running slot; on a reassignment db-service ends the old
  Mapping at the new one's `started_at`, so the old Mentor keeps the Student until then. A
  db-service exclusion constraint (added alongside this change) keeps one Student's periods in a year from overlapping, so at
  most one row is active at any instant. Only Students not marked a dropout count (`student.status = 'dropout'`; NULL or any other
  status stays in), written once as `activeBlendedMappingSql(alias, yearParam)` in
  `src/lib/blended-learning-access.ts` (`notBlendedDropoutSql(studentIdSql)` is the dropout
  half). Every Blended Learning scope uses it: `canAccessBlendedStudent` (so a dropout's page,
  log form, Conversations and write routes are a 404), `lockMappingInScope`, `listMentees`,
  `listMentorCards`, `getMenteeDetail`, the Flags feed (a dropout's flags are hidden from
  every viewer, admins included, and from "N new" and the Mentor filter), and Common Action
  Item targets (count, preview, Mentor "(N students)", push and push again never reach a
  dropout; a pasted dropout ID is listed as "found but with no active mentor"). Mapping rows
  are never changed, so a Student whose status changes back reappears. Only the links import
  reads the raw rows (`currentBlendedMappingRowSql`: not yet ended, i.e. running or ending in the
  future, started or not), so a dropout's, a future-dated Mapping's and a future-ended Mapping's
  links stay loaded. It reads Students through `EXISTS`, so one mid-handover (old row ending as its
  successor starts) is matched once.
  Already-materialised Common Action Items on a dropout keep counting in the item's Open/Done.
- **Read model:** `listMentees({ access, mentorUserId?, studentId?, today })` in
  `src/lib/blended-learning-mentees.ts`. One query per list: grade from the current grade
  enrollment (`enrollment_record`, `group_type = 'grade'`, `is_current`), program from the
  active Mapping, the latest Conversation and latest Attempt (`(occurred_on, id)` DESC, through
  `LATERAL`), `blended_learning_student_links.legacy_last_contact_on`, and the open draft
  state (`transcribing|ready|failed`). A Mentor always gets their own Mentees, whatever
  `mentorUserId` says; a Mentor without a Mentor user id gets an empty list without a query.
  Rows are grouped (Talk to First = any reason) and sorted in JS by the pure policy.
  Each row also carries `programStudentId` (`student.student_id`, kept as text so leading zeros
  survive) and `category` (`student.category`), both nullable; `studentId` stays `student.id`
  for links. The table gives each its own column right after Student ("Student ID" in
  `font-mono`, "Category"; "—" for NULL); a card shows both on the muted line under the name
  ("ID <id>  Category <value>"). To fit at 1024 px the table uses tight paddings, lets names,
  headers and Program wrap, and shows View / New log as 44 px icon buttons (aria-labelled)
  below `xl` (1280 px).
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
  pagination). The search ("Search by name or Student ID") is a trimmed, case-insensitive
  substring match on the name or `programStudentId`. Gender and Program
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
  returned rows than ids throws when a missed id still exists (already done or another
  Student's), so the whole save rolls back and returns 409; a missed id with no row (deleted by
  a Common Action Item's removal or a Profile Doc re-sync) is skipped. af_lms makes only that open → done change, and
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
  `src/lib/blended-learning-links-import.ts`); there is no in-app editing. It reads the raw
  not-yet-ended Mapping rows (`currentBlendedMappingRowSql`, one row per Student), the existing links (`student_id = ANY($1::bigint[])`), and
  upserts `ON CONFLICT (student_id)` per changed Student only, so an unchanged re-run writes
  nothing. Non-`https://` values are skipped before the DB CHECK sees them; a value missing from
  the workbook keeps the stored one. `legacy_last_contact_on` is selected and written only
  with `--legacy-docs-dir`, which needs `--legacy-conversations` so a date never moves
  without its summary and items (Profile Doc HTML exports; date extraction in
  `src/lib/blended-learning-profile-doc-dates.ts`: the doc's latest dated conversation only).
  With docs, every matched Student is considered, so a stored Profile Doc link still gives a
  date when the workbook row has none; a Student with no link and no stored row gets no row.
  `legacy_conversation_summary` (db-service migration `20261027100000`, mirrored in e2e fixture
  `20261027100000_add_blended_learning_legacy_conversation.sql`) is selected and written with
  it, from `--legacy-conversations` (validation in
  `src/lib/blended-learning-legacy-conversations.ts`): the file's entry for a `dated` doc on
  that same date, NULL otherwise; an unreadable doc keeps it. The upsert names only the
  columns the run owns (fixed literals; values bound). The same run syncs that Student's
  **Profile Doc Action Items** (`blended_learning_action_items.from_profile_doc = true`,
  `conversation_id` NULL, `bl_action_items_source_check`: a Conversation XOR the Profile Doc;
  partial unique `bl_action_items_profile_doc_unique` on (student_id, text, owner)): insert
  missing ones open, keep matching ones (open or done), delete only open ones the file no
  longer lists (all open ones when the summary is NULL); three batched statements, the DELETE
  re-checking `status = 'open'`. An apply runs the reads, upserts and item sync in one
  `withTransaction`, so a failure part way rolls everything back; a dry run uses `query()`.
  Runbook: `patterns/load-blended-learning-links.md`.
- **Profile Doc entry on the Mentee pages:** `getMenteeDetail` adds a `kind: "profile_doc"`
  history entry (`legacy_last_contact_on`, the summary, every Profile Doc Action Item with its
  status, the Profile Doc URL) at its date, after the app's entries of that date; it needs a
  date and a summary or an item. It is history, never a Conversation: "Conversations (N)",
  Last Contact (still `legacy_last_contact_on`), list stats and first-conversation logic count
  only `blended_learning_conversations` rows. Its open items are in `openActionItems` with
  `source: "profile_doc"` and `agreedOn` = that date (meta "From Profile Doc · <date>"), and are
  ticked done from the log form through the normal save (`completeActionItems`). The detail page
  renders the entry like a Conversation (Summary, Action items with Open/Done, "Open Profile
  Doc"), admins read-only; the log page's Last Conversation panel shows it while it is the
  latest. Owner pills are a fixed `w-16` column (`ACTION_ITEM_ROW_CLASSES` in
  `ActionItemMeta.tsx`) so item text lines up whoever owns it.

## Blended Learning Supervisions (2026-11-12)

- `blended_learning_mentor_supervisions` (db-service `20261112120442`, LMS-owned, mirrored in
  `e2e/fixtures/migrations/20261112120442_add_blended_learning_supervisions.sql`, pg_dump-identical):
  `supervisor_user_id`, `mentor_user_id` (both `user` FKs, `<>` each other), `academic_year`,
  `started_at`, then the Mapping table's audit and lifecycle columns and CHECKs. One running row per
  (supervisor, mentor, year) (`blm_supervisions_active_pair_year_unique`, partial on
  `ended_at IS NULL`); rows are ended, never deleted. Read as `activeBlendedMappingSql` reads Mappings
  (period contains now). The Manage list and End take every link not yet ended (`ended_at IS NULL
  OR ended_at > now`): a future-dated link is listed and can be ended (at its `started_at`), and
  one given a future `ended_at` outside the app is listed with "ending on <date>" and End cuts it
  short. The team-lead INSERT's `ON CONFLICT` still matches the partial unique index (`ended_at IS
  NULL`).
- Read once per request in `getBlendedLearningAccess` (a Mentor's `supervisedMentorUserIds`);
  `listSupervisedMentors` (in `blended-learning-mentees.ts`) names them for the Flags tab's Mentor
  filter, and `listMentorCards` builds a team lead's Team cards from them (`menteeRows` takes an
  array of Mentor ids). Only Supervisions whose reportee still holds a live (not revoked)
  `blended_mentor` permission count (`liveBlendedMentorSql`, resolved by `permissionUserIdSql`), so a
  departed Mentor's Students drop out of the team lead's view. Written only by the Manage page's
  **Team leads** section (since 2026-11-18; the operator loader script was removed 2026-11-19):
  `src/lib/blended-learning-team-leads.ts`, `POST /api/blended-learning/team-leads` and
  `POST /api/blended-learning/team-leads/[id]/end`, both `manage`, with `assignment_source`/`end_source`
  `af_lms_manage_ui` and the admin's email in `assigned_by_email`/`ended_by_email` (`end_reason`
  `supervision_ended`). Add: both people must hold a live `blended_mentor` permission (Mappings alone
  do not count), checked inside the insert's transaction with their permission rows locked
  `FOR SHARE`, then `INSERT … ON CONFLICT … WHERE ended_at IS NULL DO NOTHING`; self-supervision is a
  422, a running pair a 409 (also when the insert hits db-service's
  `blm_supervisions_no_overlapping_periods` exclusion constraint, `23P01` with that constraint name:
  a racing add won, or the pair has a link given a future end, and then the message says "until
  <date>" from a lookup after the rollback; other errors, other constraints included, still throw).
  End: one `UPDATE … WHERE id = $1 AND academic_year = $2 AND (ended_at IS NULL OR ended_at > now)`
  setting `ended_at = GREATEST(started_at, now)` and the admin as ender (`ended_by_user_id` cleared,
  `ended_by_email`, `end_source`, `end_reason` overwritten for a link cut short), a 404 when nothing
  matched (an end already past is never touched; a pair ended and re-added meanwhile keeps its new
  row).
- Flags tab Mentor filter: for a team lead ("My students" or a reportee) it matches the Student's
  current active Mapping's Mentor (dropouts left out), not who logged the flagged Conversation; an
  admin's filter still matches the Conversation's Mentor.
- e2e: `BLENDED_SUPERVISOR` (one own Mentee, `SUPERVISOR_MENTEE`) supervises Mentor B and has an
  ended Supervision of Mentor A; `e2e/tests/blended-learning-supervisor.spec.ts` asserts on them.
  The Manage spec makes Mentor D lead Mentor C inside one test and ends it before finishing.

## Blended Learning Manage: Resources and Common Action Items (2026-10-27)

- **Tables:** db-service `20261027120000_create_blended_learning_resources_and_common_action_items`
  (branch `feat/bl-admin-manage`; deploy it before this code). `blended_learning_resources`
  (title ≤ 200, `^https://[^[:space:]]+$` url, `position` ≥ 1, `created_by_email` /
  `updated_by_email`, NULL only on the seeded Mentor Toolkit row; hard delete) and
  `blended_learning_common_action_items` (text ≤ 500, owner, `target_kind` `all|grade|mentor` with
  `target_grade` 12/13 or `target_mentor_user_id`, `created_by_email`, soft removal
  `removed_at` + `removed_by_email`). `blended_learning_action_items.conversation_id` is now
  nullable, `common_action_item_id` is new, `bl_action_items_source_check` requires exactly one of
  `conversation_id`, `common_action_item_id` and `from_profile_doc` (the Profile Doc carry-over's flag),
  and `bl_action_items_common_student_unique` is the partial unique index
  `(common_action_item_id, student_id) WHERE common_action_item_id IS NOT NULL`. Pushed rows use
  `position` 1. All reads and writes are direct SQL (`query()` / `withTransaction`), gated by
  `manage` (see `context/permissions.md`).
- **Resources:** `src/lib/blended-learning-resources.ts`. `listResources()` (`ORDER BY position,
  id`) feeds the Resources tab (`MentorResources`, no longer hard-coded) and the Manage page.
  Create appends at `MAX(position) + 1`; move locks every row `FOR UPDATE` and renumbers 1..n in
  the new order through `unnest(...) WITH ORDINALITY` (`movedOrder`); edit and delete are 404 for
  an unknown id. Validation (`validateResource` in the client-safe
  `src/lib/blended-learning-manage-input.ts`) → 422 `fieldErrors`.
- **Common Action Items:** `src/lib/blended-learning-common-action-items.ts`. A target reaches the
  Students of active current-year Mappings (`activeBlendedMappingSql`) filtered by the Mentee
  list's grade (`currentGradeLateralSql`, now exported from `blended-learning-mentees.ts` and used
  by `listMentees`), the Mapping's `mentor_user_id` or `student.student_id = ANY(target_student_ids)`
  ("Specific students": IDs pasted by the admin, split on whitespace / commas, deduped, kept as text
  so leading zeros survive; at most 1000) (`targetedStudentsSql`). `previewCommonTarget` (a POST, as
  ID lists can be long) counts them (the form's "Will be added to N students") and, for a students
  target, lists the pasted IDs not found and those found with no active Mapping (`unmatchedStudentIds`).
  The IDs are stored so Push again reaches the same list. `createCommonActionItem` inserts the item
  and materialises it in one transaction (`INSERT … SELECT … ON CONFLICT (common_action_item_id,
  student_id) WHERE common_action_item_id IS NOT NULL DO NOTHING`); a target with no Students (or
  an unknown Mentor, 23503) rolls back as a 422. `pushCommonActionItem` locks the item `FOR UPDATE`
  (removed → 404) and runs the same insert, so it adds only targeted Students who don't have it
  (done included) and a repeat adds 0. `updateCommonActionItem` updates the item and its rows
  `WHERE status = 'open'`; `removeCommonActionItem` soft-removes it and deletes its rows `WHERE
  status = 'open'`, keeping done ones. `listCommonActionItems` (items in force, newest first) adds
  open / done counts and `notYetAdded` (targeted Students without a row: what Push again adds).
- **Action-item queries audited for NULL `conversation_id`:** `getMenteeDetail` reads every row
  by `student_id` (no join) and now builds `openActionItems` from Conversation rows (as before)
  plus the rows with no Conversation: Profile Doc ones (`source: "profile_doc"`) and pushed ones
  (`source: "common"`, `agreedOn` = the IST date the row was inserted), newest date first;
  `groupBy` skips NULL `conversation_id`, so an open pushed row is in no Conversation's history; a
  done one (`completed_by_conversation_id` set) is listed after the items of the Conversation that
  ticked it, as `{ …, status: "done", source: "common" }` (`doneCommonItemsByConversation`), so the
  "done ones stay in their history" promise of Remove holds. `logEntry`'s tick `UPDATE … WHERE id = ANY($3) AND status = 'open' AND student_id = $4`
  ticks a pushed row like any other. A ticked id with no row left (removed while the Mentor's form
  was open) is skipped and the rest saves; only a missed id that still exists (done, or another
  Student's) is the 409.
  `insertActionItems` and the draft review read paths only touch Conversation rows; the links
  importer's Profile Doc sync and the e2e seed's Profile Doc rows only touch `from_profile_doc`
  rows. Nothing else in `src/`, `scripts/` or `e2e/` reads the table (no list counts, flags or
  exports).
- **UI:** `/blended-learning/manage` (`src/app/blended-learning/manage/`): `ResourcesManager`
  (add / inline edit / ↑ ↓ / remove after `ConfirmDialog`) and `CommonActionItemsManager` with
  `NewCommonItemForm` (who does it and the action item side by side on one line, as on the log form,
  stacked on a phone; 200 characters in the form and in `validateCommonItemEdit`, though the DB
  allows 500; target radio + Grade/Mentor select or Student IDs textarea, live preview with the unmatched IDs, confirm
  before push; 422 field errors go back inline). `useTargetPreview` returns `incomplete | counting |
  failed | ready` for the current target only (counting also covers the typing pause); a failed
  preview shows its `studentIds` field error (too many IDs, a token over 64 characters) or "Couldn't
  count students. …" with Retry, and Push is disabled while counting, failed or at 0 (an incomplete
  target keeps Push so the form's own checks show). After a push or Push again the section's status
  line says "Added to N students." from the response's `added` (0 included). Every change calls
  `router.refresh()`. The open items on the detail page and the log form show a "From program" tag
  (the UI name; code and DB keep "common") and "Added <date>" (`ActionItemMeta` `source="common"`);
  a done one shows struck through in its ticking Conversation's history with the same tag.
- **Known gaps (not built):** an admin edit while a Mentor's log form is open means the Mentor's
  tick completes the new wording (no version check); a create retried after a network error that
  the server had committed pushes a second item (no idempotency key).
- **E2E:** `e2e/fixtures/migrations/20261027120000_add_blended_learning_manage.sql` mirrors the
  migration (pg_dump-identical, seed row included). `blended-learning-manage.spec.ts` uses Mentor D
  (`BLENDED_MENTOR_D`) and `MANAGE_MENTEES` (G1, G2 mapped; G3 mapped by the spec to test Push
  again) and removes the Resources it adds, so later specs see only the Mentor Toolkit.

## Blended Learning Screener Feedback (2026-10-28)

- **Tables:** db-service `20261030120000_add_blended_learning_screener_feedback` (branch
  `feat/bl-screener-feedback`, stacked on `feat/bl-admin-manage`; deploy it before this code).
  `blended_learning_conversations.screener_used` (nullable boolean; a CHECK keeps it NULL on an
  Attempt) and `blended_learning_screener_feedback` (`student_id` UNIQUE, `conversation_id` with a
  composite FK to the same Student's Conversation, `mentor_user_id`, `helped_understand` and
  `more_comfortable` smallint 1–5, `inserted_at`). Conversations are append-only
  (`bl_conversations_immutable`), so `screener_used` is set in `insertEntry`'s INSERT or never.
- **Log form:** a Conversation (typed or saved from a draft; never an Attempt) ends with "Was the
  screener form used?" (`log/ScreenerQuestion.tsx`, unticked) only when
  `blended_learning_student_links.screener_url` is set. Ticked while
  `MenteeDetail.screenerFeedbackDue` (a link and no feedback row for the Student from any Mentor),
  it asks two required 1–5 radio groups (1 "Not at all", 5 "A lot"; copy in
  `students/[id]/screenerQuestions.ts`), listed as "Screener ratings" in the save bar's missing
  fields. The body carries `screenerUsed` only when asked and `screenerFeedback` only while the
  questions show (`logEntryPayload.ts`).
- **Save:** `logEntry` validates the shape first (`screenerFeedback` without `screenerUsed: true`
  → 422; ratings must be integers 1–5). Inside the transaction, before the Conversation's INSERT,
  `checkScreener` reads the link and whether feedback exists (only when an answer was sent). The
  link can change while the form is open, so a mismatch is not an error: an answer without a link,
  or no answer with a link, saves `screener_used = NULL` with no feedback. With a link, a tick with
  no ratings while due → 422 field errors; ratings once feedback exists → 409 with
  `fieldErrors.screenerFeedback`; else the feedback is inserted after the Conversation's parts
  (mentor = the mapped Mentor). A racing second insert hits `bl_screener_feedback_student_unique`
  (23505) and gets the same 409. On that 409 the form drops the questions and keeps the tick, so
  "Save" again records just `screener_used = true`. Any 422 field error no rendered field owns
  (`unshownFieldError` in `logEntryPayload.ts`) shows in the save bar, so none is silent.
- **Display:** `getMenteeDetail` LEFT JOINs the feedback by `conversation_id`; each Conversation
  has `screenerUsed` and `screenerFeedback`. The history shows a "Screener" section ("Screener form
  used", and the two ratings as `n / 5` on the Conversation that gave them) to Mentors and admins,
  read-only. The log page shows no past feedback.
- **E2E:** `e2e/fixtures/migrations/20261030120000_add_blended_learning_screener_feedback.sql`
  mirrors the migration (pg_dump-identical). `blended-learning-screener-feedback.spec.ts` uses
  Mentor C's `SCREENER_MENTEES` (J1–J4: one with a link, one without, per viewport) and
  `SCREENER_RACE_MENTEE` (J5), seeded after every other fixture Student so their phones don't move.

## AI Test Insights tables (#550; e2e mirror #554, 2026-11-27)

- **Ownership (ADR 0015):** db-service owns the DDL (PR #884, migration
  `20261126120504_create_ai_test_insight_tables`) and exposes no API for these tables. The LMS
  reads and writes `ai_test_insight_requests`, `ai_test_insight_sessions` and
  `ai_test_insight_session_note_audits` through its own Postgres boundary (`query()` /
  `withTransaction()`, `$n` placeholders), never through a DB Service HTTP call. AI Mentorship Guide
  updates only a request's progress (state, Item link, times, outcome code) and owns the
  `acad_mentorship_*` tables; the LMS only reads its Items and Item File rows.
- **What the database enforces:** one `queued`/`running` request per Student
  (`ati_requests_active_student_unique`; a second insert is a unique violation), lifecycle CHECKs on
  requests and sessions, the composite FK `(inference_item_id, student_id)` onto
  `am_items_id_student_unique` (the Item is the same Student's), and append-only Session Note audits
  (trigger `ati_session_note_audits_immutable`, `23514`). Times are `timestamp(0)` UTC: write and
  compare with `now() AT TIME ZONE 'UTC'` and set `updated_at` yourself (no trigger).
- **E2E fixture schema:** `e2e/fixtures/migrations/20261127120000_add_ai_test_insights_schema.sql`
  mirrors, idempotently and pg_dump-identically, db-service `20260616100000_create_academic_mentorship_tables`
  (all 15 `acad_mentorship_*` tables plus its seeded `global` runtime-settings row),
  `20260616173000_allow_scoring_status_in_eval_run_benchmarks` and
  `20261126120504_create_ai_test_insight_tables`, read from `origin/feat/issue-880-ai-test-insights-tables`.
  It seeds no Insight Request or Session rows. Re-diff with `patterns/mirror-db-service-schema-in-e2e.md`
  whenever db-service PR #884 changes.
- **Listed Students (#555):** the one rule for "which Students AI Test Insights is for" is
  `listedStudentRowsSql(firstParam)` in `src/lib/ai-test-insights-students.ts`, a subquery of
  `(student_id, user_id, centre_id, program_id, grade)` rows: `centre_students` for
  `CURRENT_ACADEMIC_YEAR`, Grade 11 or 12, an active centre whose Program is not JNV NVS,
  `student.status IS DISTINCT FROM 'dropout'`, and `LOWER(BTRIM(student.stream))` in
  `ENGINEERING_STREAM_VALUES` (`engineering`, `engg`, `pcm`; exported from
  `src/lib/student-support-rules.ts`, the exam-stream normaliser). A blank stream is **not**
  listed, unlike the Student Report's `studentExamStream`, which defaults blank to engineering.
  A Student on two centres' rosters gives two rows: `listAiTestInsightsStudents(centreIds)` groups
  by Student (lowest Grade if two), orders by Grade, then name, and adds each Student's counts
  (below). Later slices reuse the same subquery for Student access.
- **Insight counts (#556):** `readAiTestInsightsCounts(studentIds)` in
  `src/lib/ai-test-insights-counts.ts` is the one read of "how much attention a Student has had";
  the Tab uses it now and the Student page reuses it, so the two never disagree. It makes two
  `query()` reads keyed by `student_id = ANY($1::bigint[])`, across all academic years:
  1. `ai_test_insight_sessions WHERE state = 'submitted'` → `insightSessionsCompleted` (count) and
     `lastInsightSessionDate` (`TO_CHAR(MAX(session_date), 'YYYY-MM-DD')`);
  2. `ai_test_insight_requests WHERE state = 'completed'` → `testInsightsGenerated` (count).
  Drafts and requests in any other state are not counted. A Student with no rows gets 0, 0 and
  null; a failed read throws, and the list route answers 500 (never zeros). The Tab's search (name
  or Student ID) and Grade filter run in the browser on the loaded list.
- **Student access and the Student card (#557):** Student access reads the Student's listed rows
  with the same `listedStudentRowsSql` joined to `centres` and `school` (`WHERE student_id = $1`,
  one row per listing centre, lowest id first), then filters by the user's list scope (see
  `context/permissions.md`). `readAiTestInsightsStudentCard(context)` in
  `src/lib/ai-test-insights-student-card.ts` reads name, `student.student_id`, `user.gender`,
  `student.category`, `student.stream` (blank → null, shown as a dash) and Batch = distinct names
  of the Student's current batch enrollments (`enrollment_record` `group_type = 'batch'`,
  `is_current`, `group_id = batch.id`) whose `batch.program_id` is the context's Program; Grade
  comes from the context, and the session values from `readAiTestInsightsCounts`. Null when the
  Student is gone (page → not found).
- **Performance card (#558):** no new read. The Student page's client card asks the existing
  Student Report endpoint (`/api/quiz-analytics/[udise]/student-report`, gate and data unchanged)
  with `school.udise || school.code`, the context's Grade, `PROGRAM_ID_TO_LABEL[programId]` and
  `student=<user.id>` (the warehouse's `enrollment_user_id`), and shows only the score graph and
  the per-test table. It lists every test the report lists; limiting to Major, Full Syllabus and
  Mock is the test picker's job.
- **Test picker (#559):** `readAiTestInsightsTests(userId)` in `src/lib/ai-test-insights-tests.ts`
  (server-only, BigQuery, parameterised, no cache) reads `fact_student_test_results_overall` with
  `enrollment_user_id = @userId` (the Student's `user.id` from Student access), `section =
  'overall'`, `test_format IN UNNEST(@formats)` (`AI_TEST_INSIGHTS_TEST_FORMATS`: Major, Full
  Syllabus, Mock — never Part or Chapter), `academic_year = CURRENT_ACADEMIC_YEAR`, `start_date` on
  or after that year's 1 April (`academicYearStart`), `test_id IS NOT NULL` and `SUBMITTED_ONLY`
  (`has_quiz_ended IS NOT FALSE`: unknown counts as submitted). It groups by
  `CAST(test_id AS STRING)` with the newest sitting date and orders by date then id, both
  descending, casting the id and date to strings; the reader only maps those rows (since PR #573
  it no longer repeats the null-id drop, grouping, format filter or order in JS). The unit test's
  fake warehouse applies each of those SQL clauses only when the read has it, so dropping one
  fails a test. Served by `GET /api/ai-test-insights/students/[studentId]/tests`;
  the Student page reads it once for the picker and the Student card's Newest test line.
- **Insight Requests (#560):** the LMS **writes `ai_test_insight_requests` directly** (ADR 0015),
  only through `src/lib/ai-test-insights-requests.ts` (server-only). Reads `latestRequest(studentId)`
  (newest by `requested_at`, then `id`) and `requestByKey(studentId, requestKey)` (`WHERE
  student_id = $1 AND request_key = $2`, so another Student's key is null) return one view shape,
  `InsightRequestView` in `ai-test-insights-shared.ts`: `requestKey`, `state`, `outcomeCode`,
  `selectedTestIds`, `requestedAt` / `finishedAt` (`to_char(… 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`, so
  no layer reads the UTC `timestamp(0)` as local time) and `requestedByName` (the requester
  `user`'s name, else their email). `createRequest` keeps the PRD's step order in comments: (1) a
  `queued`/`running` request → `already_running` with it; (2) same tests (#567, below); (3) not
  configured; (4) `withTransaction`: close a stalled request (#566), then insert — a `23505` on
  `ati_requests_active_student_unique` returns `already_running` with the winner; (5: later)
  deliver. The insert writes a server `randomUUID()` key, the Student context's `school.id` and
  `programId` (the page's `centre` if it lists the Student, else the lowest centre),
  `CURRENT_ACADEMIC_YEAR`, `requested_by_user_id`, `selected_test_ids` as sent (newest first,
  `$7::jsonb`), `notes_snapshot '[]'`, `state 'queued'` and `requested_at` / `inserted_at` /
  `updated_at` = `now() AT TIME ZONE 'UTC'`. The actor's User is `user_permission.user_id`, else
  the lowest-id `user` with the same email (`actorUserId` in `src/lib/actor-user.ts`, which
  `getAcademicMentorshipActorUserId` also uses since the PR #573 review); neither → 409 `no_linked_user`. The Student page reads
  `latestRequest` on the server (no "page data" route). E2E: `readInsightRequests` and
  `markInsightRequestRunning` in `e2e/helpers/ai-test-insights-fixtures.ts`.
- **Same tests again (#567):** step 2 of `createRequest`, after the already-running check and
  before the not-configured check: unless the body says `generateAgain: true`, it reads the
  Student's newest `completed` request `WHERE student_id = $1 AND state = 'completed' AND
  selected_test_ids @> $2::jsonb AND selected_test_ids <@ $2::jsonb` (each array holds the other:
  the same ids in any order, as the ids are distinct) `ORDER BY requested_at DESC, id DESC LIMIT 1`,
  and if there is one
  returns `existing` with it — route 200 `{ outcome: "existing", request }`, nothing written, no
  wake or enqueue, even where generation is not configured. `no_data` and `failed` rows never
  count. With `generateAgain: true` the step is skipped and a new row is inserted; the earlier
  completed row is not touched. On the card, Generate reads "Generate again" while the ticked set
  equals the shown `completed` request's set and opens a confirmation (`Modal`, "Generate again?")
  first; an `existing` answer shows that request with "An AI Summary for these tests already
  exists". E2E "AI Summary" uses a second, stale tab of the Teacher to get an `existing` answer.
  Order is not compared because the picker lists tests by their newest sitting: after a re-sit the
  same tests come in another order than the stored one (still stored as sent, newest first at the
  time). Before the final checks the step used jsonb `=`, so that order made a new request with no
  confirmation; the route test and the e2e "same tests sent in another order" cover it.
- **Stall rule (#566):** a `queued` or `running` request whose `requested_at` is 20 minutes old or
  more is shown as `failed` with `outcomeCode: "timed_out"`. The rule lives in one place,
  `insightRequestAsShown(view, nowUtc)` in `src/lib/ai-test-insights-requests.ts`, and `toView`
  applies it to every read (`latestRequest`, `requestByKey`, the already-running check), so every
  route and the Student page agree. The clock is the database's: each view read also selects
  `read_at` = `(now() AT TIME ZONE 'UTC')::timestamp(0)`, rounded to the second as the
  `timestamp(0)` `requested_at` is stored (`to_char` truncates, the column rounds; a truncated
  clock read a request made in the same second as one second in the future, so a request
  back-dated by exactly 20 minutes still read in progress). A read never changes the row. Only the
  next Generate closes a stalled row: `createRequest` counts only a fresh in-progress request as
  `already_running`; otherwise, in the insert's transaction, it runs `UPDATE … SET state =
  'failed', outcome_code = 'timed_out', finished_at, updated_at (UTC) WHERE student_id = $1 AND
  state IN ('queued', 'running') AND requested_at <= <rounded UTC now> - interval '20 minutes'`
  before the insert. The re-delivery claim adds `AND NOT (<same stall condition>)`, so a stalled
  request is never woken or enqueued again (the status route also sees it as `failed`). A late
  generator result on a stalled row nobody retried is accepted (AI Mentorship Guide updates `WHERE
  state IN ('queued', 'running')`), so the row reads `completed`. E2E `backdateInsightRequest`
  moves `requested_at` back by N minutes.
- **Requests ended without an AI Summary (#561):** `no_data` and `failed` rows carry
  `outcome_code`; the card turns it into words with `outcomeMessage(code)` in the client-safe
  `src/lib/ai-test-insights-outcomes.ts` (the PRD table; any other code, or none, reads "Something
  went wrong while writing the AI Summary."). "Try again" posts the ended request's
  `selectedTestIds`, in their stored order, with `generateAgain: true` to the same create route,
  so it is always an ordinary new `queued` row: never the `existing` answer, even when an earlier
  completed request has the same tests (PR #573 review: after a failed "Generate again" it used
  to show that earlier AI Summary and write nothing). A row that really ended is never updated
  by the LMS; a stalled one (#566, still `queued`/`running` in the table) is closed `timed_out`
  by that insert's transaction. E2E `endInsightRequestWithoutSummary`
  ends a row as AI Mentorship Guide does (`WHERE state IN ('queued', 'running')`, UTC
  `finished_at` / `updated_at`, `started_at` kept or set); `readInsightRequests` also returns
  `outcomeCode` and `finishedAt`.
- **Status route and re-delivery (#563):** `GET /api/ai-test-insights/students/[studentId]/requests/[requestKey]`
  reads `requestByKey` after Student access (a read), so another Student's key is 404, and answers
  `{ request }` (`AiTestInsightsRequestStatusResponse`). It is the one read with a side effect: for
  `student.canEdit` and a `queued` request it calls `redeliver(requestKey)`, one of the three updates the PRD lets
  the LMS make after insert (with `enqueue_rejected` and the stall close): `UPDATE … SET
  updated_at = now() AT TIME ZONE 'UTC' WHERE request_key = $1 AND state = 'queued' AND not stalled (#566) AND updated_at
  <= now() AT TIME ZONE 'UTC' - interval '30 seconds' RETURNING request_key`. Only a returned row
  delivers (5 s per call), so two polls inside 30 s make one enqueue call; a rejection marks
  `enqueue_rejected` with the same `state = 'queued'` guard. Not configured → no claim. The route
  re-reads the row after a delivery; any error in the side effect is logged and the answer stays
  `{ request }`. E2E `backdateInsightRequestUpdate` moves `updated_at` back; `readInsightRequests`
  also returns `startedAt`. The fake generator claims (`WHERE state = 'queued'`) and ends
  (`WHERE state IN ('queued', 'running')`) rows as AI Mentorship Guide does, in UTC with `updated_at`.
- **AI Summary text and the artifact reader (#564):** `GET .../requests/[requestKey]/summary` gates
  Student access first (a read, so viewers read it), then `requestByKey`: 404 unless the request is that
  Student's and `completed`. `readTestInsightText` in `src/lib/ai-test-insights-artifacts.ts`
  (server-only) finds the file with one `$n` read, `ai_test_insight_requests r JOIN
  acad_mentorship_inference_item_files f ON f.item_id = r.inference_item_id WHERE r.student_id = $1 AND
  r.request_key = $2 AND f.file_kind = $3 AND r.state = 'completed' ORDER BY f.id DESC LIMIT 1`
  (`report` for the text; `report_pdf` is the PDF's kind) — no row is 404. The key must start with
  `{AI_TEST_INSIGHTS_S3_PREFIX}/{APP_ENV}/items/{item id}/` and hold no `.` or `..` segment, or the route
  answers 502 without reading it; the reader's own S3 client (`AI_TEST_INSIGHTS_S3_*` read-only key,
  path-style only with the local endpoint override) then `GetObject`s it, 502 on a store error, an empty
  body or more than 1 MB (by `ContentLength`, then by the bytes read). Not configured → 503
  `not_configured`. Answers `{ markdown }` (`AiTestInsightsSummaryResponse`) with `no-store`; it writes
  nothing and never wakes or enqueues. Logs: request key, `student.id`, reason, error name — never the
  text, a key or a name. Route tests mock S3 with `aws-sdk-client-mock`. In e2e the fake generator's
  complete writes the Session, Item and two Item File rows; `readInsightRequestItem` reads them back, and
  `removeInsightRequestsMadeBySpecs` / `removeAiTestInsightsFixture` remove the fake's Items and Sessions
  (marked `config_snapshot_json = '{"fake_ai_mentorship_guide":true}'`; Item Files cascade). Persona Users
  now carry the persona's name as `first_name`, so the card shows "Asked for by E2E ATI Teacher".
- **AI Summary PDF (#565):** `GET .../requests/[requestKey]/pdf` gates like the summary route (Student
  access, then `requestByKey`; 404 unless that Student's and `completed`). `presignTestInsightPdf` in
  `src/lib/ai-test-insights-artifacts.ts` finds the `report_pdf` file with the same `$n` read (no row →
  404), applies the same folder check (502, nothing signed), then `getSignedUrl` on the reader's own
  client with `expiresIn: 60` and `ResponseContentType: application/pdf` +
  `ResponseContentDisposition: attachment; filename="ai-summary-{student.id}-{YYYY-MM-DD}.pdf"` (the
  request's date in India, `aiTestInsightPdfFileName` in `src/lib/ai-test-insights-shared.ts`; never a
  name). Answers 302 with `Cache-Control: no-store` and the same `Content-Disposition`; 503
  `not_configured`; 502 when signing throws. No bytes pass through the LMS, nothing is written, no wake
  or enqueue. Logs: request key, `student.id`, reason, error name — never a key, the URL or a name.
  Asked with `Accept: application/json` it answers 200 `{ url }` (`AiTestInsightsPdfResponse`,
  `no-store`) with the same presigned URL instead of the 302; a browser visit (a new tab) still
  gets the 302. The card's link (`DownloadPdf` in `AiTestInsightsSummaryCard.tsx`, PR #573
  reviews) handles a plain click in script: one JSON ask, then `window.location.assign` to the
  presigned URL, which the store answers as a download, so the page stays and the route is called
  once per download. Any other answer keeps the Student page and shows a `RetryAlert`: 503 `not_configured` → "The PDF can't be
  downloaded here: AI Summary reading is not set up in this environment.", 404 → "The PDF of this AI
  Summary could not be found.", anything else or a network error → "The PDF could not be downloaded.
  Please try again.". A modified click (new tab or window) is left to the browser. E2E moves the
  `report_pdf` key out of the Item folder (502) and back, then Retry downloads.
- **Session Notes drafts (#551 slice #574, 2026-11-27):** `src/lib/ai-test-insights-session-notes.ts`
  (server-only) is the only reader and writer of `ai_test_insight_sessions`; it does not import the
  Insight Request module. `readOwnDraft(studentId, authorUserId)` is the one draft read (`state =
  'draft'`, author = the caller), so a draft reaches nobody but its author. `saveSessionNotes({ mode:
  "draft", … })`, one `withTransaction` per save: `expectedRevision` 0 inserts at revision 1 with the
  Student context's School and Program (the page's `centre`), `CURRENT_ACADEMIC_YEAR` and the acting
  User — unless all three text fields are blank (nothing written, revision 0); a hit on
  `ati_sessions_author_student_draft_unique` is `stale` with the existing draft's revision, not a 500.
  1+ updates `WHERE student_id = $1 AND author_user_id = $2 AND revision = $3 AND state = 'draft'`
  with `revision + 1` and `updated_at`; zero rows is `stale` with the caller's current draft revision
  (0 when none). Text is stored as typed, a blank field as null; no audit row. Routes:
  `GET …/students/[studentId]/sessions` (view; 200 `{ timeline: [], draft, notesAccess }`, `no-store`;
  `notesAccess` `write` / `no_linked_user` / `read`, draft read only for an `edit` caller with a User;
  `timeline` stays `[]` until #576) and `PUT …/sessions/draft` (edit; 200 `{ revision }`, 409
  `{ code: "stale", currentRevision }`, 422 `{ error, field }`). Both open through
  `src/lib/ai-test-insights-student-routes.ts` (`withAiTestInsightsStudent` /
  `withAiTestInsightsStudentWrite`: Student access with `centre`, then body 422, then the shared
  `actorUserId` lookup 409 `no_linked_user`; a 500 logs only `student.id` and the error name), which
  Generate's create route now uses too. Labels, the 2,000-character limit, `validateSessionNotes`
  (draft and final rules), `parseSessionNotesRequest`, URL builders and types live in
  the client-safe `src/lib/ai-test-insights-session-notes-rules.ts`. E2E: seeded sessions carry
  `other_notes = 'e2e-ati-fixture'`; `readInsightSessions` / `readSessionNoteAudits` read rows back and
  `removeInsightSessionsMadeBySpecs` deletes every other session of the given Students with its audit
  rows (one transaction, `SET LOCAL session_replication_role = replica`, test DB only). The mirror was
  re-diffed against db-service `44b4cac6` on 2026-11-27: identical.
- **Session Notes submit (#551 slice #575, 2026-11-27):** `saveSessionNotes({ mode: "submit",
  openRequestKey, … })` checks the final rule (`validateSessionNotes(notes, "final", getTodayIST())`:
  the draft rule, Areas of concern and Immediate actions non-blank after trim, a date present and not
  after today in India) and then, in one `withTransaction`: (1) when `openRequestKey` is not null,
  `SELECT id FROM ai_test_insight_requests WHERE student_id = $1 AND request_key = $2 AND state =
  'completed'` — no row is `invalid` (`field: "openRequestKey"`, route 422) and nothing is written (the
  module reads that table in its own SQL; it still imports nothing from the Insight Request module);
  (2) `UPDATE ai_test_insight_sessions SET state = 'submitted'`, trimmed text (blank Other notes →
  null), `insight_request_id`, `school_id` / `program_id` / `academic_year` from the Student context
  (the page's `centre`) and `CURRENT_ACADEMIC_YEAR`, `submitted_at`, `revision + 1`, `updated_at`
  `WHERE student_id = $1 AND author_user_id = $2 AND revision = $3 AND state = 'draft' RETURNING id,
  revision` — zero rows is `stale` with the caller's draft revision (0 when none), so a second press of
  Submit never makes a second session; (3) `INSERT INTO ai_test_insight_session_note_audits
  (session_id, actor_user_id, action, revision, …) VALUES (…, 'submitted', <new revision>, …)` — no
  note text. Route `POST …/students/[studentId]/sessions` (edit): body `sessionDate`,
  `areasOfConcern`, `immediateActions`, `otherNotes`, `expectedRevision` (1 or more),
  `openRequestKey` (null or 1–200 characters), parsed by `parseSessionNotesSubmitRequest(raw,
  getTodayIST())`; 201 `{ sessionId, revision }`. The counts read is unchanged: the Tab and the
  Student card count the new `submitted` row. E2E cleanup order: sessions before requests (a submitted
  session's composite FK holds its request); the Submit specs' own `afterEach` does both in that order.
