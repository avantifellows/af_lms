# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Student Enrollment CRUD UI for Avanti Fellows - a Next.js 16 application that allows school administrators to view and manage student enrollments. Features dual authentication (Google OAuth + school passcodes) with permission-based access control.

PM school-visit flows include per-action tracking with GPS, a completed classroom-observation rubric implementation (v1, 19 scored params, max score 45), an AF team interaction checklist (9 binary questions with multiselect teacher dropdown), an individual AF teacher interaction per-teacher checklist (13 binary questions with attendance gating), a principal interaction checklist (7 binary questions, no teacher selection), a group student interaction checklist (4 binary questions with grade selection), an individual student interaction per-student checklist (2 binary questions with grade filter and multi-select checkbox dropdown with batch-add), and a school staff interaction checklist (2 binary questions, no teacher/student/grade selection).

## Development Commands

```bash
npm run dev              # Start development server at localhost:3000
npm run build            # Production build
npm run lint             # Run ESLint
npm run start            # Start production server
npm run test             # Run unit tests (Vitest)
npm run test:unit        # Run unit tests (alias)
npm run test:unit:watch  # Run unit tests in watch mode
npm run test:unit:coverage # Run unit tests + V8 coverage
npm run test:e2e         # Run Playwright e2e tests (port 3001) + V8 coverage
npm run test:e2e:ui      # Playwright UI mode for debugging (no coverage)
```

## Architecture

### Tech Stack
- **Framework**: Next.js 16 (App Router)
- **Auth**: NextAuth.js v4 with Google OAuth + custom passcode provider
- **Database**: PostgreSQL via `pg` pool
- **Styling**: Tailwind CSS v4
- **Unit Tests**: Vitest + V8 coverage
- **E2E Tests**: Playwright (Chromium) + V8 coverage via monocart-reporter

### Directory Structure
```
src/
├── app/                    # Next.js App Router pages
│   ├── api/auth/           # NextAuth API route
│   ├── api/pm/visits/      # Visit + action API routes
│   ├── dashboard/          # School list (admin view)
│   ├── school/[udise]/     # Student list per school
│   └── visits/             # Visit list, detail, action detail pages
├── components/
│   ├── visits/             # Visit components (ActionPointList, CompleteVisitButton, etc.)
│   └── Providers.tsx       # SessionProvider wrapper
└── lib/
    ├── auth.ts             # NextAuth configuration
    ├── db.ts               # PostgreSQL connection pool
    ├── permissions.ts      # Access control (hardcoded)
    ├── visit-actions.ts    # ACTION_TYPES, ActionType, status constants
    ├── visits-policy.ts    # Shared visit auth/scope/locking helpers
    ├── geo-validation.ts   # GPS validation (server)
    ├── geolocation.ts      # Browser geolocation helper (client)
    └── *.test.ts           # Colocated unit tests (Vitest)

e2e/                        # Playwright E2E tests
├── fixtures/
│   ├── auth.ts             # Session injection (per-role page fixtures)
│   └── db-dump.sql         # Local DB dump (gitignored)
├── helpers/
│   ├── db.ts               # DB reset/teardown helpers
│   └── test-users.ts       # Deterministic test user personas
├── tests/                  # Test specs
│   ├── smoke.spec.ts
│   ├── dashboard.spec.ts
│   ├── school.spec.ts
│   ├── permissions.spec.ts
│   └── visits.spec.ts
├── global-setup.ts         # Loads dump + inserts test users
└── global-teardown.ts      # Drops test DB
```

### Authentication Flow
1. **Google OAuth**: Users with `@avantifellows.org` or whitelisted emails get role-based access
2. **Passcode Auth**: 8-digit codes grant single-school access (format: `{schoolCode}XXX`)

### Permission Levels
Defined in `src/lib/permissions.ts`:
- **Level 3**: All schools access
- **Level 2**: Region-based access
- **Level 1**: Specific school codes only
- Admin status is determined by `role = "admin"`, not by level
- Roles: `teacher`, `program_manager`, `program_admin` (read-only), `admin`

### Database Schema (External PostgreSQL)
Core tables:
- `school`: id, code, udise_code, name, district, state, region
- `user`: id, first_name, last_name, phone, email, gender
- `student`: user_id, student_id, category, stream
- `group`: id, type, child_id
- `group_user`: id, group_id, user_id

Visit tables:
- `lms_pm_school_visits`: id, school_code, pm_email, visit_date, status (`in_progress`/`completed`), start GPS fields, end GPS fields, completed_at, inserted_at, updated_at
- `lms_pm_school_visit_actions`: id, visit_id (FK), action_type, status (`pending`/`in_progress`/`completed`), start/end GPS + timestamps, data (JSONB form payload), deleted_at (soft delete), inserted_at, updated_at

### PM Visits: Classroom Observation Rubric (v1)
- Payload contract is rubric-only: `rubric_version`, `params`, `observer_summary_strengths`, `observer_summary_improvements`
- Legacy classroom keys (`class_details`, `observations`, `support_needed`) are sanitized out of active edit/save payloads
- Validation rules:
  - PATCH while action is `in_progress`: lenient rubric validation (partial allowed)
  - PATCH while action is `completed`: strict rubric validation
  - END classroom observation: strict rubric validation
  - COMPLETE visit: requires at least one completed `classroom_observation` with strict-valid rubric payload (plus existing no-`in_progress`-action and GPS requirements)
- Unsupported explicit `rubric_version` is read-only in UI (save/end blocked) and rejected by API with `422`
- Missing `rubric_version` on legacy/empty rows bootstraps to the current supported version in client state
- Implementation/testing docs:
  - `docs/ai/classroom-observation/2026-02-21-classroom-observation-implementation-and-testing-plan.md`
  - `docs/ai/classroom-observation/phase-5-manual-frontend-test-cases.md`
  - `docs/ai/agent-browser-testing.md`

### PM Visits: AF Team Interaction (v1)
- 9-question binary checklist with multiselect teacher dropdown across 4 sections
- Payload: `{ teachers: [{ id, name }], questions: { [key]: { answer: boolean|null, remark?: string } } }`
- Validation: lenient for in_progress (partial OK), strict for completed/end (all 9 answered + ≥1 teacher)
- Config/validation: `src/lib/af-team-interaction.ts`; shared teacher utils: `src/lib/teacher-utils.ts`
- Form component: `src/components/visits/AFTeamInteractionForm.tsx`

### PM Visits: Individual AF Teacher Interaction (v1)
- Per-teacher 13-question binary checklist with attendance gating across 5 sections
- Payload: `{ teachers: [{ id, name, attendance, questions: { [key]: { answer: boolean|null, remark?: string } } }] }`
- Attendance options: `present`, `on_leave`, `absent` — only `present` teachers require question answers
- 5 sections: Operational Health (1 question), Syllabus Track (4), Student Performance (2), Support Needed (3), Monthly Planning (3) — 13 total
- Validation: lenient for in_progress (partial OK), strict for completed/end (all present teachers need all 13 answered + ≥1 teacher)
- END route additionally checks all school teachers are recorded (queries `user_permission` table)
- Config/validation: `src/lib/individual-af-teacher-interaction.ts`
- Form component: `src/components/visits/IndividualAFTeacherInteractionForm.tsx`

### PM Visits: Principal Interaction (v1)
- 7-question binary checklist across 5 sections — no teacher selection (simplest form in the system)
- Payload: `{ questions: { [key]: { answer: boolean|null, remark?: string } } }`
- 5 sections: Operational Health (1 question), Implementation Progress (2), Student Performance on Monthly Tests (1), Support Needed (1), Monthly Planning (2) — 7 total
- Question keys: `oh_program_feedback`, `ip_curriculum_progress`, `ip_key_events`, `sp_student_performance`, `sn_concerns_raised`, `mp_monthly_plan`, `mp_permissions_obtained`
- Validation: lenient for in_progress (partial OK), strict for completed/end (all 7 questions answered with non-null boolean)
- Config/validation: `src/lib/principal-interaction.ts`
- Form component: `src/components/visits/PrincipalInteractionForm.tsx`

### PM Visits: Student Interaction (v1)
- 4-question binary checklist with grade selection (11 or 12) across 1 section — grade-scoped group discussion
- Payload: `{ grade: number, questions: { [key]: { answer: boolean|null, remark?: string } } }`
- 1 section: General Check (4 questions) — 4 total
- Question keys: `gc_interacted`, `gc_program_updates`, `gc_direction`, `gc_concerns`
- Validation: lenient for in_progress (partial OK), strict for completed/end (valid grade + all 4 questions answered with non-null boolean)
- Config/validation: `src/lib/group-student-discussion.ts`
- Form component: `src/components/visits/GroupStudentDiscussionForm.tsx`

### PM Visits: Individual Student Interaction (v1)
- Per-student 2-question binary checklist with grade filter and multi-select checkbox dropdown with batch-add across 1 section — no attendance gating
- Payload: `{ students: [{ id, name, grade, questions: { [key]: { answer: boolean|null, remark?: string } } }] }`
- Grade filter fetches students from `/api/pm/students?school_code=X&grade=N`
- 1 section: Operational Health (2 questions) — 2 total
- Question keys: `oh_teaching_concern`, `oh_additional_support`
- Validation: lenient for in_progress (partial OK), strict for completed/end (≥1 student, each with valid id/name/grade + all 2 questions answered)
- No 'all students recorded' DB check (unlike individual teacher END)
- Config/validation: `src/lib/individual-student-discussion.ts`; shared student utils: `src/lib/student-utils.ts`
- Form component: `src/components/visits/IndividualStudentDiscussionForm.tsx`

### PM Visits: School Staff Interaction (v1)
- 2-question binary checklist across 1 section — no teacher/student/grade selection (simplest checklist alongside principal interaction)
- Payload: `{ questions: { [key]: { answer: boolean|null, remark?: string } } }`
- 1 section: General Check (2 questions) — 2 total
- Question keys: `gc_staff_concern`, `gc_pertaining_issue`
- Validation: lenient for in_progress (partial OK), strict for completed/end (all 2 questions answered with non-null boolean)
- Config/validation: `src/lib/school-staff-interaction.ts`
- Form component: `src/components/visits/SchoolStaffInteractionForm.tsx`

### PM Visits: Visit Completion Rule
- Visit completion requires all 7 action types: at least one completed `classroom_observation` (with strict-valid rubric), at least one completed `af_team_interaction`, at least one completed `individual_af_teacher_interaction`, at least one completed `principal_interaction`, at least one completed `group_student_discussion`, at least one completed `individual_student_discussion`, and at least one completed `school_staff_interaction`
- Checks are sequential and short-circuit on first missing type (classroom → AF team → individual teacher → principal → group student → individual student → school staff)


### Key Patterns
- Server components for data fetching (`getServerSession` + direct DB queries)
- Client components for interactivity (`"use client"` directive)
- Path alias: `@/*` maps to `./src/*`

## Environment Variables Required

```
DATABASE_HOST, DATABASE_PORT, DATABASE_USER, DATABASE_PASSWORD, DATABASE_NAME
GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
NEXTAUTH_SECRET, NEXTAUTH_URL
DYNAMODB_URL, DYNAMODB_REGION, DYNAMODB_ACCESS_KEY, DYNAMODB_SECRET_KEY
```

## Unit Tests

Unit tests use Vitest with V8 coverage. Test files live alongside source files as `*.test.ts` / `*.test.tsx`.

```bash
npm run test               # Run all unit tests
npm run test:unit:coverage # Run with V8 coverage report
```

### Key conventions
- Test files: `src/**/*.test.ts` and `src/**/*.test.tsx` (colocated with source)
- Config: `vitest.config.ts` (path alias `@/*` configured)
- Coverage output:
  - `unit-coverage/coverage-summary.json` — **committed** to repo; read by GitHub Actions
  - `unit-coverage/index.html` — local coverage viewer (gitignored)
- GitHub Actions workflow (`.github/workflows/unit-coverage-comment.yml`) posts a coverage table as a PR comment
- Developer workflow: run tests locally, commit `unit-coverage/coverage-summary.json`, push

### Test files (92 files, 1661 tests as of 2026-03-22)

**Library tests** (high-signal):
- `src/lib/permissions.test.ts` — sync helpers + async DB-dependent functions (getUserPermission, canAccessSchool, isAdmin, etc.)
- `src/lib/curriculum-helpers.test.ts` — pure helpers + localStorage functions
- `src/lib/geo-validation.test.ts` — GPS reading validation
- `src/lib/geolocation.test.ts` — browser geolocation API (watchPosition/clearWatch mocks, fake timers)
- `src/lib/school-student-list-data-issues.test.ts` — student deduplication and multi-school detection
- `src/lib/auth.test.ts` — NextAuth callbacks (authorize, jwt, session)
- `src/lib/bigquery.test.ts` — BigQuery client init + query functions (singleton reset via vi.resetModules)
- `src/lib/db.test.ts` — pg Pool query wrapper
- `src/lib/constants.test.ts` — shared constants
- `src/lib/visit-actions.test.ts` — ACTION_TYPES map + ActionType exhaustiveness
- `src/lib/visits-policy.test.ts` — shared visit auth/scope/locking policy helpers
- `src/lib/classroom-observation-rubric.test.ts` — rubric config integrity, score computation, lenient/strict validation rules
- `src/lib/af-team-interaction.test.ts` — AF team interaction config integrity, lenient/strict validation rules
- `src/lib/individual-af-teacher-interaction.test.ts` — individual teacher interaction config integrity, attendance-gated lenient/strict validation rules
- `src/lib/principal-interaction.test.ts` — principal interaction config integrity, lenient/strict validation rules
- `src/lib/group-student-discussion.test.ts` — group student discussion config integrity, grade validation, lenient/strict validation rules
- `src/lib/individual-student-discussion.test.ts` — individual student discussion config integrity, per-student grade validation, lenient/strict validation rules
- `src/lib/school-staff-interaction.test.ts` — school staff interaction config integrity, lenient/strict validation rules
- `src/lib/teacher-utils.test.ts` — shared teacher display name helper
- `src/lib/student-utils.test.ts` — shared student display name helper
- `src/proxy.test.ts` — middleware redirect logic

**Hook tests** (high-signal):
- `src/hooks/use-auto-save.test.ts` — auto-save hook: debounce, status transitions, flush/cancel, beforeunload, sanitizeFn integration

**API route tests** (high-signal):
- `src/app/api/admin/schools/route.test.ts` — GET list/search schools
- `src/app/api/admin/schools/[code]/route.test.ts` — PATCH update school program_ids
- `src/app/api/admin/users/route.test.ts` — GET list users, POST create user
- `src/app/api/admin/users/[id]/route.test.ts` — DELETE/PATCH user management
- `src/app/api/curriculum/chapters/route.test.ts` — GET chapters with topics (uses NextRequest)
- `src/app/api/students/search/route.test.ts` — GET student search with school access control
- `src/app/api/pm/students/route.test.ts` — GET students for a school with optional grade filter
- `src/app/api/pm/teachers/route.test.ts` — GET teachers for a school (role/access filtering)
- `src/app/api/pm/visits/route.test.ts` — GET/POST visits list + create with GPS
- `src/app/api/pm/visits/[id]/route.test.ts` — GET visit + actions (no PATCH/PUT)
- `src/app/api/pm/visits/[id]/actions/route.test.ts` — GET list / POST create action
- `src/app/api/pm/visits/[id]/actions/[actionId]/route.test.ts` — GET / PATCH data / DELETE (pending-only)
- `src/app/api/pm/visits/[id]/actions/[actionId]/start/route.test.ts` — POST start action with GPS
- `src/app/api/pm/visits/[id]/actions/[actionId]/end/route.test.ts` — POST end action with GPS
- `src/app/api/pm/visits/[id]/complete/route.test.ts` — POST complete visit with GPS + rules
- `src/app/api/batches/route.test.ts` — GET batches (DB service proxy)
- `src/app/api/batches/[id]/route.test.ts` — PATCH batch metadata (DB service proxy)
- `src/app/api/student/route.test.ts` — POST student update (DB service proxy)
- `src/app/api/student/[id]/route.test.ts` — PATCH student + grade + batch (multi-fetch)
- `src/app/api/student/dropout/route.test.ts` — POST mark dropout (DB service proxy)
- `src/app/api/quiz-analytics/[udise]/route.test.ts` — POST quiz analytics (BigQuery)
- `src/app/api/quiz-analytics/[udise]/sessions/route.test.ts` — GET quiz sessions (BigQuery)

**Page tests** (high-signal):
- `src/app/page.test.tsx` — login page
- `src/app/layout.test.tsx` — root layout
- `src/app/dashboard/page.test.tsx` — dashboard (no issueLog/visit.data dependency)
- `src/app/school/[udise]/page.test.tsx` — school roster
- `src/app/school/[udise]/visit/new/page.test.tsx` — start new visit
- `src/app/admin/page.test.tsx`, `src/app/admin/batches/page.test.tsx`, `src/app/admin/schools/page.test.tsx`, `src/app/admin/users/page.test.tsx` — admin pages
- `src/app/visits/page.test.tsx` — visits list (2-state, completed_at, filters)
- `src/app/visits/[id]/page.test.tsx` — visit detail (action cards, no section links)
- `src/app/visits/[id]/actions/[actionId]/page.test.tsx` — action detail (renderer dispatch, save/end, read-only)

**Component tests** (high-signal):
- `src/components/visits/ActionPointList.test.tsx` — action card interactions (add/start/delete/open)
- `src/components/visits/ActionTypePickerModal.test.tsx` — action type picker
- `src/components/visits/ClassroomObservationForm.test.tsx` — rubric form rendering, scoring summary behavior, data updates
- `src/components/visits/AFTeamInteractionForm.test.tsx` — AF team interaction form rendering, teacher multiselect, binary questions, validation
- `src/components/visits/IndividualAFTeacherInteractionForm.test.tsx` — individual teacher interaction form rendering, per-teacher accordion, attendance gating, add/remove
- `src/components/visits/PrincipalInteractionForm.test.tsx` — principal interaction form rendering, binary questions, read-only mode
- `src/components/visits/GroupStudentDiscussionForm.test.tsx` — group student discussion form rendering, grade dropdown gating, binary questions, progress bar
- `src/components/visits/IndividualStudentDiscussionForm.test.tsx` — individual student discussion form rendering, grade filter, student fetch/add/remove, per-student questions
- `src/components/visits/SchoolStaffInteractionForm.test.tsx` — school staff interaction form rendering, binary questions, read-only mode
- `src/components/visits/CompleteVisitButton.test.tsx` — GPS capture + completion rules
- `src/components/visits/NewVisitForm.test.tsx` — start visit GPS flow
- `src/components/SchoolTabs.test.tsx`, `src/components/VisitsTab.test.tsx` — visit tab rendering
- `src/components/EditStudentModal.test.tsx`, `src/components/StudentTable.test.tsx` — student CRUD
- `src/components/curriculum/*.test.tsx` — curriculum POC components (6 files)
- Plus: `SchoolCard`, `SchoolSearch`, `StudentSearch`, `StatCard`, `Pagination`, `PageHeader`, `LoadingLink`, `Providers`, `PerformanceTab`, `QuizAnalyticsSection`, admin components

**Shared test utilities:**
- `src/app/api/__test-utils__/api-test-helpers.ts` — `jsonRequest()`, `routeParams()`, session constants

### Mocking patterns
- **DB queries**: `vi.mock("./db")` + `vi.mocked(query)` for return value control per test
- **Constructors** (pg.Pool, BigQuery): `vi.hoisted()` + `vi.fn(function() { return {...} })` (arrow functions can't be `new`-ed)
- **Browser APIs**: `vi.stubGlobal("navigator", {...})`, `vi.stubGlobal("localStorage", {...})`
- **Timers**: `vi.useFakeTimers()` / `vi.advanceTimersByTime()` for timeout-based tests
- **Singletons**: `vi.resetModules()` + dynamic `import()` in each test to get fresh module instances
- **NextAuth provider**: access user's authorize via `provider.options.authorize` (not `provider.authorize` which is the default `() => null`)
- **API route auth**: `vi.mock("next-auth")` + `vi.mock("@/lib/auth", () => ({ authOptions: {} }))` — mock `getServerSession` directly
- **External fetch**: `vi.stubGlobal("fetch", mockFetch)` for DB service proxy routes — chain with `mockResolvedValueOnce()`
- **NextRequest**: Use `new NextRequest(new URL(url, "http://localhost"))` for routes that read `request.nextUrl.searchParams`

## E2E Tests

Tests use Playwright with a local test Postgres DB (`af_lms_test`) loaded from a dump of the dev DB.

### Setup (one-time)
```bash
cp .env.test.example .env.test                    # defaults are fine for local postgres
pg_dump --no-owner --no-privileges --clean --if-exists \
  -U postgres -h localhost -f e2e/fixtures/db-dump.sql dbservice_dev
```

### How it works
- Runs on port **3001** with a separate `.next-test/` build dir (won't conflict with `npm run dev`)
- Auth is injected via NextAuth JWT cookies — no real Google login needed
- 3 test personas (admin, PM, teacher) + passcode user are upserted into `user_permission`
- DB is reset from dump in `global-setup.ts`, dropped in `global-teardown.ts`
- Single worker, sequential execution (shared DB)

### Key conventions
- Import `test`/`expect` from `e2e/fixtures/auth.ts` for authenticated tests
- Use `adminPage`, `pmPage`, `teacherPage`, `passcodePage` fixtures for per-role pages
- Import from `@playwright/test` for unauthenticated tests (smoke tests)

### Coverage reports
- `npm run test:e2e` collects V8 JS coverage automatically (all page fixtures in `e2e/fixtures/auth.ts` instrument coverage)
- Coverage is filtered to only `src/` app files (no Next.js internals)
- Output:
  - `coverage/coverage-summary.json` — **committed** to repo; read by GitHub Actions
  - `coverage/index.html` — local V8 coverage viewer (gitignored)
  - `monocart-report/index.html` — local test report (gitignored)
- GitHub Actions workflow (`.github/workflows/e2e-coverage-comment.yml`) posts a coverage table as a PR comment
- Developer workflow: run tests locally, commit `coverage/coverage-summary.json`, push

## Deployment

Deployed on AWS Amplify. Database SSL is enabled with `rejectUnauthorized: false`.
