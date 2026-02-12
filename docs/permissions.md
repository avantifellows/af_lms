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
| `role` | varchar(50) | `teacher`, `program_manager`, `program_admin`, or `admin` |
| `level` | integer | 1=specific schools, 2=region, 3=all schools, 4=admin |
| `school_codes` | text[] | Specific school codes (level 1) |
| `regions` | text[] | Region names (level 2) |
| `program_ids` | integer[] | Which programs the user is assigned to |
| `read_only` | boolean | Global read-only flag (downgrades edit → view) |

---

## Layer 1: School Scope

The `level` + `school_codes`/`regions` columns determine which schools appear in a user's dashboard.

| Level | Scope | Example |
|-------|-------|---------|
| 4 | Admin — all schools | Tech admin |
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

### Passcode Users

Passcode authentication grants single-school access. Passcode users get:
- `students` → edit
- Everything else → none

### The Matrix Lives in Code, Not the Database

The matrix defines **what each role means** — it's application logic, not per-user data. Changes are reviewed in PRs and type-checked by TypeScript. Adding a new feature is one line in the matrix.

---

## Layer 3: Program Scope (Per-Record Edit Control)

The function `ownsRecord(permission, programId)` checks whether a user can edit a specific record based on their `program_ids`.

Rules:
- **Admins** own all records
- **Passcode users** own all records at their school
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

NVS-only users can edit students and view performance. All other features are gated off by the NVS restriction.

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
