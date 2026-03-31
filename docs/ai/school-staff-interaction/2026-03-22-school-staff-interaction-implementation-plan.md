# Plan: Add School Staff Interaction Action Type

## Context

The PM school visit system currently has 6 required action types (classroom_observation, af_team_interaction, individual_af_teacher_interaction, principal_interaction, group_student_discussion, individual_student_discussion). We are adding the 7th: **School Staff Interaction** -- a simple binary+remark checklist with NO entity selection (no teacher/student/grade selection). This is structurally identical to **Principal Interaction** (simplest form in the system).

**Key decisions:**
- **New key `school_staff_interaction`** -- added to `ACTION_TYPES`
- **Required for visit completion** -- all 7 action types must have a completed instance
- **No teacher/student/grade selection** -- just questions (simple checklist like principal interaction)

**Source:** "LMS Field Visit - Forms and Templates.xlsx" > "School Staff Interaction" tab

---

## RESOLVED: Full Question List

~~Only Q1 and Q2 are clearly visible in the screenshot. The spreadsheet shows columns Q1-Q6 but remaining question texts are not legible.~~

**Confirmed:** There are exactly 2 questions. Q3-Q6 do not exist. The plan is correct as-is.

---

## Data Shape (JSONB `data` column)

```typescript
{
  questions: {
    [key: string]: {
      answer: boolean | null,   // Yes/No/unanswered
      remark?: string           // always optional
    }
  }
}
```

Identical to Principal Interaction data shape. No `teachers`, `students`, or `grade` fields.

**Questions (confirmed):**

| Key | Section | Question |
|-----|---------|----------|
| `gc_staff_concern` | General Check | Did any school staff raise any concern related to the program? |
| `gc_pertaining_issue` | General Check | Is there a pertaining issue from any school staff that affects the program? |

> **Prefix convention:** `gc_` for "General Check" section, following the pattern used in `group-student-discussion.ts`.

---

## Phase 1: Foundation -- Config + Validation + Type Registry

### 1.1 Create `src/lib/school-staff-interaction.ts` (NEW)

Copy pattern exactly from `src/lib/principal-interaction.ts` (203 lines). This is the simplest checklist pattern (questions-only, no entity selection).

**Interfaces** (copy from principal-interaction.ts, rename types):
```typescript
export interface ValidationResult { valid: boolean; errors: string[] }
export interface QuestionConfig { key: string; label: string }
export interface SectionConfig { title: string; questions: QuestionConfig[] }
export interface SchoolStaffInteractionConfig { sections: SectionConfig[]; allQuestionKeys: string[] }
export interface SchoolStaffInteractionData {
  questions: Record<string, { answer: boolean | null; remark?: string }>;
}
```

**Config** -- 1 section, 2 questions (confirmed; may grow):
```typescript
const sections: SectionConfig[] = [
  {
    title: "General Check",
    questions: [
      { key: "gc_staff_concern", label: "Did any school staff raise any concern related to the program?" },
      { key: "gc_pertaining_issue", label: "Is there a pertaining issue from any school staff that affects the program?" },
    ],
  },
];

export const SCHOOL_STAFF_INTERACTION_CONFIG: SchoolStaffInteractionConfig = {
  sections,
  allQuestionKeys: sections.flatMap((s) => s.questions.map((q) => q.key)),
};
```

**Constants:**
```typescript
const ALLOWED_TOP_LEVEL_KEYS = new Set(["questions"]);
```

**Validation functions** (copy `validateQuestions` from principal-interaction.ts, identical logic):
- `validateSchoolStaffInteractionSave(data)` -- lenient:
  - Rejects unknown top-level keys
  - If `questions` present: null answers OK, partial OK, unknown question keys ignored
- `validateSchoolStaffInteractionComplete(data)` -- strict:
  - All questions (currently 2) must have non-null boolean answers
  - Reports question labels (not keys) in error messages

### 1.2 Create `src/lib/school-staff-interaction.test.ts` (NEW)

Copy pattern from `src/lib/principal-interaction.test.ts` (226 lines). Adapt for 1 section, 2 questions. ~20 tests:

- **Config integrity**: 1 section "General Check", 2 unique keys, allQuestionKeys matches sections
- **Lenient (save)**: accepts `{}`, partial, null answers, remarks, fully valid; rejects unknown top-level keys, non-boolean answer, non-string remark, null/string/array data
- **Strict (complete)**: rejects empty, incomplete (1/2), null answers; reports labels in errors; accepts fully complete

### 1.3 Update `src/lib/visit-actions.ts`

Add `school_staff_interaction: "School Staff Interaction"` to `ACTION_TYPES`. Total becomes 7 types. `ActionType` union auto-updates.

### 1.4 Update `src/lib/visit-actions.test.ts`

- Add `school_staff_interaction: true` to exhaustive record
- Change expected length from 6 to 7
- Add `isActionType("school_staff_interaction")` and `getActionTypeLabel` assertions

---

## Phase 2: API Route Integration

### 2.1 PATCH validation -- `src/app/api/pm/visits/[id]/actions/[actionId]/route.ts`

- Import `validateSchoolStaffInteractionSave` + `validateSchoolStaffInteractionComplete`
- Add `school_staff_interaction` validation block after `individual_student_discussion` (lenient for in_progress, strict for completed)
- Error message: `"Invalid school staff interaction data"`

### 2.2 END validation -- `src/app/api/pm/visits/[id]/actions/[actionId]/end/route.ts`

- Import `validateSchoolStaffInteractionComplete`
- Add `schoolStaffInteractionValidationError()` function (same pattern as `principalInteractionValidationError`)
- Wire into BOTH primary and concurrent-fallback validation chains
- No "all teachers/students recorded" DB check needed
- Error message: `"Invalid school staff interaction data"` with validation errors array

### 2.3 COMPLETE visit -- `src/app/api/pm/visits/[id]/complete/route.ts`

- Add 7th check after `individual_student_discussion`: query for >= 1 completed `school_staff_interaction` action
- Sequential order: in-progress -> classroom -> AF team -> individual teacher -> principal -> group student -> individual student -> **school staff** -> UPDATE
- Error message: `"At least one completed School Staff Interaction is required to complete visit"` with detail `["No completed school_staff_interaction action found for this visit"]`

### 2.4 API route tests

Add import `SCHOOL_STAFF_INTERACTION_CONFIG` from `@/lib/school-staff-interaction` to both the PATCH test file (`route.test.ts`) and the END test file (`end/route.test.ts`), following the existing config import pattern at lines 17-25 in each file.

**PATCH `route.test.ts`:** +4 tests for lenient/strict validation on school_staff_interaction (following the 4-test-per-type pattern):
1. `"accepts empty school_staff_interaction data for in-progress action (lenient)"` -- lenient valid
2. `"returns 422 for school_staff_interaction with unknown top-level keys (lenient)"` -- lenient invalid
3. `"returns 422 for incomplete school_staff_interaction on completed action (strict)"` -- strict invalid
4. `"accepts complete school_staff_interaction data on completed action (strict)"` -- strict valid

Also add `buildValidSchoolStaffInteractionData()` builder function at the top of the file (lines 93-156 area), following the existing per-type builder pattern.
**END `end/route.test.ts`:** +5 tests for strict validation on end (following the 5-test-per-type pattern):
1. `"returns 422 when school staff interaction data is incomplete"` -- strict incomplete rejected
2. `"returns 422 when school staff interaction stored data is null"` -- null data rejected
3. `"ends school staff interaction successfully when all questions answered"` -- strict complete succeeds
4. `"returns 422 when school staff interaction has all null answers"` -- all-null rejected
5. `"concurrent fallback validates school staff interaction data"` -- concurrent fallback validates

Also add `buildValidSchoolStaffInteractionData()` builder function at the top of the file (lines 118-183 area), following the existing per-type builder pattern.
**COMPLETE `complete/route.test.ts`:**
- **3 existing happy-path tests** each need an additional `.mockResolvedValueOnce([{ id: 901 }])` for the new `school_staff_interaction` type check (inserted after the `individual_student_discussion` mock). The UPDATE query mock index shifts by +1 in each:
  1. **Line 264:** `"completes visit, sets completed fields, and does not expose lat/lng"` -- add mock (9 -> 10 total). Also fix assertion `mockQuery.mock.calls[8]` -> `mockQuery.mock.calls[9]` (the completion UPDATE query index shifts).
  2. **Line 334:** `"allows admin to complete other PM visit with same validation rules and GPS"` -- add mock (9 -> 10 total).
  3. **Line 492:** `"completes visit when all 6 action types have completed actions"` -- add mock (9 -> 10 total) + rename to `"...all 7 action types..."`.
- +1 new test: `"returns 422 when school_staff_interaction is missing"`

---

## Phase 3: Form Component + Integration

### 3.1 Create `src/components/visits/SchoolStaffInteractionForm.tsx` (NEW)

Copy pattern exactly from `src/components/visits/PrincipalInteractionForm.tsx` (171 lines). Simplest form pattern -- no entity selection, just sections with binary radio+remark questions.

**Props:** `{ data, setData, disabled }` -- no `schoolCode`

**Layout:**
```
+----------------------------------------------+
| Answered: 0/2                                 |  <- sticky progress bar (top-12 z-10)
+----------------------------------------------+
| +-- General Check --------------------------+ |
| | Did any school staff raise any concern     | |
| | related to the program?                    | |
| | O Yes  O No  [Add remark]                 | |
| |                                            | |
| | Is there a pertaining issue from any       | |
| | school staff that affects the program?     | |
| | O Yes  O No  [Add remark]                 | |
| +--------------------------------------------+ |
+----------------------------------------------+
```

**Key test IDs:**
- Outer: `data-testid="action-renderer-school_staff_interaction"`
- Radios: `school-staff-interaction-{key}-yes`, `school-staff-interaction-{key}-no`
- Remark: `school-staff-interaction-{key}-remark`
- Progress: `school-staff-interaction-progress`

### 3.2 Create `src/components/visits/SchoolStaffInteractionForm.test.tsx` (NEW)

Copy pattern from `src/components/visits/PrincipalInteractionForm.test.tsx` (208 lines). ~12 tests:
- Renders 1 section ("General Check"), 2 questions with Yes/No radios
- Progress "Answered: 0/2" initially, updates on selection
- Remark toggle/change
- Pre-existing answers render correctly
- Disabled mode: radios disabled, no "Add remark" buttons

### 3.3 Wire into `src/components/visits/ActionDetailForm.tsx`

10 insertion points (same pattern used for every previous action type):

1. **Import** `SchoolStaffInteractionForm` + `SCHOOL_STAFF_INTERACTION_CONFIG`
2. **Constant** `SCHOOL_STAFF_INTERACTION_ACTION_TYPE = "school_staff_interaction" as const`
3. **Add to `SAVE_BEFORE_END_TYPES`** Set
4. **`ACTION_FORM_CONFIGS`** -- add `school_staff_interaction` entry:
   ```typescript
   school_staff_interaction: {
     title: "School Staff Interaction Details",
     description: "Record interactions with school staff regarding the program.",
     fields: [],
   },
   ```
5. **Sanitize function** `sanitizeSchoolStaffInteractionPayload(data)` -- copy `sanitizePrincipalInteractionPayload`, use `SCHOOL_STAFF_INTERACTION_CONFIG`
6. **Bootstrap function** `bootstrapSchoolStaffInteractionPayload(data)` -- return `{ questions: {} }` or sanitized
7. **`normalizeFormDataForAction` + `sanitizePatchData`** -- add branches
8. **Form renderer** -- add SchoolStaffInteractionForm branch in JSX dispatch

> **Note:** The END 422 error message in ActionDetailForm.tsx falls through to the generic message ("Please complete all required fields before ending this interaction") for school_staff_interaction. This is intentional -- same as principal_interaction. Do NOT add a custom error branch.

---

## Phase 4: Action Cards + Stats

### 4.1 Stats in `src/components/visits/ActionPointList.tsx`

- Import `SCHOOL_STAFF_INTERACTION_CONFIG` (needed because the stats function iterates `allQuestionKeys` to count answered questions -- same as `getPrincipalInteractionStats` which imports `PRINCIPAL_INTERACTION_CONFIG`. Note: not all types import their config here -- e.g. `individual_student_discussion` counts `students.length` directly.)
- Add `getSchoolStaffInteractionStats()` -- returns answered count / total (2). Export the function for direct unit testing.
- Render stats on `school_staff_interaction` action cards (answered/total with %)

### 4.2 `ActionTypePickerModal.tsx` -- NO CHANGES NEEDED

Already iterates all `ACTION_TYPE_VALUES` with no enabled/disabled gating. New type appears automatically.

### 4.3 Test updates

- `ActionPointList.test.tsx`: +9 tests (3 card rendering + 6 stats function unit tests):
  - **Card rendering (3):** renders stats with answered questions; shows nothing when data is empty/undefined; shows nothing when no questions are answered
  - **`getSchoolStaffInteractionStats` function (6):** partial payload (some answered); complete payload (all answered); undefined data returns null; empty questions returns null; null answers don't count (only boolean); ignores unknown question keys
- `ActionTypePickerModal.test.tsx`: +2 tests (selectable + submit): `"school_staff_interaction radio is selectable (not disabled)"` and `"submits school_staff_interaction when selected and Add clicked"`
- `page.test.tsx` (action detail): +3 tests following principal_interaction pattern (renderer dispatch, PATCH save with sanitized data, save-before-end flow)

---

## Phase 5: E2E Tests

### 5.1 `e2e/helpers/db.ts` -- add builder

Add import `SCHOOL_STAFF_INTERACTION_CONFIG` from `../../src/lib/school-staff-interaction` to `e2e/helpers/db.ts` (following the existing 6-import pattern at lines 6-14).

```typescript
export function buildCompleteSchoolStaffInteractionData(): Record<string, unknown> {
  const questions: Record<string, { answer: boolean }> = {};
  for (const key of SCHOOL_STAFF_INTERACTION_CONFIG.allQuestionKeys) {
    questions[key] = { answer: true };
  }
  return { questions };
}
```

### 5.2 `e2e/tests/visits.spec.ts` -- update existing completion tests

**4 specific E2E tests** each need one additional completed `school_staff_interaction` seed:

| Line | Test Name | Current Seeds | New Total | Additional Change |
|------|-----------|---------------|-----------|-------------------|
| 399 | `complete-visit-success` | 7 (6 completed + 1 pending noise) | **8** | None |
| 445 | `moderate-gps-warning-visible` | 7 (6 completed + 1 pending GPS test action) | **8** | None |
| 578 | `admin-can-complete-other-pm-visit-with-same-rules` | 6 | **7** | None |
| 849 | `visit-completes-with-all-six-required-action-types` | 6 | **7** | Rename to `"...all-seven-required-action-types"` + add `school_staff_interaction` card visibility assertion + update comment from "Assert all 6 action cards visible" to "Assert all 7 action cards visible" |

Each gets:
```typescript
await seedVisitAction(pool, visitId, {
  actionType: "school_staff_interaction",
  status: "completed",
  data: buildCompleteSchoolStaffInteractionData(),
});
```

### 5.3 New E2E test -- `visit-completion-requires-school-staff-interaction`

Following the pattern of existing completion-required tests:
- Seed all 6 existing types as completed
- Do NOT seed `school_staff_interaction`
- Click "Complete Visit"
- Assert error: `"At least one completed School Staff Interaction is required to complete visit"`

### 5.4 (Optional) New E2E test -- `pm-creates-starts-fills-and-ends-school-staff-interaction`

An end-to-end form workflow test: create action -> start -> fill questions -> end. This is optional -- principal_interaction also lacks a dedicated form workflow E2E test, so omitting this is consistent with the simplest-form pattern. Unit tests cover the form logic.

---

## Phase 6: Documentation

### 6.1 `CLAUDE.md`

- **Update the Project Overview paragraph** (line 9) to append school staff interaction to the comma-separated list of action types. Add: ", and a school staff interaction checklist (2 binary questions, no teacher/student/grade selection)"
- Add **PM Visits: School Staff Interaction (v1)** section
- Update visit completion rule: 6 -> 7 required types
- Add test files to inventory
- Update test counts: run `npx vitest run` after implementation and use the actual output counts (the current baseline "89 files, 1572 tests" is already stale -- do not project from it)

### 6.2 `docs/ai/project-context.md`

- Add School Staff Interaction subsection under section 3.5
- Update visit completion rule and action type counts
- **Fix all stale action type references** (some already stale pre-feature, all need fixing):

| Line | Current text | Update needed |
|------|-------------|---------------|
| 154 | Visit completion short-circuit chain lists only 6 types | Add `school_staff_interaction` as 7th in sequence |
| 251-252 | "10 action types defined in code" / "Six enabled ... 4 disabled" | Replace with 7 types, all enabled, no disabled. List: `classroom_observation`, `af_team_interaction`, `individual_af_teacher_interaction`, `principal_interaction`, `group_student_discussion`, `individual_student_discussion`, `school_staff_interaction` |
| 271 | ActionPointList stats description lists 6 types | Add `school_staff_interaction` stats |
| 272 | ActionTypePickerModal lists 6 types as "enabled" | Add `school_staff_interaction` |
| 285 | "ACTION_TYPES map (10 types)" | Change to "(7 types)" |

---

## Files Summary

### New (4):
1. `src/lib/school-staff-interaction.ts`
2. `src/lib/school-staff-interaction.test.ts`
3. `src/components/visits/SchoolStaffInteractionForm.tsx`
4. `src/components/visits/SchoolStaffInteractionForm.test.tsx`

### Modified -- source (6):
1. `src/lib/visit-actions.ts` -- add school_staff_interaction
2. `src/components/visits/ActionDetailForm.tsx` -- config, sanitizer, bootstrap, dispatch
3. `src/components/visits/ActionPointList.tsx` -- stats function + render
4. `src/app/api/pm/visits/[id]/actions/[actionId]/route.ts` -- PATCH validation
5. `src/app/api/pm/visits/[id]/actions/[actionId]/end/route.ts` -- END validation
6. `src/app/api/pm/visits/[id]/complete/route.ts` -- 7th required type

### Modified -- tests (~9):
1. `src/lib/visit-actions.test.ts`
2. `src/app/api/pm/visits/[id]/actions/[actionId]/route.test.ts`
3. `src/app/api/pm/visits/[id]/actions/[actionId]/end/route.test.ts`
4. `src/app/api/pm/visits/[id]/complete/route.test.ts`
5. `src/components/visits/ActionPointList.test.tsx`
6. `src/components/visits/ActionTypePickerModal.test.tsx`
7. `src/app/visits/[id]/actions/[actionId]/page.test.tsx`
8. `e2e/helpers/db.ts`
9. `e2e/tests/visits.spec.ts`

### Documentation (2):
1. `CLAUDE.md`
2. `docs/ai/project-context.md`

**4 new files, ~17 modified files. ~1,000 new lines total (including tests).**

---

## Components Verified as Needing NO Changes

| Component | Why |
|-----------|-----|
| `CompleteVisitButton.tsx` | Validation is 100% server-side; button is generic |
| `use-auto-save.ts` | Universal hook; works via `sanitizePatchData()` |
| `visits/[id]/page.tsx` | Generic progress counter |
| `visits/[id]/actions/[actionId]/page.tsx` | Form dispatch is in ActionDetailForm.tsx |
| `ActionTypePickerModal.tsx` | Already iterates all ACTION_TYPE_VALUES -- no gating |
| `actions/route.ts` (POST create) | Accepts any ActionType key, no type-specific logic |
| `actions/[actionId]/start/route.ts` | Type-agnostic |

---

## Verification

After each phase:
1. `npx tsc --noEmit` -- type check passes
2. `npx vitest run` -- all unit tests pass
3. After Phase 5: `npm run test:e2e` -- E2E tests pass
4. Manual: start dev server, create visit, add School Staff Interaction action, fill form, end action, complete visit with all 7 types
