---
name: add-api-route
description: Add a Next.js App Router API route handler with the standard auth gate and read/write path. Use when adding any endpoint under src/app/api/.
triggers:
  - "add endpoint"
  - "new api route"
  - "route handler"
  - "add route"
edges:
  - target: context/permissions.md
    condition: when deciding which gate the route needs
  - target: context/data-access.md
    condition: when deciding whether to read Postgres or proxy a write
  - target: context/conventions.md
    condition: for the route shape and verify checklist
  - target: patterns/db-service-write.md
    condition: when the route writes students/batches/quiz-sessions/documents
  - target: patterns/debug-access-denied.md
    condition: when the new route returns 401/403 unexpectedly
last_updated: 2026-06-25
---

# Add an API Route

## Context
Routes live at `src/app/api/<path>/route.ts` and export `GET`/`POST`/`PATCH`/`DELETE`.
Read `context/permissions.md` (which gate) and `context/data-access.md` (which backend).
For visit routes, the gate is `visits-policy`, not raw permissions — see `context/visits.md`.

## Steps
1. Create `src/app/api/<path>/route.ts`. Dynamic segments → folder `[id]/`.
2. Import the gate + data helpers:
   `import { getServerSession } from "next-auth"; import { authOptions } from "@/lib/auth";`
   plus `query` from `@/lib/db` (reads/visit writes) or `fetch` to the DB Service (student/batch/quiz/doc writes).
3. Gate **first**, before any data access:
   ```ts
   export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
     const session = await getServerSession(authOptions);
     if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
     // then: isAdmin(email) | canAccessSchool(email, code, region) | canAccessStudent(session, id, { requireEdit }) | requireVisitsAccess(session, "edit")
     const { id } = await params; // Next 16: params is a Promise
   }
   ```
4. Validate input (parse JSON; for visit routes use `parseJsonBody`). Reject bad input with 400/422.
5. Do the work via `query<T>(sql, params)` (always `$1` placeholders) or a DB Service `fetch`.
6. Return `NextResponse.json(...)`; for visit/PM routes return errors via `apiError(status, error, details?)`.
7. Add a colocated `route.test.ts` (mock `next-auth` `getServerSession` + `@/lib/auth`; stub `fetch`/`query`). Mirror an existing route's test (e.g. `src/app/api/pm/visits`).

## Gotchas
- **Gate before data.** Querying before the auth check leaks data on a 403 path.
- **`await params`** — Next 16 makes it a `Promise`; destructuring it synchronously is a compile error.
- **Right backend for writes** — student/batch/quiz-session/document writes MUST proxy to the DB Service, not `query()`. See `patterns/db-service-write.md`.
- **`requireEdit` on write paths** that touch a student (`canAccessStudent(..., { requireEdit: true })`) — else read-only users mutate via direct API call.
- **Scope list queries at the SQL level** — `getAccessibleSchoolCodes(email)` or `buildVisitScopePredicate(actor)`; don't fetch-all-then-filter in JS.
- Don't import `@/lib/db` into anything a client component pulls in.

## Verify
- [ ] 401 when unauthenticated, 403 when out of scope, before any data touch.
- [ ] All SQL uses `$1` placeholders; reads/writes use the correct backend.
- [ ] `await params` used; handler signature matches Next 16.
- [ ] Colocated `route.test.ts` added; `npm test` + `npm run lint` pass.

## Debug
- Unexpected 401/403 → `patterns/debug-access-denied.md`.
- DB Service write fails → check the surfaced upstream `error`/`warnings` text; verify `DB_SERVICE_URL`/`DB_SERVICE_TOKEN`.
- `42P01`/`42703` from a query → the connected DB is missing a DB-Service migration.

## Update Scaffold
- [ ] Update `.mex/ROUTER.md` "Current Project State" if a new capability landed.
- [ ] Update `.mex/context/*` if a new access or data-access rule emerged.
- [ ] If this route type had a non-obvious gotcha, capture it here.
