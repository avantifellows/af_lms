# Project Context: `af_lms` (Avanti Fellows LMS / JNV Ops UI)

Last updated: 2026-02-13
Audience: engineers + AI coding agents onboarding to this repo

---

## 0) What this project is (plain-English)

This repository contains an **internal Next.js web app** used by **Avanti Fellows** teams to operate on **JNV (Jawahar Navodaya Vidyalaya)** school data:

- Browse JNV schools a user has access to
- View student rosters for a school (read-heavy)
- Update student fields and enrollment-related metadata (write operations)
- Program Manager (PM) workflow for **school visits** (geo-tracking implemented; visit section forms WIP)
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
- **E2E Tests**: Playwright (Chromium only); config in `playwright.config.ts`

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
  - `teacher` | `program_manager` | `admin`
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
- Loads students via joins on `group_user` + `group(type='school')` + `user` + `student`
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

### 3.4 Admin UI (`/admin/*`)

Admin entry: `src/app/admin/page.tsx`

Admin sections:
- Users: `src/app/admin/users/page.tsx` (CRUD `user_permission`)
- Batches: `src/app/admin/batches/page.tsx` (edit batch `metadata` via DB Service)
- Schools: `src/app/admin/schools/page.tsx` (edit `school.program_ids`)

### 3.5 PM Visits (`/visits/*`)

Implemented pages:
- List: `src/app/visits/page.tsx`
- Visit overview: `src/app/visits/[id]/page.tsx`
- Principal meeting form: `src/app/visits/[id]/principal/page.tsx`
- Start new visit: `src/app/school/[udise]/visit/new/page.tsx` (server component) + `src/components/visits/NewVisitForm.tsx` (client component with GPS)

Not implemented (linked from overview, but pages do not exist yet):
- `/visits/[id]/leadership`, `/observations`, `/students`, `/staff`, `/feedback`

Visit data is stored in Postgres table `lms_pm_school_visits` as JSONB with section keys like:
`principalMeeting`, `leadershipMeetings`, `classroomObservations`, `studentDiscussions`, `staffMeetings`, `teacherFeedback`, `issueLog`.

#### Geo-tracking (Phase 1 — code complete)

Visit-level GPS tracking records PM location at visit start and end:
- **Start visit**: GPS captured on create; `inserted_at` serves as start timestamp (no separate `started_at`)
- **End visit**: GPS captured via `POST /api/pm/visits/[id]/end`; `ended_at` set server-side (`NOW()`)
- **Three distinct states**: Started (visit exists) → Ended (`ended_at` set) → Completed (`status='completed'`, disabled for Phase 1)
- **GPS validation**: accept ≤100m, warn 100–500m, reject >500m (`src/lib/geo-validation.ts`)
- **Client geolocation**: `src/lib/geolocation.ts` — `watchPosition` with 60s timeout, cancel support, secure-origin check
- **End visit UI**: `src/components/visits/EndVisitButton.tsx` — client component with GPS capture + API call
- **Privacy**: only visit owner PM + admins (level 4) can view exact lat/lng; coordinates not logged server-side
- **Timestamps**: all stored as UTC (`TIMESTAMP` without TZ); `visit_date` derived server-side via `(NOW() AT TIME ZONE 'Asia/Kolkata')::date`; UI displays in `Asia/Kolkata`
- **Permissions**: PM can end own visit; admin can end any visit; idempotent (re-ending returns success, no overwrite)
- **"Complete visit" is disabled** for Phase 1 (UI removed, API `PUT` handler still exists but unused)

DB columns added to `lms_pm_school_visits` (migration in db-service repo):
`start_lat`, `start_lng`, `start_accuracy`, `ended_at`, `end_lat`, `end_lng`, `end_accuracy` + index on `ended_at`.

Planning docs: `.planning/school-visit-geo-tracking/`

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
- PM visit mutations (`POST` create, `PATCH` section update, `PUT` complete, `POST` end) write directly to Postgres via `src/lib/db.ts`, bypassing DB Service.

Operational implication:
- Local development needs both Postgres read access AND DB Service token for student/batch writes.

---

## 5) Repo structure (where to look)

Top-level (high-signal):
- `README.md`: onboarding + local setup
- `docs/`: design + schema references (`docs/DB_SCHEMA.md`, etc.)
- `scripts/`: helper scripts (DB setup, deploy helpers)
- `amplify.yml` + `.github/workflows/deploy-amplify.yml`: AWS Amplify CI/CD path
- `TODO_ENVIRONMENTS.md`: Vercel staging/production notes
- `AMPLIFY_DEPLOYMENT.md`: Amplify deployment approach

App code:
- `src/app/`: App Router pages + route handlers (`src/app/api/**`)
- `src/components/`: UI components (tables, modals, charts)
- `src/lib/`: auth/permissions/db/bigquery helpers
- `src/types/`: shared TS types (NextAuth session typing, quiz, curriculum)

E2E tests:
- `e2e/`: Playwright test suite
  - `e2e/fixtures/auth.ts`: session injection via NextAuth JWT; exports `adminPage`/`pmPage`/`teacherPage`/`passcodePage` fixtures
  - `e2e/helpers/test-users.ts`: deterministic test personas upserted into `user_permission`
  - `e2e/helpers/db.ts`: `resetDatabase()` loads dump into `af_lms_test`; `dropDatabase()` cleans up
  - `e2e/tests/*.spec.ts`: smoke, dashboard, school, permissions specs
  - `e2e/fixtures/db-dump.sql`: local dev DB dump (gitignored; developer creates via `pg_dump`)

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
- `src/app/api/pm/visits/route.ts` (GET list, POST create with GPS)
- `src/app/api/pm/visits/[id]/route.ts` (GET with geo fields, PATCH section update, PUT complete)
- `src/app/api/pm/visits/[id]/end/route.ts` (POST end visit with GPS)

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

### 8.3 Run E2E tests

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

### 8.4 Access gotchas

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
- PM visit **section pages** are mostly unimplemented (only principal meeting exists; leadership/observations/students/staff/feedback pages missing)
- Visit completion (`PUT` with JSON `{ action: "complete" }`) exists in API but is **disabled in UI** for Phase 1 (geo-tracking uses separate Start/End flow)
- Potential schema drift between scripts and production DB (timestamps + missing columns)
- `src/proxy.ts` is treated as a **Next.js middleware** (build output shows `Proxy (Middleware)`) and redirects unauthenticated users away from protected routes; behavior overlaps with per-page `getServerSession()` guards.
- E2E tests exist (Playwright) but no unit/integration tests yet
- `npm run lint` currently fails due to:
  - `scripts/check-metadata.js` using `require()` (rule `@typescript-eslint/no-require-imports`)
  - a hooks dependency warning in `src/components/EditStudentModal.tsx`
- `next build` warns about **multiple lockfiles** in a parent directory and may infer the workspace root incorrectly; consider setting `turbopack.root` or removing the extra lockfile if applicable.

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
- PM visits UI: `src/app/visits/**`
- Visit geo-tracking: `src/lib/geo-validation.ts` (server), `src/lib/geolocation.ts` (client), `src/components/visits/EndVisitButton.tsx`, `src/components/visits/NewVisitForm.tsx`
- Admin UI: `src/app/admin/**`
- Batch metadata admin: `src/app/admin/batches/**` + `src/app/api/batches/**`
- Quiz analytics: `src/lib/bigquery.ts`, `src/app/api/quiz-analytics/**`, `src/components/QuizAnalyticsSection.tsx`
- Curriculum POC: `src/components/curriculum/**`, `src/app/api/curriculum/**`
- E2E tests: `e2e/tests/**`, auth fixtures in `e2e/fixtures/auth.ts`, test users in `e2e/helpers/test-users.ts`
- Playwright config: `playwright.config.ts`
