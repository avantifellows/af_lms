# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Student Enrollment CRUD UI for Avanti Fellows - a Next.js 16 application that allows school administrators to view and manage student enrollments. Features dual authentication (Google OAuth + school passcodes) with permission-based access control.

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
│   ├── dashboard/          # School list (admin view)
│   └── school/[udise]/     # Student list per school
├── components/
│   └── Providers.tsx       # SessionProvider wrapper
└── lib/
    ├── auth.ts             # NextAuth configuration
    ├── db.ts               # PostgreSQL connection pool
    └── permissions.ts      # Access control (hardcoded)

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
- **Level 3**: All schools access (admin)
- **Level 2**: Region-based access (not fully implemented)
- **Level 1**: Specific school codes only

### Database Schema (External PostgreSQL)
Tables queried:
- `school`: id, code, udise_code, name, district, state, region
- `user`: id, first_name, last_name, phone, email, gender
- `student`: user_id, student_id, category, stream
- `group`: id, type, child_id
- `group_user`: id, group_id, user_id

### Key Patterns
- Server components for data fetching (`getServerSession` + direct DB queries)
- Client components for interactivity (`"use client"` directive)
- Path alias: `@/*` maps to `./src/*`

## Environment Variables Required

```
DATABASE_HOST, DATABASE_PORT, DATABASE_USER, DATABASE_PASSWORD, DATABASE_NAME
GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
NEXTAUTH_SECRET, NEXTAUTH_URL
```

## Unit Tests

Unit tests use Vitest with V8 coverage. Test files live alongside source files as `*.test.ts`.

```bash
npm run test               # Run all unit tests
npm run test:unit:coverage # Run with V8 coverage report
```

### Key conventions
- Test files: `src/**/*.test.ts` (colocated with source)
- Config: `vitest.config.ts` (path alias `@/*` configured)
- Coverage output:
  - `unit-coverage/coverage-summary.json` — **committed** to repo; read by GitHub Actions
  - `unit-coverage/index.html` — local coverage viewer (gitignored)
- GitHub Actions workflow (`.github/workflows/unit-coverage-comment.yml`) posts a coverage table as a PR comment
- Developer workflow: run tests locally, commit `unit-coverage/coverage-summary.json`, push

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
