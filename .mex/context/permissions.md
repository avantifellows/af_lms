---
name: permissions
description: Access control — roles, school-scope levels, feature matrix, program/NVS gating, centre seats, and passcode users. Load when gating any route or page.
triggers:
  - "permission"
  - "access control"
  - "auth"
  - "403"
  - "forbidden"
  - "role"
  - "scope"
  - "isAdmin"
  - "canAccessSchool"
edges:
  - target: context/architecture.md
    condition: when seeing where the gate sits in the request flow
  - target: context/visits.md
    condition: when the route is a visit route (uses visits-policy, not raw permissions)
  - target: context/conventions.md
    condition: when writing the route handler around the gate
  - target: patterns/debug-access-denied.md
    condition: when a user is wrongly denied or wrongly granted access
  - target: patterns/add-api-route.md
    condition: when adding a route that needs gating
last_updated: 2026-07-01
---

# Permissions

Core file: `src/lib/permissions.ts`. Client-safe constants: `src/lib/constants.ts`
(`PROGRAM_IDS`, `PROGRAM_ID_TO_LABEL`, `ACADEMIC_MENTORSHIP_PROGRAM_ALLOWLIST`).
Auth config: `src/lib/auth.ts`.

## The model — three independent axes
1. **Role** (`UserRole`): `teacher` | `program_manager` | `program_admin` | `admin`.
2. **School scope** (`AccessLevel`): `1` = specific `school_codes`, `2` = `regions`, `3` = all schools. (`isAdmin` is by **role**, not level.)
3. **Program eligibility** (`program_ids`): COE=1, NODAL=2, NVS=64, plus non-JNV centre programs. Some features are gated to CoE/Nodal.

A `read_only` flag downgrades any `edit` to `view`.

## Feature access — the matrix
`getFeatureAccess(permission, feature, opts?)` returns `{ access, canView, canEdit }`:
- Looks up `FEATURE_PERMISSIONS[feature][role]` (`none`/`view`/`edit`).
- **NVS gating:** features in `NVS_GATED_FEATURES` (`visits`, `curriculum`, `pm_dashboard`, `summary_stats`, `quiz_sessions`) become `none` unless the user `hasCoEOrNodal`.
- **Academic Mentorship:** uses the `academic_mentorship` feature key and its own Program allowlist (`ACADEMIC_MENTORSHIP_PROGRAM_ALLOWLIST`, v1 wildcard `*`), so NVS-only users are not blocked by the NVS-gated feature set.
- **`read_only` downgrade:** `edit` → `view`.
- **Passcode users** (`opts.isPasscodeUser`): `students` → `edit`, everything else → `none`.

Per-row ownership uses `ownsRecord(permission, programId)` — admins own all, null program_id (unassigned) is editable by anyone with feature edit, otherwise the record's `program_id` must be in the user's programs.

## Scope resolution — `getResolvedPermission` vs `getUserPermission`
- `getUserPermission(email)` — bare row from `user_permission` (only `revoked_at IS NULL`). Use for role/feature checks that don't touch school scope.
- `getResolvedPermission(email)` — `getUserPermission` **+** `resolveScope`. Use **anywhere school/centre access is actually decided** so centre seats are included. `canAccessSchoolSync` only honours seats when `scope` is populated.
- **Centre seats** (`centre_positions` → `centres` → `school`/`program`): additive. A seated user reaches that centre's school + program even with empty `school_codes`/`program_ids`. `resolveScope` degrades to explicit-only **only** on missing-schema errors (42P01/42703); any other DB error propagates (so a seated user is never silently handed an empty scope).

## The gate — what to call
- **General routes:** `getServerSession(authOptions)` → `isAdmin(email)` (admin-only) or `canAccessSchool(email, code, region?)` / `canAccessStudent(session, studentId, { requireEdit })`.
- **Academic Mentorship routes:** use `requireAcademicMentorshipAccess(session, "view"|"edit", { schoolCode? })` from `src/lib/academic-mentorship.ts`.
- **Visit routes:** use `src/lib/visits-policy.ts` instead — `requireVisitsAccess(session, "view"|"edit")` then `enforceVisit*`. See `context/visits.md`.
- **List queries:** scope at the SQL level with `getAccessibleSchoolCodes(email)` (returns `"all"` or `string[]`) or, for visits, `buildVisitScopePredicate(actor)`.

## Gotchas
- **`getUserPermission` for a school decision = bug.** Seats are absent, so a seated-but-no-explicit-codes user is wrongly denied. Use `getResolvedPermission`.
- **`requireEdit` matters on writes.** `canAccessStudent(session, id, { requireEdit: true })` for upload/delete — without it a `read_only` user could mutate via direct API call even though the UI hides the button. It also enforces per-program ownership in mixed schools.
- **Passcode users** must be handled explicitly (`session.isPasscodeUser`) — they're blocked from visits and all non-`students` features; the gate checks `session.schoolCode` against the target school.
- **`revoked_at`** is the single "exited" switch — a revoked user resolves to no permission everywhere.
- **`PROGRAM_IDS` is hand-maintained** in `constants.ts` (transitional debt) — add a program id here when a non-JNV centre is onboarded.
- Import `PROGRAM_IDS` from `@/lib/constants`, not `@/lib/permissions`, in client components — `permissions.ts` pulls in the server-only DB pool.
