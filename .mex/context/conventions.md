---
name: conventions
description: How code is written in this project — naming, structure, patterns, and style. Load when writing new code or reviewing existing code.
triggers:
  - "convention"
  - "pattern"
  - "naming"
  - "style"
  - "how should I"
  - "what's the right way"
edges:
  - target: context/architecture.md
    condition: when a convention depends on understanding the system structure
  - target: context/data-access.md
    condition: when writing data-access code (reads vs DB Service writes)
  - target: context/permissions.md
    condition: when writing the auth gate for a route
  - target: patterns/INDEX.md
    condition: when starting a concrete task that may have a runbook
last_updated: 2026-06-25
---

# Conventions

## Naming
- React components: `PascalCase.tsx` (`StudentTable.tsx`, `NewVisitForm.tsx`).
- Lib modules & scripts: `kebab-case.ts` (`visit-actions.ts`, `geo-validation.ts`, `import-centres.ts`).
- Functions/vars: `camelCase`, verb-first (`getUserPermission`, `validateGpsReading`, `buildVisitScopePredicate`).
- Exported constant maps: `SCREAMING_SNAKE` (`ACTION_TYPES`, `PROGRAM_IDS`, `FEATURE_PERMISSIONS`).
- DB tables/columns: `snake_case`; Ecto timestamps `inserted_at`/`updated_at` (NOT `created_at`); LMS-owned tables are prefixed `lms_` (`lms_pm_school_visits`, `lms_pm_school_visit_actions`).
- Imports use the `@/` alias (`@/lib/db`, `@/components/...`), not deep relative paths.

## Structure
- Pages: `src/app/<route>/page.tsx` (Server Components). API: `src/app/api/<route>/route.ts` exporting `GET`/`POST`/`PATCH`/`DELETE`.
- Business logic + data access lives in `src/lib/*`; route handlers stay thin (auth gate → call lib → shape response). Components never call `query()` directly.
- Tests are **colocated**: `foo.ts` → `foo.test.ts` (and `Foo.tsx` → `Foo.test.tsx`) in the same folder. E2E specs live under `e2e/`.
- Client-safe shared values go in `@/lib/constants` (e.g. `PROGRAM_IDS`); anything importing `@/lib/db` is server-only and must not be reached from a client component.
- Types shared across modules live in `src/types/`; one-off types stay local to their module.

## Patterns
**API route shape — gate, then act.** Every handler authenticates and authorises before
touching data:
```ts
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  const access = await requireVisitsAccess(session, "edit"); // or canAccessSchool / isAdmin
  if (!access.ok) return access.response;
  const { id } = await params;                                // Next 16: params is a Promise
  // ... query() or DB Service fetch ...
}
```

**Parameterised SQL only — never interpolate.**
```ts
// Correct
await query<Row>(`SELECT * FROM school WHERE code = $1`, [code]);
// Wrong — SQL injection + breaks the prepared-statement path
await query<Row>(`SELECT * FROM school WHERE code = '${code}'`);
```

**Writes split by entity.** Student/batch/quiz-session/document mutations `fetch` the DB
Service with `Authorization: Bearer ${DB_SERVICE_TOKEN}`; visit/curriculum writes use
`query()` directly. See `context/data-access.md`.

**Structured error responses.** Visit/PM routes return via `apiError(status, error, details?)`
from `@/lib/visits-policy`; older routes use `NextResponse.json({ error }, { status })`.

## Verify Checklist
Before presenting any code:
- [ ] Every API route gates on `getServerSession(authOptions)` then a permissions/visits-policy check before data access.
- [ ] All SQL uses `$1` placeholders + a params array — no string interpolation.
- [ ] Data access goes through `query()` (reads/visit writes) or the DB Service proxy (student/batch/quiz/doc writes) — the right one for the entity.
- [ ] No client component imports a server-only module (`@/lib/db` or anything transitively pulling the pool).
- [ ] Next 16 route handlers `await params` (it's a `Promise`).
- [ ] A colocated `*.test.ts(x)` exists/updated; `npm test` passes and `npm run lint` is clean.
- [ ] No GPS lat/lng is logged.
