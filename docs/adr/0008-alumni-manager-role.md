# Alumni Manager role: alumni are not Students

Alumni get a dedicated LMS role, Alumni Manager (`alumni_manager`), and a dedicated feature, `alumni`. Alumni are not Students: an alumnus is identified by `alumni.id` (and, once added, `alumni.user_id`), never by `student.id`, and is reached through the School they passed out from with `canAccessAlumni`, never through `canAccessStudent` or the `students` feature.

The role is denied by default everywhere else. `getUserPermission` (and so `getResolvedPermission`, `canAccessSchool`, `canAccessStudent`, `isAdmin` and every route guard built on them) resolves an alumni role to no permission at all. Only alumni code reads it, through `getAlumniPermission`. A new LMS surface therefore can't leak Student data to an alumni caller by forgetting a role check.

## Considered Options

- **Reuse `admin` or `program_admin` with `read_only`.** Rejected: both reach every Student and most features.
- **Add the role to the matrix only.** Rejected: School and Student gates decide on level and scope, not the matrix, so a level-3 alumni row would still open School rosters.
- **Fence the role inside each existing gate, as for PMU roles (ADR 0007).** Rejected: PMU roles need Student access narrowed; alumni need none, so one deny point in `getUserPermission` is simpler and fails closed.

## Consequences

- Scope reuses level 1/2/3 with School codes or regions. Centre seats never widen it (`resolveScope` skips seats, as for PMU roles). Seating one is refused too, as for PMU roles: Staff Management returns 409 (`rejectIneligibleSeatUser`), and Admin → Users returns 409 (`ALUMNI_SEATED_ERROR`) when a seated person is made, or already is, an Alumni Manager. Otherwise the seat would clear their School codes and leave them with no schools.
- `read_only` turns `alumni` edit into view: saving is refused, and the form shows "View only" instead of Save.
- Alumni APIs send only the profile fields the form displays (plus the Class 12 year used by the checks), never the rest of the Student record (address, guardian, Grade 10 marks).
- `admin` also gets `alumni` edit; every other role gets none.
- An alumni manager's only pages are `/alumni` (their schools, plus "Find an alumnus" by AFID or name), `/alumni/[code]` and `/alumni/record/[alumniId]`; `/dashboard` sends them there.
- An alumnus with no School on record (most of the December 2025 bulk import) is reached only with all-schools (level 3) access, the same rule as a pass-out with no School.
- Audience: physical centres (CoE / Nodal programs), not NVS (decided 2026-10-22; can be widened later). Existing alumni records have no NVS-only alumni, and NVS has ~32k pass-outs a year, too many to track one by one. A school page shows the Alumni tab only when the school has students who were ever in an alumni program, or alumni on record (`schoolHasAlumni`), so NVS-only schools don't get an always-empty tab.
- Staging first: the role is tested on staging before it reaches production.
