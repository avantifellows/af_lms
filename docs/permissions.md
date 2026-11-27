# Permission System

This document describes the permission system used by Avanti Fellows staff to access student data and features across different programs.

---

## Overview: Three-Layer Permission Model

Every access check involves three independent layers:

```
Layer 1: SCHOOL SCOPE — Which schools can you see?
    Determined by: level + school_codes/regions

Layer 2: FEATURE ACCESS — What can you do? (per feature: none/view/edit)
    Determined by: role → feature permission matrix (defined in code)

Layer 3: PROGRAM SCOPE — Which records can you edit?
    Determined by: program_ids (ownership of students/data)
```

Separating scope, capabilities, and ownership keeps each concern simple. A single school can have students from multiple programs (e.g., JNV Bangalore Urban has CoE, NVS, and Nodal students), so a user may **see** all students but only **edit** their program's students.

---

## Database: `user_permission` Table

| Column | Type | Purpose |
|--------|------|---------|
| `email` | varchar(255) | User identifier |
| `role` | varchar(50) | `teacher`, `program_manager`, `program_admin`, `holistic_mentorship_admin`, `admin`, `pmu_manager`, `pmu_govt_school_user`, `blended_mentor`, `blended_admin`, or `alumni_manager` |
| `level` | integer | 1=specific schools, 2=region, 3=all schools |
| `school_codes` | text[] | Specific school codes (level 1) |
| `regions` | text[] | Region names (level 2) |
| `program_ids` | integer[] | Which programs the user is assigned to |
| `read_only` | boolean | Global read-only flag (downgrades edit → view) |

---

## Layer 1: School Scope

The `level` + `school_codes`/`regions` columns determine which schools appear in a user's dashboard.

| Level | Scope | Example |
|-------|-------|---------|
| 3 | All schools | CoE program admin who needs to see all CoE schools |
| 2 | Region | SPM assigned to Pune region |
| 1 | Specific schools | Teacher at JNV Bhavnagar |

---

## Layer 2: Feature Permission Matrix

All role-feature mappings are defined in a single constant in `src/lib/permissions.ts`:

```typescript
const FEATURE_PERMISSIONS: Record<Feature, Record<UserRole, FeatureAccess>> = {
  students:      { teacher: "edit",  program_manager: "edit",  program_admin: "edit",  admin: "edit" },
  visits:        { teacher: "none",  program_manager: "edit",  program_admin: "view",  admin: "edit" },
  curriculum:    { teacher: "edit",  program_manager: "view",  program_admin: "edit",  admin: "edit" },
  mentorship:    { teacher: "edit",  program_manager: "view",  program_admin: "edit",  admin: "edit" },
  performance:   { teacher: "view",  program_manager: "view",  program_admin: "view",  admin: "view" },
  summary_stats: { teacher: "none",  program_manager: "view",  program_admin: "view",  admin: "view" },
  pm_dashboard:  { teacher: "none",  program_manager: "view",  program_admin: "view",  admin: "view" },
  test_attendance: { teacher: "none", program_manager: "none", program_admin: "none", admin: "view" },
  exam_passwords:  { teacher: "view", program_manager: "view", program_admin: "view", admin: "view" },
  ai_test_insights: { teacher: "edit", program_manager: "view", program_admin: "view", admin: "view" },
};
```

The function `getFeatureAccess(permission, feature)` resolves access by:
1. Looking up the base access from the matrix
2. Applying NVS gating (see below)
3. Applying `read_only` downgrade (`edit` → `view`)

It returns `{ access, canView, canEdit }`.

### NVS-Gated Features

Certain features are restricted to users who have CoE or Nodal program access. Users with only NVS programs get `"none"` for these features regardless of role:

- visits
- curriculum
- mentorship
- pm_dashboard
- summary_stats
- ai_test_insights

### The Matrix Lives in Code, Not the Database

The matrix defines **what each role means** — it's application logic, not per-user data. Changes are reviewed in PRs and type-checked by TypeScript. Adding a new feature is one line in the matrix.

---

## Layer 3: Program Scope (Per-Record Edit Control)

The function `ownsRecord(permission, programId)` checks whether a user can edit a specific record based on their `program_ids`.

Rules:
- **Admins** own all records
- **Unassigned records** (null `program_id`) are editable by anyone with feature-level edit access
- **Everyone else** can only edit records whose `program_id` is in their `program_ids`

This means all students at a school are **visible** to any user with school access, but the edit button only appears on rows the user owns.

### How Students Connect to Programs

```
student (user)
  → group_user (membership)
    → group (type='batch', child_id=batch.id)
      → batch (program_id)
        → program (id, name)
```

The school page query fetches `program_id` per student via a LATERAL join.

---

## Roles

| Role | `program_ids` required? | Typical use |
|------|------------------------|-------------|
| `admin` | No (bypasses all checks) | Tech admins with full access |
| `program_admin` | Yes | Scoped admin for a specific program (e.g., CoE lead) |
| `program_manager` | Yes | PMs who do school visits, view curriculum |
| `teacher` | Yes | School-level users who edit curriculum/mentorship |
| `pmu_manager` | No (pinned to JNV NVS) | Avanti's internal PMU team, working with JNV NVS Students across Schools |
| `pmu_govt_school_user` | No (pinned to JNV NVS) | External stakeholder of one JNV NVS School (e.g. its principal), Google sign-in |
| `blended_mentor` | No (stored as `[]`) | Blended Learning Mentor: sees and logs Conversations with only their own Mentees |
| `blended_admin` | No (stored as `[]`) | Blended Learning Admin: every Mentor's Mentees, Mentor Flags, Call Recordings and transcripts; never logs; manages Resources and Common Action Items unless read-only |
| `alumni_manager` | No (stored as `{}`; alumni are reached by School) | Alumni team: views and updates alumni of their Schools, nothing else |

### PMU roles (JNV NVS pinned, ADR 0007)

`pmu_manager` and `pmu_govt_school_user` are pinned to JNV NVS at every level.
`PMU_ROLES`, `isPmuRole(role)` and `PMU_PROGRAM_ID` (= `PROGRAM_IDS.NVS`) live in the
client-safe `src/lib/constants.ts`.

- **Matrix:** explicit columns — `students: "edit"`, `performance: "view"`, `test_attendance: "view"`, every other feature `"none"` at every level. `read_only` downgrades `students` to view; `test_attendance` has no edit level, so it stays view.
- **Test Attendance (#517):** both PMU roles, and `admin`, can view the Test Attendance tab on a JNV NVS School page (a School page, never a Centre page, of a JNV School with at least one listed NVS Student in Grade 11 or 12). It is view only: the tab shows attendance and lets them download its lists (built in the browser from what the tab loaded; there is no separate export route), and nothing on it edits data. `GET /api/school/[udise]/test-attendance` checks School scope and the `test_attendance` feature, then refuses any non-JNV School for every role. Every other role is `none`. Full detail: `.mex/context/permissions.md`.
- **Program context:** `getProgramContextSync` returns `{ hasAccess: true, programIds: [64], isNVSOnly: true, hasCoEOrNodal: false }` before any admin, seat or `program_ids` logic. CoE/Nodal ids, level 3 and seats never widen it.
- **Scope:** `resolveScope` skips the centre-seat lookup. Level 3 → `{ schools: "all", centres: ∅, programs: ∅ }`; levels 1/2 keep explicit codes and lazy regions only. `isCentreSeated`, `getCentreConfinement` and `canAccessCentreSync` are false, and `canViewCentre` denies outright (no School fallback).
- **Ownership:** `ownsRecord` is true only for program 64; a null (unassigned) program is false.
- **Students:** `canAccessStudent` (view and `requireEdit`, so Student documents too) also requires any current JNV NVS batch enrollment — not the single `LIMIT 1` program from `getStudentSchool`. The shared SQL fragment is `hasCurrentNvsBatchSql(userIdColumn)` in `src/lib/permissions.ts`.
- **Admin user management:** Admin Users `POST`/`PATCH` validate the effective row (for `PATCH`, the stored row with the body merged over it) and always store `program_ids = [64]`:
  - `pmu_govt_school_user` — level 1, exactly one JNV School code, no regions.
  - `pmu_manager` — level 1: at least one code, all JNV Schools; level 2: at least one region, each with a JNV School; level 3: null codes and regions.
  - Any other shape returns 400 `{ error }`. A target with an active centre seat returns 409 — remove their centre assignments in Staff Management first.
  - The Admin modal replaces the Programs checkboxes with a read-only "JNV NVS" note; Govt School Users get a single-School picker and no level selector.

### Blended Learning roles (deny by default, #441)

`blended_mentor` and `blended_admin` reach only `/blended-learning`; every other
page and API denies them (`getUserPermission` returns `null` for them).

- **Matrix:** feature `blended_learning` is `edit` for `blended_mentor`, `blended_admin`
  and `admin`, `none` for every other role; every other feature is `none` for both
  Blended roles. `read_only` downgrades `blended_learning` to view.
- **Row shape:** stored at level 1 with `school_codes` and `regions` `NULL` and
  `program_ids = []`, whatever the request says. A user with a centre seat can't
  be given a Blended role (409).
- **Policy:** `src/lib/blended-learning-access.ts` (`getBlendedLearningAccess`,
  `canBlendedLearning`, `canAccessBlendedStudent`). An LMS `admin` acts as a
  Blended Learning Admin. Only a Mentor who is not read-only logs, uploads or
  manages drafts; a Blended Learning Admin never does. The Manage page
  (`manage`: Resources and Common Action Items) is for Blended Learning Admins
  who are not read-only; Mentors and read-only admins get no tab and 403.
  Playing Call Recordings and reading transcripts and the Mentors tab are for
  Blended Learning Admins only (read-only ones included). The Flags feed shows an
  admin every flag and a Mentor only the flags on their own Students. A Student is
  in scope only with an active current-year Mapping (for a Mentor, to them):
  one whose period (`started_at` up to, not including, `ended_at`) contains
  now. A Mapping the import sheet dates in the future grants nothing until it
  starts, and on a reassignment ended at the new Mapping's future start the
  old Mentor keeps the Student until then. Supervisions work the same way.
- Full detail: `.mex/context/permissions.md` ("Blended Learning roles").

### Alumni Manager (alumni only, ADR 0008)

`alumni_manager` reaches alumni records and nothing else. `ALUMNI_MANAGER_ROLE` and
`isAlumniRole(role)` live in `src/lib/constants.ts`.

- **Matrix:** feature `alumni` is `edit` for `admin` and `alumni_manager`, `none` for every other role; `alumni_manager` is `none` on every other feature. `read_only` downgrades `alumni` to view.
- **Denied by default:** `getUserPermission` returns null for this role, so `getResolvedPermission`, `canAccessSchool`, `canAccessStudent`, `isAdmin` and every guard built on them deny it. Alumni code reads the row through `getAlumniPermission` and gates single alumni with `canAccessAlumni`.
- **Scope:** level 1/2/3 with School codes or regions, like other roles. Centre seats never widen it, and seating one is refused (409) in Staff Management and Admin → Users.
- **Programs:** none. Admin Users `POST`/`PATCH` don't require `program_ids` for this role and always store `{}`; moving a user off the role needs `program_ids` again. The Admin modal hides the Programs checkboxes, and its read-only box reads "can view alumni, cannot edit them".

---

## Access Summary by Role and Program

### CoE/Nodal Users

| Feature | Teacher | Program Manager | Program Admin | Admin |
|---------|---------|----------------|---------------|-------|
| students | edit | edit | edit | edit |
| visits | none | edit | view | edit |
| curriculum | edit | view | edit | edit |
| mentorship | edit | view | edit | edit |
| performance | view | view | view | view |
| summary_stats | none | view | view | view |
| pm_dashboard | none | view | view | view |
| exam_passwords | view | view | view | view |
| test_attendance | none | none | none | view |
| ai_test_insights | edit | view | view | view |

`test_attendance` is `view` only for `admin` here; the PMU roles (`pmu_manager`, `pmu_govt_school_user`) are the others who get it (see "PMU roles" above).

`exam_passwords` is the right to reveal a Student's decrypted exam-portal password on the
Edit Student Exams tab. It sits on top of the tab's own gate (edit rights on the Student,
school-scoped, never a JNV NVS Student), so a teacher sees their schools' Students and a PM
their assigned schools'. Every reveal is logged to `lms_exam_password_reveals`. Every other
role is `none`.

### AI Test Insights (#550, physical centres only)

`ai_test_insights` is `edit` for Teacher (only a Teacher generates a Test Insight; a
`read_only` Teacher gets `view`), `view` for Program Manager, Program Admin and Admin, and
`none` for every other role (both PMU roles, the Holistic Mentorship admin, the Blended
Learning roles and the Alumni Manager). It is NVS-gated, so a user with only JNV NVS gets
`none`.

- **Tab:** "AI Test Insights", right after Teacher Feedback, on a Centre page whose centre has
  a physical-centre Program (every Program but JNV NVS), or a School page whose School has at
  least one such active centre. A School with no active centre never shows it, for any role.
  The tab loads its own list; the roster page runs no AI Test Insights query.
- **List route:** `GET /api/school/[udise]/ai-test-insights` (optional `centre_id`) refuses,
  before any Student read: 401 no session, 404 School not found, 403 no School access, 403 no
  `ai_test_insights` view, 403 no physical-centre scope for this user.
- **List scope** (`src/lib/ai-test-insights-access.ts`, the only place that decides it): Admin
  gets every active physical centre of the School; a centre-seated user only their seat centres
  and is refused on the School route without a centre; other users the School's active physical
  centres whose Program is in their program context. A named centre must be one of those, at that
  School, and pass `canViewCentre`.
- **Student page** `/ai-test-insights/students/[studentId]` (#557), opened from the tab's Open
  link: **Student access** (same module) refuses 401 no session (the page sends you to sign in),
  422 bad id, 403 no `ai_test_insights` view, and 404 when the Student is missing, not listed, or
  listed only by centres the user may not list; a write also answers 403 when access is not `edit`,
  before the 404 check. The page shows every refusal as the same not-found page. A user who may
  list a centre may open every listed Student of it (no mentor-mentee mapping).
- **Test picker route** `GET /api/ai-test-insights/students/[studentId]/tests` (#559) runs the
  same Student access, in the same order, before any warehouse read. Every viewer may read it; a
  viewer (Program Manager, Program Admin, Admin, `read_only` Teacher) sees the picker read-only and
  only a Teacher with `edit` can tick tests.
- **Generate route** `POST /api/ai-test-insights/students/[studentId]/requests` (#560) is the
  only write. Only a Teacher with `edit` access (a Teacher who is not `read_only`) whose School
  scope lets them open the Student can call it: it runs Student access as a write, so a Program
  Manager, Program Admin, Admin or `read_only` Teacher gets 403 before any Student is read, and a
  Teacher who may not open the Student gets 404. Then 422 for a bad body, and 409 when the login
  links to no User. The card hides Generate from viewers, but the route is the gate.
- **Status route** `GET /api/ai-test-insights/students/[studentId]/requests/[requestKey]` (#563)
  runs the same Student access as a read, so every viewer may call it for a Student they may open;
  a request key of another Student is 404. Its one side effect is only for a caller with `edit`:
  a poll of a `queued` request may deliver it to AI Mentorship Guide again. A viewer's poll never
  does.
- **AI Summary text route**
  `GET /api/ai-test-insights/students/[studentId]/requests/[requestKey]/summary` (#564) runs the
  same Student access as a read: every viewer may read the AI Summary of a completed request of a
  Student they may open. A request key of another Student, or a request that is not completed,
  is 404.
- **AI Summary PDF route** `GET /api/ai-test-insights/students/[studentId]/requests/[requestKey]/pdf`
  (#565) runs the same Student access, in the same order, and is a read: every viewer may download
  the PDF of a completed request of a Student they may open. A request key of another Student is 404.

### NVS-Only Users

| Feature | Teacher | Program Manager | Program Admin | Admin |
|---------|---------|----------------|---------------|-------|
| students | edit | edit | edit | edit |
| visits | none | none | none | edit |
| curriculum | none | none | none | edit |
| mentorship | none | none | none | edit |
| performance | view | view | view | view |
| summary_stats | none | none | none | view |
| pm_dashboard | none | none | none | view |
| exam_passwords | view | view | view | view |
| test_attendance | none | none | none | view |
| ai_test_insights | none | none | none | view |

NVS-only users can edit students and view performance. `exam_passwords` and `test_attendance` are not NVS-gated, so the matrix value applies (the Exams tab itself never shows a JNV NVS Student's password). Test Attendance for NVS staff comes through the PMU roles, not Teacher / Program Manager / Program Admin (ADR 0007). The other features are gated off by the NVS restriction.

---

## Visits

Visits use all three layers:

| Layer | How it applies |
|-------|---------------|
| **School scope** | Which schools' visits you can see |
| **Feature matrix** | Whether your role can view/create/edit visits |
| **Ownership** | Only the PM who created a visit can update it |

Additional rules:
- Creating a visit requires `canEdit` (not just `canView`)
- Completed visits cannot be updated
- Admins can view any visit; PMs can only view their own

---

## Program IDs

| Program | ID |
|---------|----|
| CoE | 1 |
| Nodal | 2 |
| NVS | 64 |

---

## Example User Configurations

| Person | role | level | program_ids | school_codes | regions |
|--------|------|-------|-------------|--------------|---------|
| CoE Admin | `program_admin` | `3` | `{1}` | null | null |
| CoE SPM (Pune) | `program_manager` | `2` | `{1}` | null | `{Pune}` |
| CoE PM (specific) | `program_manager` | `1` | `{1}` | `{70705,14042}` | null |
| CoE Teacher | `teacher` | `1` | `{1}` | `{70705}` | null |
| NVS PM (Jaipur) | `program_manager` | `2` | `{64}` | null | `{Jaipur}` |

### What Each Experiences

**CoE Admin** (`program_admin`, `program_ids: {1}`):
- Sees all CoE schools (level 3)
- Can edit students, curriculum, mentorship for CoE students
- Can view visits across all their schools (read-only, cannot create)
- Can view summary stats and PM dashboard
- Cannot edit NVS students at shared schools

**CoE SPM** (`program_manager`, `program_ids: {1}`, `regions: {Pune}`):
- Sees all schools in Pune region
- Can edit CoE students, view curriculum/mentorship (read-only)
- Can create and edit visits, view summary stats

**CoE Teacher** (`teacher`, `program_ids: {1}`, `school_codes: {70705}`):
- Sees one school
- Can edit CoE students, curriculum, mentorship at that school
- No visits, PM dashboard, or summary stats

**NVS PM** (`program_manager`, `program_ids: {64}`, `regions: {Jaipur}`):
- Sees all schools in Jaipur region
- At a shared school: sees all students, can only edit NVS students
- Visits, curriculum, mentorship, PM dashboard, summary stats all hidden (NVS-gated)
