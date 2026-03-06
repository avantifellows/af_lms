# Structured Classroom Observation Rubric

## Context

Classroom observations currently use simple text fields (class_details, observations, support_needed). The program team needs a structured scoring rubric: 19 parameters with MCQ options totalling max 45 points, plus per-parameter optional remarks and 2 session-level text fields. The rubric may change 1-2x/year.

**Backward compatibility:** Old classroom observation data (with `class_details`, `observations`, `support_needed`) is discarded. We are starting fresh — no migration needed. Old JSONB rows remain in the DB but are not displayed in the new rubric form. New observations will only use the rubric data shape.

**Agreed design decisions:**
- Hybrid: rubric config in versioned TypeScript, `rubric_version` stamped in each observation's `data` JSONB
- Nested data shape: `data.params.{key}.{score, remarks?}`
- Scrollable card list + sticky live score summary
- Dedicated `ClassroomObservationForm` delegated from `ActionDetailForm`
- End behavior for classroom observation: clicking **End Action** first auto-saves current `formData` (PATCH), then calls `/end` only if save succeeds
- Rubric version behavior:
  - Known version: editable
  - Unknown version: show read-only unsupported-version message in UI and block PATCH/END with clear 422 errors
  - Single UI owner: `ActionDetailForm` handles unsupported-version detection, shows the message, and disables Save/End. `ClassroomObservationForm` stays a presentational form renderer.
- 422 UX contract (classroom observation):
  - For PATCH/END 422 responses, keep the user on the same page with entered data intact and no navigation
  - Show one inline error summary near form controls, with backend `details` rendered as a readable list when present
  - Re-enable actions after the failed request so user can fix inputs and retry
  - END-specific primary message text: `Please complete all required rubric scores before ending this observation.`
- Shared validation lib:
  - PATCH on in-progress classroom observation: lenient (partial OK)
  - PATCH on completed classroom observation (admin edit): strict (all 19 params scored; session text fields optional)
  - END on classroom observation: strict (all 19 params scored; session text fields optional)
- Data contract: classroom observation payloads are schema-checked; unknown top-level keys are rejected (`rubric_version`, `params`, `observer_summary_strengths`, `observer_summary_improvements` only)
- Visit COMPLETE rule: requires at least one completed `classroom_observation` with **valid complete rubric data** (not just `status='completed'`)

---

## Files

### New (4)

| File | Purpose |
|------|---------|
| `src/lib/classroom-observation-rubric.ts` | Rubric config, types, validation fns |
| `src/lib/classroom-observation-rubric.test.ts` | Pure function tests |
| `src/components/visits/ClassroomObservationForm.tsx` | Rubric form component |
| `src/components/visits/ClassroomObservationForm.test.tsx` | Component tests |

### Modified (9)

| File | Change |
|------|--------|
| `src/components/visits/ActionDetailForm.tsx` | Delegate to `ClassroomObservationForm` for `classroom_observation` |
| `src/app/api/pm/visits/[id]/actions/[actionId]/route.ts` | Status-aware PATCH validation (lenient in-progress, strict completed) |
| `src/app/api/pm/visits/[id]/actions/[actionId]/end/route.ts` | Completeness check on END |
| `src/app/api/pm/visits/[id]/actions/[actionId]/route.test.ts` | PATCH validation tests |
| `src/app/api/pm/visits/[id]/actions/[actionId]/end/route.test.ts` | END completeness tests + fixture fix |
| `src/app/api/pm/visits/[id]/complete/route.ts` | Ensure visit completion checks for at least one rubric-valid completed classroom observation |
| `src/app/api/pm/visits/[id]/complete/route.test.ts` | COMPLETE route tests for rubric-valid classroom observation requirement |
| `src/app/visits/[id]/actions/[actionId]/page.test.tsx` | Update classroom renderer + save/end flow assertions for rubric payload |
| `e2e/tests/visits.spec.ts` | Update classroom observation E2E flow to fill rubric instead of old text fields |

---

## Pre-Phase: Readiness Checks (Mandatory Before Step 1)

These are blockers. Do not start implementation steps until this pre-phase is complete.

### Pre-Phase 1: UI payload switch
- Scope: `src/components/visits/ActionDetailForm.tsx`
- Problem today: classroom observation still sends old keys (`class_details`, `observations`, `support_needed`).
- Required action:
  - Route `classroom_observation` to the rubric form path only.
  - Ensure outgoing payload shape is rubric-only: `rubric_version`, `params`, `observer_summary_strengths`, `observer_summary_improvements`.
  - Treat legacy rows as old data to ignore for new submissions.
- Done when:
  - New classroom saves never include legacy top-level keys.
  - Rubric payload shape is visible in page/integration test assertions.

### Pre-Phase 2: Backend payload enforcement
- Scope: `src/app/api/pm/visits/[id]/actions/[actionId]/route.ts`, `src/app/api/pm/visits/[id]/actions/[actionId]/end/route.ts`
- Problem today: API accepts almost any object shape.
- Required action:
  - Add lenient validation for in-progress PATCH (partial rubric allowed).
  - Add strict validation for completed PATCH and END (all required rubric scores present).
  - Reject unknown top-level keys and unknown rubric versions with clear `422` messages/details.
- Done when:
  - Invalid rubric payloads consistently fail with `422`.
  - Valid rubric payloads pass for intended status flows.

### Pre-Phase 3: Visit completion hardening
- Scope: `src/app/api/pm/visits/[id]/complete/route.ts`
- Problem today: visit completion checks only status/type, not rubric validity.
- Required action:
  - Require at least one completed `classroom_observation` with `data` that passes strict rubric validation.
  - Return clear `422` if none are valid.
- Done when:
  - Legacy/incomplete completed classroom observations do not satisfy visit completion.
  - At least one rubric-valid completed classroom observation satisfies this dependency.

### Pre-Phase 4: Test baseline alignment
- Scope: `src/app/visits/[id]/actions/[actionId]/page.test.tsx`, `e2e/tests/visits.spec.ts`, API route tests
- Problem today: tests still use old classroom fields and hide rubric regressions.
- Required action:
  - Replace old classroom field interactions with rubric interactions.
  - Add explicit `422` failure-path assertions (message + retry behavior).
  - Add/keep assertion for auto-save-before-end order (PATCH then `/end`).
- Done when:
  - Classroom observation tests no longer reference legacy classroom keys in active rubric flows.
  - Test suite verifies both success and failure behavior for rubric validation.

### Pre-Phase 5: Consumer impact audit (reports/analytics/docs)
- Scope: in-repo + external consumers (including BigQuery/reporting queries referenced in project context)
- Problem today: downstream consumers may still assume old classroom JSON shape.
- Required action:
  - Create a checklist of every consumer of classroom observation data.
  - Mark each consumer as `updated`, `not needed`, or `needs follow-up`.
  - Update docs that describe completion rules/data shape expectations.
- Done when:
  - Every critical consumer is marked `updated` or `not needed`.
  - No critical consumer remains in `needs follow-up`.

### Pre-Phase Release Gate
- Do not launch the rubric flow until all 5 pre-phase checks are complete.

---

## Step 1: Shared rubric lib

**File:** `src/lib/classroom-observation-rubric.ts`

Types:
```ts
interface RubricOption { label: string; score: number }
interface RubricParameter { key: string; label: string; description?: string; maxScore: number; options: RubricOption[] }
interface SessionField { key: string; label: string; placeholder: string }
interface RubricConfig { version: string; maxScore: number; parameters: RubricParameter[]; sessionFields: SessionField[] }
interface ParamData { score: number; remarks?: string }
interface ClassroomObservationData { rubric_version: string; params: Record<string, ParamData>; observer_summary_strengths?: string; observer_summary_improvements?: string }
interface ValidationResult { valid: boolean; errors: string[] }
```

Exports:
- `CURRENT_RUBRIC_VERSION` = `"1.0"`
- `CLASSROOM_OBSERVATION_RUBRIC: RubricConfig` — 19 parameters, all options/scores from `docs/classroom-observation-notes.md`
- `getRubricConfig(version: string): RubricConfig | null` — for future multi-version lookup
- `computeTotalScore(params): number` — sum scores for live display
- `validateClassroomObservationSave(data): ValidationResult` — lenient: accepts partial, validates score ranges if present, rejects unknown top-level keys; if `rubric_version` is present but unknown, reject
- `validateClassroomObservationComplete(data): ValidationResult` — strict: all 19 params must have valid scores; `rubric_version` required and must be known; rejects unknown top-level keys. Session text fields (`observer_summary_strengths`, `observer_summary_improvements`) are **optional** — not checked on end.

19 parameter keys (45 total max):
`teacher_on_time`(1), `teacher_grooming`(1), `start_note`(1), `pre_task_hw`(1), `recall_test`(2), `learning_objective`(1), `curiosity_introduction`(1), `concept_teaching_competence`(4), `concept_notes_taking`(3), `concept_problem_solving`(4), `concept_doubt_solving`(2), `communication_board`(3), `communication_interaction`(2), `communication_body_language`(6), `class_conclusion`(3), `pace_of_teaching`(2), `time_management`(3), `classroom_management`(2), `gender_sensitivity`(3)

**Note:** `time_management` has no 0-score option (min=1). Validation checks against actual option scores, not 0..maxScore. The form must only render options [1, 2, 3] for this parameter — no placeholder zero option. This happens naturally since the rubric config's `options` array won't include a 0-score entry.

---

## Step 2: Rubric lib tests

**File:** `src/lib/classroom-observation-rubric.test.ts`

No mocks needed (pure functions). Key test groups:
- Config correctness: 19 params, sum=45, each param has options including maxScore, unique keys
- `computeTotalScore`: empty=0, partial sums, max=45
- Save validation: accepts `{}`, accepts partial, rejects out-of-range score, rejects non-number score, rejects unknown top-level keys
- Save validation: rejects unknown `rubric_version` when provided
- Complete validation: rejects missing params (reports which ones), rejects missing/unknown `rubric_version`, accepts all-19-filled
- `time_management` edge: score=0 rejected (not a valid option)

---

## Step 3: ClassroomObservationForm component

**File:** `src/components/visits/ClassroomObservationForm.tsx`

Props:
```ts
interface ClassroomObservationFormProps {
  formData: Record<string, unknown>;
  onFormDataChange: (updater: (prev: Record<string, unknown>) => Record<string, unknown>) => void;
  disabled: boolean;
}
```

Structure:
1. **Rubric version stamp on mount** — if `formData.rubric_version` missing, call `onFormDataChange` to inject `CURRENT_RUBRIC_VERSION`. Use a `useEffect` with an early return guard (`if (formData.rubric_version) return`) so it's idempotent across React strict-mode double-mounts and doesn't trigger unnecessary re-renders.
   - If `formData.rubric_version` already exists, do not overwrite it.
   - Do not perform unsupported-version checks here; parent (`ActionDetailForm`) owns that logic.
2. **Sticky score bar** (`sticky top-0 z-10 bg-white`) — shows `{score} / 45` + `{answered} / 19 answered`, updates live
   - Behavior contract (must be consistent):
     - Score updates immediately after any radio selection change.
     - `answered` counts only parameters that currently have a valid selected score.
     - Remarks/session text changes do **not** change score or `answered` count.
3. **19 parameter cards** — each with:
   - Label + optional description
   - **Radio buttons** for options (better mobile UX than dropdown — one tap per option)
   - **Remarks: hidden by default.** Each card has an "Add remarks" button that toggles a textarea into view. Once remarks text exists, the textarea stays visible. This keeps the form compact for 19 parameters.
   - Remarks visibility contract:
     - Hidden by default when no remarks exist.
     - Clicking "Add remarks" shows textarea.
     - If remarks text exists, textarea stays visible across re-renders.
     - If user clears remarks back to empty, textarea remains visible for the current editing session (no auto-close).
   - `data-testid={rubric-param-${key}}`
4. **Session fields** at bottom — 2 optional textareas (Strengths, Points of Improvement). These are **not required** for ending the action.
5. All inputs disabled when `props.disabled === true`

Data flow: reads from `formData.params.{key}`, writes back via `onFormDataChange` preserving all other keys.

---

## Step 4: Component tests

**File:** `src/components/visits/ClassroomObservationForm.test.tsx`

Use `@testing-library/react` + `userEvent`. Mock only `onFormDataChange` with `vi.fn()`. Key tests:
- Renders all 19 parameter labels
- Score summary shows 0/45 for empty data
- Selecting a radio calls `onFormDataChange` with correct nested structure
- Score summary updates immediately after score selection changes
- Score summary/answered count does not change when only remarks/session text changes
- "Add remarks" button shows textarea; typing remarks preserves other params
- Clearing remarks keeps textarea visible in current edit session
- Pre-filled data shows correct radio selected
- Disabled state disables all inputs
- Stamps `rubric_version` on mount when missing
- Unknown-version messaging/controls are tested in `ActionDetailForm` tests (single-owner behavior), not in this component test file

---

## Step 5: ActionDetailForm delegation

**File:** `src/components/visits/ActionDetailForm.tsx`

Minimal change — inside the `<form>` tag, add conditional:

```tsx
const isRubricObservation = action.action_type === "classroom_observation";

// In JSX, replace the generic fields.map block:
{isRubricObservation ? (
  <ClassroomObservationForm
    formData={formData}
    onFormDataChange={setFormData}
    disabled={!canSave || isBusy}
  />
) : (
  config.fields.map(field => /* existing generic rendering */)
)}
```

- Keep `classroom_observation` entry in `ACTION_FORM_CONFIGS` for the header title/description
- The `data-testid={action-renderer-classroom_observation}` on the `<form>` stays as-is
- Save/End buttons remain in `ActionDetailForm` UI, but END flow for `classroom_observation` changes:
  - On `End Action`, call PATCH first with current `formData`
  - If PATCH fails, show error and do not continue to GPS/END call
  - Standardized PATCH-failure behavior (must match exactly):
    - Show error text: `Could not save observation. Fix errors and try End again.`
    - Keep user on the same form with entered rubric data intact (no reset/clear)
    - Do not start GPS sampling and do not call `/end`
    - Clear busy state so user can retry End after fixing inputs
  - If PATCH succeeds, proceed with existing GPS flow and `/end` API call
  - This prevents "form looked filled but END failed" when user forgot to click Save manually
  - If `/end` returns 422 for rubric incompleteness/invalid data:
    - Keep user on current form with all entered values preserved
    - Show inline error text: `Please complete all required rubric scores before ending this observation.`
    - Render server `details` list (missing/invalid parameter labels) under the message
    - Re-enable End button after request settles so user can retry
- Unsupported rubric version handling in `ActionDetailForm`:
  - Detect unsupported `rubric_version` for `classroom_observation` using `getRubricConfig`
  - Force read-only behavior (`canSave = false`, `canEnd = false`) so Save/End buttons are hidden/disabled
  - Show one clear unsupported-version message above the form controls (single place)
  - Render `ClassroomObservationForm` in read-only mode without adding a second unsupported-version banner in the child
- Read-only role behavior in `ActionDetailForm`:
  - If user does not have edit permission, render rubric in read-only mode (`disabled=true`)
  - Save and End Action controls must not be usable (hidden or disabled per existing app pattern)
  - Read-only users can still view all rubric scores/remarks and session fields

---

## Step 6: Backend validation — PATCH (status-aware)

**File:** `src/app/api/pm/visits/[id]/actions/[actionId]/route.ts`

After the existing `data must be an object` check (~line 169), add status-aware rubric validation:

```ts
if (action.action_type === "classroom_observation") {
  const validation =
    action.status === "completed"
      ? validateClassroomObservationComplete(data)
      : validateClassroomObservationSave(data);

  if (!validation.valid) {
    return apiError(422, "Invalid classroom observation data", validation.errors);
  }
}
```

Imports from `@/lib/classroom-observation-rubric`:
- `validateClassroomObservationSave`
- `validateClassroomObservationComplete`

Behavioral rule:
- In-progress classroom observation PATCH remains lenient (partial allowed)
- Completed classroom observation PATCH is strict (prevents completed data from becoming incomplete)
- Unknown `rubric_version` returns 422 with clear error (e.g. `Unsupported classroom observation rubric version`)
- Unknown top-level keys return 422 with clear error details (for a clean rubric-only payload shape)

---

## Step 7: Backend validation — END (strict)

**File:** `src/app/api/pm/visits/[id]/actions/[actionId]/end/route.ts`

After line 127 (`Action must be started before ending` check), before the UPDATE at line 129, add:

```ts
if (existingAction.action_type === "classroom_observation") {
  const validation = validateClassroomObservationComplete(existingAction.data);
  if (!validation.valid) {
    return apiError(422, "Classroom observation rubric is incomplete", validation.errors);
  }
}
```

Uses `existingAction.data` already loaded at line 116. Error `details` array lists missing param labels (human-readable, not keys).
These `details` values are intended for direct UI rendering in the inline error list.

Also reject unknown `rubric_version` with 422 + clear message/details.

---

## Step 7.5: Backend validation — VISIT COMPLETE dependency

**File:** `src/app/api/pm/visits/[id]/complete/route.ts`

Tighten visit completion eligibility for classroom observations:
- Current behavior checks only existence of one completed `classroom_observation` action.
- Updated behavior must require one completed `classroom_observation` whose `data` passes `validateClassroomObservationComplete`.

Implementation approach:
- Load completed classroom observation actions for the visit (excluding soft-deleted).
- Run `validateClassroomObservationComplete(action.data)` and require at least one valid result.
- If none are valid, return `422` with clear message (e.g. `Complete at least one classroom observation rubric before completing visit`).
- Frontend handling for this 422 on visit completion:
  - Keep user on visit page (no redirect)
  - Show inline error near `Complete Visit` controls using server message text
  - If server provides details, show them as a short list under the message

This closes a loophole where old/empty/invalid classroom observation rows marked `completed` could still allow visit completion.

---

## Step 8: Update API route tests

**PATCH tests** (`route.test.ts`):
- **Fixture fix:** Change `BASE_ACTION_ROW.action_type` from `"classroom_observation"` to `"principal_meeting"` (generic PATCH tests cover save mechanics, not rubric-specific behavior — same rationale as the END fixture fix below)
- Add rubric-specific cases:
  - invalid score rejected (422)
  - partial accepted (200) for in-progress classroom observation
  - complete accepted (200)
  - completed classroom observation (admin PATCH) with incomplete rubric rejected (422)
  - completed classroom observation (admin PATCH) with complete rubric accepted (200)
  - unknown top-level key rejected (422)
  - unknown `rubric_version` rejected (422) with clear error/details
  - unauthorized/read-only role PATCH attempt rejected (existing auth status code; no data mutation)
  - non-classroom types unaffected

**END tests** (`end/route.test.ts`):
- **Fixture fix:** Change existing `IN_PROGRESS_ACTION.action_type` from `"classroom_observation"` to `"principal_meeting"` (those tests cover generic end mechanics, not rubric-specific behavior)
- Add: incomplete data rejected (422) with missing param details, empty data rejected, complete data accepted, non-classroom types unaffected
- Add: unknown `rubric_version` rejected (422) with clear error/details
- Add: unauthorized/read-only role END attempt rejected (existing auth status code)

**COMPLETE tests** (`complete/route.test.ts`):
- Keep existing generic completion-rule tests
- Add: completed classroom observation with invalid/legacy rubric data does **not** satisfy completion requirement (422)
- Add: completed classroom observation with valid complete rubric data satisfies completion requirement (subject to other existing checks)
- Add: mix of multiple completed classroom observations where at least one is valid should pass

---

## Step 9: Update page/integration tests

**File:** `src/app/visits/[id]/actions/[actionId]/page.test.tsx`

This file has classroom_observation tests currently using old keys (`class_details`, `observations`, `support_needed`) and old UI labels ("Observations"). Update those tests to the rubric shape/UI:

- `loads the classroom observation renderer...`:
  - Replace old `data` fixture with rubric-shaped data (`rubric_version`, `params`, optional summary fields)
  - Assert rubric UI renders (`data-testid="rubric-param-teacher_on_time"` or score summary text)
- `completes a classroom observation by saving details and ending with GPS`:
  - Replace `getByLabelText("Observations")` interaction with rubric interaction (select a radio option)
  - Update PATCH payload assertions from `data.observations` to nested `data.params.<key>.score`
  - Remove legacy `preserved_key` assertion; classroom observation payload should remain rubric-shaped (no unrelated top-level keys)
- Add test for auto-save on end:
  - Fill rubric inputs
  - Click `End Action` directly (without clicking Save)
  - Assert fetch order is PATCH first, then `/end`
  - Assert PATCH body contains latest rubric values
  - Add failure-path assertion:
    - Mock PATCH failure and assert `/end` is not called
    - Assert error text `Could not save observation. Fix errors and try End again.` is shown
    - Assert user remains on form and can retry End
  - Add `/end`-422 assertion:
    - Mock `/end` returning 422 with validation details
    - Assert inline message `Please complete all required rubric scores before ending this observation.` is shown
    - Assert validation details render and user can retry after fixing inputs
- Add/keep a pre-filled rubric rendering assertion (radio pre-selected from existing `formData`)
- Add test for unsupported rubric version:
  - Render classroom observation action with unknown `rubric_version`
  - Assert unsupported-version message is visible exactly once
  - Assert Save and End Action controls are not available
- Add read-only role test:
  - Render classroom observation for a user without edit permission
  - Assert rubric content is visible
  - Assert rubric inputs are disabled and Save/End controls are not usable

---

## Step 10: Update E2E classroom observation flow

**File:** `e2e/tests/visits.spec.ts`

The test `pm-can-start-and-end-classroom-observation` currently fills removed fields:
- `Class Details`
- `Observations`
- `Support Needed`

With strict END validation, this flow must now submit valid rubric data before ending. Update this test to:
- Open classroom observation action as today
- Fill rubric by selecting one valid score option for each of the 19 parameters (can use `data-testid="rubric-param-<key>"` selectors)
- Click `End Action` directly (without Save) to verify auto-save-before-end behavior
- Keep existing completed/read-only assertions

Also update the GPS-warning E2E so strict classroom validation does not break an unrelated GPS test:
- Test: `moderate-gps-warning-visible`
- Today it uses `classroom_observation` and calls `/end` directly with no rubric data, which will fail after strict END validation.
- Recommended: use a non-classroom action (e.g. `principal_meeting`) for the start/end GPS warning assertions.
- If that test still calls visit `/complete`, seed at least one completed `classroom_observation` action separately so the visit completion rule remains satisfied.

---

## Step 11: Post-launch cleanup and rollout close

**Purpose:** Prevent old classroom-observation logic from lingering after rubric rollout.

Cleanup actions:
- Remove legacy classroom observation UI rendering paths that are no longer used (`class_details`, `observations`, `support_needed` form controls).
- Ensure classroom observation save payload creation is rubric-only in all write paths.
- Remove/update outdated unit/integration/e2e assertions that still rely on legacy classroom keys.
- Update docs that still describe old classroom observation fields or old completion behavior.
- Confirm unsupported-version and 422 error copy is consistent across UI and tests.

Release-close checklist (must be completed before calling rollout done):
- Legacy classroom fields are not rendered anywhere in active classroom observation flows.
- Legacy classroom keys are not written in new classroom observation PATCH payloads.
- Tests no longer depend on legacy classroom keys in active rubric scenarios.
- Rubric-only behavior is documented in AI/docs references used by the team.
- Final smoke run completed for start/save/end/complete visit paths.
- Read-only role verification completed: user can view rubric but cannot PATCH/END from UI or API.

Ownership and date (fill before rollout close):
- Cleanup owner: `<name/team>`
- QA sign-off owner: `<name/team>`
- Rollout close target date: `<YYYY-MM-DD>`

Rollout close gate:
- Do not mark the feature complete until all Step 11 checklist items are checked and owners have signed off.

---

## Verification

```bash
# Step-by-step verification during implementation
npm run test:unit -- src/lib/classroom-observation-rubric.test.ts           # After step 2
npm run test:unit -- src/components/visits/ClassroomObservationForm.test.tsx # After step 4
npm run test:unit -- 'src/app/visits/[id]/actions/[actionId]/page.test.tsx' # After step 9
npm run test:unit -- 'src/app/api/pm/visits/[id]/actions/[actionId]/route.test.ts'     # After step 6
npm run test:unit -- 'src/app/api/pm/visits/[id]/actions/[actionId]/end/route.test.ts' # After step 7
npm run test:unit -- 'src/app/api/pm/visits/[id]/complete/route.test.ts' # After step 7.5
npm run test:e2e -- e2e/tests/visits.spec.ts --grep "pm-can-start-and-end-classroom-observation" # After step 10
npm run test:e2e -- e2e/tests/visits.spec.ts --grep "moderate-gps-warning-visible" # After step 10

# Full regression
npm run test:unit
npm run build
```
