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

## Issue #383 navigation fixes — implemented in PR #394

The feature branch implements every published slice; child issues #389–#393 are
closed and issue #383 remains open while PR #394 awaits review:

- **#389 Visit totals:** both dashboard views use the exact trimmed/case-folded
  count of the actor's owned non-deleted Visits. The capped JNV Recent Visits
  query uses the same owner predicate (see `context/visits.md`).
- **#390 dashboard routing:** `resolveDashboardView` defaults users with resolved
  `hasCoEOrNodal` context to Physical Centres and others to JNV NVS Schools after
  the existing seated/PMU/Holistic hard routes and an explicit valid `?view=`.
  School/Centre returns and JNV pagination name their dashboard view explicitly.
- **#391 card actions:** dashboard School and Centre cards receive no Start Visit
  action. Their primary links and the existing gated Visit entry points on the
  School/Centre pages remain unchanged.
- **#392 filter history:** deliberate Performance choices push reversible entries;
  automatic Grade reconciliation replaces; Back/Forward restores the complete
  URL-backed selection. Rapid choices compose, and stale grade/overview results
  cannot publish over the current state.
- **#393 report and tab history:** reports push one entry, outer tabs follow
  historical `tab`, and in-page report return consumes browser history only when
  its in-memory trail proves the matching overview predecessor. Unknown provenance
  safely replaces away only `session`; obsolete report data and names are inert.

The final follow-up pass also resolves the two low-severity review findings. A
report-to-overview transition recovers a deeply scrolled viewport when the shorter
overview would otherwise sit entirely above it, while preserving scroll when the
overview still overlaps the viewport. Browser coverage now directly proves the
report → Grade push → Enrollment replace → Back journey remounts Performance at
the historical report and Grade.

This is implemented, PR-ready branch behavior, not merged production behavior.
Centre Switcher remains separate in #388. The change adds no schema, API,
permission, or persistent history store. The Ralph PRD/slice artifacts and write
boundaries remain under `.ralph/workspaces/383/`; configured council rounds were
zero, and no ADR conflict was identified.

## Issue #388 Centre-page switcher

**Implemented so far (#397 tracer, on `feat/issue-388-centre-page-switcher`):**
`getCentreSwitcherEntries(access)` in `src/lib/dashboard-groupings.ts` is the
lightweight list read: `resolveCentreAccess` scope (`all` → no clause, `ids` →
`c.id = ANY($1)`, `schools` → `sch.code = ANY($1)`, empty → no query), filtered
`c.is_active AND c.school_id IS NOT NULL`, no counts. `RosterPage` loads it only
for `scope.kind === "centre"`, after every existing gate, in parallel with the
roster; any failure in School-code expansion, access resolution, or the query
becomes "no switcher" with one fixed `console.error("Centre switcher list
unavailable")`. The client-safe `src/lib/centre-switcher.ts` is the one place for
option logic (current Centre first and merged, `<Program or No Program> · School
(code)` context, name → School → Program → numeric id order, separate `search`
fields, reserved `disambiguator`). `PageHeader` takes an optional `titleBlock`
(default stays the plain `h1`); `src/components/CentreSwitcher.tsx` renders an
`h1` holding only the trigger button and a sibling `listbox` popup, and its single
`select` handler pushes `/centre/<id>` (no-op for the inert Current option).
Tests: `src/app/centre/[id]/page.test.tsx` keeps the real header and query export;
`e2e/tests/centre-switcher.spec.ts` uses `seedCentreSwitcherFixture` /
`removeCentreSwitcherFixture` (`e2e/helpers/db.ts`) and `signInAs`
(`e2e/fixtures/auth.ts`) — the shared fixture contract for #398–#400.

**Still planned (#398–#400):** search, keyboard/combobox, focus, mobile layout,
effective outer-tab carry, pending guard, Back/Forward journeys, and
type/category → Centre ID disambiguation. The grilled plan follows.


Issue #388 will add a searchable switcher to the Centre page title when the
viewer has at least two browsable accessible Centres. It reuses the Physical
Centres access semantics: active Centre seats confine the list to those Centres;
a seatless scoped user falls back to accessible Schools; admins may see all;
PMU roles see none. Only active School-linked Centres are switch targets, because
School-less Centre pages do not exist. The destination page remains the final
authorization gate.

The page server-loads one lightweight authorized list without student counts;
the client searches Centre, Program, School name, and School code. Results show
Program and School context, with type/category and finally Centre ID used only to
disambiguate otherwise identical labels. The current Centre is first and inert.
A single browsable Centre keeps the existing plain title. A list-read failure
also falls back to the plain title without failing the current Centre page.

Choosing a Centre pushes history and carries only the outer tab that is actually
visible at the source; a stale or hidden raw `tab` cannot reappear on a later
switch. It drops every Centre-specific query value and hash. Back therefore
restores the previous Centre's untouched URL, including any earlier Performance
report or filters. Destination-owned defaults may reconcile by `replace` without
adding a history entry. A Program-less target keeps the tab and uses the existing
no-Program state; a tab genuinely unavailable at the destination falls back to
Enrollment.

The reviewed implementation contract keeps the popup outside the heading subtree,
uses dismissal-specific focus behavior, guards navigation synchronously before
App Router's void-returning `push`, and adapts the Centre-page tests to retain the
real header and switcher query. Browser fixtures prove inactive, School-less,
unseated, and out-of-scope Centres are excluded rather than merely omitting them
from mocked rows. No School-page switcher, dashboard redesign, new API, permission,
persistence, schema, or School-less Centre page is part of #388.

The implementation will be a separate stack on PR #394, then retarget to `main`
after #394 merges. These are reversible navigation decisions, so no ADR is needed.

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
