# Permissions Architecture Redesign

## Problem Statement

Current permissions are role-based (teacher/PM/admin) without considering program type. Different programs (NVS, CoE, Nodal) have different feature requirements:

| Program | Available Roles | Features |
|---------|-----------------|----------|
| **NVS** | PM only | Student management only. No visits, curriculum, mentorship |
| **CoE/Nodal** | PM + Teacher | Full features: visits, curriculum, mentorship, analytics |

## Proposed Solution

Add **program-based permissions** to the existing role system:
- Users are assigned to specific program IDs
- Features are gated by `(program, role)` combination
- One role per user across all their assigned programs
- **No program_ids = no access** (explicit assignment required)
- **Students filtered by program** (NVS PM only sees NVS students)
- **Super admins** can access all programs; **program admins** only their assigned programs

---

## Database Changes

### Option A: Add `program_ids` column to `user_permission` (Recommended)

```sql
ALTER TABLE user_permission
ADD COLUMN program_ids INTEGER[] DEFAULT '{}';

-- Example: PM for NVS program only
UPDATE user_permission
SET program_ids = ARRAY[64]  -- JNV NVS
WHERE email = 'nvs-pm@avantifellows.org';

-- Example: Teacher for CoE and Nodal
UPDATE user_permission
SET program_ids = ARRAY[1, 2]  -- JNV CoE, JNV Nodal
WHERE email = 'coe-teacher@avantifellows.org';
```

### Program IDs Reference
- JNV CoE = 1
- JNV Nodal = 2
- JNV NVS = 64

---

## Feature Permission Matrix

| Feature | NVS PM | CoE/Nodal PM | CoE/Nodal Teacher | Program Admin | Super Admin |
|---------|--------|--------------|-------------------|---------------|-------------|
| **Student Management** | ✅ Edit (NVS only) | ✅ Edit | ✅ Edit | ✅ Edit | ✅ All |
| **School Visits** | ❌ Hidden | ✅ View/Create | ✅ View/Create | ✅ All | ✅ All |
| **Curriculum Tracking** | ❌ Hidden | ✅ View only | ✅ Edit | ✅ Edit | ✅ All |
| **Mentorship** | ❌ Hidden | ✅ View only | ✅ Edit | ✅ Edit | ✅ All |
| **Quiz Analytics** | ✅ View (NVS only) | ✅ View | ✅ View | ✅ View | ✅ All |
| **PM Dashboard** | ✅ Access | ✅ Access | ❌ Hidden | ✅ Access | ✅ All |
| **Student Visibility** | NVS students only | Program students | Program students | Program students | All students |

---

## Code Changes

### 1. Update `src/lib/permissions.ts`

Add program types and permission functions:

```typescript
// Program type enum
export type ProgramType = 'nvs' | 'coe' | 'nodal';

// User roles - updated
export type UserRole = 'teacher' | 'program_manager' | 'program_admin' | 'super_admin';

// Program ID mapping
export const PROGRAM_IDS = {
  coe: 1,
  nodal: 2,
  nvs: 64,
} as const;

// Update UserPermission interface
export interface UserPermission {
  email: string;
  level: AccessLevel;
  role: UserRole;
  school_codes?: string[] | null;
  regions?: string[] | null;
  read_only?: boolean;
  program_ids?: number[] | null;  // NEW - required for access
}

// Role hierarchy:
// - super_admin: Access to ALL programs, all features
// - program_admin: Admin for assigned programs only
// - program_manager: PM for assigned programs
// - teacher: Teacher for assigned programs

// New permission functions
export function getUserProgramTypes(permission: UserPermission): ProgramType[] {
  // Derive program types from program_ids
}

export function canAccessFeature(
  permission: UserPermission,
  feature: 'visits' | 'curriculum' | 'mentorship' | 'students' | 'analytics'
): { visible: boolean; editable: boolean } {
  // Check based on program + role combination
}
```

### 2. Update `src/app/school/[udise]/page.tsx`

Conditionally show tabs based on user's program permissions:

```typescript
// Get user's program types
const programTypes = getUserProgramTypes(permission);
const isNVSOnly = programTypes.length === 1 && programTypes.includes('nvs');

// Build tabs array conditionally
const tabs = [
  { id: "enrollment", label: "Students", content: enrollmentContent },
];

if (!isNVSOnly) {
  if (canAccessFeature(permission, 'curriculum').visible) {
    tabs.push({ id: "curriculum", label: "Curriculum", content: curriculumContent });
  }
  // ... mentorship, visits tabs
}
```

### 3. Update PM Dashboard (`src/app/pm/page.tsx`)

- Filter schools by user's assigned programs
- Hide "Start Visit" button for NVS-only users

### 4. Deprecate Passcode Authentication

- Remove `SCHOOL_PASSCODES` from permissions.ts
- Remove passcode provider from `src/lib/auth.ts`
- Update login page to remove passcode option
- Add migration guide for existing passcode users

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/lib/permissions.ts` | Add program types, program_ids field, new permission functions |
| `src/app/school/[udise]/page.tsx` | Conditional tab rendering based on program |
| `src/app/pm/page.tsx` | Filter by program, hide visits for NVS |
| `src/app/pm/visits/page.tsx` | Block access for NVS-only users |
| `src/app/pm/school/[code]/page.tsx` | Block visit creation for NVS |
| `src/lib/auth.ts` | Remove passcode provider |
| `src/app/api/auth/[...nextauth]/route.ts` | Update auth config |

---

## Implementation Steps

### Phase 1: Database & Core Permissions
1. Add `program_ids` column to `user_permission` table
2. Update `getUserPermission()` to fetch program_ids
3. Add `PROGRAM_IDS` constants and helper functions
4. Add feature permission matrix logic

### Phase 2: School Page
1. Update school page to check program permissions
2. Conditionally render tabs (curriculum, mentorship, visits)
3. Pass program context to child components

### Phase 3: PM Features
1. Update PM dashboard to filter by user's programs
2. Block visit-related pages for NVS-only users
3. Update visit creation flow

### Phase 4: Deprecate Passcodes
1. Remove passcode authentication code
2. Update auth flow
3. Document migration path for existing users

### Phase 5: Testing & Validation
1. Test with NVS PM (should only see students)
2. Test with CoE PM (should see all, view-only for some)
3. Test with CoE Teacher (should see all, edit access)

---

## Migration Plan

1. **Add column** with default empty array (backward compatible)
2. **Populate program_ids** for existing users based on current assignments
3. **Deploy code** that uses program_ids (falls back gracefully if empty)
4. **Remove passcodes** in separate deployment after users are migrated

---

## Resolved Questions

1. **Admin access**: Super admins access all programs; program admins need explicit assignment
2. **No program_ids**: No feature access - explicit assignment required
3. **Student filtering**: Yes - users only see students in their assigned programs
