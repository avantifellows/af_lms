# Program Manager Access - Architecture Plan

This document outlines the architecture for adding Program Manager (PM) functionality to the Student Enrollment CRUD UI.

---

## Overview

Program Managers oversee a set of schools and conduct school visits. They need:
1. Access to view/edit students in their assigned schools
2. A school visit workflow to record observations, meetings, and issues

---

## Phase 1: Permission System Changes

### Current State

```sql
CREATE TABLE user_permission (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  level INTEGER CHECK (level IN (1, 2, 3, 4)),
  school_codes TEXT[],
  regions TEXT[],
  read_only BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

**Current levels:**
| Level | Access |
|-------|--------|
| 1 | Specific school codes |
| 2 | Region-based |
| 3 | All schools |
| 4 | Admin + user management |

### Proposed Change

Add a `role` column to distinguish user types:

```sql
ALTER TABLE user_permission
ADD COLUMN role VARCHAR(50) DEFAULT 'teacher';
```

**Roles:**
| Role | Description | Primary View |
|------|-------------|--------------|
| `teacher` | Current behavior - student list, edit enrollments | `/school/[code]` |
| `program_manager` | School oversight + visits | `/pm/*` |
| `admin` | Full access to both views | Both |

**Access logic:**
- `role = 'teacher'` + `school_codes = ['12345']` → Teacher at school 12345
- `role = 'program_manager'` + `school_codes = ['12345', '67890']` → PM for those schools
- `role = 'admin'` + `level = 4` → Can assign roles, access everything

### Migration SQL

```sql
-- Add role column
ALTER TABLE user_permission
ADD COLUMN role VARCHAR(50) DEFAULT 'teacher';

-- Update existing admins
UPDATE user_permission SET role = 'admin' WHERE level = 4;

-- Add index for role queries
CREATE INDEX idx_user_permission_role ON user_permission(role);
```

---

## Phase 2: School Visit Data Model (POC)

For the POC, we avoid complex schema by using a single table with JSONB:

```sql
CREATE TABLE school_visit (
  id SERIAL PRIMARY KEY,
  school_code VARCHAR(20) NOT NULL,
  pm_email VARCHAR(255) NOT NULL,
  visit_date DATE NOT NULL,
  status VARCHAR(20) DEFAULT 'in_progress', -- 'in_progress', 'completed'
  data JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_school_visit_school ON school_visit(school_code);
CREATE INDEX idx_school_visit_pm ON school_visit(pm_email);
CREATE INDEX idx_school_visit_date ON school_visit(visit_date DESC);
```

### JSONB `data` Structure

```typescript
interface SchoolVisitData {
  // Section 1: Principal Meeting
  principalMeeting: {
    syllabusStatus: string;        // Per subject/class status
    examPerformance: string;       // Chapter tests, AIETs
    programUpdates: string;        // Activities completed, upcoming events
    potentialToppers: string;      // High-performing students status
    supportRequired: string;       // From school management
    classTimingConfirmed: boolean;
    classroomAvailable: boolean;
    resourceAccess: {
      tablets: boolean;
      printers: boolean;
      smartBoards: boolean;
    };
    notes: string;
  };

  // Section 2: Leadership Meetings (VP, CBSE Teachers)
  leadershipMeetings: {
    vpMeeting: {
      attended: boolean;
      performanceDiscussed: string;
      attendancePatterns: string;
      notes: string;
    };
    teacherMeetings: Array<{
      teacherName: string;
      subject: string;
      syllabusStatus: string;
      supportNeeded: string;
      notes: string;
    }>;
  };

  // Section 3: Classroom Observations
  classroomObservations: Array<{
    teacherName: string;
    grade: '11' | '12';
    subject: string;
    // Observation criteria (1-5 rating)
    preparationRating: number;
    questionDistribution: 'all_students' | 'toppers_only' | 'mixed';
    inclusionOfGirls: number;      // 1-5
    attentionToStruggling: number; // 1-5
    studentEngagement: number;     // 1-5
    useOfAids: boolean;
    timeManagement: number;        // 1-5
    notes: string;
  }>;

  // Section 4: Student Discussions
  studentDiscussions: {
    groupDiscussions: Array<{
      grade: '11' | '12';
      topicsCovered: string[];     // exam approach, study planning, aspirations, etc.
      keyInsights: string;
      notes: string;
    }>;
    individualDiscussions: Array<{
      studentName: string;
      studentId?: number;
      grade: '11' | '12';
      category: 'topper' | 'girl_student' | 'at_risk' | 'other';
      academicPerformance: string;
      challenges: string;
      supportNeeded: string;
      actionItems: string;
      notes: string;
    }>;
  };

  // Section 5: Staff Meetings
  staffMeetings: {
    individualMeetings: Array<{
      staffName: string;
      concerns: {
        schoolManagement: string;
        peerRelationships: string;
        training: string;
        studentEngagement: string;
      };
      classroomFeedbackIntegrated: string;
      actionItems: string;
      notes: string;
    }>;
    teamMeeting: {
      commonConcerns: string;
      supportFromManagement: string;
      syllabusProgress: string;
      performanceVsProjections: {
        toppers: string;
        girlStudents: string;
      };
      nextMonthPlan: {
        syllabusCoverage: string;
        testingSchedule: string;
        revisionPlan: string;
        studentsNeedingAttention: string;
      };
      notes: string;
    };
  };

  // Section 6: Feedback & Issues
  teacherFeedback: Array<{
    teacherName: string;
    programDesignFeedback: string;
    infrastructureGaps: string;
    trainingNeeds: string;
    recurringChallenges: string;
  }>;

  issueLog: Array<{
    source: 'employee' | 'student' | 'management';
    category: 'immediate' | 'major' | 'minor' | 'escalate';
    description: string;
    owner: string;
    status: 'open' | 'in_progress' | 'resolved';
    dueDate?: string;
    notes: string;
  }>;
}
```

### Why JSONB for POC?

| Approach | Pros | Cons |
|----------|------|------|
| **JSONB (chosen)** | Fast to implement, flexible schema, easy to iterate | Less strict validation, harder to query individual fields |
| **Normalized tables** | Strong typing, easy queries, referential integrity | 8+ tables to create, slower to iterate on schema |

**Decision:** Start with JSONB. Once visit workflow stabilizes, migrate to normalized tables if needed.

---

## Phase 3: Page Structure

### New Routes

```
src/app/
├── pm/                                    # Program Manager section
│   ├── page.tsx                          # PM Dashboard
│   ├── layout.tsx                        # PM-specific layout
│   │
│   ├── school/
│   │   └── [code]/
│   │       ├── page.tsx                  # School overview + actions
│   │       └── students/
│   │           └── page.tsx              # Student list (reuse existing)
│   │
│   └── visits/
│       ├── page.tsx                      # All visits list
│       ├── new/
│       │   └── page.tsx                  # Start new visit (select school)
│       └── [id]/
│           ├── page.tsx                  # Visit overview + navigation
│           ├── principal/page.tsx        # Principal meeting form
│           ├── leadership/page.tsx       # VP & teacher meetings
│           ├── observations/page.tsx     # Classroom observations
│           ├── students/page.tsx         # Student discussions
│           ├── staff/page.tsx            # Staff meetings
│           ├── feedback/page.tsx         # Teacher feedback
│           ├── issues/page.tsx           # Issue log
│           └── summary/page.tsx          # Final summary + complete
```

### Page Descriptions

#### `/pm` - Dashboard
- Grid of assigned schools with quick stats
- Recent visits (last 5)
- Open issues count
- Quick action: "Start New Visit"

#### `/pm/school/[code]` - School Detail
- School info (name, district, region)
- Student count, enrollment stats
- Visit history for this school
- Button: "View Students" → `/pm/school/[code]/students`
- Button: "Start Visit" → Creates visit, redirects to `/pm/visits/[id]`

#### `/pm/visits/[id]` - Visit Workflow
- Progress indicator showing all 6 sections
- Each section shows completion status
- "Complete Visit" button (only enabled when all sections filled)

---

## Phase 4: Component Architecture

### Shared Components

```
src/components/
├── pm/
│   ├── PMLayout.tsx              # Layout with PM navigation
│   ├── SchoolCard.tsx            # School card for dashboard
│   ├── VisitProgress.tsx         # Progress indicator for visit sections
│   ├── VisitSection.tsx          # Wrapper for each visit section
│   │
│   └── forms/
│       ├── PrincipalMeetingForm.tsx
│       ├── LeadershipMeetingForm.tsx
│       ├── ClassroomObservationForm.tsx
│       ├── StudentDiscussionForm.tsx
│       ├── StaffMeetingForm.tsx
│       ├── TeacherFeedbackForm.tsx
│       └── IssueLogForm.tsx
```

### Form Pattern

Each form section:
1. Fetches current visit data on load
2. Auto-saves on blur/change (debounced)
3. Shows save status indicator
4. Validates required fields before allowing "Complete Visit"

```typescript
// Example form save pattern
async function saveSection(visitId: number, section: string, data: any) {
  await fetch(`/api/pm/visits/${visitId}`, {
    method: 'PATCH',
    body: JSON.stringify({ section, data })
  });
}
```

---

## Phase 5: API Routes

### New API Endpoints

```
src/app/api/pm/
├── schools/
│   └── route.ts                  # GET: List PM's schools
│
├── visits/
│   ├── route.ts                  # GET: List visits, POST: Create visit
│   └── [id]/
│       ├── route.ts              # GET: Visit detail, PATCH: Update section
│       └── complete/
│           └── route.ts          # POST: Mark visit complete
│
└── school/
    └── [code]/
        └── students/
            └── route.ts          # Reuse existing student APIs
```

### API Authentication

All `/api/pm/*` routes check:
1. User is authenticated
2. User has `role = 'program_manager'` or `role = 'admin'`
3. User has access to the requested school (via `school_codes`)

---

## Phase 6: Admin Changes

### User Management Updates

Update `/admin/users` to:
1. Display role column
2. Allow admins to set role when creating/editing users
3. Filter users by role

```typescript
// Admin can assign roles
interface UserPermissionForm {
  email: string;
  role: 'teacher' | 'program_manager' | 'admin';
  level: 1 | 2 | 3 | 4;
  school_codes: string[];
  regions: string[];
  read_only: boolean;
}
```

---

## Implementation Order

### POC Scope (Minimal Viable)

1. **Database: user_permission change**
   - Add `role` column
   - Update existing level 4 users to `role = 'admin'`

2. **Permission logic updates**
   - Add `isProgramManager()` function
   - Update routing logic to check role

3. **PM Dashboard (`/pm`)**
   - List assigned schools
   - Basic layout

4. **PM School View (`/pm/school/[code]`)**
   - School info
   - Link to students (reuse existing student list)

5. **Database: school_visit table**
   - Single table with JSONB

6. **Visit Creation & Basic Form**
   - Create visit
   - Principal meeting section (as proof of concept)

### Post-POC (Full Implementation)

7. Remaining visit sections (leadership, observations, etc.)
8. Visit completion flow
9. Admin UI for role management
10. Visit history and reporting
11. Issue tracking with status updates

---

## Routing Logic

### Updated Auth Flow

```typescript
// In middleware or page components
async function getPMRedirect(session: Session) {
  const permission = await getUserPermission(session.user.email);

  if (!permission) return '/'; // No access

  switch (permission.role) {
    case 'admin':
      return '/dashboard'; // Admin sees teacher view by default
    case 'program_manager':
      return '/pm';        // PM goes to PM dashboard
    case 'teacher':
    default:
      // Existing logic: single school redirect or dashboard
      if (permission.school_codes?.length === 1) {
        return `/school/${permission.school_codes[0]}`;
      }
      return '/dashboard';
  }
}
```

---

## Security Considerations

1. **Role verification**: Every PM route must verify `role = 'program_manager'` or `role = 'admin'`
2. **School access**: PM can only access schools in their `school_codes` array
3. **Visit ownership**: PMs can only edit their own visits (or admins can edit any)
4. **Data validation**: JSONB data should be validated against TypeScript interface before save

---

## Open Questions (Resolved)

| Question | Decision |
|----------|----------|
| PM-School assignment storage | Use existing `school_codes` array |
| PM-Teacher relationship | Implicit - teachers at PM's schools report to PM |
| Visit sections required? | All sections required to complete visit |
| Offline support? | No - online only |

---

## File Changes Summary

### New Files
- `src/app/pm/` - All PM pages (7+ files)
- `src/components/pm/` - PM components (10+ files)
- `src/app/api/pm/` - PM API routes (5+ files)

### Modified Files
- `src/lib/permissions.ts` - Add role checks
- `src/lib/db.ts` - (no change, just use existing)
- `src/app/admin/users/page.tsx` - Add role management
- `src/app/api/admin/users/route.ts` - Handle role field

### Database Changes
- `user_permission` table: Add `role` column
- New `school_visit` table with JSONB
