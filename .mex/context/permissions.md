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
last_updated: 2026-08-17
---

# Permissions

Core file: `src/lib/permissions.ts`. Client-safe constants: `src/lib/constants.ts`
(`PROGRAM_IDS`, `PROGRAM_ID_TO_LABEL`, `ACADEMIC_MENTORSHIP_PROGRAM_ALLOWLIST`).
Auth config: `src/lib/auth.ts`.

`USER_ROLES` in `src/lib/permissions.ts` is the canonical server-side role list.
Admin user create/update APIs reject unknown roles with 400 instead of silently defaulting them.

## The model — three independent axes
1. **Role** (`UserRole`): `teacher` | `program_manager` | `program_admin` | `holistic_mentorship_admin` | `admin`.
2. **School scope** (`AccessLevel`): `1` = specific `school_codes`, `2` = `regions`, `3` = all schools. (`isAdmin` is by **role**, not level.)
3. **Program eligibility** (`program_ids`): COE=1, NODAL=2, NVS=64, plus non-JNV centre programs. Some features are gated to CoE/Nodal.

A `read_only` flag downgrades any `edit` to `view`.

## Feature access — the matrix

`getFeatureAccess(permission, feature, opts?)` returns `{ access, canView, canEdit }`:

- Looks up `FEATURE_PERMISSIONS[feature][role]` (`none`/`view`/`edit`).
- **NVS gating:** features in `NVS_GATED_FEATURES` (`visits`, `curriculum`, `pm_dashboard`, `summary_stats`, `quiz_sessions`) become `none` unless the user `hasCoEOrNodal`.
- **Academic Mentorship:** is temporarily disabled for every role by setting its feature-matrix row to `none`. The existing Program allowlist, routes, APIs, mappings, and data remain in place for later restoration.
- **Holistic Mentorship:** uses the `holistic_mentorship` feature key. Teachers, Holistic Mentorship Admins, and global Admins receive base edit access; Program Managers and Program Admins receive base view access. The shared action policy then enforces the JNV CoE (`1`) and EMRS CoE (`78`) allowlist, unambiguous Program and School scope, Teacher-seat eligibility, and Mapping ownership. Scoped managers may read program progress, Assignment Coverage, and eligible mapped or unassigned Student/Phase detail only when their resolved School/region/Centre-seat scope intersects an assigned supported Program. Their detail view exposes Profile, active Phase Guidance, and submitted Notes without draft metadata or mutation affordances; Mapping and Notes mutations, Phase configuration, and Profile regeneration remain denied. The dedicated Admin role has no other feature access.
- **Holistic Mapping lifecycle:** Teachers must name one explicit supported Program when claiming unassigned Students or removing their own Mappings; missing, null, empty, non-integer, and unsupported Program values fail before authorization or mutation. Teacher self-removal erases only that Mentor's unsubmitted draft answers for the selected Students, Program, and Academic Year in the same transaction; drafts from another Mentor, Program, or year remain untouched. Global Admins and Holistic Mentorship Admins may assign an eligible current-year unassigned Student, atomically reassign an exact active Mapping to another eligible same-School/Program Mentor, or remove an exact active Mapping after explicit confirmation and a required audit reason of at most 500 characters; `read_only` denies all three actions. A claim, Admin assignment, or stale Admin reassignment/removal returns the current Mapping ownership without changing it. After a successful Admin reassignment, the School Assignment Coverage client refreshes canonical roster ownership and keeps Mapping controls disabled until the replacement Mapping ID arrives. Admin reassignment and removal end the Mapping and erase only the outgoing Mentor's unsubmitted draft answers for that Student, Program, and Academic Year in the same transaction, while submitted Notes and unrelated drafts remain history. Admin reassignment/removal write content-free audits, and reassignment also creates the replacement Mapping in its transaction. Mapping starts, ends, and draft-erasure audits store the same normalized authenticated email and reason and use the canonical User ID only when one exists. Teacher exit, LMS access revoke, relevant app/seat-role changes, and seat loss end affected active Mappings and erase unsubmitted draft answers in the same LMS transaction; another eligible seat at the same School/Program preserves access. Canonical User hard deletion is blocked by the Holistic schema's restrictive history foreign keys; removing `user_permission` is a revoke, not a hard delete.
- **Holistic Notes authorship:** only the current Mentor may draft or Submit; submitted Notes are correctable only by their author while that author remains the current Mentor. Draft content and draft-existence metadata (state, revision, timestamp, and answer count) are returned only to the authoring current Mentor, including when the read-only override removes edit access. Every other viewer derives progress as though the draft does not exist: normally Pending, while an otherwise Skipped Phase remains Skipped, until submission creates Completed. Replacement Mentors can read submitted history and receive an editable blank form with a public revision token of `0` after an unsubmitted draft is erased.
- **Holistic privacy erasure:** the LMS privacy-deletion endpoint and shared action policy deny every role, including global Admin, and passcode users. Existing immutable tombstones remain enforced by Profile regeneration, Notes writes, Historical imports, and the read-side erased-content notice; erasure is owned by the coordinated external process.
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
- **Holistic Mentorship list scope:** pass the resolved permission returned by the access helper into progress/options/year/CSV, coverage-School listing, and assignment-coverage domain reads. Those reads use `buildHolisticSchoolScopePredicate` from `src/lib/holistic-scope.ts`; Admin and Holistic Mentorship Admin remain program-wide, while explicit School, region, and Centre-seat-derived scopes produce parameterized, fail-closed SQL predicates. Current-year reconciliation triggered by a progress read consumes that same resolved permission before ending stale Mappings or erasing drafts, so scoped managers cannot cause writes outside their School scope. The coverage-School list comes from active Centres in the selected supported Program rather than Mapping history, so the dedicated Admin workspace can link to Assignment Coverage for Schools with zero active Mappings. Program Manager and Program Admin navigation and workspace entry both derive from the helper's non-empty supported-Program result; do not add a separate role-only UI gate.
- **Holistic Student and configuration reads:** `program_read` is only the program-workspace/list gate; it does not authorize an arbitrary Student or configuration resource. Profile-status reads use `mapped_student_read` with the exact Student, School, Program, and Academic Year, and scoped manager access verifies the Student belongs to that School context. Once authorized, current-year Profile and regeneration-status queries accept an eligible Centre-roster Student without requiring an active Mapping, while earlier years still require Mapping history for the selected Program and year. Student/Phase drill-down links preserve their Students & Progress or School Assignment Coverage origin through Phase changes and locked-Phase redirects; School return links retain the explicit Program and expose an Assignment Coverage-specific accessible label. Phase Plan reads use the Admin-only `phase_configuration_read` action; `phase_configure` remains the mutation gate. The `read_only` override preserves Phase Setup visibility for global Admin and Holistic Mentorship Admin accounts while removing Phase Plan mutation affordances; Program Manager and Program Admin workspaces do not expose Phase Setup.
- **Holistic Mentorship tutorial:** `/holistic-mentorship/tutorial` uses `program_read` for the Admin guide. Teacher links add `school_code`, and the same route uses `roster_view` for that School before showing the Teacher guide. Program Managers, Program Admins, passcode users, and unsupported Teacher School access remain blocked.
- **School page Academic Mentorship tab:** visibility comes from `academic_mentorship` feature access, so it is hidden while that feature is disabled. Its prior role-based views remain implemented behind the gate.
- **Visit routes:** use `src/lib/visits-policy.ts` instead — `requireVisitsAccess(session, "view"|"edit")` then `enforceVisit*`. See `context/visits.md`.
- **List queries:** scope at the SQL level with `getAccessibleSchoolCodes(email)` (returns `"all"` or `string[]`) or, for visits, `buildVisitScopePredicate(actor)`.

## Gotchas

- **`getUserPermission` for a school decision = bug.** Seats are absent, so a seated-but-no-explicit-codes user is wrongly denied. Use `getResolvedPermission`.
- **Raw `program_ids` for program filtering = bug.** Use `getProgramContextSync(permission).programIds` so centre-seat-derived programs are included. Otherwise a seated manager can access a school but see empty curriculum/program data for the wrong program.
- **`program_read` for a Student or configuration resource = bug.** It proves only that the actor has some supported-Program workspace scope. Bind Student reads to the exact Student/School/Program/year action, and use the dedicated Admin-only configuration read action for Phase Setup.
- **Scoping after Mapping selection = bug.** Holistic progress and filter-option queries must apply the resolved School predicate before computing first-start windows or choosing the latest yearly Mapping. Otherwise a later out-of-scope School transfer can suppress valid in-scope history or alter derived progress and exports.
- **Unscoped reconciliation before a scoped read = bug.** A current-year progress read may end stale Mappings and erase drafts before selecting rows. Pass its resolved permission into reconciliation so the write candidate set uses the same School predicate as the read result.
- **`requireEdit` matters on writes.** `canAccessStudent(session, id, { requireEdit: true })` for upload/delete — without it a `read_only` user could mutate via direct API call even though the UI hides the button. It also enforces per-program ownership in mixed schools.
- **Passcode users** must be handled explicitly (`session.isPasscodeUser`) — they're blocked from visits and all non-`students` features; the gate checks `session.schoolCode` against the target school.
- **`revoked_at`** is the single "exited" switch — a revoked user resolves to no permission everywhere.
- **Postgres `bigint` columns arrive as JS strings** (no `setTypeParser` in `db.ts`). Any numeric comparison against them must cast in SQL (`::int`) or coerce (`Number()`). This bit for real in Jul 2026: `getStudentSchool` started resolving `batch.program_id` (bigint) after the #162 batch-join fix, `ownsRecord` did `[1].includes("1")` → false, and every non-admin got 403 on document upload/delete in prod for 3 days. `ownsRecord` now coerces and the query casts; keep both when touching this path.
- **`PROGRAM_IDS` is hand-maintained** in `constants.ts` (transitional debt) — add a program id here when a non-JNV centre is onboarded.
- Import `PROGRAM_IDS` from `@/lib/constants`, not `@/lib/permissions`, in client components — `permissions.ts` pulls in the server-only DB pool.
