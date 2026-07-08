---
name: debug-access-denied
description: Diagnose unexpected 401/403, empty lists, or wrongly-granted access at the auth boundary. Use when a user can't reach data they should (or can reach data they shouldn't).
triggers:
  - "403"
  - "401"
  - "forbidden"
  - "access denied"
  - "empty list"
  - "can't see"
  - "wrongly granted"
  - "permission bug"
edges:
  - target: context/permissions.md
    condition: for the full access model (roles, scope, matrix, seats)
  - target: context/visits.md
    condition: when the denied resource is a visit
  - target: patterns/add-api-route.md
    condition: when the bug is in a route's gate ordering
last_updated: 2026-06-25
---

# Debug Access Denied (401/403/empty)

## Context
The auth boundary is the most common failure surface. Load `context/permissions.md`
(general) or `context/visits.md` (visit routes). The usual root causes, in order of
likelihood, are below — check them top-down.

## Steps
1. **Authenticated at all?** 401 → no `session`. Confirm `getServerSession(authOptions)` returns a user; check NextAuth env (`NEXTAUTH_URL`/`NEXTAUTH_SECRET`) and that the route gated correctly.
2. **Passcode user?** `session.isPasscodeUser` is blocked from visits and every non-`students` feature. Expected 403 — not a bug. The gate compares `session.schoolCode` to the target school.
3. **Bare vs resolved permission.** The #1 real bug: a school/centre decision used `getUserPermission` instead of `getResolvedPermission`, so centre **seats** were absent and a seated user got denied (or an empty list). Switch to `getResolvedPermission`.
4. **Scope level.** Level 1 = `school_codes`, level 2 = `regions` (region resolved via a `school` lookup when not passed), level 3 = all. Confirm the `user_permission` row's level/codes/regions match expectation.
5. **Feature matrix + gating.** `getFeatureAccess`: is the role's matrix cell `none`? Is it an `NVS_GATED_FEATURES` feature and the user lacks CoE/Nodal (`hasCoEOrNodal=false`)? Is `read_only` downgrading `edit`→`view` on a write path?
6. **Write paths.** A write returning 403 may be missing — or correctly enforcing — `requireEdit` + `ownsRecord` (per-program ownership in mixed schools).
7. **`revoked_at`.** A revoked user resolves to no permission everywhere — check `revoked_at IS NULL`.
8. **List came back empty (not 403)?** The scope predicate filtered it: `getAccessibleSchoolCodes` returned `[]`, or `buildVisitScopePredicate` produced `1 = 0`. Trace the resolved scope set.

## Gotchas
- An empty list and a 403 have different root causes — empty usually means scope SQL, 403 means the gate.
- `resolveScope` swallows ONLY missing-schema errors (42P01/42703) and degrades to explicit-only; any other DB error during resolution throws (so don't mistake a transient DB failure for "no access").
- Don't "fix" a denial by widening the matrix — confirm the user's row/seats first.
- Visit routes use `visits-policy` semantics (PM sees only own visits) — a PM seeing an empty list of *others'* visits is correct.

## Debug
- Reproduce with the exact email; in dev, switch dev-login persona (`admin`/`program_manager`/`teacher`/`read_only`) to isolate role vs scope.
- Log the resolved `permission` (role, level, school_codes, regions, program_ids, scope) — NOT GPS.
- Confirm the route calls the gate BEFORE data access (a query that runs before the check can mask where the denial should occur).

## Update Scaffold
- [ ] If a new class of access bug was found (e.g. a route using the bare permission), add a note to `context/permissions.md`.
- [ ] If a recurring miswiring emerged, capture the fix here.
