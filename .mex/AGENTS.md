---
name: agents
description: Always-loaded project anchor. Read this first. Contains project identity, non-negotiables, commands, and pointer to ROUTER.md for full context.
last_updated: 2026-06-25
---

# af_lms (crud_ui)

## What This Is
Next.js admin LMS for Avanti Fellows — manages JNV student enrollments, PM school visits (GPS-tracked), curriculum tracking, quiz sessions/analytics, performance dashboards, and admin of users/schools/batches/centres/staff.

## Non-Negotiables
- Reads go through `query()` in `src/lib/db.ts`; never construct a second `pg.Pool`.
- Never build SQL by string interpolation — use `$1` placeholders + the params array.
- Never bypass the permission layer: every API route gates on `getServerSession(authOptions)` then a `src/lib/permissions.ts` / `src/lib/visits-policy.ts` check before touching data.
- Server-only modules (anything importing `@/lib/db`) must never be imported by client components — use `@/lib/constants` for client-safe shared values.
- Never log GPS lat/lng — treat as sensitive (see `src/lib/geo-validation.ts`).
- Never commit secrets; all config comes from env vars (see `.env.example`).

## Commands
- Dev: `npm run dev` (port 3000)
- Test (unit): `npm test` / `npm run test:unit:watch`
- Test (e2e): `npm run test:e2e`
- Lint: `npm run lint`
- Build: `npm run build`

## Scaffold Growth
After meaningful work, run GROW:
- Ground: what changed in reality?
- Record: update `ROUTER.md` and relevant `context/` files
- Orient: create or update a `patterns/` runbook if this can recur
- Write: bump `last_updated` on changed scaffold files and run `mex log` when rationale matters

The scaffold grows from real work, not just setup. See the GROW step in `ROUTER.md` for details.

## Navigation
At the start of every session, read `ROUTER.md` before doing anything else.
For full project context, patterns, and task guidance — everything is there.
