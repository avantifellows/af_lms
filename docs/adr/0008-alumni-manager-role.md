# Alumni Manager role: alumni are not Students

Alumni get a dedicated LMS role, Alumni Manager (`alumni_manager`), and a dedicated feature, `alumni`. Alumni are not Students: an alumnus is identified by `alumni.id` (and, once added, `alumni.user_id`), never by `student.id`, and is reached through the School they passed out from with `canAccessAlumni`, never through `canAccessStudent` or the `students` feature.

The role is denied by default everywhere else. `getUserPermission` (and so `getResolvedPermission`, `canAccessSchool`, `canAccessStudent`, `isAdmin` and every route guard built on them) resolves an alumni role to no permission at all. Only alumni code reads it, through `getAlumniPermission`. A new LMS surface therefore can't leak Student data to an alumni caller by forgetting a role check.

## Considered Options

- **Reuse `admin` or `program_admin` with `read_only`.** Rejected: both reach every Student and most features.
- **Add the role to the matrix only.** Rejected: School and Student gates decide on level and scope, not the matrix, so a level-3 alumni row would still open School rosters.
- **Fence the role inside each existing gate, as for PMU roles (ADR 0007).** Rejected: PMU roles need Student access narrowed; alumni need none, so one deny point in `getUserPermission` is simpler and fails closed.

## Consequences

- Scope reuses level 1/2/3 with School codes or regions. Centre seats never widen it (`resolveScope` skips seats, as for PMU roles).
- `read_only` turns `alumni` edit into view, so saving is refused.
- `admin` also gets `alumni` edit; every other role gets none.
- An alumni manager signing in sees the "no access to any schools" panel until the Alumni pages ship (follow-up PR).
- Staging first: the role is tested on staging before it reaches production.
