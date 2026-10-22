---
name: add-user-role
description: Add a new `user_permission` role (matrix column, constants, deny-point or pin, Admin Users, Staff Management, Dev Login, landing). Use when a feature needs its own role, like the PMU or Blended Learning roles.
triggers:
  - "new role"
  - "add role"
  - "USER_ROLES"
  - "deny by default"
edges:
  - target: context/permissions.md
    condition: for the matrix, the deny-point and the existing pinned roles
  - target: patterns/add-api-route.md
    condition: when the role's own section needs API routes
  - target: patterns/debug-access-denied.md
    condition: when the new role is wrongly granted or denied
last_updated: 2026-10-22
---

# Add a User Role

## Context
Read `context/permissions.md`. Decide first whether the role reaches existing
LMS surfaces at all. PMU roles (ADR 0007) reach Schools, pinned to JNV NVS.
Blended Learning roles (#441) reach nothing but their own section, so the
shared lookup denies them (the ADR 0008 deny-point shape).

## Steps
1. **Constants:** add `X_ROLE`, `X_ROLES` and `isXRole` to `src/lib/constants.ts`
   (client-safe, so components can branch on them).
2. **Matrix:** spread the roles into `USER_ROLES`, add a column for every row of
   `FEATURE_PERMISSIONS` (`none` unless decided otherwise) and, if needed, a new
   feature key. TypeScript fails until every row has the new column.
3. **Deny or pin:** for a role with no School access, return `null` from
   `getUserPermission` (one line next to `isBlendedRole`) and give the role's
   own code a raw-row reader like `getBlendedLearningPermission`. For a pinned
   role, follow the PMU branches (`resolveScope`, `getProgramContextSync`,
   `ownsRecord`, `canViewCentre`).
4. **Own policy:** a server-only `src/lib/<feature>-access.ts` that every page
   and route of the section calls first.
5. **Landing:** if the role has no program context, redirect it in
   `/dashboard` *before* the no-access and program-context checks; add the
   section to the `src/proxy.ts` matcher.
6. **Admin Users:** `POST`/`PATCH` row shape (skip the "at least one program"
   rule, force the stored scope), 409 for seated targets, 400 when moving off
   the role without `program_ids`; modal option, description, access fields;
   list label and colour.
7. **Staff Management:** add the role to `rejectIneligibleSeatUser` (409) and
   `PROGRAM_SYNC_SKIPPED_ROLES`.
8. **Dev Login + fixtures:** persona in `DEV_LOGIN_PERSONAS` and `src/app/page.tsx`,
   rows in `seedHolisticFixtures` (also used by the e2e reset), manifest entry.
9. **Docs:** `context/permissions.md`, `context/setup.md` (personas), ROUTER.

## Gotchas
- `dashboard/page.test.tsx` mocks `@/lib/permissions` wholesale: a new
  permissions export used by the page must be added to that mock, or mock the
  new policy module instead.
- A denied role sent from a page to `/dashboard` must not be sent back by the
  dashboard, or it loops. Redirect on the stored role, not on "access granted".
- Fixture role rows need a `user` row too, or `user_id`-based lookups fail.
- Stored `level` is `NOT NULL` (1–4); a scope-free role still stores level 1.

## Verify
- `permissions.*.test.ts`: matrix rows and the deny-point (or pin) through the
  real guards with a mocked `query`.
- Route tests for the Admin Users row shape and the seat 409.
- Playwright: the role lands where it should and is refused elsewhere.

## Debug
See `patterns/debug-access-denied.md`. Check the stored row first
(`role`, `read_only`, `revoked_at`, `user_id`).

## Update Scaffold
- [ ] Update `.mex/ROUTER.md` "Current Project State"
- [ ] Update `context/permissions.md` and `context/setup.md`
- [ ] Bump `last_updated` on changed files
