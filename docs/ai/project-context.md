# Project Context: `af_lms` (Avanti Fellows LMS / JNV Ops UI)

Last updated: 2026-03-01
Audience: engineers + AI coding agents onboarding to this repo

---

## 0) What this project is (plain-English)

This repository contains an **internal Next.js web app** used by **Avanti Fellows** teams to operate on **JNV (Jawahar Navodaya Vidyalaya)** school data:

- Browse JNV schools a user has access to
- View student rosters for a school (read-heavy)
- Update student fields and enrollment-related metadata (write operations)
- Program Manager (PM) workflow for **school visits** (per-action tracking with GPS; see §3.5)
- Curriculum tracking **POC** (client-side only; stored in `localStorage`)
- Quiz analytics (BigQuery-backed charts + student results)
- Admin UI for access control (`user_permission`) + some metadata management

This is not a public-facing product; it is an ops/admin tool.

---

## 1) Tech stack (what to expect)

- **Runtime**: Node.js `22` (`.nvmrc`)
- **Web**: Next.js `16.0.7` (App Router), React `19`, TypeScript (strict)
- **Auth**: NextAuth v4
  - Google OAuth provider
  - Credentials provider (“passcode” login) for school-only access
- **Styling**: Tailwind CSS v4 (via `@tailwindcss/postcss` and `@import "tailwindcss"`)
- **DB (reads)**: PostgreSQL via `pg` pool (`src/lib/db.ts`)
- **Writes**: DB Service HTTP API (external; env-configured)
- **Analytics**: BigQuery via `@google-cloud/bigquery`
- **Charts**: Recharts
- **Lint**: ESLint v9 (`eslint.config.mjs`)
- **Unit Tests**: Vitest v4 + V8 coverage; config in `vitest.config.ts`
- **E2E Tests**: Playwright (Chromium only); config in `playwright.config.ts`
- **Coverage**: V8 coverage for both unit (Vitest) and E2E (monocart-reporter); both report on PRs via GitHub Actions

---

## 2) User roles, permissions, and “who can do what”

### 2.1 Auth modes

1) **Google OAuth** (typical for Avanti staff)  
2) **Passcode login** (for school users without Google access)

Passcode login details:
- The login page (`src/app/page.tsx`) calls `signIn("passcode")`
- NextAuth `CredentialsProvider` maps an **8-digit passcode** to a school code
- Passcodes are **hardcoded in the repo** (`src/lib/permissions.ts` → `SCHOOL_PASSCODES`)
- The session is augmented with:
  - `session.isPasscodeUser`
  - `session.schoolCode`
  - Types are declared in `src/types/next-auth.d.ts`

### 2.2 `user_permission` (Google users)

Google-authenticated users must have a row in `user_permission`:

- `level` (access scope):
  - `4`: Admin (full access + admin UI)
  - `3`: All schools
  - `2`: Regions (`regions[]`)
  - `1`: Schools (`school_codes[]`)
- `role` (feature set):
  - `teacher` | `program_manager` | `program_admin` | `admin`
- `program_ids` (feature gating + filtering):
  - Non-admins are expected to have **at least one** `program_id`.
  - Constants live in `src/lib/permissions.ts`:
    - `1` = CoE, `2` = Nodal, `64` = NVS
- `read_only`:
  - When `true`, student edits are disabled for Google users (`canEditStudents()`).

**Important product behavior:**
- The app enforces “program assignment required” for Google users in key pages (e.g. `/dashboard`, `/school/[udise]`).
- “NVS-only” users (program_ids = `[64]` without CoE/Nodal) are intentionally restricted from PM-type features (visits/curriculum/mentorship) and may be filtered to only NVS students.

---

## 3) Primary user flows (how the UI works today)

### 3.1 Login (`/`)
File: `src/app/page.tsx`

- Google sign-in → redirects to `/dashboard`
- Passcode sign-in → redirects to `/school/{schoolCode}` (school code is first 5 digits)

### 3.2 Dashboard (`/dashboard`)
File: `src/app/dashboard/page.tsx`

Server component behavior:
- Requires session; unauthenticated users go to `/`
- Passcode users are redirected to `/school/{session.schoolCode}`
- Loads `user_permission` for the email; if missing, shows “no access”
- Enforces “program assignment required” (non-admins must have `program_ids`)

Dashboard features:
- Paginated list of JNV schools (default `20` per page)
- Search schools by name/code/district
- Shows **NVS student count** (program_id = `64`) per school
- “Student search” across accessible schools (calls `GET /api/students/search`)
- PM-only extras:
  - Link to visits list (`/visits`)
  - “Start Visit” action for a school (goes to `/school/{code}/visit/new`)

### 3.3 School page (`/school/[udise]`)
File: `src/app/school/[udise]/page.tsx`

Core behavior:
- URL param accepts either `school.udise_code` or `school.code`
- Access checks:
  - Passcode users: only their own school
  - Google users: `canAccessSchool()` based on `user_permission.level` and region/school codes
- Loads students via joins on `group_user` + `group(type=’school’)` + `user` + `student`
- Computes grade via `enrollment_record` (current grade) + `grade`
- Computes program via a LATERAL join through batch/program membership

Enrollment behaviors:
- Shows active and dropout students
- Grade filter and basic roster info
- Edit student modal writes via the app’s API → DB Service
- Dropout action writes via the app’s API → DB Service

**Business rule enforced by UI (`src/components/StudentTable.tsx`):**
- Edit/Dropout buttons only appear for:
  - Non-dropouts AND
  - Students in **NVS program** (`program_id = 64`) AND
  - `canEdit` is true

Tabs:
- Tabs exist for Enrollment/Curriculum/Performance/Mentorship/Visits.
- **Currently, non-Enrollment tabs are only shown to level-4 admins** (`isAdmin()`).
- Visits tab: "Start Visit" / "Start New Visit" buttons are gated by `canEdit` — hidden for read-only/view-only users (e.g. `program_admin`).

### 3.4 Admin UI (`/admin/*`)

Admin entry: `src/app/admin/page.tsx`

Admin sections:
- Users: `src/app/admin/users/page.tsx` (CRUD `user_permission`; supports `full_name` field)
- Batches: `src/app/admin/batches/page.tsx` (edit batch `metadata` via DB Service)
- Schools: `src/app/admin/schools/page.tsx` (edit `school.program_ids`)

### 3.5 PM Visits (`/visits/*`) — Per-Action Tracking

**Model:** Each school visit has multiple **action points** — discrete tasks the PM performs (e.g. classroom observation, principal meeting). Each action is its own DB row with its own lifecycle, GPS, and timestamps.

#### Visit lifecycle
- Visits have exactly **2 states**: `in_progress` → `completed` (no separate "ended" concept)
- Visits start with **zero actions**; PM adds action points on-demand
- **Completion requires**: ≥1 completed `classroom_observation` whose `data` passes strict rubric validation + no actions left `in_progress` + valid GPS

#### Classroom observation rubric contract (v1)
- Top-level payload keys: `rubric_version`, `params`, `observer_summary_strengths`, `observer_summary_improvements`, `teacher_id`, `teacher_name`, `grade`
- Legacy classroom keys (`class_details`, `observations`, `support_needed`) are not part of active payloads and are sanitized from edit/save paths
- **Teacher/grade selection** (added 2026-02-28):
  - PM must select a **teacher** (from dropdown) and **grade** (10/11/12) before the rubric form renders
  - Teachers are fetched from `GET /api/pm/teachers?school_code=...` (queries `user_permission` for `role='teacher'` with matching school/region/level access)
  - Selected teacher's `id` and display name are stored as `teacher_id` / `teacher_name`; selected grade stored as `grade`
  - `VALID_GRADES` exported from `src/lib/classroom-observation-rubric.ts`: `["10", "11", "12"]`
- **Action card stats**: `ActionPointList` shows per-observation summary on cards — teacher name, grade, score (current/45), and progress (answered/total params with %)
- Validation behavior:
  - PATCH while action is `in_progress`: lenient rubric validation (partial allowed)
  - PATCH while action is `completed`: strict rubric validation (requires valid `grade`)
  - END classroom observation action: strict rubric validation (requires valid `grade`)
  - COMPLETE visit: at least one completed classroom observation with strict-valid rubric payload
- Unsupported rubric version behavior:
  - UI detects unknown explicit `rubric_version` and renders classroom observation as read-only (save/end blocked)
  - API rejects unsupported `rubric_version` with `422` and details for PATCH/END/COMPLETE checks
  - Missing `rubric_version` on legacy/empty rows bootstraps to current supported version in client state

#### Action lifecycle
- Actions follow `pending → in_progress → completed`
- **Start** captures GPS + timestamp; **End** captures GPS + timestamp
- Starting an action auto-redirects the PM to the action detail page
- Multiple actions can be `in_progress` simultaneously
- **Pending-only deletion** (soft delete: `deleted_at` set, row retained)
- 8 action types defined in code: Principal Meeting, Leadership Meeting, Classroom Observation, Group/Individual Student Discussion, Individual/Team Staff Meeting, Teacher Feedback
- **Currently only `classroom_observation` is enabled** in the picker UI; other types are visible but disabled
- Action types enforced in app code only (`ACTION_TYPES` in `src/lib/visit-actions.ts`), not in DB

#### Implemented pages
- List: `src/app/visits/page.tsx` (2-state list, admin/program_admin filters)
- Visit detail: `src/app/visits/[id]/page.tsx` (action card list, complete button, read-only on completed)
- Action detail: `src/app/visits/[id]/actions/[actionId]/page.tsx` (dynamic form by action type, save/end)
- Start new visit: `src/app/school/[udise]/visit/new/page.tsx` (server) + `src/components/visits/NewVisitForm.tsx` (client, GPS)
- Legacy route `/visits/[id]/principal` redirects to `/visits/[id]`

#### Key components
- `src/components/visits/ActionPointList.tsx` — action card list with add/start/open/delete interactions; shows classroom observation stats (teacher, grade, score, progress)
- `src/components/visits/ActionTypePickerModal.tsx` — picker modal for creating new actions (only `classroom_observation` enabled)
- `src/components/visits/ClassroomObservationForm.tsx` — rubric form with teacher/grade selection, parameter scoring, and summary fields
- `src/components/visits/ActionDetailForm.tsx` — per-action form shell (dispatches renderer by action type)
- `src/components/visits/CompleteVisitButton.tsx` — GPS capture + completion rules enforcement
- `src/components/Toast.tsx` — reusable error/warning toast notification (auto-dismiss, used by visit components)

#### Shared helpers
- `src/lib/visit-actions.ts` — `ACTION_TYPES` map, `ActionType` union, status constants, `statusBadgeClass()` helper
- `src/lib/visits-policy.ts` — shared auth/scope/locking helpers used across all visit routes
- `src/lib/classroom-observation-rubric.ts` — rubric config, score computation, lenient/strict validation, `VALID_GRADES`, `ClassroomObservationData` type
- `src/lib/geo-validation.ts` — GPS validation (accept ≤100m, warn 100–500m, reject >500m)
- `src/lib/geolocation.ts` — client `watchPosition` helper (60s timeout, cancel, secure-origin check)
- `src/lib/theme.ts` — Ledger UI theme token object for dynamic inline styles (17 color/style properties)

#### GPS + timestamps
- All `*_at` timestamps stored as UTC (`TIMESTAMP` without TZ)
- `visit_date` derived server-side via `(NOW() AT TIME ZONE 'Asia/Kolkata')::date`; UI displays in `Asia/Kolkata`
- GPS captured at action start, action end, and visit completion
- **Privacy**: raw coordinates never returned in API responses or logged

#### Role semantics
- **PM owner**: read/write own visits and actions
- **Admin** (`role="admin"`): scoped read/write (same GPS + validation rules apply)
- **Program admin**: scoped read-only (can list/view but cannot add/start/end/complete)
- **Passcode users**: blocked on all visit routes; UI redirects to school page

#### DB schema
- `lms_pm_school_visits`: visit-level data with `start_lat/lng/accuracy`, `completed_at`, `end_lat/lng/accuracy`, `status` (`in_progress`/`completed`)
- `lms_pm_school_visit_actions`: per-action rows with `action_type`, `status`, `started_at`, `start_lat/lng/accuracy`, `ended_at`, `end_lat/lng/accuracy`, `data` (JSONB form payload), `deleted_at` (soft delete)
- **Dropped columns** (hard cutover): `lms_pm_school_visits.data` (JSONB blob) and `lms_pm_school_visits.ended_at`
- DB migration lives in db-service repo: `priv/repo/migrations/20260217120000_add_visit_actions_and_update_school_visits.exs`

Planning docs: `docs/ai/school-visit-action-points/`

#### Classroom observation rollout status (2026-03-01)
- Implementation phases 1-5 are complete for the rubric rollout documented in `docs/ai/classroom-observation/2026-02-21-classroom-observation-implementation-and-testing-plan.md`
- Manual frontend QA runbook is complete with `10/10` test cases passing (`docs/ai/classroom-observation/phase-5-manual-frontend-test-cases.md`)
- Agent-browser exploratory testing was also run for role/session/geolocation flows (`docs/ai/agent-browser-testing.md`)
- In-repo consumer impact audit is complete for classroom observation payload usage; BigQuery quiz analytics and curriculum flows do not consume `lms_pm_school_visit_actions.data`
- Teacher/grade selection added (2026-02-28): PM selects teacher + grade before rubric; action cards show observation stats
- Ledger UI visual redesign applied to all visit pages and components (2026-02-26)

### 3.6 Curriculum tracking (POC)

Files:
- UI: `src/components/curriculum/*`
- API: `src/app/api/curriculum/chapters/route.ts`
- Helpers: `src/lib/curriculum-helpers.ts`

Key facts:
- Chapters/topics come from Postgres (`chapter`, `topic`, `subject`, `grade`)
- Progress is stored **only in browser `localStorage`**, keyed per school code:
  - `curriculum_sessions_{schoolCode}`
  - `curriculum_progress_{schoolCode}`

### 3.7 Quiz analytics (BigQuery)

Files:
- BigQuery client/queries: `src/lib/bigquery.ts`
- API: `src/app/api/quiz-analytics/[udise]/route.ts`
- UI: `src/components/QuizAnalyticsSection.tsx`

Behavior:
- School page fetches recent sessions for the school UDISE
- Selecting a session calls the API which composes:
  - overall summary statistics
  - subject-wise averages
  - top student results

Current hardcode:
- BigQuery queries filter `academic_year = '2025-2026'` in `src/lib/bigquery.ts`.

---

## 4) Data & infrastructure architecture (reads vs writes)

### 4.1 Reads: Postgres direct queries

All server-side reads go through `src/lib/db.ts`:

```ts
// src/lib/db.ts
export async function query<T>(text: string, params?: unknown[]): Promise<T[]> { ... }
```

Notes:
- Uses `pg.Pool`
- SSL is enabled with `rejectUnauthorized: false` (useful for many hosted DBs, but a security trade-off)

### 4.2 Writes: DB Service HTTP API

Mutation routes call `DB_SERVICE_URL` with `Authorization: Bearer ${DB_SERVICE_TOKEN}`.

Routes that use DB Service (non-exhaustive):
- `src/app/api/student/route.ts` (POST update-by-id)
- `src/app/api/student/[id]/route.ts` (PATCH student fields + grade/batch group updates)
- `src/app/api/student/dropout/route.ts` (PATCH dropout)
- `src/app/api/batches/route.ts` / `src/app/api/batches/[id]/route.ts` (admin batch metadata)

**Exception — direct Postgres writes:**
- PM visit mutations (create visit, action CRUD, action start/end, visit complete) write directly to Postgres via `src/lib/db.ts`, bypassing DB Service.

Operational implication:
- Local development needs both Postgres read access AND DB Service token for student/batch writes.

---

## 5) Repo structure (where to look)

Top-level (high-signal):
- `README.md`: onboarding + local setup
- `docs/`: design + schema references (`docs/DB_SCHEMA.md`, etc.)
- `scripts/`: helper scripts (DB setup, deploy helpers)
- `amplify.yml` + `.github/workflows/deploy-amplify.yml`: AWS Amplify CI/CD path
- `.github/workflows/e2e-coverage-comment.yml`: posts E2E coverage table on PRs (reads committed `coverage/coverage-summary.json`)
- `.github/workflows/unit-coverage-comment.yml`: posts unit test coverage table on PRs (reads committed `unit-coverage/coverage-summary.json`)
- `TODO_ENVIRONMENTS.md`: Vercel staging/production notes
- `AMPLIFY_DEPLOYMENT.md`: Amplify deployment approach

App code:
- `src/app/`: App Router pages + route handlers (`src/app/api/**`)
- `src/components/`: UI components (tables, modals, charts, Toast)
- `src/lib/`: auth/permissions/db/bigquery helpers, classroom-observation-rubric, theme tokens
- `src/types/`: shared TS types (NextAuth session typing, quiz, curriculum)
- `docs/UI-Style-Guide.md`: Ledger UI design system reference

Unit tests:
- `vitest.config.ts`: Vitest config (V8 coverage, `@/*` path alias)
- `src/lib/*.test.ts`: colocated unit test files (e.g. `geo-validation.test.ts`, `permissions.test.ts`, `curriculum-helpers.test.ts`)

Unit coverage output (generated by `npm run test:unit:coverage`):
- `unit-coverage/coverage-summary.json`: committed to repo; consumed by GH Actions PR comment workflow
- `unit-coverage/index.html`: local V8 coverage viewer (gitignored)

E2E tests:
- `e2e/`: Playwright test suite
  - `e2e/fixtures/auth.ts`: session injection via NextAuth JWT; exports `adminPage`/`pmPage`/`teacherPage`/`passcodePage` fixtures; all page fixtures collect V8 coverage (not just the default page)
  - `e2e/helpers/test-users.ts`: deterministic test personas upserted into `user_permission`
  - `e2e/helpers/db.ts`: `resetDatabase()` loads dump into `af_lms_test`; runs versioned SQL migrations from `e2e/fixtures/migrations/*.sql`; `dropDatabase()` cleans up; `seedTestVisit()` / `seedVisitAction()` for visit test data
  - `e2e/fixtures/migrations/*.sql`: versioned schema migrations applied after dump restore (tracked via `e2e_schema_migrations` table); used to bridge schema gaps between dump and current codebase
  - `e2e/tests/*.spec.ts`: smoke, dashboard, school, permissions, visits specs
  - `e2e/fixtures/db-dump.sql`: local dev DB dump (gitignored; developer creates via `pg_dump`)

Coverage output (generated by `npm run test:e2e`):
- `coverage/coverage-summary.json`: committed to repo; consumed by GH Actions PR comment workflow
- `coverage/index.html`: local V8 coverage viewer (gitignored)
- `monocart-report/`: monocart HTML test report (gitignored)
- `.v8-coverage/`: raw V8 coverage data (gitignored)
- `assets/`: monocart generated JS assets (gitignored)

Planning notes:
- `.planning/`: internal planning docs (not part of runtime app)

---

## 6) API surface (Next.js Route Handlers)

Auth:
- `src/app/api/auth/[...nextauth]/route.ts`

Students:
- `src/app/api/students/search/route.ts` (GET)
- `src/app/api/student/route.ts` (POST update student via DB Service)
- `src/app/api/student/[id]/route.ts` (PATCH update fields + grade/batch via DB Service)
- `src/app/api/student/dropout/route.ts` (POST → PATCH to DB Service dropout)

PM visits:
- `src/app/api/pm/teachers/route.ts` (GET teachers for a school by code — queries `user_permission` for `role='teacher'` with matching school/region/level access)
- `src/app/api/pm/visits/route.ts` (GET list, POST create with GPS)
- `src/app/api/pm/visits/[id]/route.ts` (GET visit + actions)
- `src/app/api/pm/visits/[id]/actions/route.ts` (GET list actions, POST create action)
- `src/app/api/pm/visits/[id]/actions/[actionId]/route.ts` (GET single action, PATCH data, DELETE pending-only soft delete)
- `src/app/api/pm/visits/[id]/actions/[actionId]/start/route.ts` (POST start action with GPS)
- `src/app/api/pm/visits/[id]/actions/[actionId]/end/route.ts` (POST end action with GPS)
- `src/app/api/pm/visits/[id]/complete/route.ts` (POST complete visit with GPS + validation rules)

Admin:
- `src/app/api/admin/users/route.ts` (GET/POST)
- `src/app/api/admin/users/[id]/route.ts` (PATCH/DELETE)
- `src/app/api/admin/schools/route.ts` (GET)
- `src/app/api/admin/schools/[code]/route.ts` (PATCH program_ids)
- `src/app/api/batches/route.ts` (GET via DB Service)
- `src/app/api/batches/[id]/route.ts` (PATCH via DB Service)

Curriculum:
- `src/app/api/curriculum/chapters/route.ts` (GET)

Analytics:
- `src/app/api/quiz-analytics/[udise]/route.ts` (POST)

---

## 7) Environment variables & secrets (local + hosted)

Templates:
- `.env.example` (local template)
- `.env.staging.example`, `.env.production.example` (reference values; **do not commit real secrets**)

Required (core app):
- Postgres reads: `DATABASE_HOST`, `DATABASE_PORT`, `DATABASE_USER`, `DATABASE_PASSWORD`, `DATABASE_NAME`
- NextAuth: `NEXTAUTH_URL`, `NEXTAUTH_SECRET`
- Google OAuth: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
- DB Service: `DB_SERVICE_URL`, `DB_SERVICE_TOKEN`

Optional (quiz analytics):
- `GOOGLE_SERVICE_ACCOUNT_JSON` (recommended for hosted envs)
- OR `GOOGLE_APPLICATION_CREDENTIALS` (local path to service account JSON file)

---

## 8) How to run locally

### 8.1 One-time setup

```bash
nvm use
npm install
cp .env.example .env.local
```

Fill in `.env.local` with credentials from your team.

### 8.2 Run dev server

```bash
npm run dev
```

Open `http://localhost:3000`.

### 8.3 Run unit tests

```bash
npm run test               # Run all unit tests
npm run test:unit:watch    # Watch mode (re-runs on file change)
npm run test:unit:coverage # Run with V8 coverage report
```

Key details:
- Test files live alongside source: `src/**/*.test.ts` and `src/**/*.test.tsx`
- No DB or server needed — tests mock DB/fetch/auth and cover lib helpers, API routes, and React components
- 1142 tests across 75 files (as of 2026-03-01)
- V8 coverage is collected; `unit-coverage/coverage-summary.json` is generated
- Commit `unit-coverage/coverage-summary.json` with your changes; a GH Actions workflow posts it as a PR comment

### 8.4 Run E2E tests

```bash
# One-time: create DB dump from your local dev DB
pg_dump --no-owner --no-privileges --clean --if-exists \
  -U postgres -h localhost -f e2e/fixtures/db-dump.sql dbservice_dev

cp .env.test.example .env.test   # defaults work for local postgres

# Run tests (starts dev server on port 3001, won't conflict with npm run dev)
npm run test:e2e
npm run test:e2e:ui   # Playwright UI mode for debugging
```

Key details:
- Tests run against a disposable `af_lms_test` database (created/dropped automatically)
- Auth is injected via NextAuth JWT cookies — no real Google login needed
- Uses `.next-test/` build dir so it coexists with a running dev server
- Single worker, sequential execution (shared test DB)
- V8 coverage is collected automatically; `coverage/coverage-summary.json` is generated
- Commit `coverage/coverage-summary.json` with your changes; a GH Actions workflow posts it as a PR comment

### 8.5 Access gotchas

- If your Google email is not in `user_permission`, `/dashboard` will block you.
- If you do have a row but no `program_ids` (and you're not admin), `/dashboard` will block you.

---

## 9) Deployment (two tracks exist)

### 9.1 Vercel

Notes live in `TODO_ENVIRONMENTS.md`. The repo also has:
- `vercel.json` (framework hint)
- `scripts/deploy.sh` (helper: `npm run deploy:staging` / `npm run deploy:production`)

### 9.2 AWS Amplify (via GitHub Actions)

- Build config: `amplify.yml`
- Workflow: `.github/workflows/deploy-amplify.yml`
  - Handles main deploys + PR previews + manual preview deploys
  - Syncs env vars from GitHub Secrets to Amplify branches

When onboarding, confirm with the team which hosting path is the current source of truth.

---

## 10) Scripts (what they do, and what to be careful about)

- `scripts/setup-permissions.ts`
  - Creates/updates `user_permission` **but appears outdated** vs runtime code:
    - Does not create `program_ids`
    - Uses `created_at` timestamps, while some runtime code expects `inserted_at`
- `scripts/setup-pm-tables.ts`
  - Creates `lms_pm_school_visits` with `created_at`/`updated_at`
  - Runtime code frequently queries `inserted_at` (e.g. dashboard/visits list), so this script can create a schema mismatch
- `scripts/check-metadata.js`
  - DB introspection helper (batch metadata, etc.)
- `scripts/deploy.sh`
  - Vercel deploy helper (staging/production)

If you need to change DB schema, prefer the canonical migrations from the DB Service repo (not included here).

---

## 11) Known issues / tech debt (high-signal)

- Hardcoded school passcodes in `src/lib/permissions.ts` (rotation requires deploy; avoid leaking)
- DB SSL uses `rejectUnauthorized: false` (security trade-off)
- No request timeouts when calling DB Service (a slow DB Service can hang requests)
- Potential schema drift between scripts and production DB (timestamps + missing columns)
- `src/proxy.ts` is treated as a **Next.js middleware** (build output shows `Proxy (Middleware)`) and redirects unauthenticated users away from protected routes; behavior overlaps with per-page `getServerSession()` guards.
- `npm run lint` currently fails due to:
  - `scripts/check-metadata.js` using `require()` (rule `@typescript-eslint/no-require-imports`)
  - a hooks dependency warning in `src/components/EditStudentModal.tsx`
- `next build` warns about **multiple lockfiles** in a parent directory and may infer the workspace root incorrectly; consider setting `turbopack.root` or removing the extra lockfile if applicable.
- E2E DB dump (`e2e/fixtures/db-dump.sql`) is pre-cutover; versioned SQL migrations in `e2e/fixtures/migrations/` bridge the gap. Once a post-cutover dump is regenerated, the compat migrations can be removed.

---

## 12) Quick “where do I change X?” map

- Login UI: `src/app/page.tsx`
- NextAuth config: `src/lib/auth.ts`, `src/app/api/auth/[...nextauth]/route.ts`
- Permissions/program gating: `src/lib/permissions.ts`
- Auth middleware (route gating): `src/proxy.ts`
- Postgres querying: `src/lib/db.ts`
- Dashboard data: `src/app/dashboard/page.tsx`
- School roster + tabs: `src/app/school/[udise]/page.tsx`
- Student edit UI: `src/components/EditStudentModal.tsx`
- Student table + dropout UI: `src/components/StudentTable.tsx`
- PM visits API: `src/app/api/pm/visits/**`
- PM teachers API: `src/app/api/pm/teachers/route.ts`
- PM visits UI: `src/app/visits/**`, `src/components/visits/**`
- Classroom observation rubric: `src/lib/classroom-observation-rubric.ts`, `src/components/visits/ClassroomObservationForm.tsx`
- Visit shared helpers: `src/lib/visit-actions.ts` (action types), `src/lib/visits-policy.ts` (auth/scope/locking)
- Visit geo: `src/lib/geo-validation.ts` (server validation), `src/lib/geolocation.ts` (client watchPosition), `src/components/visits/CompleteVisitButton.tsx`, `src/components/visits/NewVisitForm.tsx`
- Toast notifications: `src/components/Toast.tsx`
- Ledger UI theme: `src/lib/theme.ts` (inline style tokens), `src/app/globals.css` (CSS variables), `docs/UI-Style-Guide.md`
- Admin UI: `src/app/admin/**`
- Batch metadata admin: `src/app/admin/batches/**` + `src/app/api/batches/**`
- Quiz analytics: `src/lib/bigquery.ts`, `src/app/api/quiz-analytics/**`, `src/components/QuizAnalyticsSection.tsx`
- Curriculum POC: `src/components/curriculum/**`, `src/app/api/curriculum/**`
- Unit tests: `src/lib/*.test.ts` (colocated), config in `vitest.config.ts`
- E2E tests: `e2e/tests/**`, auth fixtures in `e2e/fixtures/auth.ts`, test users in `e2e/helpers/test-users.ts`
- Playwright config + E2E coverage: `playwright.config.ts` (monocart-reporter with V8 coverage config)
- Unit coverage PR comments: `.github/workflows/unit-coverage-comment.yml`
- E2E coverage PR comments: `.github/workflows/e2e-coverage-comment.yml`
