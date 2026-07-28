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
last_updated: 2026-07-17
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
5. In dev, log in via the **Dev Login** personas (admin / program_manager / teacher / read_only) — no Google needed (`src/lib/auth.ts`, only when `NODE_ENV !== "production"`).

## Environment Variables
Required (app won't function without them):
- `DATABASE_HOST`, `DATABASE_PORT`, `DATABASE_USER`, `DATABASE_PASSWORD`, `DATABASE_NAME` — Postgres connection (reads + visit/curriculum writes). `DATABASE_SSL=false` disables SSL locally.
- `DB_SERVICE_URL`, `DB_SERVICE_TOKEN` — external write API (students/batches/quiz-sessions/documents).
- `NEXTAUTH_URL`, `NEXTAUTH_SECRET` — NextAuth (`openssl rand -base64 32` for the secret).
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` — Google OAuth.

Conditionally required (only if the feature is used):
- `GOOGLE_SERVICE_ACCOUNT_JSON` (or `GOOGLE_APPLICATION_CREDENTIALS`) — BigQuery quiz analytics.
- `DYNAMODB_URL`, `DYNAMODB_REGION`, `DYNAMODB_ACCESS_KEY`, `DYNAMODB_SECRET_KEY` — performance dashboard.
- `S3_DOCS_BUCKET`, `S3_DOCS_PREFIX`, `S3_DOCS_REGION`, `S3_DOCS_ACCESS_KEY_ID`, `S3_DOCS_SECRET_ACCESS_KEY` — document uploads (bucket shared with prod).
- `AF_ACCESS_KEY_ID`, `AF_SECRET_ACCESS_KEY`, `AF_TOPIC_ARN`, `APP_ENV` — SNS session creator.

Never commit real values — `.env.local` is gitignored; CI injects prod/preview values via the Amplify workflow.

## Common Commands
- `npm run dev` — dev server on :3000 (hot reload).
- `npm test` / `npm run test:unit` — full Vitest run; `npm run test:unit:watch` for watch; `npm run test:unit:coverage` for coverage.
- `npm run test:e2e` — Playwright E2E (`:ui`/`:headed` variants exist).
- `npm run lint` — ESLint (`eslint-config-next`).
- `npm run build` — production Next build.
- `npm run fallow:health` — codebase health/hotspots; `fallow:dead-code`, `fallow:audit` for cleanup/PR risk.
- Data scripts (one-off, via `ts-node`): `npm run centres:import`, `npm run pm:import`, `npm run db:setup-permissions`, etc. (see `scripts/`).
- Holistic release setup: `npm run holistic:setup-local -- --confirm-synthetic-database` applies the sibling DB Service migrations and synthetic fixtures to a local-only database. `npm run holistic:preflight -- --confirm-production-read-only --historical-source=<private-json>` performs the read-only production reconciliation. Follow `docs/holistic-mentorship-release.md` for staging, sign-off, monitoring, and rollback.

## Common Issues
- **Port 3000 in use:** `lsof -i :3000` then `kill -9 <PID>`.
- **`undefined_table`/`undefined_column` (42P01/42703):** the connected DB is missing a migration (e.g. centre-seat schema). The DB schema is owned by the DB Service repo — apply its migrations, don't add columns here.
- **DB Service writes 401/4xx:** check `DB_SERVICE_URL`/`DB_SERVICE_TOKEN`; the proxy route surfaces the upstream error text in `warnings`/`error`.
- **Pool exhaustion / hung queries:** `src/lib/db.ts` caps at 10 connections with 15s `statement_timeout`; a leaking caller shows as `connectionTimeoutMillis` errors after 5s.
- **Knowledge graph (`graphify-out/`) out of date:** it's regenerated locally and not committed — run `/graphify --update` to refresh it against the current code (AST refresh is free; only changed docs cost tokens).
