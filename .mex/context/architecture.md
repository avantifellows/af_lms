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
last_updated: 2026-10-08
---

# Architecture

## System Overview
Next.js 16 App Router monolith. A request hits `src/proxy.ts` (middleware) first — it
redirects unauthenticated users to `/` and logged-in users away from the login page.
Retired passcode JWTs (`src/lib/retired-session.ts`) count as no token, and their
session cookies are cleared.
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

## Holistic Admin navigation state

The Holistic Admin Program selector is represented by the validated `program_id`
query parameter. The client derives its selection from `useSearchParams` and uses
native `history.replaceState(null, "", url)` when the user changes Program. This
preserves unrelated query parameters and the hash, updates Next App Router state,
and keeps the current history entry so native Back and reload restore the Program.
Repeated, invalid or unavailable Program query values use the server-validated
fallback rather than selecting the first repeated query value on the client.

Assignment Coverage School links add the fixed `source=progress` marker. The School
route recognizes only that exact scalar value, and `RosterPage` produces a
program-bearing return link only after the existing School and Holistic access
checks resolve authorized content. The marker supplies navigation context and never
grants access. Ordinary School links and all Centre return paths keep their existing
dashboard behavior; there is no general return-URL or storage framework.

Student drill-downs from a progress-origin School use the fixed `school-progress`
source. Phase links and locked-phase redirects preserve it, and the Student Back
link restores `source=progress` on the School URL. Ordinary School drill-downs
retain `source=school`, so their original dashboard return does not change.

## Planned navigation work — issue #383

The October 7 PRD retains the existing dashboard/roster/Performance boundaries.
Shipped in #390: `resolveDashboardView` in `src/app/dashboard/page.tsx` defaults
to Physical Centres from resolved `hasCoEOrNodal` (JNV NVS otherwise) after
seated/PMU/Holistic routing and an explicit valid `?view=`; `defaultRosterBackHref`
in `RosterPage` and JNV pagination name `?view=jnv-nvs`. It also plans an exact
trimmed/case-folded owned non-deleted Visit count independent of Recent Visits;
the capped Recent Visits query uses that same owner predicate (shipped in #389,
see `context/visits.md`).
Performance will push deliberate choices, rehydrate every selection from URL
history, compose rapid pending choices, and reject stale grade, option, loading,
error, and report-name responses. Outer
tabs still replace but must follow historical `tab`; report return consumes only
a proven internal step, otherwise replacing away `session` safely. Dashboard
cards lose Start Visit; authorized header/School Visits actions remain.

This is a plan, not shipped behavior. Centre Switcher is separate (#388). No schema,
new API, permission change, or persistent history store is planned. Existing
rendered-page/component tests plus native browser journeys are the chosen seams;
the owned Visit-count predicate needs a real local database fixture. Original and
final issue bodies live under `.ralph/workspaces/383/`; configured council rounds
were zero. No ADR conflicts were identified.

AFK implementation slices are published and natively linked under #383:
#389 exact Visit totals; #390 dashboard defaults/returns/pagination; #391 card
action removal; #392 reversible Performance filters; #393 report history and
outer-tab restoration. Only #393 is blocked by #392, both in its body and as a
native GitHub dependency. The three dashboard slices own distinct edit regions
in the same page; broad page/test rewrites would create avoidable conflicts.
The existing Performance controller and serializer make a separate prefactor
unnecessary. Final issue bodies, write boundaries and verification are in
`.ralph/workspaces/383/slices.md`. This publication implements no app behavior.

AFK implementation slices are published and natively linked under #383:
#389 exact Visit totals; #390 dashboard defaults/returns/pagination; #391 card
action removal; #392 reversible Performance filters; #393 report history and
outer-tab restoration. Only #393 is blocked by #392, both in its body and as a
native GitHub dependency. The three dashboard slices own distinct edit regions
in the same page; broad page/test rewrites would create avoidable conflicts.
The existing Performance controller and serializer make a separate prefactor
unnecessary. Final issue bodies, write boundaries and verification are in
`.ralph/workspaces/383/slices.md`. This publication implements no app behavior.

## Key Components

- **`src/lib/db.ts`** — the `query<T>()` helper over a singleton `pg.Pool` (god node, ~137 edges). Reads and direct writes both go through it. `withTransaction()` for multi-statement writes.
- **`src/lib/permissions.ts`** — the access-control core: `getUserPermission`/`getResolvedPermission`, `getFeatureAccess` (feature×role matrix), `canAccessSchool*`, `isAdmin`. See `context/permissions.md`.
- **`src/lib/visits-policy.ts`** — visit-specific gate (`requireVisitsAccess`, `enforceVisit*`, `buildVisitScopePredicate`, `apiError`). See `context/visits.md`.
- **`src/lib/auth.ts`** — NextAuth v4 config: Google OAuth (+ dev-login personas in non-prod). The `jwt` callback throws on a retired passcode token, signing it out.
- **`src/lib/centres.ts`** — admin-only Centre Management reads and direct writes, including current Grade 11/12 Centre Exam Track mappings. The API accepts only the shared fixed Exam Track codes; mapping unassignment is a hard delete. Legacy Centre Stream storage and configurable options are removed. Admins enter the reviewed initial mappings manually through Centre Management; there is no one-off importer or live Sheet sync.
- **`src/lib/centre-resolver.ts`** — shared fail-closed School + Program resolver for exactly one active physical Centre. Curriculum options use that Centre's Grade-specific Exam Track mappings, annotate Tracks with curriculum-content availability, and reject new logs or standalone Chapter Completion writes outside the current mapping; scopes with retained logs remain available as read-only history. Curriculum Summary expresses the same cardinality rule in its bulk query: current mappings produce normal or unavailable rows, zero/multiple Centres produce per-combination configuration-error rows, and filter options use the complete mapped union for the selected Schools.
- **Visit action-type registry** — 7 action types, each a `src/lib/<type>.ts` config/validator + a `src/components/visits/<Type>Form.tsx`, dispatched by `ActionDetailForm.tsx`. Registered in `ACTION_TYPES` (`src/lib/visit-actions.ts`).
- **Analytics clients** — `src/lib/bigquery.ts` (quiz analytics), `src/lib/dynamodb.ts` (performance), each a lazily-initialised singleton client.

## External Dependencies
- **PostgreSQL** — primary datastore, shared with the DB Service and prod. Reads + visit/curriculum writes via `src/lib/db.ts`. Uses Ecto naming (`inserted_at`/`updated_at`, snake_case). Server TZ is UTC.
- **DB Service (Elixir/Phoenix)** — external HTTP API at `DB_SERVICE_URL`, Bearer `DB_SERVICE_TOKEN`. All student/batch/quiz-session/document **writes** route here via `fetch`.
- **BigQuery** (`@google-cloud/bigquery`) — read-only source for quiz analytics (`src/lib/bigquery.ts`); credentials via `GOOGLE_SERVICE_ACCOUNT_JSON`.
- **DynamoDB** (`@aws-sdk/lib-dynamodb`) — read-only source for the performance dashboard deep-dive (`src/lib/dynamodb.ts`).
- **S3** (`@aws-sdk/client-s3`) — student document uploads (`src/lib/s3.ts`), presigned URLs. Bucket shared with prod.
- **SNS** (`@aws-sdk/client-sns`) — `src/lib/sns.ts` publishes session-creation messages.
- **Google OAuth** — the only login, via NextAuth, open to any Google account; access comes only from a `user_permission` row. Passcode login was removed (ADR 0007).

## What Does NOT Exist Here
- No ORM — raw parameterised SQL via `pg` only. No Prisma/Drizzle/Knex.
- No direct student/batch/quiz-session/document writes to Postgres — those go through the DB Service. Writing them directly bypasses the source of truth.
- No state library (Redux/Zustand) — React local state + Server Components only.
- No REST/GraphQL client framework — `fetch` directly to the DB Service.
- The DB Service itself lives in a **separate repo** (`/Users/deepanshmathur/Documents/AF/db-service`); migrations and write business logic are there, not here.

## Navigation release verification

LMS #332, #334 and #335 merged into main on September 18 in stack order.
For #335 final head `2b2d3392`, staging job 541 verified the complete nested
School/Student/Phase return journey for global and dedicated Holistic Admins on
EMRS Bhopal, plus reload and ordinary School entry. Punjab Nodal had no staging
phases, so its exact nested RSMS drill-down was covered by regression tests rather
than a live browser claim. Final checks included 3,884 unit tests (3 skipped),
lint/build and a completed Codex review without findings. Merge verification alone
does not establish production deployment. Evidence: sibling
`release-records/holistic-back-navigation-20260917/`.
