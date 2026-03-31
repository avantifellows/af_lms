# Plan: Add Principal Interaction Action Type

## Context

The PM school visit system currently supports 3 enabled action types (`classroom_observation`, `af_team_interaction`, `individual_af_teacher_interaction`) plus 7 disabled types (including `principal_meeting`). The product team needs a 4th enabled type — **Principal Interaction** — a 7-question binary+remark checklist about the PM's interaction with the school Principal.

**Key decisions:**
- **New key `principal_interaction`** replaces the existing `principal_meeting` (which is removed entirely)
- **Required for visit completion** — all 4 action types must have a completed instance
- **No teacher/entity selection** — just questions (simplest form in the system)
- **Typos from CSV are fixed** in the question text (see corrections table below)

**CSV typo corrections (intentional):**

| Original (CSV) | Corrected |
|---|---|
| "Where you able to..." | "Were you able to..." (×2 questions) |
| "discuss about the student" | "discuss the student" |
| "Where there any request or concern raised to The Principal?" | "Were there any requests or concerns raised to the Principal?" |
| "Is the plan for upcoming month" | "Is the plan for the upcoming month" |
| "permission obtained for upcoming activities activites" | "permissions obtained for upcoming activities?" |
| "Implementaion Progress" | "Implementation Progress" |
| "Student perfrormance on Monthly tests" | "Student Performance on Monthly Tests" |

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

**7 questions across 5 sections:**

| Key | Section | Question |
|-----|---------|----------|
| `oh_program_feedback` | Operational Health | Does the Principal have any feedback or concerns on the program implementation? |
| `ip_curriculum_progress` | Implementation Progress | Were you able to provide an update of curriculum progress with the Principal? |
| `ip_key_events` | Implementation Progress | Were you able to provide an update of other key events with the Principal? |
| `sp_student_performance` | Student Performance on Monthly Tests | Did you share and discuss the student performance? |
| `sn_concerns_raised` | Support Needed | Were there any requests or concerns raised to the Principal? |
| `mp_monthly_plan` | Monthly Planning | Is the plan for the upcoming month discussed with the Principal? |
| `mp_permissions_obtained` | Monthly Planning | Were the necessary permissions obtained for upcoming activities? |

> **Note:** Keys `sp_student_performance` and `mp_monthly_plan` intentionally overlap with keys in AF Team Interaction and Individual AF Teacher Interaction. This is safe — each action type stores its data in its own separate JSONB `data` column per action row, so there is zero runtime collision. The same key names are used because they represent the same question concepts across interaction types.

---

## Phase 1: Foundation — Config + Validation + Type Registry

### 1.1 Create `src/lib/principal-interaction.ts` (NEW)

Follow `src/lib/af-team-interaction.ts` pattern but simpler (no `teachers` array).

- Export `PRINCIPAL_INTERACTION_CONFIG` — 5 sections, 7 questions, `allQuestionKeys`
- Export `PrincipalInteractionData` interface — `{ questions: Record<string, { answer: boolean | null; remark?: string }> }`
- Export `validatePrincipalInteractionSave()` — lenient (partial OK, unknown question keys ignored, unknown top-level keys rejected)
- Export `validatePrincipalInteractionComplete()` — strict (all 7 answered with non-null boolean)
- `ALLOWED_TOP_LEVEL_KEYS = new Set(["questions"])` — no `teachers`

### 1.2 Create `src/lib/principal-interaction.test.ts` (NEW)

Follow `src/lib/af-team-interaction.test.ts` pattern. ~20 tests covering:
- Config integrity (5 sections, 7 unique keys)
- Lenient: empty OK, partial OK, unknown question keys ignored, unknown top-level keys rejected, type checks
- Strict: all 7 required, null rejected, labels in errors, fully complete accepted

### 1.3 Update `src/lib/visit-actions.ts`

- Remove `principal_meeting: "Principal Meeting"` (line 2)
- Add `principal_interaction: "Principal Interaction"` in its place
- Total stays at 10 types. `ActionType` union auto-updates.

### 1.4 Update `src/lib/visit-actions.test.ts`

- Replace `principal_meeting: true` with `principal_interaction: true` in the exhaustiveness record

### 1.5 Update `src/components/visits/ActionDetailForm.tsx` (must land atomically with 1.3)

- Remove `principal_meeting` entry from `ACTION_FORM_CONFIGS`
- Add `principal_interaction` entry with `title: "Principal Interaction Details"`, `description: "Record observations from the interaction with the school Principal."`, `fields: []` (custom component)
- Add `PRINCIPAL_INTERACTION_ACTION_TYPE` constant
- Add to `SAVE_BEFORE_END_TYPES` set

---

## Phase 2: API Route Integration

### 2.1 PATCH validation — `src/app/api/pm/visits/[id]/actions/[actionId]/route.ts`

- Import `validatePrincipalInteractionSave` + `validatePrincipalInteractionComplete`
- Add `principal_interaction` validation block (lenient for in_progress, strict for completed) after the individual teacher block
- Error message: `"Invalid principal interaction data"` (follows pattern of `"Invalid AF team interaction data"`)

### 2.2 END validation — `src/app/api/pm/visits/[id]/actions/[actionId]/end/route.ts`

- Import `validatePrincipalInteractionComplete`
- Add `principalInteractionValidationError()` function (same pattern as `afTeamValidationError`)
- Wire into both primary and concurrent-fallback validation chains
- No "all teachers recorded" check needed
- Error message: `"Invalid principal interaction data"` with validation errors array (follows `afTeamValidationError` pattern)

### 2.3 COMPLETE visit — `src/app/api/pm/visits/[id]/complete/route.ts`

- Add 4th check after individual teacher (line ~205): query for ≥1 completed `principal_interaction` action
- Sequential order: in-progress → classroom → AF team → individual teacher → **principal interaction** → UPDATE
- Error message: `"At least one completed Principal Interaction is required to complete visit"` with detail `["No completed principal_interaction action found"]`

### 2.4 API route tests

**`route.test.ts`** (PATCH): Add `buildValidPrincipalInteractionData()` helper + ~4 tests for lenient/strict validation
**`end/route.test.ts`** (END): Add ~5 tests for strict validation on end
**`complete/route.test.ts`** (COMPLETE):
  - **3 happy-path tests need a 7th `mockResolvedValueOnce`** inserted for the new `principal_interaction` check (after individual teacher mock, before UPDATE mock):
    - Line 264: `"completes visit, sets completed fields, and does not expose lat/lng"`
    - Line 331: `"allows admin to complete other PM visit"`
    - Line 411: `"completes visit when all 3 action types have completed actions"` → rename to `"...all 4 action types..."`
  - New mock to add in each chain: `.mockResolvedValueOnce([{ id: 601 }])` (principal_interaction found)
  - **IMPORTANT:** After adding the 7th mock, the UPDATE query moves from index 5 to index 6 in the call chain. Update `mockQuery.mock.calls[5]` → `mockQuery.mock.calls[6]` at line 300 in the first happy-path test (`"completes visit, sets completed fields..."`), since the UPDATE query is now the 7th call (index 6) instead of the 6th (index 5).
  - Tests that short-circuit earlier do NOT need updating — each fails before reaching the new principal_interaction check:
    - **Line 366** (`"returns 422 when af_team_interaction is missing"`): Short-circuits at the AF team check (3rd query), which comes before both individual teacher and principal_interaction checks. No 7th mock needed.
    - **Line 388** (`"returns 422 when individual_af_teacher_interaction is missing"`): Short-circuits at the individual teacher check (4th query), which comes before the principal_interaction check. No 7th mock needed.
    - **Line 444** (`"returns 422 when classroom_observation has invalid rubric"`): Short-circuits at the classroom rubric validation check (2nd query), well before principal_interaction. No 7th mock needed.
  - **Add new test**: `"returns 422 when principal_interaction is missing"` — chains 6 mocks (visit + in-progress + classroom + af_team + individual_teacher + empty principal_interaction result `[]`), expects 422 with message about principal interaction required

---

## Phase 3: Form Component + Integration

### 3.1 Create `src/components/visits/PrincipalInteractionForm.tsx` (NEW)

Simplest form in the system — follows `AFTeamInteractionForm.tsx` but without any teacher section:
- Props: `data`, `setData`, `disabled` (no `schoolCode` — unlike AFTeamInteractionForm and IndividualAFTeacherInteractionForm, this form has no teacher selection and therefore no need to fetch teachers)
- Sticky progress: "Answered: X/7" at `top-12 z-10`
- 5 sections with bordered cards, each question has Yes/No radios + optional remark
- `data-testid="action-renderer-principal_interaction"`
- No fetch calls, no loading state, no teacher dropdown

### 3.2 Create `src/components/visits/PrincipalInteractionForm.test.tsx` (NEW)

~15 tests: rendering (sections, questions, progress), interactions (radio, remark), read-only mode, no teacher UI

### 3.3 Wire into `src/components/visits/ActionDetailForm.tsx`

- Import `PrincipalInteractionForm` + `PRINCIPAL_INTERACTION_CONFIG`
- Add `sanitizePrincipalInteractionPayload()` — follows `sanitizeAFTeamPayload` pattern (lines 358-397) minus the `teachers` array:
  1. Return `{ questions: {} }` if data isn't a plain object
  2. Iterate over only the 7 known question keys from `PRINCIPAL_INTERACTION_CONFIG.allQuestionKeys`
  3. For each known key, extract only `answer` (boolean|null) and `remark` (string)
  4. Return `{ questions }` — no teachers array
- Add `bootstrapPrincipalInteractionPayload()` — bootstrap shape is `{ questions: {} }` (return `sanitizePrincipalInteractionPayload(data)` if data is a plain object)
- Add `principal_interaction` case in `normalizeFormDataForAction` (calls `bootstrapPrincipalInteractionPayload`), `sanitizePatchData`, and JSX dispatch

---

## Phase 4: Action Cards + Picker Modal

### 4.1 Stats in `src/components/visits/ActionPointList.tsx`

- Import `PRINCIPAL_INTERACTION_CONFIG`
- Add `getPrincipalInteractionStats()` — returns answered count / total (7)
- Render stats on `principal_interaction` action cards

### 4.2 Enable in `src/components/visits/ActionTypePickerModal.tsx`

- Add `|| actionType === "principal_interaction"` to the enabled check (line 47) — now 4 enabled

### 4.3 Update tests

- `ActionPointList.test.tsx`: Change `makeAction()` default `action_type` from `principal_meeting` to `leadership_meeting` (line 42), plus update 5 other `principal_meeting` key references at lines 84, 233, 277, 379, 554 to `leadership_meeting`. **Also update 2 display-name assertions:** line 237 `"Principal Meeting"` → `"Leadership Meeting"` and line 247 `"Principal Meeting"` → `"Leadership Meeting"` (these assert on the rendered label, which changes when the action_type key changes). Then add ~3 new tests for `principal_interaction` stats.
- `ActionTypePickerModal.test.tsx`: Update enabled count 3→4, disabled count 7→6, add test for `principal_interaction` selectable
- `page.test.tsx` (action detail — `src/app/visits/[id]/actions/[actionId]/page.test.tsx`):
  1. Change default `makeAction()` helper (line 104) from `action_type: "principal_meeting"` to `"leadership_meeting"` (generic disabled type that won't trigger any custom renderer)
  2. **Rewrite** the renderer test at line 482 (`"loads the principal meeting renderer for principal_meeting actions"`) to verify `PrincipalInteractionForm` renders for `principal_interaction` actions (not just delete/rename to another disabled type)
  3. Update `data-testid` assertions: `"action-renderer-principal_meeting"` → `"action-renderer-principal_interaction"` at lines 492 and 1346

---

## Phase 5: Rename Ripple — `principal_meeting` → other type in test fixtures

18 files reference `principal_meeting`. Source files are covered in phases 1-4. Remaining source + test/E2E files:

### Source rename — `NewVisitForm.tsx`

**`src/components/visits/NewVisitForm.tsx`:**
1. Line 244: Change `"Principal Meeting"` → `"Principal Interaction"` (user-facing instructional text)
2. Line 248: Fix outdated completion text — change `"Complete the visit after at least one Classroom Observation is completed and no action is in progress."` → `"Complete the visit after all required action types are completed and no action is in progress."` (this text is already wrong today — it only mentions Classroom Observation but the system requires 4 types)

**`src/components/visits/NewVisitForm.test.tsx`:**
- Line 235: Update regex assertion to match the new completion text — change `/Complete the visit after at least one Classroom Observation/i` → `/Complete the visit after all required action types are completed/i`

### Unit test renames (`principal_meeting` → `leadership_meeting`)

| File | Change |
|------|--------|
| `src/hooks/use-auto-save.test.ts` | Change sample action type to `leadership_meeting` |
| `src/app/visits/[id]/page.test.tsx` | Change sample action type to `leadership_meeting`. **Also update display-name assertion at line 211:** `"Principal Meeting"` → `"Leadership Meeting"` (rendered label changes when action_type key changes) |
| `src/app/api/pm/visits/[id]/route.test.ts` | Change sample action type |
| `src/app/api/pm/visits/[id]/actions/route.test.ts` | Find-and-replace-all `principal_meeting` → `leadership_meeting` (7 occurrences: line 72 `ACTION_ROWS` constant + lines 213, 229, 244, 261, 276, 291 POST request bodies) |
| `src/app/api/pm/visits/[id]/actions/[actionId]/route.test.ts` | Change `BASE_ACTION_ROW.action_type` |
| `src/app/api/pm/visits/[id]/actions/[actionId]/end/route.test.ts` | Change `PENDING_ACTION.action_type` |

### E2E changes (`e2e/tests/visits.spec.ts`) — split by context

**Add `buildCompletePrincipalInteractionData()` to `e2e/helpers/db.ts`:**
- Follows existing pattern (alongside `buildCompleteClassroomObservationData`, `buildCompleteAFTeamInteractionData`, `buildCompleteIndividualTeacherInteractionData`)
- Returns `{ questions: { [key]: { answer: true } } }` for all 7 question keys from `PRINCIPAL_INTERACTION_CONFIG.allQuestionKeys`

**Rename-only (3 tests)** — `principal_meeting → leadership_meeting` (safe, completion not tested):

| Test (line) | Why safe to rename | Extra action |
|---|---|---|
| `complete-blocked-without-rubric...` (line 291) | Short-circuits at classroom check before reaching principal | **Also add** a `principal_interaction: completed` seed with `buildCompletePrincipalInteractionData()` — proactive fix so the test only fails for the deliberately-invalid classroom rubric data, not for a missing action type that's irrelevant to the test's purpose. Prevents latent breakage if someone later fixes the classroom data. |
| `complete-blocked-when-any-action-in-progress` (line 332) | Tests in-progress blocking, not completion | None |
| `program-admin-read-only` (line 536) | Uses `principal_meeting` as a generic action type for read-only access testing; not completion-related | None |

**Completion-impacting (4 tests)** — need `principal_interaction: completed` with valid data:

| Test (line) | Current state | Required fix |
|---|---|---|
| `moderate-gps-warning-visible` (line 382) | Seeds `principal_meeting: pending` (started+ended during test) | **Two changes:** (1) Rename the existing `principal_meeting: pending` seed to `leadership_meeting: pending` — keep it as the action the test starts and ends for GPS warning testing (it is not a completion-required type, so it doesn't interfere). The test captures `actionId` from this seed and POSTs to `/start` (requires `status = 'pending'`) and `/end` (requires `status = 'in_progress'`) — using a completed action would cause a 409 error. (2) **Add** a new `seedVisitAction` call: `principal_interaction: completed` with `data: buildCompletePrincipalInteractionData()` — this satisfies the 4th visit completion requirement so the visit complete call returns 200+GPS warning instead of 422. |
| `admin-can-complete-other-pm-visit` (line 497) | Seeds `principal_meeting: completed` | Change to `principal_interaction: completed` with `buildCompletePrincipalInteractionData()` (NOT `leadership_meeting`) |
| `complete-visit-success` (line 348) | No principal seed at all | **Add** `seedVisitAction` with `principal_interaction: completed` + `buildCompletePrincipalInteractionData()` |
| `visit-completes-with-all-three-required-action-types` (line 757) | No principal seed at all | **Add** `seedVisitAction` with `principal_interaction: completed` + `buildCompletePrincipalInteractionData()`; rename test to `...all-four-required-action-types` |

**New E2E test — `visit-completion-requires-principal-interaction`:**

Add a new test following the exact pattern of `visit-completion-requires-individual-teacher-interaction` (line 977):
- Seed `classroom_observation: completed` with `buildCompleteClassroomObservationData()`
- Seed `af_team_interaction: completed` with `buildCompleteAFTeamInteractionData()`
- Seed `individual_af_teacher_interaction: completed` with `buildCompleteIndividualTeacherInteractionData()`
- Do NOT seed `principal_interaction`
- Click "Complete Visit" button
- Assert the error message `"At least one completed Principal Interaction is required to complete visit"` is visible

This ensures full-stack coverage of the user-facing validation message, matching the existing E2E coverage for classroom (line 710) and individual teacher (line 977) required types.

**Note:** `CompleteVisitButton.test.tsx` does NOT need changes — it mocks API responses and the existing error messages remain unchanged (the new 4th check is added after the existing ones).

Doc-only files (no code changes needed, just historical reference):
- `docs/ai/af-team-interaction/...` — historical plan, no update needed
- `docs/ai/school-visit-action-points/...` — historical plans
- `docs/ai/classroom-observation/...` — historical plans

---

## Phase 6: Pre-Deployment + Documentation

### 6.0 Pre-deployment checklist

**Data migration (if needed):**
1. Run against production DB before deploying:
   ```sql
   SELECT COUNT(*) FROM lms_pm_school_visit_actions
   WHERE action_type = 'principal_meeting' AND deleted_at IS NULL;
   ```
2. If count > 0, run a data migration to convert old rows:
   ```sql
   UPDATE lms_pm_school_visit_actions
   SET action_type = 'leadership_meeting'
   WHERE action_type = 'principal_meeting' AND deleted_at IS NULL;
   ```
3. If count = 0, no action needed. (Note: the UI won't crash on old rows — it has fallback handling — but it will show a degraded experience with a generic label and basic "Notes" form.)

**Deployment communication:**
- Communicate to PMs that a new "Principal Interaction" action is now **required** to complete visits. Any visit currently `in_progress` will be blocked from completing until the PM adds + completes a `principal_interaction` action.
- Consider deploying at the start of a week/month when fewer visits are in-progress, to minimize disruption to mid-visit PMs.

### 6.1 `CLAUDE.md`

- Add **PM Visits: Principal Interaction (v1)** section
- Update visit completion rule: 3 → 4 required types
- Update action type picker: 3 → 4 enabled types
- Add test files to inventory
- Remove `principal_meeting` references

### 6.2 `docs/ai/project-context.md`

- Add Principal Interaction subsection under §3.5
- Update visit completion rule
- Update action type counts (3 enabled → 4, 7 disabled → 6)

---

## Files Summary

### New (4):
1. `src/lib/principal-interaction.ts`
2. `src/lib/principal-interaction.test.ts`
3. `src/components/visits/PrincipalInteractionForm.tsx`
4. `src/components/visits/PrincipalInteractionForm.test.tsx`

### Modified — source (8):
1. `src/lib/visit-actions.ts` — remove principal_meeting, add principal_interaction
2. `src/components/visits/ActionDetailForm.tsx` — config, sanitizer, dispatch
3. `src/components/visits/ActionPointList.tsx` — stats function + render
4. `src/components/visits/ActionTypePickerModal.tsx` — enable principal_interaction
5. `src/app/api/pm/visits/[id]/actions/[actionId]/route.ts` — PATCH validation
6. `src/app/api/pm/visits/[id]/actions/[actionId]/end/route.ts` — END validation
7. `src/app/api/pm/visits/[id]/complete/route.ts` — 4th required type
8. `src/components/visits/NewVisitForm.tsx` — rename "Principal Meeting" → "Principal Interaction" + fix outdated completion text

### Modified — tests (13):
1. `src/lib/visit-actions.test.ts`
2. `src/app/api/pm/visits/[id]/actions/[actionId]/route.test.ts`
3. `src/app/api/pm/visits/[id]/actions/[actionId]/end/route.test.ts`
4. `src/app/api/pm/visits/[id]/complete/route.test.ts`
5. `src/components/visits/ActionPointList.test.tsx`
6. `src/components/visits/ActionTypePickerModal.test.tsx`
7. `src/app/visits/[id]/actions/[actionId]/page.test.tsx`
8. `src/hooks/use-auto-save.test.ts`
9. `src/app/visits/[id]/page.test.tsx`
10. `src/app/api/pm/visits/[id]/route.test.ts` + `actions/route.test.ts`
11. `e2e/tests/visits.spec.ts`
12. `e2e/helpers/db.ts` — add `buildCompletePrincipalInteractionData()` helper
13. `src/components/visits/NewVisitForm.test.tsx` — update completion text regex assertion

### Documentation (2):
1. `CLAUDE.md`
2. `docs/ai/project-context.md`

---

## Key Reusable Code

- **Pattern template**: `src/lib/af-team-interaction.ts` — closest match (binary+remark, no rubric scoring)
- **Form template**: `src/components/visits/AFTeamInteractionForm.tsx` — minus teacher section
- **Shared types**: `ValidationResult` pattern from `af-team-interaction.ts`
- **Teacher utils**: NOT needed (no teacher selection)
- **Theme tokens**: `src/lib/theme.ts` for inline styles

---

## Verification

After each phase:
1. `npx tsc --noEmit` — type check passes
2. `npx vitest run` — all unit tests pass
3. After Phase 5: `npm run test:e2e` — E2E tests pass
4. Manual: start dev server, create visit, add Principal Interaction action, fill form, end action, complete visit with all 4 types
