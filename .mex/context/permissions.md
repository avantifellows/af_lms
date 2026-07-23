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
last_updated: 2026-07-23
---

# Permissions

Core file: `src/lib/permissions.ts`. Client-safe constants: `src/lib/constants.ts`
(`PROGRAM_IDS`, `PROGRAM_ID_TO_LABEL`, `ACADEMIC_MENTORSHIP_PROGRAM_ALLOWLIST`).
Auth config: `src/lib/auth.ts`.

## The model — three independent axes
1. **Role** (`UserRole`): `teacher` | `program_manager` | `program_admin` | `holistic_mentorship_admin` | `admin`.
2. **School scope** (`AccessLevel`): `1` = specific `school_codes`, `2` = `regions`, `3` = all schools. (`isAdmin` is by **role**, not level.)
3. **Program eligibility** (`program_ids`): COE=1, NODAL=2, NVS=64, plus non-JNV centre programs. Some features are gated to CoE/Nodal.

A `read_only` flag downgrades any `edit` to `view`.

## Feature access — the matrix

`getFeatureAccess(permission, feature, opts?)` returns `{ access, canView, canEdit }`:

- Looks up `FEATURE_PERMISSIONS[feature][role]` (`none`/`view`/`edit`).
- **NVS gating:** features in `NVS_GATED_FEATURES` (`visits`, `curriculum`, `pm_dashboard`, `summary_stats`, `quiz_sessions`) become `none` unless the user `hasCoEOrNodal`.
- **Academic Mentorship:** uses the `academic_mentorship` feature key and its own Program allowlist (`ACADEMIC_MENTORSHIP_PROGRAM_ALLOWLIST`, v1 wildcard `*`), so NVS-only users are not blocked by the NVS-gated feature set.
- **Holistic Mentorship:** uses the `holistic_mentorship` feature key. Teachers, Holistic Mentorship Admins, and global Admins receive base edit access; the shared action policy then enforces Program 1, School scope, Teacher-seat eligibility, and Mapping ownership. The dedicated Admin role has no other feature access.
- **Holistic Mapping lifecycle:** Teachers may claim, confirm takeover, or remove only their own Program 1 Mappings. Teacher exit, LMS access revoke, relevant app/seat-role changes, and seat loss end affected active Mappings and erase unsubmitted draft answers in the same LMS transaction; another eligible seat at the same School/Program preserves access. Canonical User hard deletion is blocked by the Holistic schema's restrictive history foreign keys; removing `user_permission` is a revoke, not a hard delete.
- **Holistic Notes authorship:** only the current Mentor may draft or Submit; submitted Notes are correctable only by their author while that author remains the current Mentor. Replacement Mentors can read submitted history but receive an editable blank form after an unsubmitted draft is erased; Holistic/global Admins never receive draft answers.
- **Staff Management Academic Mentor safeguards:** deleting a Teacher-linked permission blocks on any Academic Mentor-Mentee Mapping history; Teacher exit/revoke blocks only on active Mentees. These checks use `academic_mentorship_mentor_mentee_mappings.mentor_user_id` (`user.id`), not `user_permission.id`, and blocker messages link back to `/admin/academic-mentorship` when School/year context is available.
- **`read_only` downgrade:** `edit` → `view`.
- **Passcode users** (`opts.isPasscodeUser`): `students` → `edit`, everything else → `none`.

Per-row ownership uses `ownsRecord(permission, programId)` — admins own all, null program_id (unassigned) is editable by anyone with feature edit, otherwise the record's `program_id` must be in the user's programs.

Student Addition writes deliberately use a stricter gate than `ownsRecord`: admin, program admin, and program manager roles must all have the target Program in their resolved Program context. Global admins still resolve all Programs; an admin explicitly scoped only to CoE cannot edit or drop an NVS student.

## Scope resolution — `getResolvedPermission` vs `getUserPermission`

- `getUserPermission(email)` — bare row from `user_permission` (only `revoked_at IS NULL`). Use for role/feature checks that don't touch school scope.
- `getResolvedPermission(email)` — `getUserPermission` **+** `resolveScope`. Use **anywhere school/centre access is actually decided** so centre seats are included. `canAccessSchoolSync` only honours seats when `scope` is populated.
- **Centre seats** (`centre_positions` → `centres` → `school`/`program`): additive. A seated user reaches that centre's school + program even with empty `school_codes`/`program_ids`. `resolveScope` degrades to explicit-only **only** on missing-schema errors (42P01/42703); any other DB error propagates (so a seated user is never silently handed an empty scope).

## The gate — what to call

- **General routes:** `getServerSession(authOptions)` → `isAdmin(email)` (admin-only) or `canAccessSchool(email, code, region?)` / `canAccessStudent(session, studentId, { requireEdit })`.
- **Academic Mentorship routes:** use `requireAcademicMentorshipAccess(session, "view"|"edit", { schoolCode? })` from `src/lib/academic-mentorship.ts`.
- **Holistic Mentorship routes:** use `requireHolisticMentorshipAccess(session, action, options)` from `src/lib/holistic-mentorship.ts`; it authenticates before protected data access and applies action-specific Teacher/Admin rules.
- **School page Mentorship tab:** visibility comes from `academic_mentorship` feature access. Teachers see only their own current-year active Mentees; PMs/Admins/Program Admins see a read-only School overview; only Admins and Program Admins get the management link.
- **Visit routes:** use `src/lib/visits-policy.ts` instead — `requireVisitsAccess(session, "view"|"edit")` then `enforceVisit*`. See `context/visits.md`.
- **List queries:** scope at the SQL level with `getAccessibleSchoolCodes(email)` (returns `"all"` or `string[]`) or, for visits, `buildVisitScopePredicate(actor)`.

## Gotchas

- **`getUserPermission` for a school decision = bug.** Seats are absent, so a seated-but-no-explicit-codes user is wrongly denied. Use `getResolvedPermission`.
- **Raw `program_ids` for program filtering = bug.** Use `getProgramContextSync(permission).programIds` so centre-seat-derived programs are included. Otherwise a seated manager can access a school but see empty curriculum/program data for the wrong program.
- **`requireEdit` matters on writes.** `canAccessStudent(session, id, { requireEdit: true })` for upload/delete — without it a `read_only` user could mutate via direct API call even though the UI hides the button. It also enforces per-program ownership in mixed schools.
- **Passcode users** must be handled explicitly (`session.isPasscodeUser`) — they're blocked from visits and all non-`students` features; the gate checks `session.schoolCode` against the target school.
- **`revoked_at`** is the single "exited" switch — a revoked user resolves to no permission everywhere.
- **Postgres `bigint` columns arrive as JS strings** (no `setTypeParser` in `db.ts`). Any numeric comparison against them must cast in SQL (`::int`) or coerce (`Number()`). This bit for real in Jul 2026: `getStudentSchool` started resolving `batch.program_id` (bigint) after the #162 batch-join fix, `ownsRecord` did `[1].includes("1")` → false, and every non-admin got 403 on document upload/delete in prod for 3 days. `ownsRecord` now coerces and the query casts; keep both when touching this path.
- **`PROGRAM_IDS` is hand-maintained** in `constants.ts` (transitional debt) — add a program id here when a non-JNV centre is onboarded.
- Import `PROGRAM_IDS` from `@/lib/constants`, not `@/lib/permissions`, in client components — `permissions.ts` pulls in the server-only DB pool.
