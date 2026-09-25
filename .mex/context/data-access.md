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
last_updated: 2026-09-25
---

# Data Access

Five backends. Picking the wrong one for a write is a real bug — read this before touching data.

## 1. PostgreSQL — `query()` (the default)
`import { query } from "@/lib/db"` → `query<RowType>(sql, params)`. Returns `rows`.
- **All reads** (lists, dashboards, detail pages, scope resolution).
- **Direct writes** for LMS-owned tables only: PM visits (`lms_pm_school_visits`, `lms_pm_school_visit_actions`), curriculum, permissions/centre tables, Academic Mentor-Mentee Mappings, and Holistic Mentorship product records.
- Holistic Profile regeneration first records an attributable request atomically in Postgres, then calls the configured ETL collection endpoint at `/{request_key}/enqueue` with the matching `APP_ENV` in the body. No Student data is sent. Ambiguous network outcomes remain queued for retry; confirmed rejection is recorded as failed without replacing the previous Profile.
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
