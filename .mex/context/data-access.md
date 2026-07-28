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
last_updated: 2026-07-17
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
