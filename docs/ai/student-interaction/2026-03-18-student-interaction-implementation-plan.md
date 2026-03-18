# Plan: Student Interaction Action Types

## Context

The PM school visit system currently has 4 required action types (classroom observation, AF team interaction, individual teacher interaction, principal interaction). We're adding the 5th and 6th: **Student Interaction** (group, grade-level checklist) and **Individual Student Interaction** (per-student checklist). Both action type keys already exist in `ACTION_TYPES` (`group_student_discussion`, `individual_student_discussion`) but are unused — they currently have generic text-field configs in `ActionDetailForm.tsx` (lines 103-144).

The user confirmed:
- **Group**: PM selects a grade (11/12), 4 binary+remark questions appear
- **Individual**: PM selects grade, searches students by name, adds them, fills 2 questions per student
- **Both required** for visit completion (total 6 required types)
- **Reuse existing** action type keys

---

## Phase 1: Config & Validation Libraries

### 1a. `src/lib/group-student-discussion.ts` (NEW)

Copy pattern from `src/lib/principal-interaction.ts` (204 lines, simplest checklist). Add `grade` field.

**Interfaces** (copy from principal-interaction.ts lines 1-23, add grade):
```typescript
export interface ValidationResult { valid: boolean; errors: string[] }
export interface QuestionConfig { key: string; label: string }
export interface SectionConfig { title: string; questions: QuestionConfig[] }
export interface GroupStudentDiscussionConfig { sections: SectionConfig[]; allQuestionKeys: string[] }
export interface GroupStudentDiscussionData {
  grade: number;
  questions: Record<string, { answer: boolean | null; remark?: string }>;
}
```

**Config** — 1 section, 4 questions (from CSV row 4):
```typescript
const sections: SectionConfig[] = [
  {
    title: "General Check",  // rendered dynamically as "General Check Grade {N}" in form
    questions: [
      { key: "gc_interacted", label: "Have you interacted with the students?" },
      { key: "gc_program_updates", label: "Check on the program updates for the previous month?" },
      { key: "gc_direction", label: "Were able to provide a direction for the next month?" },
      { key: "gc_concerns", label: "Did students convey any concerns that need to be addressed?" },
    ],
  },
];
```

**Constants**:
```typescript
export const VALID_GRADES = [11, 12] as const;
export type ValidGrade = (typeof VALID_GRADES)[number];
const ALLOWED_TOP_LEVEL_KEYS = new Set(["grade", "questions"]);
```

**Validation functions** (copy `validateQuestions` from principal-interaction.ts lines 109-161, add grade validation):
- `validateGroupStudentDiscussionSave(data)` — lenient:
  - Rejects unknown top-level keys
  - If `grade` present: must be 11 or 12 (reject strings, floats, other numbers)
  - If `questions` present: `validateQuestions(questions, false)` — null answers OK
- `validateGroupStudentDiscussionComplete(data)` — strict:
  - Grade required (must be 11 or 12)
  - All 4 questions must have non-null boolean answers
  - `validateQuestions(questions, true)`

### 1b. `src/lib/group-student-discussion.test.ts` (NEW)

Copy pattern from `src/lib/principal-interaction.test.ts`. ~25 tests:
- Config integrity: 1 section, 4 questions, unique keys, key format `gc_*`
- Save validation: accepts `{}`, partial questions, valid grade, null answers, remarks; rejects unknown keys, invalid grade (10, 13, "eleven", null), non-boolean answer, non-string remark
- Complete validation: rejects empty, missing grade, missing questions, incomplete (2/4), null answers; accepts fully complete payload

### 1c. `src/lib/individual-student-discussion.ts` (NEW)

Copy pattern from `src/lib/individual-af-teacher-interaction.ts` (264 lines). **Simplified**: remove attendance gating, add `grade` per student entry.

**Types**:
```typescript
export interface IndividualStudentEntry {
  id: number;
  name: string;
  grade: number;
  questions: Record<string, { answer: boolean | null; remark?: string }>;
}
export interface IndividualStudentDiscussionData {
  students: IndividualStudentEntry[];
}
```

**Config** — 1 section, 2 questions (from CSV row 4):
```typescript
const sections: SectionConfig[] = [
  {
    title: "Operational Health",
    questions: [
      { key: "oh_teaching_concern", label: "Did any student raise a concern on teaching quality and classroom environment?" },
      { key: "oh_additional_support", label: "Did a student request for additional support?" },
    ],
  },
];
```

**Validation** (adapt from individual-af-teacher-interaction.ts `validateTeacherEntries`, remove attendance logic):
- `validateIndividualStudentDiscussionSave(data)` — lenient:
  - Rejects unknown top-level keys (`ALLOWED_TOP_LEVEL_KEYS = ["students"]`)
  - If `students` present: each entry validated leniently:
    - `id`: positive integer, no duplicates
    - `name`: non-empty string (if present)
    - `grade`: number 11 or 12 (if present)
    - `questions`: validates each known key leniently
- `validateIndividualStudentDiscussionComplete(data)` — strict:
  - `students` required, array, length >= 1 ("At least one student must be recorded")
  - Each student: `id` (positive int, unique), `name` (non-empty string), `grade` (11 or 12)
  - All 2 questions per student must have non-null boolean answers
  - **No** "all students at school must be recorded" check (unlike teachers)

### 1d. `src/lib/individual-student-discussion.test.ts` (NEW)
~25 tests. Config integrity, lenient/strict validation, duplicate IDs, grade validation, per-student question validation.

### 1e. `src/lib/student-utils.ts` (NEW)
Copy `src/lib/teacher-utils.ts` (9 lines):
```typescript
export interface Student {
  id: number;
  full_name: string | null;
  student_id: string | null;
  grade: number | null;
}
export function getStudentDisplayName(student: Student): string {
  return student.full_name?.trim() || student.student_id || `Student #${student.id}`;
}
```

### 1f. `src/lib/student-utils.test.ts` (NEW)
3 tests: full_name present, fallback to student_id, fallback to `Student #id`.

---

## Phase 2: Students API Endpoint

### 2a. `src/app/api/pm/students/route.ts` (NEW)

Copy auth pattern exactly from `src/app/api/pm/teachers/route.ts` (58 lines). Adapt query from `src/app/school/[udise]/page.tsx` lines 108-151.

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { query } from "@/lib/db";
import { apiError, canAccessVisitSchoolScope, requireVisitsAccess } from "@/lib/visits-policy";

interface StudentRow {
  id: number;
  full_name: string | null;
  student_id: string | null;
  grade: number | null;
}

// GET /api/pm/students?school_code=XXXXX&grade=11
export async function GET(request: NextRequest) {
  // 1. Auth (same as teachers route lines 16-20)
  const session = await getServerSession(authOptions);
  const access = await requireVisitsAccess(session, "view");
  if (!access.ok) return access.response;

  // 2. Parse school_code (required) + grade (optional)
  const schoolCode = request.nextUrl.searchParams.get("school_code")?.trim();
  if (!schoolCode) return apiError(400, "school_code query parameter is required");
  const gradeParam = request.nextUrl.searchParams.get("grade");
  const grade = gradeParam ? Number(gradeParam) : null;
  if (grade !== null && (!Number.isInteger(grade) || grade < 1)) {
    return apiError(400, "grade must be a positive integer");
  }

  // 3. Resolve school_code → school.id + region (teachers route does region-only)
  const schoolRows = await query<{ id: number; region: string | null }>(
    `SELECT id, region FROM school WHERE code = $1`,
    [schoolCode]
  );
  if (schoolRows.length === 0) return apiError(404, "School not found");
  const school = schoolRows[0];

  // 4. Check scope access (same as teachers route line 35)
  if (!canAccessVisitSchoolScope(access.actor, schoolCode, school.region)) {
    return apiError(403, "Forbidden");
  }

  // 5. Query students (adapted from school page getStudents lines 108-151)
  const students = await query<StudentRow>(
    `SELECT DISTINCT u.id,
            TRIM(CONCAT(u.first_name, ' ', u.last_name)) AS full_name,
            s.student_id,
            gr.number AS grade
     FROM group_user gu
     JOIN "group" g ON g.id = gu.group_id AND g.type = 'school'
     JOIN "user" u ON gu.user_id = u.id
     LEFT JOIN student s ON s.user_id = u.id
     LEFT JOIN enrollment_record er ON er.user_id = u.id
       AND er.group_type = 'grade'
       AND er.is_current = true
     LEFT JOIN grade gr ON er.group_id = gr.id
     WHERE g.child_id = $1
       AND ($2::INT IS NULL OR gr.number = $2)
       AND (s.status IS NULL OR s.status != 'dropout')
     ORDER BY gr.number NULLS LAST, full_name NULLS LAST`,
    [school.id, grade]
  );

  return NextResponse.json({ students });
}
```

**Key difference from teachers route**: Teachers query `user_permission` (flat table). Students require the join chain `group_user → group → user → student → enrollment_record → grade`, and need `school.id` (not just school_code).

### 2b. `src/app/api/pm/students/route.test.ts` (NEW)

Copy pattern from `src/app/api/pm/teachers/route.test.ts`. ~10 tests:
- 401 when not authenticated
- 403 for passcode users
- 400 when school_code missing
- 400 when grade is invalid
- 403 when user lacks school access
- 404 when school not found
- Returns students filtered by grade
- Returns all students when no grade filter
- Returns empty array when no students

---

## Phase 3: Form Components

### 3a. `src/components/visits/GroupStudentDiscussionForm.tsx` (NEW)

Copy pattern from `src/components/visits/PrincipalInteractionForm.tsx` (171 lines). Add grade dropdown at top.

**Props**: `{ data, setData, disabled }` — no `schoolCode` (no API fetch needed)

**Layout mockup**:
```
┌──────────────────────────────────────────┐
│ Grade: [-- Select Grade --  ▼]           │  ← <select> with 11, 12 options
├──────────────────────────────────────────┤
│ Answered: 2/4                            │  ← sticky progress (only after grade selected)
├──────────────────────────────────────────┤
│ ┌── General Check Grade 11 ────────────┐ │  ← section title with grade number
│ │ Have you interacted with the         │ │
│ │ students?                            │ │
│ │ ○ Yes  ○ No  [Add remark]           │ │
│ │                                      │ │
│ │ Check on the program updates...      │ │
│ │ ○ Yes  ○ No  [Add remark]           │ │
│ │ ...                                  │ │
│ └──────────────────────────────────────┘ │
└──────────────────────────────────────────┘
```

**Behavior**:
- Grade dropdown: reads `data.grade`, writes via `setData({ ...data, grade: Number(value) })`
- Questions hidden until grade is selected (or if `data` already has question answers — same gating as AF Team's teacher selection)
- Section title: `"General Check Grade {data.grade}"` (dynamic)
- Question radios/remarks: identical pattern to PrincipalInteractionForm lines 99-166
- Read-only (`disabled=true`): grade shown as text, radios disabled, no "Add remark" buttons
- `data-testid="action-renderer-group_student_discussion"`
- Radio names: `group-student-${question.key}`, test IDs: `group-student-${question.key}-yes/no`

### 3b. `src/components/visits/GroupStudentDiscussionForm.test.tsx` (NEW)

~15 tests:
- Renders grade dropdown with 11/12 options
- Questions hidden before grade selection
- Questions appear after grade selection
- Section title includes selected grade
- Answer change updates data
- Remark toggle and change
- Progress bar counts
- Disabled mode: dropdown disabled, radios disabled, no add-remark

### 3c. `src/components/visits/IndividualStudentDiscussionForm.tsx` (NEW)

Copy pattern from `src/components/visits/IndividualAFTeacherInteractionForm.tsx` (491 lines). Remove attendance, add grade filter, use student API.

**Props**: `{ data, setData, disabled, schoolCode }`

**Layout mockup**:
```
┌─────────────────────────────────────────────────┐
│ Grade: [11 ▼]   Student: [Add Student...  ▼]    │  ← grade filter + student select
├─────────────────────────────────────────────────┤
│ Students: 2                                      │  ← sticky progress
├─────────────────────────────────────────────────┤
│ ▼ Ravi Kumar                    Grade 11   1/2   │  ← accordion header
│ ┌──────────────────────────────────────────────┐ │
│ │ Operational Health                           │ │
│ │ Did any student raise a concern on teaching  │ │
│ │ quality and classroom environment?           │ │
│ │ ○ Yes  ○ No  [Add remark]                   │ │
│ │                                              │ │
│ │ Did a student request for additional         │ │
│ │ support?                                     │ │
│ │ ○ Yes  ○ No  [Add remark]                   │ │
│ │                                              │ │
│ │ [Remove Student]                             │ │
│ └──────────────────────────────────────────────┘ │
│ ▶ Priya Singh                   Grade 12   0/2   │  ← collapsed
└─────────────────────────────────────────────────┘
```

**State management**:
- `availableStudents`: fetched from `/api/pm/students?school_code=${schoolCode}&grade=${selectedGrade}`
- `selectedGrade`: local state for the filter dropdown (null initially)
- `studentsLoading`, `studentsError`: fetch states
- `expandedIds`, `revealedRemarks`: accordion/remark visibility (same as teacher form)
- `recordedStudents`: extracted from `data.students`

**Key behaviors**:
1. **Grade filter**: When grade changes → re-fetch students for that grade
2. **Student select**: `<select>` dropdown showing `getStudentDisplayName()` for remaining (not-yet-added) students. On select → add student with `{ id, name, grade: selectedGrade, questions: {} }`
3. **Accordion**: Header shows name + grade badge + progress `X/2`. Click toggles expand.
4. **Questions**: 2 binary Yes/No + remarks. Same rendering pattern as IndividualAFTeacherInteractionForm lines 351-421 but without attendance gating.
5. **Remove**: removes student from `data.students` array
6. **Read-only**: No grade filter, no add/remove, questions disabled, answers shown as text

**Key differences from IndividualAFTeacherInteractionForm**:
- No attendance field/radios/badges (lines 160-177, 331-348 removed)
- No attendance gating on questions (lines 350-351 `entry.attendance === "present"` check removed)
- No `allTeachersRecorded` check (lines 106-109, 444-450 removed)
- Grade filter dropdown at top (new)
- Re-fetch students when grade changes (teachers are fetched once on mount)
- `getStudentDisplayName()` instead of `getTeacherDisplayName()`
- 2 questions per student instead of 13
- `data-testid` prefixes: `student-section-{id}`, `student-header-{id}`, `remove-student-{id}`, `add-student-select`, `student-{id}-{key}-yes/no`

### 3d. `src/components/visits/IndividualStudentDiscussionForm.test.tsx` (NEW)

~18 tests:
- Renders grade filter dropdown
- Fetches students when grade selected
- Shows loading/error states
- Adds student from select dropdown
- Removes student
- Per-student accordion expand/collapse
- Answer and remark changes per student
- Progress bar shows student count
- Grade badge on accordion header
- Disabled mode: no add/remove, radios disabled

---

## Phase 4: Wire into Existing Files

### 4a. `src/lib/visit-actions.ts` (MODIFY)

Update display labels (lines 5-6):
```typescript
// Before:
group_student_discussion: "Group Student Discussion",
individual_student_discussion: "Individual Student Discussion",
// After:
group_student_discussion: "Student Interaction",
individual_student_discussion: "Individual Student Interaction",
```

### 4b. `src/components/visits/ActionDetailForm.tsx` (MODIFY)

**8 insertion points with exact locations:**

**(1) Imports** (after line 14):
```typescript
import GroupStudentDiscussionForm from "@/components/visits/GroupStudentDiscussionForm";
import IndividualStudentDiscussionForm from "@/components/visits/IndividualStudentDiscussionForm";
import { GROUP_STUDENT_DISCUSSION_CONFIG } from "@/lib/group-student-discussion";
import { INDIVIDUAL_STUDENT_DISCUSSION_CONFIG } from "@/lib/individual-student-discussion";
```

**(2) Constants** (after line 71, before line 72):
```typescript
const GROUP_STUDENT_DISCUSSION_ACTION_TYPE = "group_student_discussion" as const;
const INDIVIDUAL_STUDENT_DISCUSSION_ACTION_TYPE = "individual_student_discussion" as const;
```
Add both to `SAVE_BEFORE_END_TYPES` set (line 72).

**(3) ACTION_FORM_CONFIGS** (replace lines 103-144):
```typescript
group_student_discussion: {
  title: "Student Interaction Details",
  description: "Record observations from student group interaction.",
  fields: [],  // custom form component, no generic fields
},
individual_student_discussion: {
  title: "Individual Student Interaction Details",
  description: "Record individual interactions with students.",
  fields: [],  // custom form component, no generic fields
},
```

**(4) Sanitize functions** (after line 484, `bootstrapPrincipalInteractionPayload`):

`sanitizeGroupStudentDiscussionPayload(data)`:
- Copy `sanitizePrincipalInteractionPayload` (lines 452-477)
- Add grade handling: extract `data.grade` (number 11 or 12, or null)
- Questions: iterate `GROUP_STUDENT_DISCUSSION_CONFIG.allQuestionKeys` (same pattern as lines 458-474)
- Return `{ grade: validGrade, questions: {...} }`
- Default (non-object): `{ grade: null, questions: {} }`

`sanitizeIndividualStudentDiscussionPayload(data)`:
- Copy `sanitizeIndividualTeacherPayload` (lines 395-443)
- Remove attendance handling (line 415)
- Add grade per student: `grade: typeof entry.grade === "number" ? entry.grade : null`
- Questions: iterate `INDIVIDUAL_STUDENT_DISCUSSION_CONFIG.allQuestionKeys` (same pattern as lines 419-435)
- Return `{ students: [...] }`
- Default (non-object): `{ students: [] }`

**(5) Bootstrap functions** (immediately after sanitize functions):

`bootstrapGroupStudentDiscussionPayload(data)`:
- If not plain object: return `{ grade: null, questions: {} }`
- Otherwise: call `sanitizeGroupStudentDiscussionPayload(data)`

`bootstrapIndividualStudentDiscussionPayload(data)`:
- If not plain object: return `{ students: [] }`
- Otherwise: call `sanitizeIndividualStudentDiscussionPayload(data)`

**(6) normalizeFormDataForAction** (lines 486-508, add before the generic fallback at line 502):
```typescript
if (actionType === GROUP_STUDENT_DISCUSSION_ACTION_TYPE) {
  return bootstrapGroupStudentDiscussionPayload(data);
}
if (actionType === INDIVIDUAL_STUDENT_DISCUSSION_ACTION_TYPE) {
  return bootstrapIndividualStudentDiscussionPayload(data);
}
```

**(7) sanitizePatchData** (lines 510-528, add before the generic fallback at line 527):
```typescript
if (actionType === GROUP_STUDENT_DISCUSSION_ACTION_TYPE) {
  return sanitizeGroupStudentDiscussionPayload(data);
}
if (actionType === INDIVIDUAL_STUDENT_DISCUSSION_ACTION_TYPE) {
  return sanitizeIndividualStudentDiscussionPayload(data);
}
```

**(8) Form renderer** (lines 952-979, add after principal_interaction branch at line 978, before generic fallback at line 980):
```typescript
) : action.action_type === GROUP_STUDENT_DISCUSSION_ACTION_TYPE ? (
  <GroupStudentDiscussionForm
    data={formData}
    setData={setFormData}
    disabled={!canSave || isBusy}
  />
) : action.action_type === INDIVIDUAL_STUDENT_DISCUSSION_ACTION_TYPE ? (
  <IndividualStudentDiscussionForm
    data={formData}
    setData={setFormData}
    disabled={!canSave || isBusy}
    schoolCode={schoolCode}
  />
) : (
```

**End error message** (line 826-835): Add specific message for individual student:
```typescript
: action.action_type === INDIVIDUAL_STUDENT_DISCUSSION_ACTION_TYPE
  ? "Please complete all required fields and add at least one student before ending this interaction."
```

### 4c. `src/components/visits/ActionPointList.tsx` (MODIFY)

**Add after line 282** (after `getPrincipalInteractionStats`):

```typescript
export interface GroupStudentDiscussionStats {
  grade: number | null;
  answeredCount: number;
  totalQuestions: number;
}

export function getGroupStudentDiscussionStats(
  data: Record<string, unknown> | undefined
): GroupStudentDiscussionStats | null {
  if (!data || typeof data !== "object") return null;

  const grade = typeof data.grade === "number" ? data.grade : null;
  const questions = data.questions;
  let answeredCount = 0;
  if (questions && typeof questions === "object" && !Array.isArray(questions)) {
    const qr = questions as Record<string, unknown>;
    for (const key of GROUP_STUDENT_DISCUSSION_CONFIG.allQuestionKeys) {
      const v = qr[key];
      if (v && typeof v === "object" && "answer" in v) {
        if (typeof (v as { answer: unknown }).answer === "boolean") answeredCount++;
      }
    }
  }
  if (grade === null && answeredCount === 0) return null;
  return { grade, answeredCount, totalQuestions: GROUP_STUDENT_DISCUSSION_CONFIG.allQuestionKeys.length };
}

export interface IndividualStudentDiscussionStats {
  studentCount: number;
}

export function getIndividualStudentDiscussionStats(
  data: Record<string, unknown> | undefined
): IndividualStudentDiscussionStats | null {
  if (!data || typeof data !== "object") return null;
  const students = data.students;
  if (!Array.isArray(students) || students.length === 0) return null;
  return { studentCount: students.length };
}
```

**Add card rendering** (after line 593, before line 594):

For `group_student_discussion`: Show `Grade: 11` + `2/4 (50%)` (same visual pattern as principal interaction stats, lines 576-593)

For `individual_student_discussion`: Show `Students: N` (same visual pattern as individual teacher stats, lines 562-575)

### 4d. `src/components/visits/ActionTypePickerModal.tsx` (MODIFY)

**Line 47** — add to `enabled` condition:
```typescript
const enabled = actionType === "classroom_observation"
  || actionType === "af_team_interaction"
  || actionType === "individual_af_teacher_interaction"
  || actionType === "principal_interaction"
  || actionType === "group_student_discussion"
  || actionType === "individual_student_discussion";
```

### 4e. `src/app/api/pm/visits/[id]/actions/[actionId]/route.ts` (MODIFY — PATCH)

**Imports** (add at top):
```typescript
import { validateGroupStudentDiscussionSave, validateGroupStudentDiscussionComplete } from "@/lib/group-student-discussion";
import { validateIndividualStudentDiscussionSave, validateIndividualStudentDiscussionComplete } from "@/lib/individual-student-discussion";
```

**Validation blocks** (after line 229, after principal_interaction block):
```typescript
if (action.action_type === "group_student_discussion") {
  const validation = action.status === "completed"
    ? validateGroupStudentDiscussionComplete(data)
    : validateGroupStudentDiscussionSave(data);
  if (!validation.valid) {
    return apiError(422, "Invalid student interaction data", validation.errors);
  }
}

if (action.action_type === "individual_student_discussion") {
  const validation = action.status === "completed"
    ? validateIndividualStudentDiscussionComplete(data)
    : validateIndividualStudentDiscussionSave(data);
  if (!validation.valid) {
    return apiError(422, "Invalid individual student interaction data", validation.errors);
  }
}
```

### 4f. `src/app/api/pm/visits/[id]/actions/[actionId]/end/route.ts` (MODIFY — END)

**Imports** (add at top):
```typescript
import { validateGroupStudentDiscussionComplete } from "@/lib/group-student-discussion";
import { validateIndividualStudentDiscussionComplete } from "@/lib/individual-student-discussion";
```

**Validation functions** (add after `principalInteractionValidationError` at line 129):
```typescript
function groupStudentDiscussionValidationError(action: VisitActionRow) {
  if (action.action_type !== "group_student_discussion") return null;
  const validation = validateGroupStudentDiscussionComplete(action.data);
  if (validation.valid) return null;
  return apiError(422, "Invalid student interaction data", validation.errors);
}

function individualStudentDiscussionValidationError(action: VisitActionRow) {
  if (action.action_type !== "individual_student_discussion") return null;
  const validation = validateIndividualStudentDiscussionComplete(action.data);
  if (validation.valid) return null;
  return apiError(422, "Invalid individual student interaction data", validation.errors);
}
```

**Invocations** — add in TWO places:

1. After line 239 (after `principalInteractionValidationError` check, before `allTeachersRecordedError`):
```typescript
const invalidGroupStudentData = groupStudentDiscussionValidationError(existingAction);
if (invalidGroupStudentData) return invalidGroupStudentData;

const invalidIndividualStudentData = individualStudentDiscussionValidationError(existingAction);
if (invalidIndividualStudentData) return invalidIndividualStudentData;
```

2. After line 304 (concurrent fallback path, after `principalInteractionValidationError`, before `allTeachersRecordedError`):
```typescript
const invalidCurrentGroupStudentData = groupStudentDiscussionValidationError(current);
if (invalidCurrentGroupStudentData) return invalidCurrentGroupStudentData;

const invalidCurrentIndividualStudentData = individualStudentDiscussionValidationError(current);
if (invalidCurrentIndividualStudentData) return invalidCurrentIndividualStudentData;
```

**No** "all students recorded" check (unlike `allTeachersRecordedError` for teachers). Student count varies per visit.

### 4g. `src/app/api/pm/visits/[id]/complete/route.ts` (MODIFY — COMPLETE)

**Add after line 224** (after `principalInteractionActions` check, before the UPDATE query at line 226):
```typescript
const completedGroupStudentActions = await query<{ id: number }>(
  `SELECT a.id FROM lms_pm_school_visit_actions a
   WHERE a.visit_id = $1
     AND a.deleted_at IS NULL
     AND a.action_type = 'group_student_discussion'
     AND a.status = 'completed'
   LIMIT 1`,
  [id]
);
if (completedGroupStudentActions.length === 0) {
  return apiError(422,
    "At least one completed Student Interaction is required to complete visit",
    ["No completed group_student_discussion action found for this visit"]
  );
}

const completedIndividualStudentActions = await query<{ id: number }>(
  `SELECT a.id FROM lms_pm_school_visit_actions a
   WHERE a.visit_id = $1
     AND a.deleted_at IS NULL
     AND a.action_type = 'individual_student_discussion'
     AND a.status = 'completed'
   LIMIT 1`,
  [id]
);
if (completedIndividualStudentActions.length === 0) {
  return apiError(422,
    "At least one completed Individual Student Interaction is required to complete visit",
    ["No completed individual_student_discussion action found for this visit"]
  );
}
```

Visit completion now requires **6 types**: classroom_observation → af_team_interaction → individual_af_teacher_interaction → principal_interaction → group_student_discussion → individual_student_discussion (sequential short-circuit).

**Deployment note**: This is a staging-only feature — it has not shipped to production yet. There is no need for backward-compatibility handling, feature flags, or migration of in-progress visits. Any in-progress visits on staging can simply add the new action types before completing.

---

## Phase 5: Test Updates

### Modified test files:

| File | Changes |
|------|---------|
| `src/lib/visit-actions.test.ts` | Update label assertions for renamed types |
| `src/app/api/pm/visits/[id]/actions/[actionId]/route.test.ts` | +7 tests: PATCH validation for both student types (lenient accepts, strict rejects, valid complete) |
| `src/app/api/pm/visits/[id]/actions/[actionId]/end/route.test.ts` | +6 tests: END validation for both types (incomplete rejected, complete succeeds, concurrent path) |
| `src/app/api/pm/visits/[id]/complete/route.test.ts` | +3 tests: visit requires 6 types (missing group_student rejects, missing individual_student rejects, all 6 passes). Existing "all pass" and short-circuit tests also need their mock chains extended with 2 extra `.mockResolvedValueOnce()` calls for the new action type checks (7→9 total queries in the chain). |
| `src/components/visits/ActionTypePickerModal.test.tsx` | +2 tests: both student types are enabled and selectable |
| `src/components/visits/ActionPointList.test.tsx` | +8 tests: stats functions for both types + card rendering |
| `src/app/visits/[id]/actions/[actionId]/page.test.tsx` | +4 tests: form renderer dispatch for both types, sanitize/bootstrap |

---

## Phase 6: Documentation

- `CLAUDE.md` — Add "PM Visits: Student Interaction (v1)" and "PM Visits: Individual Student Interaction (v1)" sections. Update visit completion rule to mention 6 types. Add test file entries. Update test counts.
- `docs/ai/project-context.md` — Update accordingly.

---

## File Summary

| # | File | Action | Lines (est.) |
|---|------|--------|-------|
| 1 | `src/lib/group-student-discussion.ts` | NEW | ~160 |
| 2 | `src/lib/group-student-discussion.test.ts` | NEW | ~200 |
| 3 | `src/lib/individual-student-discussion.ts` | NEW | ~200 |
| 4 | `src/lib/individual-student-discussion.test.ts` | NEW | ~200 |
| 5 | `src/lib/student-utils.ts` | NEW | ~10 |
| 6 | `src/lib/student-utils.test.ts` | NEW | ~25 |
| 7 | `src/app/api/pm/students/route.ts` | NEW | ~65 |
| 8 | `src/app/api/pm/students/route.test.ts` | NEW | ~120 |
| 9 | `src/components/visits/GroupStudentDiscussionForm.tsx` | NEW | ~200 |
| 10 | `src/components/visits/GroupStudentDiscussionForm.test.tsx` | NEW | ~180 |
| 11 | `src/components/visits/IndividualStudentDiscussionForm.tsx` | NEW | ~450 |
| 12 | `src/components/visits/IndividualStudentDiscussionForm.test.tsx` | NEW | ~250 |
| 13 | `src/lib/visit-actions.ts` | MODIFY | ~2 lines changed |
| 14 | `src/components/visits/ActionDetailForm.tsx` | MODIFY | ~80 lines added |
| 15 | `src/components/visits/ActionPointList.tsx` | MODIFY | ~60 lines added |
| 16 | `src/components/visits/ActionTypePickerModal.tsx` | MODIFY | ~2 lines changed |
| 17 | `src/app/api/pm/visits/[id]/actions/[actionId]/route.ts` | MODIFY | ~20 lines added |
| 18 | `src/app/api/pm/visits/[id]/actions/[actionId]/end/route.ts` | MODIFY | ~30 lines added |
| 19 | `src/app/api/pm/visits/[id]/complete/route.ts` | MODIFY | ~25 lines added |
| 20-26 | 7 existing test files | MODIFY | ~30 tests added |
| 27-28 | `CLAUDE.md`, `docs/ai/project-context.md` | MODIFY | docs |

**12 new files, 16 modified files. ~2,500 new lines total (including tests).**

---

## Components Verified as Needing NO Changes

These were investigated and confirmed to require zero modifications:

| Component | Why No Changes |
|-----------|---------------|
| `src/components/visits/CompleteVisitButton.tsx` | Validation is 100% server-side; button is generic, doesn't list required types |
| `src/hooks/use-auto-save.ts` | Universal hook; works for all action types via `sanitizePatchData()` function |
| `src/app/visits/[id]/page.tsx` | Generic progress counter ("X of N completed"); doesn't hardcode type count |
| `src/app/visits/[id]/actions/[actionId]/page.tsx` | Passes `schoolCode` prop generically; form dispatch is in `ActionDetailForm.tsx` |

---

## E2E Test Considerations

E2E helpers in `e2e/helpers/db.ts` will need two new builder functions:

```typescript
export function buildCompleteGroupStudentDiscussionData(grade: number = 11) {
  const questions: Record<string, { answer: boolean }> = {};
  for (const key of ["gc_interacted", "gc_program_updates", "gc_direction", "gc_concerns"]) {
    questions[key] = { answer: true };
  }
  return { grade, questions };
}

export function buildCompleteIndividualStudentDiscussionData() {
  return {
    students: [{
      id: 1, name: "Test Student", grade: 11,
      questions: {
        oh_teaching_concern: { answer: true },
        oh_additional_support: { answer: false },
      },
    }],
  };
}
```

Existing E2E tests in `e2e/tests/visits.spec.ts` that test visit completion will need their seed data updated to include all 6 action types (currently seed 4). Use `seedVisitAction(pool, visitId, { actionType: "group_student_discussion", status: "completed", data: buildCompleteGroupStudentDiscussionData() })`.

**E2E form fill functions** (optional, can be added in a follow-up):
- `fillGroupStudentDiscussionForm()` — select grade, click Yes on 4 questions
- `fillIndividualStudentDiscussionForm()` — select grade, select student, answer 2 questions

---

## Test Pattern Reference

### PATCH route tests (`route.test.ts`)
Mock chain: `visit → action → updated result`. Pattern from lines 606-624:
```typescript
it("accepts empty data for in-progress action (lenient)", async () => {
  setupPmView();
  const action = { ...BASE_ACTION_ROW, action_type: "group_student_discussion" };
  const updated = { ...action, data: {} };
  mockQuery.mockResolvedValueOnce([VISIT_ROW]).mockResolvedValueOnce([action]).mockResolvedValueOnce([updated]);
  // ... make PATCH request, assert 200
});
```

### END route tests (`end/route.test.ts`)
Uses builder functions like `buildValidClassroomData()`. Pattern from lines 285-317:
```typescript
it("returns 422 when data incomplete", async () => {
  setupPmEdit();
  mockQuery.mockResolvedValueOnce([VISIT_ROW]).mockResolvedValueOnce([
    { ...IN_PROGRESS_ACTION, action_type: "group_student_discussion", data: {} },
  ]);
  // ... make POST with GPS, assert 422 + error message
});
```

### COMPLETE route tests (`complete/route.test.ts`)
Sequential mocks — each `mockResolvedValueOnce` matches one DB query. Pattern from lines 368-410:
```typescript
it("returns 422 when group student discussion missing", async () => {
  setupPmEdit();
  mockQuery
    .mockResolvedValueOnce([VISIT_ROW])                              // visit
    .mockResolvedValueOnce([{ has_in_progress_actions: false }])     // in-progress check
    .mockResolvedValueOnce([{ id: 201, data: validClassroom }])      // classroom ✓
    .mockResolvedValueOnce([{ id: 301 }])                            // af_team ✓
    .mockResolvedValueOnce([{ id: 401 }])                            // individual_teacher ✓
    .mockResolvedValueOnce([{ id: 501 }])                            // principal ✓
    .mockResolvedValueOnce([]);                                      // NO group_student ✗
  // ... assert 422
});
```

### Form component tests
- **Group form**: Copy `PrincipalInteractionForm.test.tsx` pattern — `useState` harness, `userEvent.setup()`, test IDs like `group-student-{key}-yes/no`
- **Individual form**: Copy `IndividualAFTeacherInteractionForm.test.tsx` pattern — `mockFetchStudents()` with `vi.stubGlobal("fetch", ...)`, `waitFor` for async fetch, `selectOptions` for add dropdown

### ActionTypePickerModal tests
Currently tests 4 enabled + 6 disabled types. After change: 6 enabled + 4 disabled. Update the "other types disabled" test (line 163-180) to expect only 4 disabled types.

### ActionPointList stats tests
Export stats functions, test with partial/complete/null data. Pattern: `expect(getGroupStudentDiscussionStats({ grade: 11, questions: {...} })).toEqual({ grade: 11, answeredCount: 2, totalQuestions: 4 })`.

### Action detail page tests
Pattern from line 655-671: render server component, check `screen.getByTestId("action-renderer-group_student_discussion")`, test bootstrap null→default, test save-before-end flow.

---

## Implementation Order

1. **Phase 1** (libs) → no dependencies, fully testable in isolation. Run `npm run test` after.
2. **Phase 2** (students API) → depends only on DB. Run tests after.
3. **Phase 3** (form components) → depends on Phase 1 configs + Phase 2 API. Run tests after.
4. **Phase 4** (wiring) → depends on all above. Run tests + `npm run build` after.
5. **Phase 5** (test updates) → depends on Phase 4.
6. **Phase 6** (docs) → last.

Within each phase, run `npm run test` to verify no regressions.

---

## Notes

- **Grades**: CSV specifies only 11 and 12. The DB `grade` table has dynamic values but `VALID_GRADES = [11, 12]` in config is correct for now. If grades expand later, update the const. Note: grades are stored as **numbers** (not strings) in the JSONB payload, matching the DB `grade.number` column type. This intentionally differs from classroom observation which stores grades as strings — classroom observation's grade is a free-form form field unrelated to the DB `grade` table, whereas student interaction grades come directly from DB data.
- **Student search bar**: User asked for "a search bar" for individual students. The existing teacher form uses a `<select>` dropdown. For consistency and simplicity, use a `<select>` dropdown filtered by grade (same UX as `IndividualAFTeacherInteractionForm` line 453-471). The grade filter already narrows the list. If the user wants a true text-search combobox later, it can be added as a follow-up.
- **No "all students recorded" check**: Unlike Individual Teacher Interaction which queries `user_permission` to verify all school teachers are recorded on END, the student form has no such requirement. Student count per visit varies by PM discretion.

---

## Verification

1. `npm run test` — all unit tests pass (existing ~1402 + ~60 new ≈ ~1462+)
2. `npm run build` — TypeScript compiles cleanly
3. `npm run lint` — no lint errors
4. Manual: create group_student_discussion → select grade 11 → fill 4 questions → save → end
5. Manual: create individual_student_discussion → select grade 11 → add student → fill 2 questions → save → end
6. Manual: attempt visit completion with only 4/6 types → verify rejection with descriptive error
7. Manual: complete visit with all 6 action types → verify success
8. Manual: program_admin views both student forms → read-only (no edit controls)
