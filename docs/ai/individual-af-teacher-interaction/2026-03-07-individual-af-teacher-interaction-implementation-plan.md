# Plan: Add Individual AF Teacher Interaction Action Type

## Context

The PM school visit system currently supports two enabled action types: `classroom_observation` and `af_team_interaction`. The product team needs a third action type — **Individual AF Teacher Interaction** — to record per-teacher observations during a PM's individual interactions with each teacher at a school.

**Key design differences from AF Team Interaction:**
- **Single action, multiple teachers**: One action holds data for many teachers. The PM adds teachers one at a time within the action detail page.
- **Single-select per entry** (not multiselect): Each teacher entry is recorded individually with their own attendance + questions.
- **Attendance gating**: Each teacher is marked Present / On Leave / Absent. Questions are only shown/required for "Present" teachers.
- **All-teachers requirement**: To END the action, ALL teachers at the school must be recorded (server validates against DB).
- **Visit completion change**: All three action types (classroom observation, AF team interaction, individual AF teacher interaction) are now required for visit completion. This is a **confirmed product decision** — the previous rule (only classroom observation required) is superseded. No visits have been created on production yet (only staging), so this rule change has no migration impact.

> **Decision: Visit completion now requires all 3 action types.** Earlier documentation (CLAUDE.md, project-context.md, AF team interaction plan, school-visit-action-points plan) states that only `classroom_observation` is required and AF team interaction is "supplementary." That rule is now obsolete. Phase 5 of this plan updates all those references. Until Phase 5 is complete, treat **this plan** as the source of truth for completion requirements.

---

## Data Shape (JSONB `data` column)

```typescript
{
  teachers: Array<{
    id: number,           // teacher user_permission ID
    name: string,         // display name at time of recording
    attendance: "present" | "on_leave" | "absent",
    questions: Record<string, {
      answer: boolean | null,
      remark?: string
    }>  // empty {} when attendance !== "present"
  }>
}
```

> **Design choice**: Each teacher entry is a self-contained object in the array, carrying their own attendance status and question responses. This mirrors the AF Team Interaction pattern (`teachers` array + `questions`) but nests questions per teacher instead of globally.

> **Attendance values**: `"present"` / `"on_leave"` / `"absent"` (not `"yes"` / `"leave"` / `"absent"` from the CSV). These are more explicit and consistent as data values.

> **No config versioning needed.** Same rationale as AF Team Interaction: simple binary form, lenient validation ignores unknown question keys.

**13 question keys** across 5 sections:

> **Note on wording**: Question text has been cleaned up from the source CSV (`docs/LMS Field Visit - Forms and Templates - Individual AF Teacher Interaction.csv`), which contained grammar/spelling issues. The corrected wording below is confirmed for implementation.

| Key | Section | Question |
|-----|---------|----------|
| `oh_class_duration` | Operational Health | Does the teacher get the required duration of classes? |
| `st_grade11_syllabus` | Syllabus Track | Is grade 11 syllabus on track? |
| `st_grade11_testing` | Syllabus Track | Is grade 11 testing on track? |
| `st_grade12_syllabus` | Syllabus Track | Is grade 12 syllabus on track? |
| `st_grade12_testing` | Syllabus Track | Is grade 12 testing on track? |
| `sp_student_performance` | Student Performance on Monthly Tests | Are there concerns related to student performance in their subject? |
| `sp_girls_performance` | Student Performance on Monthly Tests | Are there concerns related to girl student performance in their subject? |
| `sn_academics` | Support Needed | Does this teacher need assistance on academics? |
| `sn_school_operations` | Support Needed | Does the teacher need assistance in school operations? |
| `sn_co_curriculars` | Support Needed | Does the teacher need assistance on co-curriculars? |
| `mp_monthly_plan` | Monthly Planning | Is the plan for upcoming month discussed with the teacher? |
| `mp_classroom_observations` | Monthly Planning | Have you discussed the observations from the classroom? |
| `mp_student_feedback` | Monthly Planning | Have you discussed the student feedback with the teacher? |

**Attendance options:**

| Value | UI Label |
|-------|----------|
| `present` | Present |
| `on_leave` | On Leave |
| `absent` | Absent |

---

## UX Flow (action detail page)

### Collapsible teacher sections

Each teacher's interaction is rendered as a **collapsible div** (accordion-style):
- **Open by default** when the PM is actively working on that teacher (just added or just expanded)
- PM can **collapse** any teacher's section and **expand** another to work on a different teacher
- Multiple sections can be open simultaneously — the PM is free to jump between teachers
- Collapse/expand state is client-side only (not persisted in data)

This means there is no separate "Add Teacher" form area. Instead:
1. PM clicks "Add Teacher" button (shows dropdown of remaining teachers)
2. Selecting a teacher creates a new collapsible section at the bottom, **open by default**
3. PM fills attendance + questions (if present) directly in that section
4. PM can collapse that section and add another teacher, or go back to edit a previous one
5. Each section has a "Remove" button (while action is `in_progress`)

### Initial state (action just started, no teachers recorded)
1. No teacher sections yet
2. "Add Teacher" button with dropdown of all school teachers
3. PM selects a teacher -> new collapsible section opens with that teacher, attendance defaults to **Present**
4. Since attendance defaults to Present, 13 binary+remark questions appear immediately in the section
5. PM can change attendance to **On Leave / Absent** -> questions are hidden/cleared
6. PM can add another teacher (new section opens) or collapse current and work on others

### With recorded teachers
- Each teacher shown as a collapsible section with header: teacher name, attendance badge, question progress (e.g., "13/13" for present, "N/A" for absent/leave)
- Click header to expand/collapse
- While `in_progress`: sections are editable (change attendance, change answers, remove teacher)
- When all teachers are recorded, "Add Teacher" dropdown shows "All teachers recorded" message

### Save / End flow
- **Save**: PATCHes current `data.teachers` array to server (lenient validation)
- **End Action**: save-before-end (PATCH) then POST `/end` (strict validation including all-teachers DB check)

### Read-only / completed state
- All teacher sections shown collapsed by default (expandable to view details)
- No edit/remove/add controls
- Attendance and answers displayed as static text

---

## Phase 1: Foundation (config + validation + type registration)

> **Build order note**: Adding `individual_af_teacher_interaction` to `ACTION_TYPES` immediately breaks `Record<ActionType, ActionFormConfig>` in `ActionDetailForm.tsx`. Therefore steps 1.1 and 1.5 must land atomically.

### 1.1 Add action type — `src/lib/visit-actions.ts`
- Add `individual_af_teacher_interaction: "Individual AF Teacher Interaction"` to `ACTION_TYPES`

#### Implementation checklist
- [ ] Add `individual_af_teacher_interaction: "Individual AF Teacher Interaction"` entry to the `ACTION_TYPES` object (after `af_team_interaction`)
- [ ] Verify `ActionType` union type auto-expands (it's `keyof typeof ACTION_TYPES`)
- [ ] Verify `ACTION_TYPE_VALUES` auto-expands (derived from `Object.keys(ACTION_TYPES)`)
- [ ] Verify `isActionType("individual_af_teacher_interaction")` returns `true`
- [ ] Verify `getActionTypeLabel("individual_af_teacher_interaction")` returns `"Individual AF Teacher Interaction"`

#### Verification
- [ ] TypeScript: `npx tsc --noEmit` fails at this point (expected — `ACTION_FORM_CONFIGS` is missing the new key). Resolved by 1.5.

---

### 1.2 Update exhaustiveness test — `src/lib/visit-actions.test.ts`
- Add `individual_af_teacher_interaction` to the exhaustiveness record, update count from 9 -> 10

#### Implementation checklist
- [ ] Add `individual_af_teacher_interaction: true` to the `Record<ActionType, true>` object
- [ ] Change `toHaveLength(9)` -> `toHaveLength(10)`

#### Verification
- [ ] Test passes: `npx vitest run src/lib/visit-actions.test.ts`

---

### 1.3 Create config + validation — `src/lib/individual-af-teacher-interaction.ts` (NEW)

Following the `af-team-interaction.ts` pattern:

**Exports:**
- `INDIVIDUAL_AF_TEACHER_INTERACTION_CONFIG` — sections array + `allQuestionKeys` flat list
- `ATTENDANCE_OPTIONS` — `["present", "on_leave", "absent"] as const`
- `Attendance` type — `"present" | "on_leave" | "absent"`
- `IndividualTeacherEntry` interface
- `IndividualAFTeacherInteractionData` interface
- `validateIndividualTeacherSave(data: unknown): ValidationResult` — lenient
- `validateIndividualTeacherComplete(data: unknown): ValidationResult` — strict (data shape only; all-teachers check is in API route)

> **Design note**: Strict validation here checks data shape integrity only (each present teacher has all 13 questions answered, valid attendance values, etc.). The "all teachers at the school recorded" check requires a DB query and lives in the API route, not in the pure validation function.

#### Implementation checklist

**Config structure:**
- [ ] Define local `isPlainObject(value: unknown): value is Record<string, unknown>` helper — same pattern as `af-team-interaction.ts` (`value !== null && typeof value === "object" && !Array.isArray(value)`)
- [ ] Reuse `ValidationResult`, `QuestionConfig`, `SectionConfig` interfaces (import from `@/lib/af-team-interaction` OR define locally — prefer local to avoid coupling)
- [ ] Define `ATTENDANCE_OPTIONS = ["present", "on_leave", "absent"] as const`
- [ ] Define `Attendance = typeof ATTENDANCE_OPTIONS[number]`
- [ ] Define `IndividualTeacherEntry` interface: `{ id: number; name: string; attendance: Attendance; questions: Record<string, { answer: boolean | null; remark?: string }> }`
- [ ] Define `IndividualAFTeacherInteractionData` interface: `{ teachers: IndividualTeacherEntry[] }`
- [ ] Create config constant with 5 sections (13 questions total):
  - Operational Health (1 question: `oh_class_duration`)
  - Syllabus Track (4 questions: `st_grade11_syllabus`, `st_grade11_testing`, `st_grade12_syllabus`, `st_grade12_testing`)
  - Student Performance on Monthly Tests (2 questions: `sp_student_performance`, `sp_girls_performance`)
  - Support Needed (3 questions: `sn_academics`, `sn_school_operations`, `sn_co_curriculars`)
  - Monthly Planning (3 questions: `mp_monthly_plan`, `mp_classroom_observations`, `mp_student_feedback`)
- [ ] Compute `allQuestionKeys` from `sections.flatMap(...)` (13 keys total)

**Lenient validation (`validateIndividualTeacherSave`):**
- [ ] Reject non-object data (null, undefined, string, number, array) -> "Data must be an object"
- [ ] Reject unknown top-level keys (only `teachers` allowed) -> "Unknown field: {key}"
- [ ] If `teachers` present:
  - [ ] Must be an array -> "teachers must be an array"
  - [ ] Each entry must be an object -> "Teacher entry {i}: must be an object"
  - [ ] Each entry must have `id` (positive integer) -> "Teacher entry {i}: id must be a positive integer"
  - [ ] Each entry must have `name` (non-empty string) -> "Teacher entry {i}: name must be a non-empty string"
  - [ ] Reject duplicate teacher IDs -> "Duplicate teacher id: {id}"
  - [ ] If `attendance` present: must be one of `ATTENDANCE_OPTIONS` -> "Teacher entry {i}: attendance must be present, on_leave, or absent"
  - [ ] If `questions` present: must be a plain object -> "Teacher entry {i}: questions must be an object"
  - [ ] For each *known* question key in `questions`:
    - [ ] Value must be an object -> "Teacher {name}: {label}: must be an object"
    - [ ] `answer` must be `boolean | null` -> "Teacher {name}: {label}: answer must be true, false, or null"
    - [ ] `remark` if present must be string -> "Teacher {name}: {label}: remark must be a string"
  - [ ] Unknown question keys are silently ignored
- [ ] All fields optional (empty `{}` is valid)

**Strict validation (`validateIndividualTeacherComplete`):**
- [ ] Run all lenient structural checks
- [ ] `teachers` must be present and non-empty -> "At least one teacher must be recorded"
- [ ] Each teacher entry:
  - [ ] `attendance` must be present -> "Teacher {name}: attendance is required"
  - [ ] If `attendance === "present"`:
    - [ ] `questions` must be present -> "Teacher {name}: all questions must be answered"
    - [ ] All 13 current keys must be present with `answer` as `boolean` (not `null`) -> "Teacher {name}: {label}: answer is required"
  - [ ] If `attendance !== "present"`:
    - [ ] Questions are NOT required (teacher is absent/on leave)
- [ ] Remarks remain optional in strict mode

> **Note**: This validation does NOT check "all teachers at school recorded" — that requires a DB query and is handled by the END route (Phase 2.2).

#### Verification
- [ ] File compiles: `npx tsc --noEmit` (full compile still fails until 1.5)
- [ ] Exports are importable from `@/lib/individual-af-teacher-interaction`

---

### 1.4 Create validation tests — `src/lib/individual-af-teacher-interaction.test.ts` (NEW)

#### Implementation checklist — test cases to write

**Config integrity tests (~3 tests):**
- [ ] Test: config has 5 sections with correct titles
- [ ] Test: config has 13 total questions with unique keys (1+4+2+3+3)
- [ ] Test: `allQuestionKeys` matches flattened `sections[].questions[].key` in order

**Lenient validation tests (~15 tests):**
- [ ] Test: accepts empty object `{}`
- [ ] Test: accepts partial teachers array (1 teacher, partial questions)
- [ ] Test: accepts teacher with attendance `"on_leave"` and no questions
- [ ] Test: accepts teacher with attendance `"absent"` and no questions
- [ ] Test: accepts teacher with attendance `"present"` and partial questions
- [ ] Test: accepts fully valid payload (multiple teachers, mixed attendance)
- [ ] Test: rejects unknown top-level keys (`{ foo: "bar" }`)
- [ ] Test: ignores unknown question keys silently
- [ ] Test: rejects non-boolean answer value (`"yes"`)
- [ ] Test: rejects non-string remark value (`123`)
- [ ] Test: rejects non-array `teachers`
- [ ] Test: rejects teacher entry missing `id`
- [ ] Test: rejects teacher entry with non-positive-integer ID
- [ ] Test: rejects duplicate teacher IDs
- [ ] Test: rejects invalid attendance value (`"sick"`)
- [ ] Test: rejects non-object data (null, string, array)

**Strict validation tests (~8 tests):**
- [ ] Test: rejects empty object `{}` (missing teachers)
- [ ] Test: rejects empty teachers array `[]`
- [ ] Test: rejects present teacher with missing questions -> errors list each missing question label
- [ ] Test: rejects present teacher with `null` answers
- [ ] Test: accepts absent teacher without questions
- [ ] Test: accepts on_leave teacher without questions
- [ ] Test: accepts fully complete payload (mix of present with all answers + absent/on_leave without)
- [ ] Test: reports teacher name and question labels in error messages

#### Verification
- [ ] All tests pass: `npx vitest run src/lib/individual-af-teacher-interaction.test.ts`
- [ ] Count: ~26 tests

---

### 1.5 Add `ACTION_FORM_CONFIGS` entry — `src/components/visits/ActionDetailForm.tsx`
Must land with 1.1 to prevent TypeScript errors:
```typescript
individual_af_teacher_interaction: {
  title: "Individual AF Teacher Interaction Details",
  description: "Record individual interactions with each teacher at the school.",
  fields: [],  // custom component
},
```

#### Implementation checklist
- [ ] Add `individual_af_teacher_interaction` entry to `ACTION_FORM_CONFIGS` record
- [ ] Set `fields: []` (custom component wired in Phase 3)

#### Verification
- [ ] `npx tsc --noEmit` passes cleanly
- [ ] Existing action detail page tests pass

---

### Phase 1 gate — all must pass before starting Phase 2
- [ ] `npx tsc --noEmit` — zero errors
- [ ] `npx vitest run src/lib/visit-actions.test.ts` — passes (count 10)
- [ ] `npx vitest run src/lib/individual-af-teacher-interaction.test.ts` — passes (~26 tests)
- [ ] `npx vitest run src/app/visits/\\[id\\]/actions/\\[actionId\\]/page.test.tsx` — existing tests pass
- [ ] Full suite: `npm run test` — all tests pass

---

## Phase 2: API Validation

### 2.1 PATCH route — `src/app/api/pm/visits/[id]/actions/[actionId]/route.ts`
- Import `validateIndividualTeacherSave`, `validateIndividualTeacherComplete`
- Add matching validation block for `individual_af_teacher_interaction` after the `af_team_interaction` block

#### Implementation checklist
- [ ] Add import from `@/lib/individual-af-teacher-interaction`
- [ ] Add validation block:
  ```typescript
  if (action.action_type === "individual_af_teacher_interaction") {
    const validation =
      action.status === "completed"
        ? validateIndividualTeacherComplete(data)
        : validateIndividualTeacherSave(data);
    if (!validation.valid) {
      return apiError(422, "Invalid individual teacher interaction data", validation.errors);
    }
  }
  ```

#### Verification
- [ ] `npx tsc --noEmit` — no errors
- [ ] Existing PATCH tests pass

---

### 2.2 END route — `src/app/api/pm/visits/[id]/actions/[actionId]/end/route.ts`

This is the most complex API change. The END route must:
1. Validate data shape (strict) — via `validateIndividualTeacherComplete`
2. Validate all-teachers coverage — via DB query comparing recorded teacher IDs against school's teacher list

#### Implementation checklist
- [ ] Add import: `import { validateIndividualTeacherComplete } from "@/lib/individual-af-teacher-interaction"`
- [ ] Add `individualTeacherValidationError()` function (mirror `classroomValidationError`/`afTeamValidationError`):
  ```typescript
  function individualTeacherValidationError(action: VisitActionRow) {
    if (action.action_type !== "individual_af_teacher_interaction") return null;
    const validation = validateIndividualTeacherComplete(action.data);
    if (validation.valid) return null;
    return apiError(422, "Invalid individual teacher interaction data", validation.errors);
  }
  ```
- [ ] Add `allTeachersRecordedError()` async function — new pattern (DB-dependent validation):
  ```typescript
  async function allTeachersRecordedError(action: VisitActionRow, schoolCode: string, schoolRegion: string | null) {
    if (action.action_type !== "individual_af_teacher_interaction") return null;
    // Fetch all teachers for this school — same query as GET /api/pm/teachers
    const allTeachers = await query<{ id: number; full_name: string | null; email: string }>(
      `SELECT id, full_name, email FROM user_permission
       WHERE role = 'teacher'
         AND (
           school_codes @> ARRAY[$1]::TEXT[]
           OR ($2::TEXT IS NOT NULL AND regions @> ARRAY[$2]::TEXT[])
           OR level = 3
         )`,
      [schoolCode, schoolRegion]
    );
    const data = action.data as { teachers?: Array<{ id: number }> };
    const recordedIds = new Set((data.teachers ?? []).map(t => t.id));
    const missing = allTeachers.filter(t => !recordedIds.has(t.id));
    if (missing.length === 0) return null;
    const missingNames = missing.map(t => t.full_name || t.email);
    return apiError(422, "Not all teachers at this school have been recorded", [
      `Missing: ${missingNames.join(", ")}`
    ]);
  }
  ```
  > **SQL query note**: This uses the exact same TEXT[] array containment syntax as `GET /api/pm/teachers` (`src/app/api/pm/teachers/route.ts` lines 44-55). The `school_codes` and `regions` columns in `user_permission` are `TEXT[]` type, NOT JSONB — so we use `ARRAY[$1]::TEXT[]`, not `$1::jsonb`.
  >
  > **Implementation detail**: The END route's `loadVisitAccessTarget` already fetches both `visit.school_code` and `visit.school_region` (via `LEFT JOIN school s ON s.code = v.school_code` → `s.region AS school_region`). Both are available. Inline the query in the END route for now (same as the teachers API route does), extracting to a shared helper only if a third consumer appears.
- [ ] Add calls in **both** the pre-update path and the concurrent-fallback path (same 2 places as classroom/AF team validation)
- [ ] Pass `visit.school_code` and `visit.school_region` to `allTeachersRecordedError()` — both are available from the visit row fetched by `loadVisitAccessTarget()`
- [ ] Compare recorded teacher IDs (`data.teachers.map(t => t.id)`) against all teacher IDs from DB
- [ ] If missing teachers: return `apiError(422, "Not all teachers recorded", ["Missing teachers: {names or IDs}"])`

#### All-teachers query approach
The END route already fetches the visit (which has `school_code` and `school_region` from the LEFT JOIN on `school`). Use the same teacher-matching query as `GET /api/pm/teachers` (`src/app/api/pm/teachers/route.ts` lines 44-55):
```sql
SELECT id, full_name, email FROM user_permission
WHERE role = 'teacher'
  AND (
    school_codes @> ARRAY[$1]::TEXT[]
    OR ($2::TEXT IS NOT NULL AND regions @> ARRAY[$2]::TEXT[])
    OR level = 3
  )
```
Where `$1` is `schoolCode` and `$2` is `schoolRegion` (already available from `visit.school_region`).

> **Important**: The `school_codes` and `regions` columns are `TEXT[]` arrays, NOT JSONB. Use PostgreSQL TEXT array containment (`ARRAY[$1]::TEXT[]`), not JSONB containment (`$1::jsonb`).

#### Verification
- [ ] `npx tsc --noEmit` — no errors
- [ ] Existing END tests pass

---

### 2.3 COMPLETE route — `src/app/api/pm/visits/[id]/complete/route.ts`

**Breaking change**: Visit completion now requires all 3 action types.

#### Implementation checklist
- [ ] Find the existing completion check that requires `classroom_observation` (looks for at least one completed classroom observation with strict-valid rubric)
- [ ] Add check for `af_team_interaction`: at least one completed `af_team_interaction` action -> error: "At least one completed AF Team Interaction is required"
- [ ] Add check for `individual_af_teacher_interaction`: at least one completed `individual_af_teacher_interaction` action -> error: "At least one completed Individual AF Teacher Interaction is required"
- [ ] Order: check requirements sequentially (classroom observation first, then AF team interaction, then individual teacher interaction) — short-circuit on first missing type, matching the existing route pattern where each check returns immediately on failure

#### Verification
- [ ] `npx tsc --noEmit` — no errors
- [ ] Existing COMPLETE tests will BREAK (they don't include all 3 action types) — updated in 2.6

---

### 2.4 Update PATCH route tests — `src/app/api/pm/visits/[id]/actions/[actionId]/route.test.ts`

#### Implementation checklist — test cases to write (~7 tests)
- [ ] Test: lenient — accepts empty `{}` data for in-progress `individual_af_teacher_interaction` -> 200
- [ ] Test: lenient — accepts partial data (1 teacher, partial questions) -> 200
- [ ] Test: lenient — accepts teacher with `attendance: "absent"` and no questions -> 200
- [ ] Test: lenient — rejects unknown top-level keys -> 422
- [ ] Test: lenient — rejects invalid attendance value -> 422
- [ ] Test: strict — rejects incomplete data on completed action (admin edit) -> 422
- [ ] Test: strict — accepts fully complete data on completed action (admin) -> 200

#### Verification
- [ ] All tests pass
- [ ] New test count: +7 tests

---

### 2.5 Update END route tests — `src/app/api/pm/visits/[id]/actions/[actionId]/end/route.test.ts`

#### Implementation checklist — test cases to write (~6 tests)
- [ ] Test: 422 when `individual_af_teacher_interaction` data is incomplete (missing answers for present teacher)
- [ ] Test: 422 when data is null/malformed
- [ ] Test: 422 when not all school teachers are recorded (mock teacher query to return more teachers than in data)
- [ ] Test: ends successfully when all teachers recorded with valid data
- [ ] Test: absent/on_leave teachers pass without questions
- [ ] Test: concurrent fallback path also validates

#### Verification
- [ ] All tests pass
- [ ] New test count: +6 tests

---

### 2.6 Update COMPLETE route tests — `src/app/api/pm/visits/[id]/complete/route.test.ts`

**Important**: This is the biggest test impact. Existing tests that complete visits with only classroom observation will now fail because AF team interaction and individual teacher interaction are also required.

#### Implementation checklist
- [ ] Update ALL existing successful completion test mocks to include completed actions of all 3 types
- [ ] Test: visit fails completion with only `classroom_observation` (no AF team, no individual teacher) -> 422 mentioning missing types
- [ ] Test: visit fails completion with `classroom_observation` + `af_team_interaction` but no `individual_af_teacher_interaction` -> 422
- [ ] Test: visit completes with all 3 completed action types -> 200
- [ ] Test: error message mentions the first missing action type (short-circuit — consistent with existing pattern)

#### Verification
- [ ] All tests pass (existing updated + new)
- [ ] New test count: +3-4 tests, many existing tests updated

---

### Phase 2 gate — all must pass before starting Phase 3
- [ ] `npx tsc --noEmit` — zero errors
- [ ] All PATCH, END, COMPLETE route tests pass
- [ ] Full suite: `npm run test` — all tests pass

---

## Phase 3: UI Components

### 3.1 Enable in picker — `src/components/visits/ActionTypePickerModal.tsx`

#### Implementation checklist
- [ ] Change enabled check to include all 3 types:
  ```typescript
  const enabled = actionType === "classroom_observation"
    || actionType === "af_team_interaction"
    || actionType === "individual_af_teacher_interaction";
  ```

#### Test checklist — update `ActionTypePickerModal.test.tsx`
- [ ] Test: `individual_af_teacher_interaction` radio button is selectable (not disabled)
- [ ] Test: selecting and submitting calls `onSubmit("individual_af_teacher_interaction")`
- [ ] Test: other 7 action types remain disabled

#### Verification
- [ ] All tests pass
- [ ] New test count: +2-3 tests

---

### 3.2 Create form component — `src/components/visits/IndividualAFTeacherInteractionForm.tsx` (NEW)

This is the most complex component. It manages a list of per-teacher collapsible sections within a single action.

**Props:** `{ data, setData, disabled, schoolCode }` (same shape as other form components)

#### Implementation checklist

**File structure:**
- [ ] `"use client"` directive at top
- [ ] Import `Teacher`, `getTeacherDisplayName` from `@/lib/teacher-utils`
- [ ] Import `INDIVIDUAL_AF_TEACHER_INTERACTION_CONFIG`, `ATTENDANCE_OPTIONS` from `@/lib/individual-af-teacher-interaction`

**Data extraction helpers:**
- [ ] `getTeacherEntriesFromData(data)` — extract and validate `data.teachers` array
- [ ] `getQuestionsFromEntry(entry)` — extract questions record from a teacher entry

**Teacher fetch (same pattern as AFTeamInteractionForm):**
- [ ] State: `availableTeachers: Teacher[]`, `loading`, `error`
- [ ] `useEffect` with `cancelled` flag — fetch `GET /api/pm/teachers?school_code={schoolCode}`
- [ ] Always fetch even when `disabled`

**Computed state:**
- [ ] `recordedTeachers`: entries from `data.teachers`
- [ ] `recordedTeacherIds`: `Set` of recorded teacher IDs
- [ ] `remainingTeachers`: fetched teachers not in `recordedTeacherIds`

**Collapse/expand state:**
- [ ] `expandedTeacherIds: Set<number>` — tracks which teacher sections are currently expanded
- [ ] Client-side only (not persisted in `data`)
- [ ] When a new teacher is added, auto-expand that teacher's section
- [ ] Multiple sections can be open simultaneously

**Collapsible teacher sections:**
Each recorded teacher is rendered as a collapsible div (accordion-style):
- [ ] Section wrapper: `data-testid="teacher-section-{id}"`
- [ ] **Header** (always visible, clickable to toggle expand/collapse):
  - Teacher name
  - Attendance badge (color-coded: green for present, yellow for on leave, gray for absent)
  - Question progress (e.g., "13/13" for present teachers, "N/A" for absent/on leave)
  - Expand/collapse chevron indicator
- [ ] **Expanded content** (shown when section is expanded):
  - Attendance radio group: `data-testid="teacher-{id}-attendance-{value}"` for each option
  - Questions section (only when attendance is `"present"`):
    - Same section/question layout as AF Team Interaction (loop over config sections)
    - Radio buttons: `data-testid="teacher-{id}-{questionKey}-yes"` / `data-testid="teacher-{id}-{questionKey}-no"`
    - Remark toggle + textarea: `data-testid="teacher-{id}-{questionKey}-remark"`
  - "Remove" button: `data-testid="remove-teacher-{id}"` (only when `!disabled`)
- [ ] When attendance changes from "present" to "on_leave"/"absent": clear questions from that entry
- [ ] When attendance changes from "on_leave"/"absent" to "present": initialize empty questions
- [ ] All edits (attendance change, answer change, remark change) update `data.teachers` via `setData` immediately

**Add Teacher button + dropdown (below all sections):**
- [ ] Only shown when `!disabled` AND `remainingTeachers.length > 0`
- [ ] When all teachers recorded AND `!disabled`: show "All teachers recorded" message (`data-testid="all-teachers-recorded"`)
- [ ] "Add Teacher" button: `data-testid="add-teacher-button"` — clicking reveals a dropdown of remaining teachers
- [ ] Teacher dropdown: `data-testid="add-teacher-select"` — only shows remaining teachers (fetched minus recorded)
- [ ] On teacher selection: immediately append new entry to `data.teachers` (with `attendance: "present"` as default, empty `questions: {}`), auto-expand the new section, collapse the dropdown. The PM can change attendance afterwards — defaulting to `"present"` avoids a TypeScript type mismatch (the `Attendance` type is `"present" | "on_leave" | "absent"` with no `undefined`).

**Progress bar (sticky):**
- [ ] `data-testid="individual-teacher-progress"`
- [ ] Content: `"Recorded: {X}/{Y} teachers"` where X = recorded count, Y = total fetched teachers
- [ ] Show breakdown: `"{P} present, {L} on leave, {A} absent"` from recorded entries

**Disabled/read-only mode:**
- [ ] Show all teacher sections collapsed by default (expandable to view details)
- [ ] Expanded view shows attendance + answers as static text (no radios, no textareas)
- [ ] No "Remove" buttons
- [ ] No "Add Teacher" button/dropdown
- [ ] Attendance shown as text badge

**Outermost wrapper:**
- [ ] `data-testid="action-renderer-individual_af_teacher_interaction"` on the root element

#### Verification
- [ ] Covered by unit tests in 3.3

---

### 3.3 Create form tests — `src/components/visits/IndividualAFTeacherInteractionForm.test.tsx` (NEW)

#### Implementation checklist — test cases to write

**Teacher fetch tests (~3 tests):**
- [ ] Test: fetches teachers on mount with correct `school_code`
- [ ] Test: shows error state on fetch failure
- [ ] Test: renders "Add Teacher" button after successful fetch

**Add teacher + collapsible section tests (~6 tests):**
- [ ] Test: selecting a teacher from dropdown creates a new collapsible section, auto-expanded
- [ ] Test: added teacher removed from dropdown (remaining teachers computed correctly)
- [ ] Test: new section shows attendance radio group when expanded
- [ ] Test: selecting "on_leave" attendance shows no questions in the section
- [ ] Test: selecting "present" attendance shows all 13 questions in the section
- [ ] Test: "All teachers recorded" message shown when all fetched teachers are in data

**Collapsible behavior tests (~4 tests):**
- [ ] Test: clicking section header toggles expand/collapse
- [ ] Test: multiple sections can be open simultaneously
- [ ] Test: collapsing a section preserves its data (answers not lost)
- [ ] Test: collapsed section header shows teacher name, attendance badge, and question progress

**Editing + removing tests (~5 tests):**
- [ ] Test: changing attendance from "present" to "absent" clears questions for that teacher
- [ ] Test: changing attendance present → absent → present shows empty questions (old answers not restored)
- [ ] Test: changing an answer in an expanded section updates `data.teachers` via `setData`
- [ ] Test: "Remove" button removes teacher entry and section disappears
- [ ] Test: removed teacher reappears in the "Add Teacher" dropdown

**Progress bar tests (~1 test):**
- [ ] Test: progress bar shows correct recorded/total count and breakdown

**Disabled/read-only tests (~3 tests):**
- [ ] Test: disabled mode shows all sections collapsed by default
- [ ] Test: disabled mode: no "Add Teacher" button, no "Remove" buttons
- [ ] Test: disabled mode: expanding section shows read-only answers (static text)

**Edge cases (~2 tests):**
- [ ] Test: handles teacher in data but not in fetched list (school change) — shows name from data
- [ ] Test: handles empty data (null/undefined) — shows empty state with "Add Teacher" button

#### Verification
- [ ] All tests pass
- [ ] Count: ~24 tests (the collapsible sections, per-teacher attendance gating, and add/remove flows are more complex than AFTeamInteractionForm's 22 tests — expect 24-30)

---

### 3.4 Wire into ActionDetailForm — `src/components/visits/ActionDetailForm.tsx`

#### Implementation checklist

**Imports and constants:**
- [ ] Add `import IndividualAFTeacherInteractionForm from "./IndividualAFTeacherInteractionForm"`
- [ ] Add `import { INDIVIDUAL_AF_TEACHER_INTERACTION_CONFIG } from "@/lib/individual-af-teacher-interaction"`
- [ ] Add constant: `const INDIVIDUAL_TEACHER_ACTION_TYPE = "individual_af_teacher_interaction" as const`
- [ ] Update `SAVE_BEFORE_END_TYPES` to include `INDIVIDUAL_TEACHER_ACTION_TYPE`

**Sanitization functions:**
- [ ] Add `sanitizeIndividualTeacherPayload(data: Record<string, unknown>): Record<string, unknown>`
  - Return empty object if input is not a plain object
  - Extract `teachers` array, validate each entry structure
  - For each entry: keep `id`, `name`, `attendance`, and `questions` (strip unknown question keys using config)
  - Return only `{ teachers }` (no other top-level keys)
- [ ] Add `bootstrapIndividualTeacherPayload(data: unknown): Record<string, unknown>`
  - If null/undefined/not-object -> return `{ teachers: [] }`
  - Otherwise -> delegate to `sanitizeIndividualTeacherPayload`

**Integration points (same pattern as AF Team Interaction):**
- [ ] Update `normalizeFormDataForAction()` — add branch for `INDIVIDUAL_TEACHER_ACTION_TYPE` **before** the `!isPlainObject(data)` guard
- [ ] Update `sanitizePatchData()` — add branch for `INDIVIDUAL_TEACHER_ACTION_TYPE`
- [ ] Update rendering: add `IndividualAFTeacherInteractionForm` branch in the conditional render chain **between** the AF team interaction check and the fallback `config.fields.map(...)`. The current ternary chain is: `isClassroomObservation ? ClassroomObservationForm : af_team ? AFTeamInteractionForm : config.fields.map(...)`. Insert the new branch so it becomes:
    ```
    isClassroomObservation ? ClassroomObservationForm
    : af_team ? AFTeamInteractionForm
    : individual_teacher ? IndividualAFTeacherInteractionForm   ← ADD HERE
    : config.fields.map(...)
    ```
    If the new branch is placed after the fallback, the form will never render.
- [ ] Update `handleEndAction()` error messages:
  - `SAVE_BEFORE_END_TYPES` already includes it via the Set update
  - **Save failure message**: Keep existing binary ternary (classroom observation gets its own message, everything else gets "Could not save form data. Fix errors and try End again."). No change needed — the message is the same for AF team and individual teacher.
  - **END 422 message**: Convert to 3-way ternary (this is the only place where individual teacher interaction needs a different message):
    ```typescript
    const endErrorMessage = isClassroomObservation
      ? "Please complete all required rubric scores before ending this observation."
      : action.action_type === INDIVIDUAL_TEACHER_ACTION_TYPE
        ? "Please complete all required fields and record all teachers before ending this interaction."
        : "Please complete all required fields before ending this interaction.";
    ```
  - The individual teacher message must mention "record all teachers" because the END route has a DB-level check for all-teachers coverage that AF team interaction does not have.

#### Verification
- [ ] `npx tsc --noEmit` — no errors
- [ ] Existing action detail page tests pass

---

### 3.5 Add action card stats — `src/components/visits/ActionPointList.tsx`

#### Implementation checklist

**Stats function:**
- [ ] Import `INDIVIDUAL_AF_TEACHER_INTERACTION_CONFIG` from `@/lib/individual-af-teacher-interaction`
- [ ] Define and export `IndividualTeacherInteractionStats` interface: `{ recordedCount: number; presentCount: number; onLeaveCount: number; absentCount: number }`
- [ ] Add and export `getIndividualTeacherInteractionStats(data: ...): IndividualTeacherInteractionStats | null`
  - Return `null` if data is missing/empty
  - Count teachers by attendance type
  - Return `null` if `recordedCount === 0`

**Rendering:**
- [ ] After the AF team interaction stats block, add individual teacher interaction stats:
  ```
  Teachers: {recorded} ({P} present, {L} leave, {A} absent)
  ```
  With `data-testid="individual-teacher-stats-{action.id}"`

#### Test checklist — update `ActionPointList.test.tsx`
- [ ] Test: stats render for individual teacher interaction card with recorded teachers
- [ ] Test: stats show attendance breakdown
- [ ] Test: stats show nothing when data is empty/undefined
- [ ] Standalone stats unit tests (~5 tests): null cases, counting logic, mixed attendance

#### Verification
- [ ] All tests pass
- [ ] New test count: ~8 tests

---

### 3.6 Update action detail page tests — `src/app/visits/[id]/actions/[actionId]/page.test.tsx`

#### Implementation checklist — test cases to write (~5 tests)
- [ ] Test: loads the Individual AF Teacher Interaction renderer for the action type
- [ ] Test: bootstraps payload — initializes null data to `{ teachers: [] }`
- [ ] Test: auto-saves data before calling `/end`
- [ ] Test: shows save failure details with type-specific message
- [ ] Test: shows `/end` 422 guidance with type-specific message

#### Verification
- [ ] All tests pass (existing + 5 new)

---

### Phase 3 gate
- [ ] `npx tsc --noEmit` — zero errors
- [ ] All new and existing component tests pass
- [ ] Full suite: `npm run test` — all tests pass

---

## Phase 4: E2E Tests

### 4.1 Add data builder + teacher seeding — `e2e/helpers/db.ts`

#### Implementation checklist
- [ ] Add `buildCompleteIndividualTeacherInteractionData(teacherIds?: Array<{id: number, name: string}>)` function
  - Default: uses `[{ id: 1, name: "Test Teacher" }]` with attendance `"present"` and all 13 questions answered
  - Generates `{ teachers: [{ id, name, attendance: "present", questions: { [all 13 keys]: { answer: true } } }] }`
- [ ] Verify: returned payload passes `validateIndividualTeacherComplete()` (strict-valid)
- [ ] Add `seedIndividualTeacherTestTeachers(pool: Pool, schoolCode: string)` function:
  - Upserts a deterministic set of teacher `user_permission` rows for the test school (e.g., 3 teachers)
  - Returns the seeded teacher IDs and names for use in data builders and assertions
  - Uses `INSERT ... ON CONFLICT (email) DO UPDATE` to be idempotent against dump data
  - Also cleans up any other teacher rows for the test school code that aren't in the seeded set (to avoid dump interference)

---

### 4.2 Add form-filling helper — `e2e/tests/visits.spec.ts`

#### Implementation checklist
- [ ] Add `fillIndividualTeacherInteractionForm(page: Page)` function:
  - Select first teacher from dropdown
  - Select "Present" attendance
  - Answer all 13 questions with "Yes"
  - Click "Add Teacher"
  - Verify teacher appears in recorded list

---

### 4.3 Add E2E test scenarios — `e2e/tests/visits.spec.ts`

**Test 1: PM creates, starts, fills, and ends individual teacher interaction**
- Full lifecycle: add action -> start -> open -> add all teachers -> end
- Assert: action completed, stats visible on card, DB has correct data

**Test 2: END blocked when not all teachers recorded**
- **Teacher seeding**: In `beforeAll`, seed a deterministic set of teacher `user_permission` rows for the test school (e.g., 3 teachers with known IDs). This ensures the all-teachers check is deterministic regardless of what the DB dump contains. Use `INSERT ... ON CONFLICT DO UPDATE` to upsert, same pattern as existing test user seeding in `e2e/helpers/test-users.ts`.
- Seed action with partial teacher data (only 1 of the 3 seeded teachers recorded)
- Try END -> assert 422 error about missing teachers

**Test 3: Absent/on-leave teachers recorded without questions**
- Add teacher with "Absent" -> verify no questions shown, teacher recorded
- Add remaining teachers -> END succeeds

**Test 4: Visit completion requires all 3 action types**
- Seed visit with only classroom_observation + af_team_interaction (no individual teacher)
- Try complete -> assert 422 error mentioning "Individual AF Teacher Interaction"

**Test 5: Visit completes with all 3 action types**
- Seed all 3 completed actions -> complete visit -> assert success

**Test 6: Program admin can view but not interact**
- Navigate as program_admin -> assert read-only view

#### Verification
- [ ] All 6 new E2E tests pass
- [ ] No existing E2E tests broken (existing completion tests need updating due to new requirement)

> **Important**: Existing E2E visit completion tests that only include classroom observation will now fail. They must be updated to also seed completed AF team interaction AND individual teacher interaction actions. Use `buildCompleteAFTeamInteractionData()` and `buildCompleteIndividualTeacherInteractionData()` with the seeded teacher IDs.
>
> **Specific E2E tests that will break:**
> - `complete-blocked-without-rubric-valid-completed-classroom-observation` — currently seeds only classroom observation + principal meeting; needs all 3 completed action types seeded
> - `admin-can-complete-other-pm-visit-with-same-rules` (first completion attempt) — currently seeds only principal meeting; needs all 3 completed action types seeded

---

### Phase 4 gate
- [ ] `npm run test:e2e` — all tests pass (existing updated + 6 new)
- [ ] Coverage collected and `coverage/coverage-summary.json` regenerated

---

## Phase 5: Documentation

Update these files to reflect the new action type and the visit completion rule change (all 3 action types now required).

#### 5.1 Remove old "only classroom observation required" references

The previous completion rule ("only classroom observation required, AF team interaction is supplementary") appears in multiple files. All of these must be updated to reflect the new rule: **all 3 action types are required for visit completion.**

| File | Line(s) | What to change |
|------|---------|----------------|
| `CLAUDE.md` | ~118 | Remove "Visit completion does NOT require AF team interaction — only `classroom_observation` is required" → replace with new rule |
| `docs/ai/project-context.md` | ~154 | Remove "(AF team interaction is supplementary — not required for visit completion)" from completion requirements → add all 3 types |
| `docs/ai/project-context.md` | ~184 | Remove "COMPLETE visit: does NOT require AF team interaction — only classroom observation is required" → replace with new rule |
| `docs/ai/af-team-interaction/2026-03-05-af-team-interaction-implementation-plan.md` | ~313, ~377, ~904 | Update/annotate: the "supplementary" and "not required" statements are now superseded |
| `ralph/archive/2026-03-06-af-team-interaction/prd-af-team-interaction.md` | ~16, ~67, ~238 | Update/annotate: FR-8 and related statements are now superseded |
| `src/app/api/pm/visits/[id]/complete/route.test.ts` | ~362 | Update test name "AF team interaction is supplementary" and its comments (lines ~364-366) |

#### 5.2 Add new action type documentation

- `docs/ai/project-context.md` — add individual AF teacher interaction section, update enabled types
- `CLAUDE.md` — add individual teacher interaction summary

#### 5.3 Key documentation updates checklist
- [ ] Action types: 9 -> 10, enabled: 2 -> 3
- [ ] Visit completion: now requires all 3 action types (remove all old "only classroom observation" references per table above)
- [ ] New config/validation file: `src/lib/individual-af-teacher-interaction.ts`
- [ ] New form component: `src/components/visits/IndividualAFTeacherInteractionForm.tsx`
- [ ] Unit test count updates
- [ ] E2E test count updates
- [ ] Update auto-memory file (`MEMORY.md`) — update unit test count (currently "1142 tests across 75 files") and E2E test count (currently "28 E2E tests") to reflect new totals

---

## Phase 6: Verification

### 6.1 Automated test verification
- [ ] `npm run test` — all unit tests pass
- [ ] `npm run test:unit:coverage` — coverage report generated
- [ ] `npm run test:e2e` — all E2E tests pass
- [ ] `npx tsc --noEmit` — zero errors
- [ ] `npm run lint` — no new lint errors

### 6.2 Manual dev server smoke test

#### Happy path
- [ ] Log in as PM -> navigate to school -> start visit
- [ ] Add "Individual AF Teacher Interaction" action -> start -> open
- [ ] Select teacher -> select "Present" -> fill 13 questions -> "Add Teacher"
- [ ] Select another teacher -> select "Absent" -> "Add Teacher" (no questions needed)
- [ ] Verify progress bar: "Recorded: 2/N teachers"
- [ ] Click Save -> verify PATCH succeeds
- [ ] When all teachers recorded -> "End Action" -> verify success

#### Attendance gating
- [ ] Select "On Leave" -> verify no questions shown
- [ ] Select "Absent" -> verify no questions shown
- [ ] Switch to "Present" -> verify questions appear

#### Edit/remove
- [ ] Expand a recorded teacher card -> edit an answer -> Save
- [ ] Remove a teacher -> verify they reappear in dropdown

#### End action validation
- [ ] With partial teachers: "End Action" -> verify 422 (not all teachers recorded)
- [ ] With all teachers + incomplete present-teacher answers: "End Action" -> verify 422

#### Visit completion (new rules)
- [ ] Visit with only classroom observation: "Complete Visit" -> verify 422 mentioning missing types
- [ ] Visit with all 3 completed: "Complete Visit" -> verify success

#### Regression
- [ ] Classroom observation flow unchanged
- [ ] AF team interaction flow unchanged
- [ ] Other disabled action types still disabled in picker

---

## Files Summary

**New files (4):**
- `src/lib/individual-af-teacher-interaction.ts` — config, data types, lenient/strict validation
- `src/lib/individual-af-teacher-interaction.test.ts` — config + validation tests
- `src/components/visits/IndividualAFTeacherInteractionForm.tsx` — multi-teacher form component
- `src/components/visits/IndividualAFTeacherInteractionForm.test.tsx` — form tests

**Modified files:**
- `src/lib/visit-actions.ts` — add `individual_af_teacher_interaction` (1 line)
- `src/lib/visit-actions.test.ts` — update count 9 -> 10
- `src/components/visits/ActionTypePickerModal.tsx` — enable 3rd action type
- `src/components/visits/ActionDetailForm.tsx` — form dispatch, config entry, sanitize/bootstrap, save-before-end, error messages
- `src/components/visits/ActionPointList.tsx` — stats function + rendering
- `src/app/api/pm/visits/[id]/actions/[actionId]/route.ts` — PATCH validation
- `src/app/api/pm/visits/[id]/actions/[actionId]/end/route.ts` — END validation + all-teachers DB check
- `src/app/api/pm/visits/[id]/complete/route.ts` — require all 3 action types
- `e2e/helpers/db.ts` — add data builder + teacher seeding helper for deterministic all-teachers check
- `e2e/tests/visits.spec.ts` — add helper + 6 new E2E tests + update existing completion tests
- `docs/ai/project-context.md` — document new action type + update rules + test counts
- `CLAUDE.md` — update action type summary + rules + test counts

**Modified test files (unit):**
- `src/components/visits/ActionTypePickerModal.test.tsx` — enable tests
- `src/components/visits/ActionPointList.test.tsx` — stats tests
- `src/app/api/pm/visits/[id]/actions/[actionId]/route.test.ts` — PATCH validation tests
- `src/app/api/pm/visits/[id]/actions/[actionId]/end/route.test.ts` — END validation tests
- `src/app/api/pm/visits/[id]/complete/route.test.ts` — completion rule change (many existing tests updated + new tests)
- `src/app/visits/[id]/actions/[actionId]/page.test.tsx` — form dispatch tests

**Estimated test count changes:**
- New unit test files: 2 (~26 validation + ~24 form = ~50 tests)
- Updated unit test files: 6 (~36 new tests + many existing tests updated for completion rule change)
- Estimated new unit tests: ~86
- New E2E tests: 6 + updates to existing completion tests

---

## Risk areas

1. **Visit completion rule change** affects all existing successful completion tests (unit + E2E). All existing tests that complete visits with only classroom observation must be updated to include all 3 action types. This is a confirmed product decision. No visits exist on production yet (only staging), so no migration is needed. Phase 5.1 lists all old documentation references that must be updated to remove the superseded "only classroom observation required" rule.

2. **All-teachers DB query in END route** introduces a new pattern (DB-dependent validation during action end). This needs careful testing for:
   - Empty teacher list edge case
   - Teacher list changing between action start and end
   - Performance (additional DB query on every END)
   - **E2E determinism**: The test DB dump may contain teacher rows for the test school. E2E tests must seed a deterministic set of teachers and clean up stray rows to avoid flaky all-teachers checks.

3. **Multi-teacher form component** is the most complex UI piece. The add/edit/remove flow with conditional questions per attendance status has many state transitions to test.
