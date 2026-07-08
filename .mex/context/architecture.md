---
name: architecture
description: How the major pieces of this project connect and flow. Load when working on system design, integrations, or understanding how components interact.
triggers:
  - "architecture"
  - "system design"
  - "how does X connect to Y"
  - "integration"
  - "flow"
edges:
  - target: context/stack.md
    condition: when specific technology details or versions are needed
  - target: context/decisions.md
    condition: when understanding why the architecture is structured this way
  - target: context/data-access.md
    condition: when reading or writing data — which of the 5 backends to use
  - target: context/permissions.md
    condition: when a route or page needs to gate access
  - target: context/visits.md
    condition: when working on PM school visits or visit action types
last_updated: 2026-06-25
---

# Architecture

## System Overview
Next.js 16 App Router monolith. A request hits `src/proxy.ts` (middleware) first — it
redirects unauthenticated users to `/` and logged-in users away from the login page.
The request then lands on a Server Component page (`src/app/**/page.tsx`) or a route
handler (`src/app/api/**/route.ts`).

- **Reads** (lists, dashboards, detail pages): the page/route calls `query<T>(sql, params)`
  from `src/lib/db.ts`, a direct PostgreSQL connection pool. This is the dominant path.
- **Writes**: split by entity. Student/batch/quiz-session/document mutations are **proxied**
  to the external DB Service (Elixir/Phoenix) over HTTP with a Bearer token. PM visits and
  curriculum write **directly** to Postgres via `query()`.
- **Analytics reads**: quiz analytics pull from **BigQuery**; the performance dashboard pulls
  from **DynamoDB**. Document files live in **S3**. Session creation publishes to **SNS**.

Every API route gates first: `getServerSession(authOptions)` → a permission check
(`src/lib/permissions.ts`, or `src/lib/visits-policy.ts` for visits) → then data access.

## Key Components
- **`src/lib/db.ts`** — the `query<T>()` helper over a singleton `pg.Pool` (god node, ~137 edges). Reads and direct writes both go through it. `withTransaction()` for multi-statement writes.
- **`src/lib/permissions.ts`** — the access-control core: `getUserPermission`/`getResolvedPermission`, `getFeatureAccess` (feature×role matrix), `canAccessSchool*`, `isAdmin`. See `context/permissions.md`.
- **`src/lib/visits-policy.ts`** — visit-specific gate (`requireVisitsAccess`, `enforceVisit*`, `buildVisitScopePredicate`, `apiError`). See `context/visits.md`.
- **`src/lib/auth.ts`** — NextAuth v4 config: Google OAuth + passcode CredentialsProvider (+ dev-login personas in non-prod).
- **Visit action-type registry** — 7 action types, each a `src/lib/<type>.ts` config/validator + a `src/components/visits/<Type>Form.tsx`, dispatched by `ActionDetailForm.tsx`. Registered in `ACTION_TYPES` (`src/lib/visit-actions.ts`).
- **Analytics clients** — `src/lib/bigquery.ts` (quiz analytics), `src/lib/dynamodb.ts` (performance), each a lazily-initialised singleton client.

## External Dependencies
- **PostgreSQL** — primary datastore, shared with the DB Service and prod. Reads + visit/curriculum writes via `src/lib/db.ts`. Uses Ecto naming (`inserted_at`/`updated_at`, snake_case). Server TZ is UTC.
- **DB Service (Elixir/Phoenix)** — external HTTP API at `DB_SERVICE_URL`, Bearer `DB_SERVICE_TOKEN`. All student/batch/quiz-session/document **writes** route here via `fetch`.
- **BigQuery** (`@google-cloud/bigquery`) — read-only source for quiz analytics (`src/lib/bigquery.ts`); credentials via `GOOGLE_SERVICE_ACCOUNT_JSON`.
- **DynamoDB** (`@aws-sdk/lib-dynamodb`) — read-only source for the performance dashboard deep-dive (`src/lib/dynamodb.ts`).
- **S3** (`@aws-sdk/client-s3`) — student document uploads (`src/lib/s3.ts`), presigned URLs. Bucket shared with prod.
- **SNS** (`@aws-sdk/client-sns`) — `src/lib/sns.ts` publishes session-creation messages.
- **Google OAuth** — staff login via NextAuth; passcode auth for school users without Google.

## What Does NOT Exist Here
- No ORM — raw parameterised SQL via `pg` only. No Prisma/Drizzle/Knex.
- No direct student/batch/quiz-session/document writes to Postgres — those go through the DB Service. Writing them directly bypasses the source of truth.
- No state library (Redux/Zustand) — React local state + Server Components only.
- No REST/GraphQL client framework — `fetch` directly to the DB Service.
- The DB Service itself lives in a **separate repo** (`/Users/deepanshmathur/Documents/AF/db-service`); migrations and write business logic are there, not here.
