# Plan: Add AF Team Interaction Action Type

## Context

The PM school visit system currently supports only `classroom_observation` as an enabled action type. The product team needs a second action type — **AF Team Interaction** — to record observations from a PM's group interaction with all teachers at a school. This is a structured binary+remark checklist (not a scored rubric), with a multiselect teacher dropdown.

---

## Data Shape (JSONB `data` column)

```typescript
{
  teachers: Array<{ id: number; name: string }>,  // selected teachers
  questions: {
    [key: string]: {
      answer: boolean | null,   // Yes=true, No=false, unanswered=null
      remark?: string           // always optional
    }
  }
}
```

> **Design choice**: `teachers` is an array of objects (not parallel `teacher_ids`/`teacher_names` arrays). This prevents index desynchronization bugs, simplifies validation, and is self-documenting in the JSONB column. The `{ id, name }` shape is specific to this action type's persisted data — separate from the API-fetched `Teacher` interface (`{ id, email, full_name }`).

> **No config versioning needed.** Unlike classroom observation's scored rubric (19 params, variable score ranges), this is a simple 9-question binary form. If questions change in a future deploy, lenient validation **ignores** unknown question keys in persisted data (rather than rejecting them), preventing PM lockout. Strict validation only checks that all *current* known keys are answered. This matches how the other 7 non-classroom action types handle schema evolution.

**9 question keys** (flat map — sections are a UI concern only):

> **Note on wording**: The question text below has been cleaned up from the source CSV (`docs/LMS Field Visit - Forms and Templates - AF Team Interaction.csv`), which contained grammar/spelling issues (e.g. "Does the teachers get…", "implementaion", "perfomance", "assisstance"). The corrected wording below is confirmed for implementation.

| Key | Section | Question |
|-----|---------|----------|
| `op_class_duration` | Operational Health | Does the teacher get the required duration of classes? |
| `op_centre_resources` | Operational Health | Is the centre capacitated with all required resources? |
| `op_other_disruptions` | Operational Health | Any other disruptions caused in the implementation? |
| `sp_student_performance` | Student Performance on Monthly Tests | Are there concerns related to student performance? |
| `sp_girls_performance` | Student Performance on Monthly Tests | Are there concerns related to girls student performance? |
| `sn_academics` | Support Needed | Does the teacher need assistance on academics? |
| `sn_school_operations` | Support Needed | Does the teacher need assistance in school operations? |
| `sn_co_curriculars` | Support Needed | Does the teacher need assistance on co-curriculars? |
| `mp_monthly_plan` | Monthly Planning | Is the plan for upcoming month discussed with teachers? |

---

## Phase 1: Foundation (config + validation + type registration)

> **Build order note**: Adding `af_team_interaction` to `ACTION_TYPES` immediately breaks `Record<ActionType, ActionFormConfig>` in `ActionDetailForm.tsx`. Therefore steps 1.1 and 1.5 must land atomically.

### 1.1 Add action type — `src/lib/visit-actions.ts`
- Add `af_team_interaction: "AF Team Interaction"` to `ACTION_TYPES`

#### Implementation checklist
- [ ] Add `af_team_interaction: "AF Team Interaction"` entry to the `ACTION_TYPES` object (after `teacher_feedback`, line ~9)
- [ ] Verify `ActionType` union type auto-expands (it's `keyof typeof ACTION_TYPES`)
- [ ] Verify `ACTION_TYPE_VALUES` auto-expands (derived from `Object.keys(ACTION_TYPES)`)
- [ ] Verify `isActionType("af_team_interaction")` returns `true` (via `value in ACTION_TYPES`)
- [ ] Verify `getActionTypeLabel("af_team_interaction")` returns `"AF Team Interaction"`

#### Verification
- [ ] TypeScript: `npx tsc --noEmit` fails at this point (expected — `ACTION_FORM_CONFIGS` in `ActionDetailForm.tsx` is `Record<ActionType, ...>` and is missing the new key). This is resolved by 1.5.

---

### 1.2 Update exhaustiveness test — `src/lib/visit-actions.test.ts`
- Add `af_team_interaction` to the exhaustiveness record, update count from 8 → 9

#### Implementation checklist
- [ ] Add `af_team_interaction: true` to the `Record<ActionType, true>` object in the test (line ~20)
- [ ] Change `toHaveLength(8)` → `toHaveLength(9)` (line ~26)

#### Verification
- [ ] Test passes: `npx vitest run src/lib/visit-actions.test.ts`

---

### 1.3 Create shared teacher utils — `src/lib/teacher-utils.ts` (NEW)
Extract from `ClassroomObservationForm.tsx` (lines 13-17, 50-52):
```typescript
export interface Teacher {
  id: number;
  email: string;
  full_name: string | null;
}

export function getTeacherDisplayName(teacher: Teacher): string {
  return teacher.full_name || teacher.email;
}
```
Update `ClassroomObservationForm.tsx` to import from `@/lib/teacher-utils` instead of defining locally. The existing `ClassroomObservationForm.test.tsx` constructs mock teacher objects inline and does not import the type, so no test changes needed for this extraction.

#### Implementation checklist
- [ ] Create `src/lib/teacher-utils.ts` with exported `Teacher` interface and `getTeacherDisplayName()` function
- [ ] In `ClassroomObservationForm.tsx`: remove the local `Teacher` interface (lines 13-17) and local `getTeacherDisplayName` function (lines 50-52)
- [ ] In `ClassroomObservationForm.tsx`: add `import { Teacher, getTeacherDisplayName } from "@/lib/teacher-utils"`
- [ ] Confirm `ClassroomObservationForm.tsx` still compiles — verify the `teachers` state type, `fetchTeachers()`, and `handleTeacherChange()` all still work with the imported type

#### Verification
- [ ] `npx vitest run src/components/visits/ClassroomObservationForm.test.tsx` — all existing tests pass unchanged (tests construct inline mock objects, don't import `Teacher`)
- [ ] `npx tsc --noEmit` compiles cleanly for `ClassroomObservationForm.tsx`

---

### 1.4 Create config + validation — `src/lib/af-team-interaction.ts` (NEW)
Following the `classroom-observation-rubric.ts` pattern:

**Exports:**
- `AF_TEAM_INTERACTION_CONFIG` — sections array + `allQuestionKeys` flat list
- `AFTeamInteractionData` interface
- `validateAFTeamInteractionSave(data: unknown): ValidationResult` — lenient
- `validateAFTeamInteractionComplete(data: unknown): ValidationResult` — strict

> Define `ValidationResult` locally (`{ valid: boolean; errors: string[] }`) rather than importing from `classroom-observation-rubric.ts` to avoid conceptual coupling between unrelated modules.

#### Implementation checklist

**Config structure:**
- [ ] Define `ValidationResult` interface: `{ valid: boolean; errors: string[] }`
- [ ] Define `QuestionConfig` interface: `{ key: string; label: string }`
- [ ] Define `SectionConfig` interface: `{ title: string; questions: QuestionConfig[] }`
- [ ] Define `AFTeamInteractionConfig` interface: `{ sections: SectionConfig[]; allQuestionKeys: string[] }`
- [ ] Define `AFTeamInteractionData` interface matching the data shape: `{ teachers: Array<{ id: number; name: string }>; questions: Record<string, { answer: boolean | null; remark?: string }> }`
- [ ] Create `AF_TEAM_INTERACTION_CONFIG` constant with 4 sections:
  - Operational Health (3 questions: `op_class_duration`, `op_centre_resources`, `op_other_disruptions`)
  - Student Performance on Monthly Tests (2 questions: `sp_student_performance`, `sp_girls_performance`)
  - Support Needed (3 questions: `sn_academics`, `sn_school_operations`, `sn_co_curriculars`)
  - Monthly Planning (1 question: `mp_monthly_plan`)
- [ ] Compute `allQuestionKeys` from `sections.flatMap(s => s.questions.map(q => q.key))` (9 keys total)
- [ ] Export `AF_TEAM_INTERACTION_CONFIG`, `AFTeamInteractionData`, `ValidationResult`

**Lenient validation (`validateAFTeamInteractionSave`):**
- [ ] Reject non-object data (null, undefined, string, number, array) → error: "Data must be an object"
- [ ] Reject unknown top-level keys (anything other than `teachers`, `questions`) → error: "Unknown field: {key}"
- [ ] If `teachers` present:
  - [ ] Must be an array → error: "teachers must be an array"
  - [ ] Each entry must have `id` (positive integer) → error: "Teacher entry {i}: id must be a positive integer"
  - [ ] Each entry must have `name` (non-empty string) → error: "Teacher entry {i}: name must be a non-empty string"
  - [ ] Reject duplicate teacher IDs → error: "Duplicate teacher id: {id}"
- [ ] If `questions` present:
  - [ ] Must be a plain object (not array, not null) → error: "questions must be an object"
  - [ ] **Ignore** unknown question keys silently (do NOT reject — graceful config evolution)
  - [ ] For each *known* question key present:
    - [ ] Value must be an object → error: "{label}: must be an object"
    - [ ] `answer` must be `boolean | null` → error: "{label}: answer must be true, false, or null"
    - [ ] `remark` if present must be string → error: "{label}: remark must be a string"
- [ ] All fields optional (empty `{}` is valid)
- [ ] Return `{ valid: true, errors: [] }` when all checks pass

**Strict validation (`validateAFTeamInteractionComplete`):**
- [ ] Run all lenient checks first (call shared helper or inline)
- [ ] `teachers` must be present and non-empty → error: "At least one teacher must be selected"
- [ ] `questions` must be present → error: "All questions must be answered"
- [ ] All 9 current keys must be present with `answer` as `boolean` (not `null`) → error: "{label}: answer is required"
- [ ] Remarks remain optional in strict mode
- [ ] Unknown question keys are still ignored (don't fail strict validation)

#### Verification
- [ ] File compiles: `npx tsc --noEmit` (though full compile will still fail until 1.5)
- [ ] Exports are importable from `@/lib/af-team-interaction`

---

### 1.5 Add `ACTION_FORM_CONFIGS` entry — `src/components/visits/ActionDetailForm.tsx`
Must land with 1.1 to prevent TypeScript errors:
```typescript
af_team_interaction: {
  title: "AF Team Interaction Details",
  description: "Record observations from interaction with all teachers at the school.",
  fields: [],  // custom component, like classroom_observation
},
```

#### Implementation checklist
- [ ] Add `af_team_interaction` entry to `ACTION_FORM_CONFIGS` record (after or near `classroom_observation` entry, within lines 62-204)
- [ ] Set `fields: []` (custom component will be wired in Phase 3.4)
- [ ] Verify the record satisfies `Record<ActionType, ActionFormConfig>` — no TS error

#### Verification
- [ ] `npx tsc --noEmit` passes cleanly (the `Record<ActionType, ActionFormConfig>` constraint is now satisfied)
- [ ] `npx vitest run src/app/visits/\\[id\\]/actions/\\[actionId\\]/page.test.tsx` — existing tests still pass

---

### 1.6 Create validation tests — `src/lib/af-team-interaction.test.ts` (NEW)

#### Implementation checklist — test cases to write

**Config integrity tests (~3 tests):**
- [ ] Test: config has 4 sections with correct titles (Operational Health, Student Performance on Monthly Tests, Support Needed, Monthly Planning)
- [ ] Test: config has 9 total questions with unique keys (3+2+3+1)
- [ ] Test: `allQuestionKeys` matches flattened `sections[].questions[].key` in order

**Lenient validation tests (`validateAFTeamInteractionSave`, ~13 tests):**
- [ ] Test: accepts empty object `{}` → `{ valid: true }`
- [ ] Test: accepts partial questions (3 of 9 answered with `answer: true`) → `{ valid: true }`
- [ ] Test: accepts valid teachers array `[{ id: 1, name: "Alice" }]` → `{ valid: true }`
- [ ] Test: accepts fully valid payload (teachers + all 9 questions) → `{ valid: true }`
- [ ] Test: rejects unknown top-level keys (`{ foo: "bar" }`) → `{ valid: false }`, error contains "Unknown field: foo"
- [ ] Test: **ignores** unknown question keys (`{ questions: { unknown_key: { answer: true } } }`) → `{ valid: true }` (does NOT reject)
- [ ] Test: rejects non-boolean answer value (`"yes"`) → `{ valid: false }`, error references question label
- [ ] Test: rejects non-string remark value (`123`) → `{ valid: false }`
- [ ] Test: rejects non-array `teachers` (`teachers: "Alice"`) → `{ valid: false }`
- [ ] Test: rejects teacher entry missing `id` (`{ name: "Alice" }`) → `{ valid: false }`
- [ ] Test: rejects teacher entry missing `name` (`{ id: 1 }`) → `{ valid: false }`
- [ ] Test: rejects non-positive-integer teacher ID (`{ id: -1, name: "A" }`, `{ id: 1.5, name: "A" }`) → `{ valid: false }`
- [ ] Test: rejects duplicate teacher IDs (`[{ id: 1, name: "A" }, { id: 1, name: "B" }]`) → `{ valid: false }`
- [ ] Test: rejects teacher with empty `name` (`{ id: 1, name: "" }`) → `{ valid: false }`
- [ ] Test: rejects non-object data — null → `{ valid: false }`, "Data must be an object"
- [ ] Test: rejects non-object data — string → `{ valid: false }`
- [ ] Test: rejects non-object data — array → `{ valid: false }`

**Strict validation tests (`validateAFTeamInteractionComplete`, ~7 tests):**
- [ ] Test: rejects empty object `{}` (missing teachers, questions) → `{ valid: false }`, errors mention teachers and questions
- [ ] Test: rejects empty teachers array `[]` → `{ valid: false }`, "At least one teacher must be selected"
- [ ] Test: rejects when not all 9 answers present → `{ valid: false }`, errors list each missing question label
- [ ] Test: rejects `null` answers (requires `boolean`, not `null`) → `{ valid: false }`
- [ ] Test: reports question labels (not keys) in error messages (e.g. "Does the teacher get..." not "op_class_duration")
- [ ] Test: accepts fully complete payload (1+ teachers, all 9 `boolean` answers) → `{ valid: true }`
- [ ] Test: ignores unknown question keys alongside requiring all known keys → `{ valid: true }` with valid payload + extra unknown key

#### Verification
- [ ] All tests pass: `npx vitest run src/lib/af-team-interaction.test.ts`
- [ ] Count: ~23 tests

---

### 1.7 Create teacher-utils tests — `src/lib/teacher-utils.test.ts` (NEW)

#### Implementation checklist — test cases to write
- [ ] Test: `getTeacherDisplayName` returns `full_name` when present (e.g. `{ id: 1, email: "a@b.com", full_name: "Alice" }` → `"Alice"`)
- [ ] Test: `getTeacherDisplayName` falls back to `email` when `full_name` is `null` → `"a@b.com"`
- [ ] Test: `getTeacherDisplayName` falls back to `email` when `full_name` is empty string `""` → `"a@b.com"`

#### Verification
- [ ] All tests pass: `npx vitest run src/lib/teacher-utils.test.ts`
- [ ] Count: 3 tests

---

### Phase 1 gate — all must pass before starting Phase 2
- [ ] `npx tsc --noEmit` — zero errors
- [ ] `npx vitest run src/lib/visit-actions.test.ts` — passes (count 9)
- [ ] `npx vitest run src/lib/teacher-utils.test.ts` — passes (3 tests)
- [ ] `npx vitest run src/lib/af-team-interaction.test.ts` — passes (~23 tests)
- [ ] `npx vitest run src/components/visits/ClassroomObservationForm.test.tsx` — all existing tests pass unchanged
- [ ] `npx vitest run src/app/visits/\\[id\\]/actions/\\[actionId\\]/page.test.tsx` — all existing tests pass unchanged
- [ ] Full suite: `npm run test` — all 1142+ tests pass

---

## Phase 2: API Validation

### 2.1 PATCH route — `src/app/api/pm/visits/[id]/actions/[actionId]/route.ts`
- Import `validateAFTeamInteractionSave`, `validateAFTeamInteractionComplete`
- After the `classroom_observation` block (line 175-184), add matching block for `af_team_interaction`

#### Implementation checklist
- [ ] Add import: `import { validateAFTeamInteractionSave, validateAFTeamInteractionComplete } from "@/lib/af-team-interaction"`
- [ ] After the existing `classroom_observation` validation block (lines 175-184), add:
  ```typescript
  if (action.action_type === "af_team_interaction") {
    const validation =
      action.status === "completed"
        ? validateAFTeamInteractionComplete(data)
        : validateAFTeamInteractionSave(data);
    if (!validation.valid) {
      return apiError(422, "Invalid AF team interaction data", validation.errors);
    }
  }
  ```
- [ ] Verify the pattern matches the `classroom_observation` block exactly (status-based strictness selection)

#### Verification
- [ ] `npx tsc --noEmit` — no errors in route file
- [ ] Existing PATCH tests still pass: `npx vitest run src/app/api/pm/visits/\\[id\\]/actions/\\[actionId\\]/route.test.ts`

---

### 2.2 END route — `src/app/api/pm/visits/[id]/actions/[actionId]/end/route.ts`
- Import `validateAFTeamInteractionComplete`
- Add `afTeamValidationError(action: VisitActionRow)` alongside `classroomValidationError()` — same pattern: early-return if wrong type, call `validateAFTeamInteractionComplete(action.data)` (accepts `unknown`), return `apiError(422, ...)` on failure
- Add checks in **both** the pre-update path (after line 148) **and** the concurrent-fallback path (after line 186)

#### Implementation checklist
- [ ] Add import: `import { validateAFTeamInteractionComplete } from "@/lib/af-team-interaction"`
- [ ] Add `afTeamValidationError()` function (mirror `classroomValidationError` at lines 76-87):
  ```typescript
  function afTeamValidationError(action: VisitActionRow) {
    if (action.action_type !== "af_team_interaction") return null;
    const validation = validateAFTeamInteractionComplete(action.data);
    if (validation.valid) return null;
    return apiError(422, "Invalid AF team interaction data", validation.errors);
  }
  ```
- [ ] Add call in **pre-update path** (after existing `classroomValidationError` call, ~line 148):
  ```typescript
  const afTeamError = afTeamValidationError(action);
  if (afTeamError) return afTeamError;
  ```
- [ ] Add call in **concurrent-fallback path** (after existing re-validation, ~line 186):
  ```typescript
  const afTeamFallbackError = afTeamValidationError(current);
  if (afTeamFallbackError) return afTeamFallbackError;
  ```
- [ ] Confirm both paths are covered (there are exactly 2 places `classroomValidationError` is called — add `afTeamValidationError` at the same 2 places)

#### Verification
- [ ] `npx tsc --noEmit` — no errors
- [ ] Existing END tests still pass: `npx vitest run src/app/api/pm/visits/\\[id\\]/actions/\\[actionId\\]/end/route.test.ts`

---

### 2.3 COMPLETE route — NO CHANGE
> **⚠️ SUPERSEDED (2026-03-09):** Visit completion now requires all 3 action types: `classroom_observation` + `af_team_interaction` + `individual_af_teacher_interaction`. See `individual-af-teacher-interaction` branch.

~~Visit completion does **not** require `af_team_interaction`. Only `classroom_observation` remains required. **Product implication**: a visit with only AF Team Interactions (no classroom observation) cannot be completed. This is intentional.~~

#### Verification
- [ ] Confirm no code changes needed in `src/app/api/pm/visits/[id]/complete/route.ts`
- [ ] Existing COMPLETE tests still pass: `npx vitest run src/app/api/pm/visits/\\[id\\]/complete/route.test.ts`

---

### 2.4 Update PATCH route tests — `src/app/api/pm/visits/[id]/actions/[actionId]/route.test.ts`

#### Implementation checklist — test cases to write

New test scenarios (mirroring existing `classroom_observation` tests):
- [ ] Test: lenient — accepts empty `{}` data for in-progress `af_team_interaction` → 200
  - Mock: action with `action_type: "af_team_interaction"`, `status: "in_progress"`; PATCH body `{ data: {} }`
- [ ] Test: lenient — accepts partial AF team interaction data (some questions answered, no teachers) for in-progress → 200
  - Mock: PATCH body with `{ data: { questions: { op_class_duration: { answer: true } } } }`
- [ ] Test: lenient — rejects unknown top-level keys for `af_team_interaction` → 422
  - Mock: PATCH body `{ data: { foo: "bar" } }` → response contains "Unknown field"
- [ ] Test: lenient — rejects bad types for question answer values → 422
  - Mock: PATCH body with `{ data: { questions: { op_class_duration: { answer: "yes" } } } }`
- [ ] Test: strict — rejects incomplete AF team interaction data on completed action (admin edit) → 422
  - Mock: action with `status: "completed"`, admin session; PATCH body `{ data: { teachers: [], questions: {} } }`
- [ ] Test: strict — rejects AF team interaction data with empty teachers on completed action → 422
  - Mock: full questions but `teachers: []` → error mentions "At least one teacher"
- [ ] Test: strict — accepts fully complete AF team interaction data on completed action (admin) → 200
  - Mock: action with `status: "completed"`, admin session; PATCH body with complete payload (teachers + all 9 boolean answers)

#### Verification
- [ ] All tests pass: `npx vitest run src/app/api/pm/visits/\\[id\\]/actions/\\[actionId\\]/route.test.ts`
- [ ] New test count: +7 tests

---

### 2.5 Update END route tests — `src/app/api/pm/visits/[id]/actions/[actionId]/end/route.test.ts`

#### Implementation checklist — test cases to write
- [ ] Test: 422 when `af_team_interaction` data is incomplete (missing answers)
  - Mock: action row with `action_type: "af_team_interaction"`, `status: "in_progress"`, `data: { teachers: [{ id: 1, name: "A" }], questions: {} }`
  - Assert: 422 response with errors listing missing questions
- [ ] Test: 422 when `af_team_interaction` stored data is null/malformed
  - Mock: action row with `data: null`
  - Assert: 422 with "Data must be an object" error
- [ ] Test: 422 when `af_team_interaction` has empty teachers array
  - Mock: action row with complete questions but `teachers: []`
  - Assert: 422 with "At least one teacher" error
- [ ] Test: ends `af_team_interaction` successfully when data is fully complete
  - Mock: action row with complete payload (teachers + all 9 boolean answers)
  - Assert: 200, returned action has `status: "completed"`, `ended_at` set
- [ ] Test: concurrent fallback path also validates AF team interaction data
  - Mock: first UPDATE returns 0 rows, re-fetch returns same action still `in_progress` with incomplete data
  - Assert: 422 (not 409)

#### Verification
- [ ] All tests pass: `npx vitest run src/app/api/pm/visits/\\[id\\]/actions/\\[actionId\\]/end/route.test.ts`
- [ ] New test count: +5 tests

---

### 2.6 Update COMPLETE route tests — `src/app/api/pm/visits/[id]/complete/route.test.ts`

#### Implementation checklist — test cases to write
- [ ] Test: visit completes successfully with completed `af_team_interaction` alongside required completed `classroom_observation`
  - Mock: visit with 2 actions — one `classroom_observation` (completed, strict-valid rubric) + one `af_team_interaction` (completed, strict-valid payload)
  - Assert: 200, visit `status: "completed"` (**⚠️ SUPERSEDED:** AF team interaction is now mandatory for completion as of 2026-03-09)

#### Verification
- [ ] All tests pass: `npx vitest run src/app/api/pm/visits/\\[id\\]/complete/route.test.ts`
- [ ] New test count: +1 test

---

### Phase 2 gate — all must pass before starting Phase 3
- [ ] `npx tsc --noEmit` — zero errors
- [ ] `npx vitest run src/app/api/pm/visits/\\[id\\]/actions/\\[actionId\\]/route.test.ts` — all pass (existing + 7 new)
- [ ] `npx vitest run src/app/api/pm/visits/\\[id\\]/actions/\\[actionId\\]/end/route.test.ts` — all pass (existing + 5 new)
- [ ] `npx vitest run src/app/api/pm/visits/\\[id\\]/complete/route.test.ts` — all pass (existing + 1 new)
- [ ] Full suite: `npm run test` — all tests pass

---

## Phase 3: UI Components

### 3.1 Enable in picker — `src/components/visits/ActionTypePickerModal.tsx`
- Change `const enabled = actionType === "classroom_observation"` to also include `af_team_interaction`

#### Implementation checklist
- [ ] Change line 47 from:
  ```typescript
  const enabled = actionType === "classroom_observation";
  ```
  to:
  ```typescript
  const enabled = actionType === "classroom_observation" || actionType === "af_team_interaction";
  ```
- [ ] Verify the change preserves the disabled styling (`cursor-not-allowed`, `opacity-40`) for the other 7 types

#### Test checklist — update `ActionTypePickerModal.test.tsx`
- [ ] Test: `af_team_interaction` radio button is selectable (not disabled)
  - Assert: radio input for "AF Team Interaction" does NOT have `disabled` attribute
- [ ] Test: selecting and submitting `af_team_interaction` calls `onSubmit("af_team_interaction")`
  - User event: click radio → click "Add" button → assert `onSubmit` called with `"af_team_interaction"`
- [ ] Test: other 7 action types remain disabled (no existing test covers this — must add)

#### Verification
- [ ] All tests pass: `npx vitest run src/components/visits/ActionTypePickerModal.test.tsx`
- [ ] New test count: +3 tests

---

### 3.2 Create form component — `src/components/visits/AFTeamInteractionForm.tsx` (NEW)

**Props:** `{ data, setData, disabled, schoolCode }` (same shape as ClassroomObservationForm)

**Accessibility:** Follow `ClassroomObservationForm.tsx` patterns:
- Each question's Yes/No radios wrapped in `<fieldset disabled={disabled}>` with `<legend className="sr-only">{questionLabel}</legend>`
- Teacher checkbox group wrapped in `<fieldset>` with `<legend>` "Teachers Present"
- Each checkbox/radio has a proper `<label>` wrapper
- Radio `name` attributes scoped per question: `name="af-team-{key}"`

**Teacher fetch lifecycle:** The teacher-fetching `useEffect` must use a `cancelled` flag in its cleanup function to prevent stale state updates from aborted fetches (same cancellation pattern as `ClassroomObservationForm.tsx` lines 75-107).

#### Implementation checklist

**File structure:**
- [ ] `"use client"` directive at top
- [ ] Import `Teacher`, `getTeacherDisplayName` from `@/lib/teacher-utils`
- [ ] Import `AF_TEAM_INTERACTION_CONFIG` from `@/lib/af-team-interaction`
- [ ] Define props interface matching `ClassroomObservationFormProps`: `{ data: Record<string, unknown>; setData: Dispatch<SetStateAction<Record<string, unknown>>>; disabled: boolean; schoolCode: string }`

**Teacher multiselect section:**
- [ ] State: `teachers: Teacher[]` (API-fetched list), `loading: boolean`, `error: string | null`
- [ ] `useEffect` with `cancelled` flag — fetch `GET /api/pm/teachers?school_code={schoolCode}`
  - [ ] On success: `if (!cancelled) setTeachers(response.teachers)`
  - [ ] On error: `if (!cancelled) setError("Failed to load teachers")`
  - [ ] Cleanup: `return () => { cancelled = true }`
- [ ] Always fetch teachers (even when `disabled`) — matches `ClassroomObservationForm.tsx` pattern for consistency
- [ ] Render checkbox list in scrollable `max-h-48 overflow-y-auto` container
- [ ] Each checkbox: `data-testid="af-team-teacher-{id}"` on the `<input>`
- [ ] Toggle handler: when checked ON, construct `{ id, name }` from fresh API teacher list (use `getTeacherDisplayName`), NOT from persisted `data.teachers`
- [ ] Toggle handler: when unchecked, filter out by `id`
- [ ] **"Select All / Deselect All" toggle button**: `data-testid="af-team-select-all"`
  - [ ] If all fetched teachers are selected → text "Deselect All", action clears array
  - [ ] Otherwise → text "Select All", action adds all fetched teachers
- [ ] **Pre-selected but removed teachers**: if `data.teachers` has IDs not in fetched list, show those names above checkbox list with "(no longer at this school)" label. Fall back to `"Teacher #{id}"` if `name` is empty.
- [ ] **Disabled/read-only mode**: render stored `data.teachers` as static `<span>` elements (no checkboxes; fetch still runs but fetched list is not rendered as interactive elements)

**Gating logic:**
- [ ] Compute `hasTeachers = (data.teachers as Array<...>)?.length > 0`
- [ ] Compute `hasExistingAnswers` = any known question key in `data.questions` has non-null `answer`
- [ ] If `!hasTeachers && !hasExistingAnswers && !disabled`: show "Select at least one teacher to begin" message, hide questions
- [ ] Otherwise: show questions section

**Sticky progress bar:**
- [ ] `data-testid="af-team-progress"`
- [ ] CSS: `sticky top-2 z-10 border-2 border-border-accent bg-bg-card-alt px-3 py-2` (match classroom observation pattern)
- [ ] Content: `"Teachers: {N} | Answered: {X}/9"` where:
  - N = `data.teachers?.length ?? 0`
  - X = count of known question keys with `boolean` answer (not `null`)

**Question sections:**
- [ ] Loop over `AF_TEAM_INTERACTION_CONFIG.sections`
- [ ] Each section: heading with section title
- [ ] Each question:
  - [ ] Wrapped in `<fieldset disabled={disabled}>`
  - [ ] `<legend className="sr-only">{question.label}</legend>`
  - [ ] Question text displayed visually
  - [ ] "Yes" radio: `data-testid="af-team-{key}-yes"`, `name="af-team-{key}"`, `value="true"`, checked when `answer === true`
  - [ ] "No" radio: `data-testid="af-team-{key}-no"`, `name="af-team-{key}"`, `value="false"`, checked when `answer === false`
  - [ ] Radio change handler: updates `data.questions[key].answer` to `true`/`false` via `setData`
  - [ ] "Add remark" toggle button (only shown when not disabled)
  - [ ] Remark textarea: `data-testid="af-team-{key}-remark"`, hidden until toggled, updates `data.questions[key].remark` on change

**Outermost wrapper:**
- [ ] `data-testid="action-renderer-af_team_interaction"` on the root element

#### Verification
- [ ] Component renders without errors in dev mode (manual check deferred to Phase 6)
- [ ] Covered by unit tests in 3.3

---

### 3.3 Create form tests — `src/components/visits/AFTeamInteractionForm.test.tsx` (NEW)

#### Implementation checklist — test cases to write

**Setup:**
- [ ] Mock `global.fetch` for teacher API calls (return `{ teachers: [...] }`)
- [ ] Create helper `renderForm(overrides?)` that renders `<AFTeamInteractionForm data={...} setData={mockSetData} disabled={false} schoolCode="12345" />`
- [ ] Use `@testing-library/react` + `@testing-library/user-event`

**Teacher fetch tests (~4 tests):**
- [ ] Test: fetches teachers on mount with correct `school_code` param
  - Assert: `fetch` called with URL containing `school_code=12345`
- [ ] Test: shows loading state while fetching
  - Assert: loading indicator visible before fetch resolves
- [ ] Test: shows error state on fetch failure
  - Mock: fetch rejects → assert error message visible
- [ ] Test: renders teacher checkboxes after successful fetch
  - Mock: 2 teachers → assert 2 checkbox inputs with correct `data-testid`

**Teacher interaction tests (~6 tests):**
- [ ] Test: toggling a teacher checkbox ON updates `data.teachers` array (calls `setData` with teacher `{ id, name }`)
- [ ] Test: toggling a teacher checkbox OFF removes teacher from array
- [ ] Test: re-toggling a teacher uses fresh display name from API (mock teacher with updated `full_name`; verify `setData` gets the fresh name)
- [ ] Test: handles teacher with `null` full_name — checkbox label shows email (via `getTeacherDisplayName`)
- [ ] Test: "Select All" selects all fetched teachers; button text toggles to "Deselect All"
- [ ] Test: "Deselect All" clears all teachers; button text toggles to "Select All"

**Gating tests (~2 tests):**
- [ ] Test: shows "Select at least one teacher to begin" when no teachers selected AND no questions answered
- [ ] Test: shows questions when teachers array is empty BUT questions have existing `answer` values (e.g. PM previously saved then removed teachers)

**Question interaction tests (~4 tests):**
- [ ] Test: shows all 4 sections and 9 questions after teacher selection
  - Assert: section headers visible, 9 pairs of Yes/No radios present
- [ ] Test: clicking "Yes" radio updates `data.questions[key].answer` to `true`
  - Assert: `setData` called with correct nested update
- [ ] Test: "Add remark" toggle reveals remark textarea (`data-testid="af-team-{key}-remark"`)
- [ ] Test: typing in remark textarea updates `data.questions[key].remark`

**Progress bar tests (~1 test):**
- [ ] Test: progress bar shows correct teacher count and answered count
  - Render with 2 teachers and 5/9 answered → assert text "Teachers: 2 | Answered: 5/9"

**Disabled/read-only tests (~3 tests):**
- [ ] Test: disabled mode shows stored teacher names as static text (no checkboxes rendered)
- [ ] Test: disabled mode: radio buttons and textareas are disabled
- [ ] Test: disabled mode: no "Select All" button, no "Add remark" toggles

**Edge case tests (~2 tests):**
- [ ] Test: handles pre-selected teachers not in current API list — shows name + "(no longer at this school)"
- [ ] Test: handles pre-selected teacher with empty `name` — falls back to "Teacher #{id}"

#### Verification
- [ ] All tests pass: `npx vitest run src/components/visits/AFTeamInteractionForm.test.tsx`
- [ ] Count: ~22 tests

---

### 3.4 Wire into ActionDetailForm — `src/components/visits/ActionDetailForm.tsx`

#### Implementation checklist

**Imports and constants:**
- [ ] Add `import AFTeamInteractionForm from "./AFTeamInteractionForm"`
- [ ] Add `import { AF_TEAM_INTERACTION_CONFIG } from "@/lib/af-team-interaction"`
- [ ] Add constant: `const AF_TEAM_ACTION_TYPE = "af_team_interaction" as const`
- [ ] Add constant: `const SAVE_BEFORE_END_TYPES = new Set([CLASSROOM_ACTION_TYPE, AF_TEAM_ACTION_TYPE])`

> **Scaling note**: `SAVE_BEFORE_END_TYPES` centralizes the "which types save before end?" check, but type-specific error messages (Changes 2 & 3 below) remain as if/else branches. If a 3rd save-before-end action type is added in the future, consider refactoring to a config map (`{ [type]: { saveErrorMsg, endErrorMsg } }`) to keep all type-specific logic in one place. For 2 types this branching is fine.

**Sanitization functions:**
- [ ] Add `sanitizeAFTeamPayload(data: Record<string, unknown>): Record<string, unknown>`:
  - [ ] Return empty object if input is not a plain object
  - [ ] Extract `teachers`: validate each entry has `id` (number) and `name` (string), filter invalid
  - [ ] Extract `questions`: for each key in `AF_TEAM_INTERACTION_CONFIG.allQuestionKeys`, if present, keep `{ answer, remark }` (strip unknown question keys)
  - [ ] Return only `{ teachers, questions }` (no other top-level keys)

> **Data evolution note**: `sanitizeAFTeamPayload` strips unknown question keys on every save. If a question key is removed from the config in a future deploy, any PM who opens an old action and saves will silently lose that question's data. This is consistent with `sanitizeClassroomPayload` (which also strips unknown param keys). If questions are ever removed, migrate existing JSONB data first.
- [ ] Add `bootstrapAFTeamPayload(data: unknown): Record<string, unknown>`:
  - [ ] If `data` is null/undefined/not-object → return `{ teachers: [], questions: {} }`
  - [ ] Otherwise → delegate to `sanitizeAFTeamPayload(data as Record<string, unknown>)`

**Integration points:**

> **CRITICAL ORDER**: In both `normalizeFormDataForAction()` and `sanitizePatchData()`, the AF team branch MUST come BEFORE the generic `!isPlainObject(data)` guard / pass-through. `bootstrapAFTeamPayload` handles null/non-object data internally (returns `{ teachers: [], questions: {} }`). If placed after the guard, new actions with `data: null` would get `{}` instead of the proper AF team structure — a silent rendering bug.

- [ ] Update `normalizeFormDataForAction()` — add branch for `AF_TEAM_ACTION_TYPE` **immediately after** the `CLASSROOM_ACTION_TYPE` branch and **before** the `!isPlainObject(data)` guard:
  ```typescript
  if (action.action_type === AF_TEAM_ACTION_TYPE) {
    return bootstrapAFTeamPayload(action.data);
  }
  ```
- [ ] Update `sanitizePatchData()` — add branch for `AF_TEAM_ACTION_TYPE`:
  ```typescript
  if (actionType === AF_TEAM_ACTION_TYPE) {
    return { data: sanitizeAFTeamPayload(formData) };
  }
  ```
- [ ] Update rendering (~line 729): add `AFTeamInteractionForm` branch:
  ```typescript
  {isClassroomObservation ? (
    <ClassroomObservationForm ... />
  ) : action.action_type === AF_TEAM_ACTION_TYPE ? (
    <AFTeamInteractionForm
      data={formData}
      setData={setFormData}
      disabled={!canSave || isBusy}
      schoolCode={schoolCode}
    />
  ) : (
    /* existing generic form */
  )}
  ```

**`handleEndAction()` changes — 3 specific updates:**
- [ ] **Change 1** (~line 565): Replace `if (isClassroomObservation)` with `if (SAVE_BEFORE_END_TYPES.has(action.action_type))` — save-before-end fires for both types
- [ ] **Change 2** (~lines 572-574, 582-584): Branch error message by action type:
  - `isClassroomObservation` → keep `"Could not save observation. Fix errors and try End again."`
  - `AF_TEAM_ACTION_TYPE` → use `"Could not save form data. Fix errors and try End again."`
- [ ] **Change 3** (~line 611): Replace `if (isClassroomObservation && response.status === 422)` with `if (SAVE_BEFORE_END_TYPES.has(action.action_type) && response.status === 422)`, with type-specific messages:
  - `isClassroomObservation` → keep `"Please complete all required rubric scores before ending this observation."`
  - `AF_TEAM_ACTION_TYPE` → use `"Please complete all required fields before ending this interaction."`

#### Verification
- [ ] `npx tsc --noEmit` — no errors
- [ ] Existing action detail page tests pass: `npx vitest run src/app/visits/\\[id\\]/actions/\\[actionId\\]/page.test.tsx`

---

### 3.5 Add action card stats + data attributes — `src/components/visits/ActionPointList.tsx`

#### Implementation checklist

**Stats function (exported for standalone unit testing):**
- [ ] Import `AF_TEAM_INTERACTION_CONFIG` from `@/lib/af-team-interaction`
- [ ] Define and **export** `AFTeamInteractionStats` interface: `{ teacherCount: number; answeredCount: number; totalQuestions: number }`
- [ ] Add and **export** `getAFTeamInteractionStats(data: Record<string, unknown> | undefined): AFTeamInteractionStats | null`:
  - [ ] Return `null` if data is missing/empty/not-object
  - [ ] Extract `teachers` array → `teacherCount = Array.isArray(teachers) ? teachers.length : 0`
  - [ ] Extract `questions` object → count known keys where `answer` is boolean (`true` or `false`, not `null`) → `answeredCount`
  - [ ] `totalQuestions = AF_TEAM_INTERACTION_CONFIG.allQuestionKeys.length` (9)
  - [ ] Return `null` if both `teacherCount === 0` and `answeredCount === 0` (no meaningful data to display)

**Rendering:**
- [ ] After the classroom observation stats rendering block (~line 422), add AF team interaction stats block:
  ```typescript
  {action.action_type === "af_team_interaction" && (() => {
    const stats = getAFTeamInteractionStats(action.data as Record<string, unknown>);
    if (!stats) return null;
    return (
      <div data-testid={`af-team-stats-${action.id}`}>
        Teachers: {stats.teacherCount} | {stats.answeredCount}/{stats.totalQuestions} ({Math.round(stats.answeredCount / stats.totalQuestions * 100)}%)
      </div>
    );
  })()}
  ```

**Data attributes (verify or add):**
- [ ] Confirm `data-action-type={action.action_type}` exists on each action card (should already be at line ~368-370)
- [ ] Confirm `data-action-status={action.status}` exists on each action card
- [ ] If missing, add both attributes to the card wrapper `<div>`

#### Test checklist — update `ActionPointList.test.tsx`
- [ ] Test: stats render for AF team interaction card with teachers and answered count
  - Mock action: `{ action_type: "af_team_interaction", data: { teachers: [{ id: 1, name: "A" }], questions: { op_class_duration: { answer: true } } } }`
  - Assert: stats element visible with "Teachers: 1" and "1/9"
- [ ] Test: stats show 0/9 when data has teachers but no questions answered
  - Mock: `{ teachers: [{ id: 1, name: "A" }], questions: {} }`
  - Assert: "0/9 (0%)"
- [ ] Test: stats show nothing when data is empty/undefined
  - Mock: `{ action_type: "af_team_interaction", data: undefined }`
  - Assert: no stats element rendered
- [ ] Test: stats show nothing for non-af_team_interaction action types
  - Mock: `{ action_type: "principal_meeting", data: { teachers: [...] } }`
  - Assert: no AF team stats rendered

#### Verification
- [ ] All tests pass: `npx vitest run src/components/visits/ActionPointList.test.tsx`
- [ ] New test count: +4 tests

---

### 3.6 Add standalone stats unit tests — `src/components/visits/ActionPointList.test.tsx`

The `getAFTeamInteractionStats()` function is tested at component level in 3.5, but the computation logic (counting answered questions, handling edge cases) benefits from direct unit tests. These tests import the exported function directly.

#### Implementation checklist — test cases to write

**Happy path (~2 tests):**
- [ ] Test: returns correct counts for full payload — 2 teachers, 5 of 9 answered with boolean → `{ teacherCount: 2, answeredCount: 5, totalQuestions: 9 }`
- [ ] Test: returns correct counts for complete payload — all 9 answered → `{ teacherCount: N, answeredCount: 9, totalQuestions: 9 }`

**Edge cases (~5 tests):**
- [ ] Test: returns `null` for `undefined` data
- [ ] Test: returns `null` for empty object `{}` (both teacherCount and answeredCount are 0)
- [ ] Test: returns `null` for non-object data (e.g. `"string"`, `null`)
- [ ] Test: ignores unknown question keys — only counts known keys from `AF_TEAM_INTERACTION_CONFIG.allQuestionKeys`
- [ ] Test: does NOT count `null` answers — only `true` or `false` count as answered
  - Input: `{ teachers: [{ id: 1, name: "A" }], questions: { op_class_duration: { answer: null } } }` → `answeredCount: 0`

**Teachers edge cases (~2 tests):**
- [ ] Test: handles non-array `teachers` gracefully → `teacherCount: 0`
- [ ] Test: counts teachers correctly even if `questions` is missing → `{ teacherCount: 2, answeredCount: 0, totalQuestions: 9 }`

#### Verification
- [ ] All tests pass: `npx vitest run src/components/visits/ActionPointList.test.tsx`
- [ ] New test count: +9 tests (on top of the +4 component tests from 3.5)

---

### 3.7 Update action detail page tests — `src/app/visits/[id]/actions/[actionId]/page.test.tsx`

This is where integration of form dispatch, sanitization, save-before-end, and error handling is verified. The file has 6 classroom-observation-specific tests and 7 generic tests. Add 5 AF team interaction equivalents (test 2 — unsupported rubric version — has no analog since AF team interaction has no versioning):

#### Implementation checklist — test cases to write

- [ ] Test: loads the AF Team Interaction renderer for `af_team_interaction` actions
  - Mock: GET action returns `{ action_type: "af_team_interaction", status: "in_progress", data: {} }`
  - Assert: `data-testid="action-renderer-af_team_interaction"` is in the DOM
- [ ] Test: bootstraps AF team payload — initializes missing/null data to `{ teachers: [], questions: {} }` and sanitizes (strips unknown keys) on PATCH
  - Mock: GET action returns `{ data: null }` for `af_team_interaction`
  - Trigger save → assert PATCH body contains `{ data: { teachers: [], questions: {} } }` (not null)
  - Also test: if data has unknown key `{ foo: "bar", teachers: [...] }`, PATCH body strips `foo`
- [ ] Test: auto-saves AF team interaction data before calling `/end`
  - Mock: GET action returns in_progress `af_team_interaction` with data
  - Click "End Action" → assert PATCH is called BEFORE POST `/end`
  - Assert: request sequence is `[PATCH, POST /end]`
- [ ] Test: shows AF team interaction save failure details and does NOT call `/end`
  - Mock: PATCH returns 422 error
  - Click "End Action" → assert error toast shows `"Could not save form data. Fix errors and try End again."`
  - Assert: POST `/end` was NOT called
- [ ] Test: shows AF team interaction `/end` 422 guidance with type-specific message
  - Mock: PATCH returns 200, POST `/end` returns 422
  - Assert: error toast shows `"Please complete all required fields before ending this interaction."`

**Existing classroom observation tests**: The two tests at lines 399 and 471 assert classroom-specific error messages. Since the plan preserves the original messages for classroom observation (branching by action type), these tests remain **unchanged**.

#### Verification
- [ ] All tests pass: `npx vitest run src/app/visits/\\[id\\]/actions/\\[actionId\\]/page.test.tsx`
- [ ] New test count: +5 tests
- [ ] Existing 13 tests unchanged and passing

---

### Phase 3 gate — all must pass before starting Phase 4
- [ ] `npx tsc --noEmit` — zero errors
- [ ] `npx vitest run src/components/visits/ActionTypePickerModal.test.tsx` — all pass
- [ ] `npx vitest run src/components/visits/AFTeamInteractionForm.test.tsx` — all pass (~22 tests)
- [ ] `npx vitest run src/components/visits/ActionPointList.test.tsx` — all pass (existing + 13 new: 4 component + 9 standalone stats)
- [ ] `npx vitest run src/app/visits/\\[id\\]/actions/\\[actionId\\]/page.test.tsx` — all pass (existing + 5 new)
- [ ] `npx vitest run src/components/visits/ClassroomObservationForm.test.tsx` — existing tests still pass (regression check)
- [ ] Full suite: `npm run test` — all tests pass

---

## Phase 4: E2E Tests

> **Infrastructure note**: The E2E suite already has all required infrastructure — `seedTestVisit()`, `seedVisitAction()` accept arbitrary action types (app-enforced, not DB-constrained), GPS mocking via `setGoodGps()`, and per-role page fixtures (`pmPage`, `adminPage`, `programAdminPage`). No schema migrations needed — `lms_pm_visit_actions.data` is JSONB and accepts any payload shape.

### 4.1 Add data builder — `e2e/helpers/db.ts`

#### Implementation checklist
- [ ] Add import: `import { AF_TEAM_INTERACTION_CONFIG } from "@/lib/af-team-interaction"`
- [ ] Add `buildCompleteAFTeamInteractionData()` function:
  ```typescript
  export function buildCompleteAFTeamInteractionData(): Record<string, unknown> {
    const questions: Record<string, { answer: boolean; remark?: string }> = {};
    for (const key of AF_TEAM_INTERACTION_CONFIG.allQuestionKeys) {
      questions[key] = { answer: true };
    }
    return {
      teachers: [{ id: 1, name: "Test Teacher" }],
      questions,
    };
  }
  ```
- [ ] Verify: returned payload passes `validateAFTeamInteractionComplete()` (strict-valid)

#### Verification
- [ ] TypeScript compiles: `npx tsc --noEmit` on the E2E helpers

---

### 4.2 Add form-filling helper — `e2e/tests/visits.spec.ts`

#### Implementation checklist
- [ ] Add import: `import { AF_TEAM_INTERACTION_CONFIG } from "@/lib/af-team-interaction"`
- [ ] Add `fillAFTeamInteractionForm()` function:
  ```typescript
  async function fillAFTeamInteractionForm(page: Page) {
    await page.getByTestId("af-team-select-all").click();
    for (const key of AF_TEAM_INTERACTION_CONFIG.allQuestionKeys) {
      await page.getByTestId(`af-team-${key}-yes`).check();
    }
    await expect(page.getByTestId("af-team-progress")).toContainText("Answered: 9/9");
  }
  ```
- [ ] Uses stable `data-testid` selectors (defined in Phase 3.2)
- [ ] Final assertion confirms all 9 questions answered

#### Verification
- [ ] Function compiles (verified when E2E tests run in 4.3)

---

### 4.3 Add E2E test scenarios — `e2e/tests/visits.spec.ts`

Add **5 tests** to the existing visits spec. These follow the established lifecycle pattern: seed DB → set GPS → navigate → interact → assert UI + DB state.

#### Test 1: PM creates, starts, fills, and ends AF team interaction

Happy-path end-to-end flow covering the full action lifecycle.

**Implementation checklist:**
- [ ] Step 1: `seedTestVisit()` → navigate to `/visits/{id}`
- [ ] Step 2: Click "Add Action Point" → select "AF Team Interaction" in picker → click "Add"
- [ ] Step 3: Assert new pending action card visible with text "AF Team Interaction"
- [ ] Step 4: Click "Start" on action card → assert status changes to `in_progress`
- [ ] Step 5: Click "Open" → navigate to action detail page
- [ ] Step 6: Call `fillAFTeamInteractionForm(pmPage)` — select all teachers + answer all 9 questions
- [ ] Step 7: Click "End Action" → verify save-before-end fires (PATCH then POST /end)
- [ ] Step 8: Assert redirect back to visit detail page
- [ ] Step 9: Assert action card shows `data-action-status="completed"`
- [ ] Step 10: Assert action card stats: "Teachers:" and "9/9 (100%)"
- [ ] Step 11: DB assertion: `SELECT data, status FROM lms_pm_visit_actions WHERE id = $1`
  - [ ] `status = 'completed'`
  - [ ] `data.teachers` is non-empty array
  - [ ] `data.questions` has 9 keys, all with `answer: true`

#### Test 2: END blocked when AF team interaction data is incomplete

**Implementation checklist:**
- [ ] Step 1: `seedTestVisit()` + `seedVisitAction(pool, visitId, { actionType: "af_team_interaction", status: "in_progress", data: { teachers: [], questions: {} } })`
- [ ] Step 2: `setGoodGps(pmPage)` → navigate to `/visits/{id}/actions/{actionId}`
- [ ] Step 3: Click "End Action" without filling any fields
- [ ] Step 4: Assert error toast visible with text matching "complete all required fields"
- [ ] Step 5: Assert "End Action" button still in DOM (action was NOT ended)
- [ ] Step 6: DB assertion: `status = 'in_progress'` still

#### Test 3: Visit with only AF team interaction cannot be completed

**Implementation checklist:**
- [ ] Step 1: `seedTestVisit()` + `seedVisitAction(pool, visitId, { actionType: "af_team_interaction", status: "completed", data: buildCompleteAFTeamInteractionData() })`
- [ ] Step 2: `setGoodGps(pmPage)` → navigate to `/visits/{id}`
- [ ] Step 3: Click "Complete Visit"
- [ ] Step 4: Assert error toast contains "classroom observation"
- [ ] Step 5: Assert visit status badge still shows "In Progress"

#### Test 4: Program admin can view but not interact with AF team interaction

**Implementation checklist:**
- [ ] Step 1: `seedTestVisit()` (admin PM email) + `seedVisitAction(pool, visitId, { actionType: "af_team_interaction", status: "in_progress", data: buildCompleteAFTeamInteractionData() })`
- [ ] Step 2: Navigate `programAdminPage` to `/visits/{id}`
- [ ] Step 3: Assert action card visible with "AF Team Interaction"
- [ ] Step 4: Assert "Add Action Point" button NOT visible
- [ ] Step 5: Navigate `programAdminPage` to `/visits/{id}/actions/{actionId}`
- [ ] Step 6: Assert no "Save" button visible
- [ ] Step 7: Assert no "End Action" button visible
- [ ] Step 8: Assert teacher names from `data.teachers` displayed as static text (not checkboxes)
- [ ] Step 9: Assert radio buttons are disabled

#### Test 5: Visit completes with both classroom observation and AF team interaction

**Implementation checklist:**
- [ ] Step 1: `seedTestVisit()`
- [ ] Step 2: `seedVisitAction(pool, visitId, { actionType: "classroom_observation", status: "completed", data: buildCompleteClassroomObservationData() })`
- [ ] Step 3: `seedVisitAction(pool, visitId, { actionType: "af_team_interaction", status: "completed", data: buildCompleteAFTeamInteractionData() })`
- [ ] Step 4: `setGoodGps(pmPage)` → navigate to `/visits/{id}`
- [ ] Step 5: Assert 2 action cards visible with distinct `data-action-type` attributes
- [ ] Step 6: Click "Complete Visit"
- [ ] Step 7: Assert no 422 error toast
- [ ] Step 8: Assert visit shows "completed" state (status badge or redirect)
- [ ] Step 9: Assert both cards show type-appropriate stats (classroom: score; AF team: teachers/questions)

#### Verification
- [ ] All 5 new E2E tests pass: `npm run test:e2e` (alongside existing tests)
- [ ] No existing E2E tests broken (29 existing + 5 new = 34 total)

---

### 4.4 Update E2E test count in documentation

#### Implementation checklist
- [ ] Update `docs/ai/project-context.md`: E2E count from 29 → 34, visit tests from ~14 → ~19
- [ ] Update `CLAUDE.md`: E2E test count references

#### Verification
- [ ] Documentation numbers match actual `npm run test:e2e` output

---

### Phase 4 gate — all must pass before starting Phase 5
- [ ] `npm run test:e2e` — all 34 tests pass (29 existing + 5 new)
- [ ] No existing visit E2E tests broken
- [ ] Coverage collected and `coverage/coverage-summary.json` regenerated

---

## Phase 5: Documentation

Update these files to reflect the new action type:
- `docs/ai/project-context.md` — add AF team interaction to section 3.5 (action types, enabled types, data shape, validation rules, no visit-completion requirement); update E2E test count; update unit test count
- `CLAUDE.md` — add AF team interaction summary alongside classroom observation; update unit test file count and E2E test count

#### Implementation checklist — `docs/ai/project-context.md`
- [ ] Section 3.5, action types: update "8 action types" → "9 action types", add `af_team_interaction` to the list
- [ ] Section 3.5, enabled types: update "Currently only `classroom_observation` is enabled" → "Currently `classroom_observation` and `af_team_interaction` are enabled"
- [ ] Section 3.5: add AF team interaction data shape summary (teachers array + 9 binary questions with remarks)
- [ ] Section 3.5: add validation rules (lenient: partial OK, ignores unknown question keys; strict: all 9 answered + ≥1 teacher)
- [ ] ~~Section 3.5: document that visit completion does NOT require `af_team_interaction` (only `classroom_observation`)~~ **⚠️ SUPERSEDED (2026-03-09):** Visit completion now requires all 3 action types.
- [ ] Section 3.5, key components: add `AFTeamInteractionForm.tsx` entry
- [ ] Section 3.5, shared helpers: add `af-team-interaction.ts` and `teacher-utils.ts` entries
- [ ] Update unit test count: files 75 → 78, tests 1142 → ~1217
- [ ] Update E2E test count: 29 → 34

#### Implementation checklist — `CLAUDE.md`
- [ ] Add AF team interaction summary in "PM Visits" section alongside classroom observation rubric description
- [ ] Update unit test file count and total test count
- [ ] Update E2E test count
- [ ] Add new test file entries to the test file listing

#### Verification
- [ ] Documentation is accurate and consistent between the two files
- [ ] Test counts match actual `npm run test` and `npm run test:e2e` output

---

**Estimated test count changes:**
- New unit test files: 3 (`teacher-utils.test.ts` ~3 tests, `af-team-interaction.test.ts` ~23 tests, `AFTeamInteractionForm.test.tsx` ~22 tests)
- Updated unit test files: 6 (~27 new tests across existing files — includes +3 picker, +13 ActionPointList [4 component + 9 standalone stats], +7 PATCH route, +5 END route, +1 COMPLETE route, +5 action detail page)
- Estimated new unit tests: ~75 (total: 1142 → ~1217, 75 → 78 files)
- New E2E tests: 5 (total: 29 → 34)

---

## Phase 6: Verification

### 6.1 Automated test verification

#### Checklist
- [ ] `npm run test` — all unit tests pass (existing + new ~75)
- [ ] `npm run test:unit:coverage` — coverage report generated
- [ ] Commit updated `unit-coverage/coverage-summary.json`
- [ ] `npm run test:e2e` — all E2E tests pass (existing 29 + new 5 = 34)
- [ ] Commit updated `coverage/coverage-summary.json` (E2E coverage)
- [ ] `npx tsc --noEmit` — zero TypeScript errors
- [ ] `npm run lint` — no new lint errors introduced (pre-existing lint issues excluded)

### 6.2 Manual dev server smoke test

#### Checklist — happy path
- [ ] Start dev server: `npm run dev`
- [ ] Log in as PM → navigate to a school → start a new visit
- [ ] On visit detail: click "Add Action Point" → verify "AF Team Interaction" is selectable in picker
- [ ] Select "AF Team Interaction" → click "Add" → verify pending action card appears with correct label
- [ ] Click "Start" → verify action transitions to `in_progress`
- [ ] Click "Open" → verify action detail page loads with AF Team Interaction form

#### Checklist — form interaction
- [ ] Teacher checkbox list loads (API call to `/api/pm/teachers`)
- [ ] "Select All" selects all teachers; "Deselect All" clears
- [ ] Individual teacher checkboxes toggle correctly
- [ ] Progress bar updates: "Teachers: N | Answered: X/9"
- [ ] Answer all 9 questions with Yes/No radios
- [ ] "Add remark" toggle reveals textarea; typing updates data
- [ ] Click "Save" → verify PATCH succeeds (no error)

#### Checklist — save + end flow
- [ ] With partial data: click "Save" → verify lenient validation passes (partial OK)
- [ ] With incomplete data: click "End Action" → verify 422 error toast ("Please complete all required fields before ending this interaction.")
- [ ] Fill all 9 questions + select ≥1 teacher → click "End Action" → verify success
- [ ] Verify redirect to visit detail with action card showing "completed" status
- [ ] Verify action card stats: teacher count + "9/9 (100%)"

#### Checklist — visit completion rules
- [ ] Visit with ONLY completed AF Team Interaction (no classroom observation): click "Complete Visit" → verify 422 error ("classroom observation" required)
- [ ] Visit with both completed classroom observation + completed AF team interaction: click "Complete Visit" → verify success

#### Checklist — read-only mode
- [ ] Navigate to a completed AF team interaction action detail
- [ ] Verify teacher names displayed as static text (no checkboxes)
- [ ] Verify radio buttons are disabled
- [ ] Verify no "Save" or "End Action" buttons

#### Checklist — regression
- [ ] Classroom observation flow still works unchanged (create, start, fill rubric, end)
- [ ] Dashboard, school pages, admin pages load without errors
- [ ] Other 7 disabled action types still show as disabled in picker

---

## Files Summary

**New files (6):**
- `src/lib/teacher-utils.ts` — shared `Teacher` interface + `getTeacherDisplayName`
- `src/lib/teacher-utils.test.ts` — teacher display name tests
- `src/lib/af-team-interaction.ts` — config, data types, lenient/strict validation
- `src/lib/af-team-interaction.test.ts` — config + validation tests
- `src/components/visits/AFTeamInteractionForm.tsx` — form component
- `src/components/visits/AFTeamInteractionForm.test.tsx` — form tests

**Modified files:**
- `src/lib/visit-actions.ts` — add `af_team_interaction` (1 line)
- `src/lib/visit-actions.test.ts` — update count
- `src/components/visits/ClassroomObservationForm.tsx` — import `Teacher`/`getTeacherDisplayName` from shared util
- `src/components/visits/ActionTypePickerModal.tsx` — enable `af_team_interaction`
- `src/components/visits/ActionDetailForm.tsx` — form dispatch, config entry, sanitize/bootstrap, save-before-end, error messages
- `src/components/visits/ActionPointList.tsx` — stats function + rendering
- `src/app/api/pm/visits/[id]/actions/[actionId]/route.ts` — PATCH validation
- `src/app/api/pm/visits/[id]/actions/[actionId]/end/route.ts` — END validation
- `e2e/helpers/db.ts` — add `buildCompleteAFTeamInteractionData()` builder
- `e2e/tests/visits.spec.ts` — add `fillAFTeamInteractionForm()` helper + 5 new E2E tests
- `docs/ai/project-context.md` — document new action type + update test counts
- `CLAUDE.md` — update action type summary + test counts

**Modified test files (unit):**
- `src/components/visits/ActionTypePickerModal.test.tsx`
- `src/components/visits/ActionPointList.test.tsx`
- `src/app/api/pm/visits/[id]/actions/[actionId]/route.test.ts`
- `src/app/api/pm/visits/[id]/actions/[actionId]/end/route.test.ts`
- `src/app/api/pm/visits/[id]/complete/route.test.ts`
- `src/app/visits/[id]/actions/[actionId]/page.test.tsx`
