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

**Implemented in PR #402 (stacked on PR #394):**
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

**Search, keyboard, and mobile (#398):** the popup opens with a `combobox` input
("Search Centres", `aria-controls` → the "Centres" listbox) that takes focus however
the popup opens (click, Enter, Space, ArrowDown on the trigger) and starts empty.
`matchesCentreSearch` in `src/lib/centre-switcher.ts` filters on the separate
`search` fields only (trimmed, case-insensitive substring; empty matches all), so
the current Centre stays first when it matches. No match shows "No accessible
Centres match your search" plus "Clear search" (empties and refocuses the input).
ArrowUp/Down/Home/End move `aria-activedescendant` over non-current options only
and scroll the highlighted option into view; the active option is derived from the
filtered list, so filtering it away clears it at once. Enter calls the same `select`
handler as a click (nothing without an active option). Escape anywhere in the popup
and a trigger click close and focus the trigger; popup-level focus-out closes after
Tab/Shift+Tab or a click on another control without moving focus, including from the
empty-state action, while a click on non-focusable content returns focus to the
trigger. Mouse-downs inside the popup and on the trigger are prevented so focus
stays in the input.
Below `sm` the popup is positioned against `PageHeader`'s `<header>` (now
`relative`) and spans its width; from `sm` up it anchors under the title. The
list caps at `60vh`/`max-h-80` and scrolls; the trigger, input, and options are ≥
44px, and long unbroken option names wrap.
Tests: the page seam's `popup › search/keyboard/dismissal` blocks and the 390px
Playwright journey (search by School code → select → Delta loads).

**Tab carry, history, and pending (#399):** `src/lib/roster-tabs.ts` (client-safe)
owns `ROSTER_TAB_IDS` (the eight outer tab ids in display order; `RosterPage`'s
`visibleRosterTabs` is typed by it), `DEFAULT_ROSTER_TAB` (`enrollment`), and
`resolveVisibleTab(rawTab, visibleTabIds, defaultTab)` — raw tab if visible, else
the default if visible, else the first visible tab. `SchoolTabs` and the switcher
both use it, so they agree on which tab a URL shows. `RosterPage` passes the
switcher the source page's visible tab ids and `tabs[0]` as default. `select`
reads `?tab=` from `useSearchParams()` at selection time (tab clicks write it with
`history.replaceState`, never a server prop), resolves it, and pushes
`centreSwitchHref(id, tab)` from `src/lib/centre-switcher.ts`: `/centre/<id>` plus
`?tab=<tab>` only for a non-default roster tab — Grade, stream, report session,
every other parameter, and the hash are dropped, and a hidden/unknown raw tab
resolves to Enrollment, so it is never carried. The push runs inside
`useTransition`; a `navigatingRef` set synchronously before `push` (which returns
`void`) ignores further choices until `isPending` falls back to false. The
`role="status"` sibling of the `h1` shows "Switching Centre…" meanwhile; default
scroll-to-top is kept. The destination re-runs `getCentreWithSchool` and
`canViewCentre` (stale scope → Access Denied), `SchoolTabs` maps a hidden tab to
Enrollment, a Program-less target keeps program-scoped tabs with
`NoCentreProgram`, and Performance adds its own default Grade by `replace` — one
history entry per switch, and Back restores the source's untouched query/report.
Tests: the page seam's `where a switch lands` block (literal pushed URLs, a
same-turn double click inside one `act`) and `e2e/tests/centre-switcher-history.spec.ts`
(an init-script recorder of `pushState`/`replaceState` proves the first write is the
lone push; held RSC request for the pending case; scope revoked via the test pool).

**Disambiguation ladder (#400):** `getCentreSwitcherEntries` also returns
`typeLabel`/`categoryLabel`, resolved from `c.type_code`/`c.category_code` through
`centre_option_sets`/`centre_options` (the admin Centre list's joins; codes stored,
labels shown per ADR 0004; missing → `null`). `buildCentreSwitcherOptions` groups
every option, the current Centre included (it borrows its labels from its own list
row), by exact (name, Program, School name, School code). In a group of two or
more, an entry whose present labels joined with " · " are non-empty and unique in
the group shows them; every other member shows `Centre ID: <id>`; a unique entry
gets no `disambiguator`. So CoE/Nodal Centres at one School (Program differs) show
nothing. `CentreSwitcher` renders it as a second muted line under the Program ·
School context; search, order, keyboard, and `select` are unchanged. Tests: the
page seam's `popup › disambiguation` block (literal visible text plus option-label
join SQL) and the mixed-group cases in `src/lib/centre-switcher.test.ts`.

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
