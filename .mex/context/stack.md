---
name: stack
description: Technology stack, library choices, and the reasoning behind them. Load when working with specific technologies or making decisions about libraries and tools.
triggers:
  - "library"
  - "package"
  - "dependency"
  - "which tool"
  - "technology"
edges:
  - target: context/decisions.md
    condition: when the reasoning behind a tech choice is needed
  - target: context/conventions.md
    condition: when understanding how to use a technology in this codebase
  - target: context/data-access.md
    condition: when choosing which data backend a library talks to
  - target: context/setup.md
    condition: when installing or configuring these tools locally
last_updated: 2026-07-03
---

# Stack

## Core Technologies
- **TypeScript 5** (strict) — every source file; path alias `@/*` → `./src/*`.
- **Next.js 16.0.7** (App Router) — pages and API route handlers under `src/app/`. React Server Components by default.
- **React 19.2** — UI; hooks only, no class components.
- **Node 22** — pinned via `.nvmrc`; run `nvm use`.
- **PostgreSQL** (via `pg` 8) — primary datastore, accessed with raw parameterised SQL.
- **Tailwind CSS v4** (`@tailwindcss/postcss`) — styling; theme tokens, not ad-hoc colors.

## Key Libraries
- **`pg`** (not an ORM) — direct Postgres. All access goes through `query<T>()` in `src/lib/db.ts`.
- **`next-auth` v4** (not v5/Auth.js) — Google OAuth + a passcode `CredentialsProvider`. Config in `src/lib/auth.ts`; routes call `getServerSession(authOptions)`.
- **`@google-cloud/bigquery`** — quiz analytics reads only (`src/lib/bigquery.ts`).
- **`@aws-sdk/client-dynamodb` + `lib-dynamodb`** — performance-dashboard reads (`src/lib/dynamodb.ts`).
- **`@aws-sdk/client-s3` + `s3-request-presigner`** — document uploads + presigned URLs (`src/lib/s3.ts`).
- **`@aws-sdk/client-sns`** — session-creation messages (`src/lib/sns.ts`).
- **`recharts`** — performance/analytics charts; **`sonner`** — app toasts; **`lucide-react`** — icons; **`csv-parse`** — centre/staff CSV imports.
- **`vitest` 4 + `@testing-library/react`** (not Jest) — unit/component tests, jsdom env. **`@playwright/test`** — E2E.
- **`fallow`** — static codebase health/dead-code/risk analysis (`npm run fallow:*`).

## What We Deliberately Do NOT Use
- **No ORM** — raw `pg` with `$1` placeholders. Keeps the schema shared with the DB Service unambiguous.
- **No client-side data-fetching library** (React Query/SWR) — Server Components fetch via `query()`; client mutations use plain `fetch` to internal API routes.
- **No global state manager** — local state + Server Components.
- **No `created_at`/`updated_at` camelCase** — DB follows Ecto (`inserted_at`/`updated_at`, snake_case).
- **No direct Postgres writes for students/batches/quiz-sessions/documents** — those go through the DB Service.

## Version Constraints
- **Next.js 16**: route handler `params` is a `Promise` — `{ params }: { params: Promise<{ id: string }> }`, must `await params`. Older Next patterns (sync params) will not compile.
- **NextAuth v4** (not v5): a custom provider's `authorize` lives at `provider.options.authorize` when testing.
- **Tailwind v4**: PostCSS-based config; no `tailwind.config.js` v3 conventions.
