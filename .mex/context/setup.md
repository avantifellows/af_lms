---
name: setup
description: Dev environment setup and commands. Load when setting up the project for the first time or when environment issues arise.
triggers:
  - "setup"
  - "install"
  - "environment"
  - "getting started"
  - "how do I run"
  - "local development"
edges:
  - target: context/stack.md
    condition: when specific technology versions or library details are needed
  - target: context/data-access.md
    condition: when configuring which backend env vars point at
  - target: context/architecture.md
    condition: when understanding how components connect during setup
last_updated: 2026-10-22
---

# Setup

## Prerequisites
- **Node 22** (`.nvmrc` pins it; install with `nvm install 22` then `nvm use`).
- **npm** (lockfile is `package-lock.json`).
- Access to **PostgreSQL** credentials and the **DB Service** API token (from team lead).
- Google OAuth client + (optional, per feature) BigQuery/DynamoDB/S3/SNS credentials.

## First-time Setup
1. `nvm use` (selects Node 22)
2. `npm install`
3. `cp .env.example .env.local` and fill in values (see below; ask team lead for secrets)
4. `npm run dev` → http://localhost:3000
5. In dev, log in via the **Dev Login** personas (admin / program_manager / program_admin / teacher / former_mentor / holistic_admin / read_only / pmu_manager / pmu_govt_school_user / blended_mentor / blended_admin / blended_admin_read_only / alumni_manager) — no Google needed (`src/lib/auth.ts`, only when `NODE_ENV !== "production"`). The two PMU personas are seeded by the local fixture setup at a JNV School (level 1, `program_ids = [64]`, no regions); the Alumni Manager persona at the fixture School (level 1, `program_ids = []`). The three Blended Learning personas (`e2e-blended-*@test.local`) are seeded by the same setup with level 1, no School codes, no regions and `program_ids = []`; they land on `/blended-learning`.

## Environment Variables
Required (app won't function without them):
- `DATABASE_HOST`, `DATABASE_PORT`, `DATABASE_USER`, `DATABASE_PASSWORD`, `DATABASE_NAME` — Postgres connection (reads + visit/curriculum writes). `DATABASE_SSL=false` disables SSL locally.
- `DB_SERVICE_URL`, `DB_SERVICE_TOKEN` — external write API (students/batches/quiz-sessions/documents).
- `NEXTAUTH_URL`, `NEXTAUTH_SECRET` — NextAuth (`openssl rand -base64 32` for the secret).
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` — Google OAuth.

Conditionally required (only if the feature is used):
- `GOOGLE_SERVICE_ACCOUNT_JSON` (or `GOOGLE_APPLICATION_CREDENTIALS`) — BigQuery quiz analytics.
- `DYNAMODB_URL`, `DYNAMODB_REGION`, `DYNAMODB_ACCESS_KEY`, `DYNAMODB_SECRET_KEY` — performance dashboard.
- `S3_DOCS_BUCKET`, `S3_DOCS_PREFIX`, `S3_DOCS_REGION`, `S3_DOCS_ACCESS_KEY_ID`, `S3_DOCS_SECRET_ACCESS_KEY` — document uploads (bucket shared with prod). Blended Learning photos are uploaded (`PutObject`), checked (`HeadObject`) and presigned with them too, and Call Recordings get presigned PUTs from them (`presignUpload`). `S3_DOCS_PREFIX` must be `lms-documents`, so recording keys match the 180-day lifecycle rule and etl-next's prefixes; the bucket also needs a CORS rule allowing browser `PUT` with `Content-Type` from the LMS origins (a rollout task, not code). The Playwright web server sets fake values (`e2e-fake-docs`, `lms-documents`), so presigning works locally with no AWS traffic; specs answer `amazonaws.com` requests with `page.route`.
- `AF_ACCESS_KEY_ID`, `AF_SECRET_ACCESS_KEY`, `AF_TOPIC_ARN`, `APP_ENV` — SNS session creator.
- `BLENDED_LEARNING_SES_ACCESS_KEY_ID`, `BLENDED_LEARNING_SES_SECRET_ACCESS_KEY`, `BLENDED_LEARNING_SES_REGION` (default `ap-south-1`), `BLENDED_LEARNING_WELLBEING_EMAILS` (comma-separated; `shalinijha@` in production) — the well-being email sent after a Conversation with an Emotional Well-being Mentor Flag is saved (`src/lib/blended-learning-wellbeing-notifier.ts`, `af-lms-ses` IAM user, from `no-reply@avantifellows.org`). The link uses `NEXTAUTH_URL`. If the key id, secret or recipients are unset, the email is skipped without error. The Playwright web server sets the key id and recipients to `" "` (a blank value would be refilled from `.env.local`), so e2e never sends.
- `BLENDED_LEARNING_ETL_URL` (the etl-next base URL, no path), `BLENDED_LEARNING_ETL_TOKEN` (machine token bound to `APP_ENV`) — the wake call after a Call Recording upload creates a Conversation Draft (`wakeTranscription` in `src/lib/blended-learning-drafts.ts`): `POST {URL}/api/internal/blended-learning/transcription-requests/{request_key}/enqueue` with `{"environment": APP_ENV}`. If the URL or token is unset (blank after trimming) or `APP_ENV` is not `staging`/`production`, the wake is skipped without error and the draft stays `transcribing`. The Playwright web server sets both to `" "`, so e2e never calls etl-next.

Never commit real values — `.env.local` is gitignored; CI injects prod/preview values via the Amplify workflow.

## Common Commands
- `npm run dev` — dev server on :3000 (hot reload).
- `npm test` / `npm run test:unit` — full Vitest run; `npm run test:unit:watch` for watch; `npm run test:unit:coverage` for coverage.
- `npm run test:e2e` — Playwright E2E (`:ui`/`:headed` variants exist).
  Global setup runs db-service migrations with `mix` from `../db-service_holistic_mentorship` (hard-coded in `e2e/helpers/db.ts`). If that checkout is absent, holistic tables are on `db-service` main, so a temporary symlink to `../db-service` works. With asdf and no `.tool-versions`, put `~/.asdf/installs/elixir/<ver>/bin` and `~/.asdf/installs/erlang/<ver>/bin` on `PATH` directly.
- `npm run lint` — ESLint (`eslint-config-next`).
- `npm run build` — production Next build.
- `npm run fallow:health` — codebase health/hotspots; `fallow:dead-code`, `fallow:audit` for cleanup/PR risk.
  - The CI Fallow job installs the newest fallow that satisfies `package.json` (for example 2.104.0), and that version can score differently from the locally installed one: it counts React hook density toward cognitive complexity, with a threshold of 15. To reproduce the CI gate, run `npm run test:unit:coverage`, then `npx -y fallow@<CI version> audit --base origin/main --coverage unit-coverage/coverage-final.json`. The CI log line "Installed fallow …" gives the version. Restore the tracked `coverage/coverage-summary.json` afterwards. `npx -y fallow@latest` is the 3.x line (3.34.1 on 2026-10-19), which also gates these files; on a busy machine pass `-- --testTimeout=30000` to the coverage run so slow component tests don't time out. Untested page components and server functions score CRAP = cyclomatic² + cyclomatic, so any function with cyclomatic ≥ 5 needs unit coverage or a split (scripts outside `src/` are never covered, so keep them thin and move logic into tested `src/lib` modules).
  - The audit diffs the PR merge ref against the PR's *old* merge-base, so findings merged into `main` by another PR show up as "changed files" on yours. Merge `main` into the branch to move the base forward, and reproduce with `--base <old merge-base>`. Editing a file makes fallow treat its existing high-CRAP functions as new, so budget for tests on the whole file. A component's prop count also adds to its cognitive score (about one point per prop past four), so a 19-prop component fails on props alone; pass a pre-rendered slot (`actions: ReactNode`) instead of forwarding props. `--format json --complexity-breakdown` on `fallow health` lists each contribution.
- Data scripts (one-off, via `ts-node`): `npm run centres:import`, `npm run blended:import-links` (Profile Doc / Screener Links; `patterns/load-blended-learning-links.md`), `npm run pm:import`, `npm run db:setup-permissions`, etc. (see `scripts/`).
- `npm run curriculum:seed-plans -- <workbook.xlsx>` dry-runs the one-time 2026-27 Curriculum Plan seed (#417 / #425) and prints the report; add `--apply` to create the three Draft plans in one transaction (all or none; `createCurriculumPlanDrafts` in `src/lib/curriculum-plans.ts`). Argument parsing lives in `src/lib/curriculum-plan-seed-args.ts` and the database side in `src/lib/curriculum-plan-seed-store.ts`. Needs the db-service plan tables; locally, apply `e2e/fixtures/migrations/20261019120000_add_lms_curriculum_plans.sql` to a throwaway DB clone rather than `dbservice_dev`. The workbook is never committed.
- Holistic release setup: `npm run holistic:setup-local -- --confirm-synthetic-database --program-id=<1|74|94|78|88|99>` applies the sibling DB Service migrations and synthetic fixtures to a local-only database. Production preflight requires `--historical-source=<private-json>` for Program 1, uses it for a Program 78 Historical run when applicable, and omits it for live Programs 74, 94, 88, and 99. Follow `docs/holistic-mentorship-release.md` for the separate commands, staging order, sign-off, monitoring, and rollback.

## Common Issues
- **Port 3000 in use:** `lsof -i :3000` then `kill -9 <PID>`.
- **`undefined_table`/`undefined_column` (42P01/42703):** the connected DB is missing a migration (e.g. centre-seat schema). The DB schema is owned by the DB Service repo — apply its migrations, don't add columns here.
- **DB Service writes 401/4xx:** check `DB_SERVICE_URL`/`DB_SERVICE_TOKEN`; the proxy route surfaces the upstream error text in `warnings`/`error`.
- **Pool exhaustion / hung queries:** `src/lib/db.ts` caps at 10 connections with 15s `statement_timeout`; a leaking caller shows as `connectionTimeoutMillis` errors after 5s.
- **Knowledge graph (`graphify-out/`) out of date:** it's regenerated locally and not committed — run `/graphify --update` to refresh it against the current code (AST refresh is free; only changed docs cost tokens).
