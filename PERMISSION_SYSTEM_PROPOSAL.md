# Permission System Proposal

This document explains the proposed permission system for Avanti Fellows staff to access student data and features across different programs.

---

## Current State

### What Exists in the Database

The `user_permission` table already has all the columns we need:

| Column | Type | Purpose |
|--------|------|---------|
| `email` | varchar(255) | User identifier |
| `role` | varchar(50) | `teacher`, `program_manager`, or `admin` |
| `level` | integer | 1=specific schools, 2=region, 3=all schools, 4=admin |
| `school_codes` | text[] | Specific school codes (level 1) |
| `regions` | text[] | Region names (level 2) |
| `program_ids` | integer[] | Which programs the user is assigned to |
| `read_only` | boolean | Global read-only flag |

### What Exists in Code

`src/lib/permissions.ts` has:
- Role and level checks for school access
- Program context detection (NVS-only vs CoE/Nodal)
- Feature gating (visits/curriculum/mentorship hidden for NVS-only users)
- Individual functions per feature: `canEditCurriculum()`, `canAccessPMFeatures()`, `canAccessFeature()`, etc.

### What's Missing

1. **No `program_admin` role** — admin is global (sees everything), no scoped admin for a single program
2. **No per-record edit control** — `canEdit` is a single boolean for the whole page. An NVS PM sees all students at a school but should only edit NVS students, not CoE students.
3. **No feature permission matrix** — each feature has its own bespoke function with hardcoded role checks, making it hard to reason about what a role can do across all features
4. **No summary stats feature** — no dashboards with aggregate statistics

---

## Proposed Solution: Three-Layer Permission Model

Every access check involves three independent questions:

```
Layer 1: SCHOOL SCOPE — Which schools can you see?
    Answered by: level + school_codes/regions

Layer 2: FEATURE ACCESS — What can you do? (per feature: none/view/edit)
    Answered by: role → feature permission matrix (defined in code)

Layer 3: PROGRAM SCOPE — Which records can you edit?
    Answered by: program_ids (determines ownership of students/data)
```

### Why Three Layers?

Previously we tried to handle everything with role + program checks in individual functions. This breaks down when:
- A school has students from multiple programs (e.g., JNV Bangalore Urban has 286 Dakshana CoE, 117 NVS, 74 Nodal students)
- A user should **see** all students but only **edit** their program's students
- Different features need different read/write rules per role

Separating scope, capabilities, and ownership makes each concern simple on its own.

---

## Layer 1: School Scope (no changes needed)

This already works. The `level` + `school_codes`/`regions` system determines which schools appear in a user's dashboard.

| Level | Scope | Example |
|-------|-------|---------|
| 4 | Admin — all schools | Tech admin |
| 3 | All schools | CoE program admin who needs to see all CoE schools |
| 2 | Region | SPM assigned to Pune region |
| 1 | Specific schools | Teacher at JNV Bhavnagar |

---

## Layer 2: Feature Permission Matrix (new)

### The Problem with Current Approach

Each feature has its own function with hardcoded logic scattered across `permissions.ts`:

```typescript
// Current: one function per feature, logic scattered everywhere
canEditCurriculum()    // checks role === "teacher" && hasCoEOrNodal
canAccessPMFeatures()  // checks role === "program_manager" && hasCoEOrNodal
canAccessFeature()     // switch statement over feature names
canEditStudents()      // checks !read_only
```

Adding a new LMS feature means writing yet another bespoke function. It's hard to answer "what can a teacher do?" without reading 10 functions.

### The Proposed Approach: Matrix as Data

Define the entire role-feature mapping in one place as a constant in code:

```typescript
// src/lib/permissions.ts

type FeatureAccess = "none" | "view" | "edit";

const FEATURE_PERMISSIONS: Record<string, Record<UserRole, FeatureAccess>> = {
  students:        { teacher: "edit",  program_manager: "edit",  program_admin: "edit",  admin: "edit" },
  visits:          { teacher: "edit",  program_manager: "edit",  program_admin: "edit",  admin: "edit" },
  curriculum:      { teacher: "edit",  program_manager: "view",  program_admin: "edit",  admin: "edit" },
  mentorship:      { teacher: "edit",  program_manager: "view",  program_admin: "edit",  admin: "edit" },
  summary_stats:   { teacher: "none",  program_manager: "view",  program_admin: "view",  admin: "view" },
  pm_dashboard:    { teacher: "none",  program_manager: "view",  program_admin: "view",  admin: "view" },
  // Future LMS features — just add rows:
  lesson_plans:    { teacher: "edit",  program_manager: "view",  program_admin: "edit",  admin: "edit" },
  assessments:     { teacher: "edit",  program_manager: "view",  program_admin: "view",  admin: "edit" },
  attendance:      { teacher: "edit",  program_manager: "view",  program_admin: "view",  admin: "edit" },
  student_reports: { teacher: "view",  program_manager: "view",  program_admin: "view",  admin: "view" },
};
```

One function resolves everything:

```typescript
function getFeatureAccess(permission: UserPermission, feature: string): FeatureAccess {
  // Admin bypasses matrix
  if (permission.role === "admin") return "edit";

  const matrix = FEATURE_PERMISSIONS[feature];
  if (!matrix) return "none";

  let access = matrix[permission.role] ?? "none";

  // Program gating: NVS-only users can't see CoE-specific features
  const context = getProgramContextSync(permission);
  if (!context.hasCoEOrNodal && ["visits", "curriculum", "mentorship"].includes(feature)) {
    access = "none";
  }

  // read_only flag downgrades edit → view
  if (access === "edit" && permission.read_only) access = "view";

  return access;
}
```

### Why the Matrix Lives in Code, Not the Database

The matrix defines **what each role means**. It's application logic, not per-user data. It belongs in code because:
- It's the same for every user with a given role
- Changes are reviewed in PRs and type-checked by TypeScript
- Adding a feature is one line, not a migration

If non-developers ever need to change it without a deploy, we can move it to a `program_feature_permission` table later.

### How a Page Uses It

```typescript
const access = getFeatureAccess(permission, "curriculum");

if (access === "none") {
  // Don't show the tab
} else if (access === "view") {
  <CurriculumTab readOnly={true} />
} else {
  <CurriculumTab readOnly={false} />
}
```

---

## Layer 3: Program Scope — Per-Record Edit Control (new)

### The Problem

A single school can have students from multiple programs. Real example from our database:

**JNV Bangalore Urban (code 49060)**:
| Program | Students |
|---------|----------|
| Dakshana CoE | 286 |
| JNV NVS | 117 |
| JNV Foundation Enable | 84 |
| JNV Foundation Bridge | 77 |
| JNV Nodal | 74 |

An NVS PM visiting this school should **see all students** (for context) but only **edit NVS students**.

### The Solution: `program_ids` as an Ownership Filter

The data path already exists: `student → group_user → group(type='batch') → batch.program_id → program`.

Each student row already includes `program_id` (fetched via LATERAL join in the current query). The permission check becomes per-row:

```typescript
// Helper function
function ownsRecord(permission: UserPermission, programId: number | null): boolean {
  if (permission.role === "admin") return true;
  if (!programId || !permission.program_ids?.length) return false;
  return permission.program_ids.includes(programId);
}
```

Used together with the feature matrix:

```typescript
// In StudentTable component, per row:
const featureAccess = getFeatureAccess(permission, "students");        // Can this role edit students at all?
const isOwned = ownsRecord(permission, student.program_id);            // Does this user own this student?
const canEditThisStudent = featureAccess === "edit" && isOwned;        // Both must be true
```

### What Changes in the School Page

Currently `canEdit` is a single boolean passed to `StudentTable`:

```typescript
// Current
<StudentTable students={activeStudents} canEdit={canEdit} />
```

Becomes:

```typescript
// Proposed: pass permission context, let the table decide per-row
<StudentTable
  students={activeStudents}       // ALL students at the school (no filtering)
  featureAccess={getFeatureAccess(permission, "students")}
  userProgramIds={permission.program_ids}
  isAdmin={permission.role === "admin"}
/>
```

The `StudentTable` component shows edit buttons only on rows where `ownsRecord()` is true.

### Visibility vs Editability

| Concern | Rule |
|---------|------|
| **Which students do you see?** | ALL students at your school (no program filtering on visibility) |
| **Which students can you edit?** | Only students in your `program_ids` |

This replaces the current `getStudentProgramFilter()` which hides students entirely. Seeing all students provides context (e.g., an NVS PM can see the full school roster) while ownership controls prevent accidental edits.

---

## Roles

### Current Roles
- `teacher` — school-level user, can edit curriculum/mentorship
- `program_manager` — PM, can do visits, view curriculum
- `admin` — global super admin, access to everything

### New Role: `program_admin`

A scoped admin for a specific program. Has elevated access like admin but only for their assigned programs.

| Role | `program_ids` matters? | School scope | Feature access |
|------|----------------------|--------------|----------------|
| `admin` | No (sees everything) | All schools | All features, edit all |
| `program_admin` | Yes | Per level/regions/school_codes | All features for their programs |
| `program_manager` | Yes | Per level/regions/school_codes | Students: edit, curriculum/mentorship: view |
| `teacher` | Yes | Per level/school_codes | Students/curriculum/mentorship: edit, no PM dashboard |

No DB schema change needed — `role` is already `varchar(50)` with no CHECK constraint.

---

## JNV CoE Use Case

### Role Mapping

| Person | role | level | program_ids | school_codes | regions |
|--------|------|-------|-------------|--------------|---------|
| CoE Admin | `program_admin` | `3` | `{1}` | null | null |
| SPM (Pune) | `program_manager` | `2` | `{1}` | null | `{Pune}` |
| PM (specific) | `program_manager` | `1` | `{1}` | `{70705,14042}` | null |
| Teacher | `teacher` | `1` | `{1}` | `{70705}` | null |
| NVS PM | `program_manager` | `2` | `{64}` | null | `{Jaipur}` |

### What Each Role Experiences

**CoE Admin** (`program_admin`, `program_ids: {1}`):
- Sees all CoE schools (level 3)
- Can edit students, curriculum, mentorship, visits for CoE students
- Can view summary stats
- Cannot edit NVS students at shared schools

**CoE SPM** (`program_manager`, `program_ids: {1}`, `regions: {Pune}`):
- Sees all schools in Pune region
- Can edit CoE students, view curriculum/mentorship (read-only)
- Can create visits, view summary stats

**CoE Teacher** (`teacher`, `program_ids: {1}`, `school_codes: {70705}`):
- Sees one school
- Can edit CoE students, curriculum, mentorship at that school
- No PM dashboard or summary stats

**NVS PM** (`program_manager`, `program_ids: {64}`, `regions: {Jaipur}`):
- Sees all schools in Jaipur region
- At a shared school: sees all students, can only edit NVS students
- Visits, curriculum, mentorship tabs hidden (NVS program doesn't use them)

---

## Database Changes Required

### Schema: None

The `user_permission` table already has `role` (varchar), `program_ids` (integer[]), `level`, `school_codes`, `regions`, and `read_only`. No ALTER needed.

### Data: Populate `program_ids` for Existing Users

Currently all users have `program_ids = {}` (empty). We need to populate them:

```sql
-- Assign CoE program to known CoE staff
UPDATE user_permission
SET program_ids = ARRAY[1], role = 'program_admin'
WHERE email = 'coe-lead@avantifellows.org';

-- Assign NVS program to NVS PMs
UPDATE user_permission
SET program_ids = ARRAY[64]
WHERE email IN ('nvs-pm1@avantifellows.org', 'nvs-pm2@avantifellows.org');
```

Admins (`role = 'admin'`) don't need `program_ids` — they bypass all checks.

---

## Code Changes Required

### 1. `src/lib/permissions.ts` — Core Changes

| Change | Details |
|--------|---------|
| Add `program_admin` to `UserRole` type | `type UserRole = "teacher" \| "program_manager" \| "program_admin" \| "admin"` |
| Add `FEATURE_PERMISSIONS` matrix | Single constant defining all role-feature mappings |
| Add `getFeatureAccess()` function | Replaces `canEditCurriculum`, `canAccessPMFeatures`, `canAccessFeature` |
| Add `ownsRecord()` function | Per-record program ownership check |
| Remove `getStudentProgramFilter()` | No longer filter visibility — all students shown, editability is per-row |
| Remove one-off feature functions | `canEditCurriculum`, `canEditStudents`, `canAccessFeature` replaced by matrix |

### 2. `src/app/school/[udise]/page.tsx` — School Page

| Change | Details |
|--------|---------|
| Remove student program filtering | Stop filtering `activeStudents` by `studentProgramFilter` |
| Use `getFeatureAccess()` for tabs | Replace `userIsAdmin` checks with matrix lookups |
| Pass program context to StudentTable | `featureAccess`, `userProgramIds`, `isAdmin` instead of single `canEdit` boolean |

### 3. `src/components/StudentTable.tsx` — Per-Row Edit Control

| Change | Details |
|--------|---------|
| Accept `userProgramIds` and `featureAccess` props | Instead of single `canEdit` boolean |
| Per-row edit check | Show edit button only when `featureAccess === "edit" && ownsRecord(...)` |
| Visual distinction | Optional: dim or badge non-owned students so user understands scope |

### 4. PM Dashboard Pages

| Change | Details |
|--------|---------|
| `src/app/pm/page.tsx` | Use `getFeatureAccess(permission, "pm_dashboard")` for access |
| Visit pages | Use `getFeatureAccess(permission, "visits")` instead of `canAccessPMFeatures()` |

---

## Implementation Phases

### Phase 1: Core Permission Logic
1. Add `program_admin` to `UserRole` type
2. Add `FEATURE_PERMISSIONS` matrix constant
3. Add `getFeatureAccess()` and `ownsRecord()` functions
4. Keep old functions temporarily (for backward compat during rollout)

### Phase 2: School Page
1. Remove student visibility filtering (show all students)
2. Replace `canEdit` boolean with per-row ownership check
3. Replace tab visibility checks with `getFeatureAccess()` calls
4. Update `StudentTable` to accept program context

### Phase 3: PM Features
1. Update PM dashboard access check to use matrix
2. Update visit pages to use matrix
3. Add `program_admin` handling in PM dashboard

### Phase 4: Deprecate Passcode Auth
1. Remove `SCHOOL_PASSCODES` from `permissions.ts`
2. Remove passcode provider from `src/lib/auth.ts`
3. Update login page to remove passcode option
4. Migrate existing passcode users to Google OAuth

### Phase 5: Cleanup
1. Remove old one-off permission functions
2. Remove `getStudentProgramFilter()`
3. Populate `program_ids` for all existing users
4. Add `program_admin` rows for CoE leads

### Phase 6: Testing
1. CoE Admin: sees all schools, edits CoE students only
2. CoE Teacher: sees one school, edits CoE students + curriculum
3. NVS PM: sees region schools, sees all students, edits NVS students only
4. NVS PM at shared school: CoE students visible but not editable
5. Admin: everything works as before

---

## Resolved Questions

1. **Visual treatment of non-owned students**: Shown identically — just no edit button. No dimming or badges.

2. **Passcode deprecation**: Yes, remove passcode auth as part of this work.

3. **Multiple CoE programs**: Start with one program per PM. The column is already `integer[]` and `ownsRecord()` uses `.includes()`, so adding a second program later is just a data update (`SET program_ids = ARRAY[1, 86]`) — no code change needed. We only handle JNV CoE (id=1) initially.

4. **Summary stats**: Deferred. The feature matrix includes it as a placeholder, but the UI doesn't exist yet and requirements are unclear. We'll define what different roles see when we build the LMS UI.

---

## Appendix: How Students Connect to Programs

Students are linked to programs through the existing group/batch system:

```
student (user)
  → group_user (membership)
    → group (type='batch', child_id=batch.id)
      → batch (program_id)
        → program (id, name)
```

The school page query already fetches `program_id` per student via a LATERAL join. No query changes needed for visibility — only the application logic for editability changes.

### Real Data Example: JNV Bangalore Urban (code 49060)

| Program | ID | Students at this school |
|---------|----|------------------------|
| Dakshana CoE | 86 | 286 |
| JNV NVS | 64 | 117 |
| JNV Foundation Enable | 54 | 84 |
| JNV Foundation Bridge | 53 | 77 |
| JNV Nodal | 2 | 74 |

No students at this school belong to multiple programs simultaneously, so the ownership check is clean — each student has exactly one `program_id`.
