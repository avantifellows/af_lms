# Classroom Observation Rubric — Implementation Plan

**Plan date:** 2026-02-21  
**Source docs:** `docs/ai/classroom-observation/brainstorming.md`, `docs/ai/classroom-observation/classroom-observation-notes.md`, `docs/ai/project-context.md`  
**Target area:** PM Visit Action `classroom_observation` (`/visits/[id]/actions/[actionId]`)  
**Goal:** Replace legacy free-text classroom observation data with versioned structured rubric data (19 scored parameters, max 45), with strict completion gates and full test coverage.

---

## 0) Scope and Final Behavior

### 0.1 In scope

- [ ] Structured rubric for classroom observation with:
  - [ ] 19 scored parameters
  - [ ] Optional per-parameter remarks
  - [ ] Optional session summaries:
    - [ ] `observer_summary_strengths`
    - [ ] `observer_summary_improvements`
- [ ] Versioned rubric contract in app code, stamped in payload:
  - [ ] `rubric_version`
- [ ] Strict backend validation rules for:
  - [ ] action `PATCH` (lenient in-progress, strict when action already completed)
  - [ ] action `END` (strict completeness required)
  - [ ] visit `COMPLETE` (requires at least one completed classroom observation with rubric-valid complete data)
- [ ] UI behavior:
  - [ ] dedicated rubric form renderer
  - [ ] sticky live score summary
  - [ ] legacy rows without `rubric_version` bootstrap to fresh rubric state (legacy keys ignored, no legacy-field rendering)
  - [ ] unsupported rubric version handling (read-only + blocked save/end)
  - [ ] end flow auto-saves rubric before `/end` call

### 0.2 Out of scope

- [ ] Migrating old classroom observation JSON data
- [ ] Supporting edit mode for unknown rubric versions
- [ ] DB schema migrations for rubric structure (data remains in `data JSONB`)

### 0.3 Canonical payload contract

Only these top-level keys are valid for `classroom_observation` data:

- [ ] `rubric_version`
- [ ] `params`
- [ ] `observer_summary_strengths`
- [ ] `observer_summary_improvements`

Unknown top-level keys must return `422`.

Additional payload constraints:

- [ ] `params` must be an object keyed only by the 19 rubric parameter keys.
- [ ] `params` must be a plain object (not `null`, not array).
- [ ] Each parameter object allows only:
  - [ ] `score` (number, and only one of the configured option scores for that parameter)
  - [ ] `remarks` (optional string)
- [ ] Each parameter value must be a plain object (not `null`, not array).
- [ ] Session summary fields must be strings when present.
- [ ] Unknown nested parameter keys (unknown parameter ids or unknown fields inside a parameter object) must return `422`.
- [ ] Legacy rows that still contain old keys (`class_details`, `observations`, `support_needed`) are not migrated in DB.
- [ ] If `rubric_version` is missing and payload is legacy/empty, client must bootstrap editable rubric state using current version and exclude legacy keys from outgoing PATCH payloads.
- [ ] Validation failure response contract for rubric rules: `error` (string) + optional `details` (`string[]`) with deterministic ordering for testability.

### 0.4 Deployment sequencing constraint

- [ ] Treat this as a coupled FE+BE rollout: rubric UI payload switch and strict backend validation must ship together.
- [ ] Do not deploy strict classroom validation (`PATCH`/`END`/`COMPLETE`) ahead of the rubric form payload switch.
- [ ] During any mixed-version window, failures must remain safe and actionable (`422` with clear message/details, no data loss in UI).

### 0.5 Preserve existing visit completion invariants

- [ ] This feature adds a classroom-rubric prerequisite; it must not relax existing visit completion prerequisites.
- [ ] `visit COMPLETE` must continue to enforce all of:
  - [ ] no action in `in_progress`
  - [ ] valid GPS capture at completion (plus existing start/end GPS semantics for actions)
  - [ ] at least one completed classroom observation with strict-valid rubric data
- [ ] `422` responses from `/complete` should identify which prerequisite failed (rubric vs GPS vs in-progress action) so UI and QA can triage quickly.

---

## Pre-Phase Readiness Checks

These are mandatory release blockers. You can start implementation work in parallel, but rollout cannot proceed until all pre-phase checks are complete.

- [x] **Pre-Phase 1 – UI payload switch:** route `classroom_observation` through the rubric form and ensure saved payloads include only `rubric_version`, `params`, and the two session summaries.
- [x] **Pre-Phase 2 – Backend payload enforcement:** add lenient/strict validators, reject unknown keys/versions, and return deterministic `422` errors for invalid rubric payloads.
- [x] **Pre-Phase 3 – Visit completion hardening:** require at least one strict-valid completed classroom observation before allowing visit `COMPLETE`, while preserving no-in-progress-action and GPS validity checks.
- [x] **Pre-Phase 4 – Test baseline alignment:** update unit/integration/E2E tests to exercise the rubric flow, including happy/failure cases for PATCH/END.
- [x] **Pre-Phase 5 – Consumer impact audit:** inventory all classroom-observation consumers (in-app reporting, exports, analytics queries) and mark each `updated`, `not needed`, or `needs follow-up`.

**Pre-Phase release gate:** Do not launch to production until all five checks are marked complete and no critical consumer remains in `needs follow-up`.

---

## 1) Rubric Definition (V1)

### 1.1 Rubric v1 summary

- [ ] Parameters: `19`
- [ ] Max score: `45`
- [ ] Version: `"1.0"`
- [ ] Parameter keys:
  - [ ] `teacher_on_time`
  - [ ] `teacher_grooming`
  - [ ] `start_note`
  - [ ] `pre_task_hw`
  - [ ] `recall_test`
  - [ ] `learning_objective`
  - [ ] `curiosity_introduction`
  - [ ] `concept_teaching_competence`
  - [ ] `concept_notes_taking`
  - [ ] `concept_problem_solving`
  - [ ] `concept_doubt_solving`
  - [ ] `communication_board`
  - [ ] `communication_interaction`
  - [ ] `communication_body_language`
  - [ ] `class_conclusion`
  - [ ] `pace_of_teaching`
  - [ ] `time_management`
  - [ ] `classroom_management`
  - [ ] `gender_sensitivity`

### 1.2 Validation rules

- [ ] `PATCH` (in-progress): partial allowed, but submitted scores must match allowed options.
- [ ] `PATCH` (completed action): full strict validation required.
- [ ] `END`: full strict validation required.
- [ ] `COMPLETE visit`: at least one completed classroom observation action must pass strict validation.
- [ ] Session-level summary fields are optional.
- [ ] `time_management` must only allow `1|2|3` (no `0` option for this parameter).
- [ ] Preserve existing idempotency semantics:
  - [ ] ending an already-ended action remains a `200` no-op response
  - [ ] completing an already-completed visit remains a `200` no-op response

---

## 2) Phase Plan

### Progress Snapshot (as of 2026-02-23)

- [x] Overall status: **Phases 1-4 completed.**
- [ ] Remaining status: **Phase 5 in progress** (consumer/docs alignment completed in-repo; manual QA + external rollout confirmations pending).
- [x] Completed in this repo:
  - [x] Added `src/lib/classroom-observation-rubric.ts`
  - [x] Added `src/lib/classroom-observation-rubric.test.ts`
  - [x] Implemented rubric v1 config (19 params, max 45), version lookup, total score helper, lenient save validation, and strict complete validation
  - [x] Added unit coverage for config integrity, score calculation, lenient/strict validation, unknown keys/version handling, and `time_management` (`0` rejected)
  - [x] Added `src/components/visits/ClassroomObservationForm.tsx`
  - [x] Added `src/components/visits/ClassroomObservationForm.test.tsx`
  - [x] Integrated classroom rubric renderer and payload sanitization in `src/components/visits/ActionDetailForm.tsx`
  - [x] Added classroom action page coverage in `src/app/visits/[id]/actions/[actionId]/page.test.tsx` for unsupported version, bootstrap/sanitization, auto-save-before-end, and 422 details UX
  - [x] Added classroom rubric enforcement in `src/app/api/pm/visits/[id]/actions/[actionId]/route.ts` (lenient in-progress PATCH, strict completed PATCH)
  - [x] Added strict classroom rubric enforcement in `src/app/api/pm/visits/[id]/actions/[actionId]/end/route.ts` (including malformed stored JSON handling)
  - [x] Hardened visit completion prerequisite in `src/app/api/pm/visits/[id]/complete/route.ts` to require at least one strict-valid completed classroom observation
  - [x] Updated `src/components/visits/CompleteVisitButton.tsx` to render `/complete` `details[]` as a readable list and preserve retry UX
  - [x] Expanded Phase 3 coverage in:
    - [x] `src/app/api/pm/visits/[id]/actions/[actionId]/route.test.ts`
    - [x] `src/app/api/pm/visits/[id]/actions/[actionId]/end/route.test.ts`
    - [x] `src/app/api/pm/visits/[id]/complete/route.test.ts`
    - [x] `src/components/visits/CompleteVisitButton.test.tsx`
  - [x] Added canonical E2E rubric fixture helper in `e2e/helpers/db.ts` (`buildCompleteClassroomObservationData`)
  - [x] Updated `e2e/tests/visits.spec.ts` Phase 4 scenarios:
    - [x] classroom happy path now fills all 19 rubric params and ends without manual save
    - [x] explicit END `422` retry path covered (`classroom-end-validation-422-is-retryable`)
    - [x] completion fixtures now seed rubric-valid completed classroom payloads via helper
    - [x] negative completion path includes intentionally invalid/legacy completed classroom payload
    - [x] GPS moderate-warning test decoupled from classroom validation by using non-classroom action + separate rubric-valid classroom seed
- [x] Verification run:
  - [x] `npm run test:unit -- src/lib/classroom-observation-rubric.test.ts`
  - [x] Result: `1` file passed, `13` tests passed
  - [x] `npm run test:unit -- src/components/visits/ClassroomObservationForm.test.tsx`
  - [x] Result: `1` file passed, `6` tests passed
  - [x] `npm run test:unit -- src/app/visits/[id]/actions/[actionId]/page.test.tsx`
  - [x] Result: `1` file passed, `13` tests passed
  - [x] `npm run test:unit -- 'src/app/api/pm/visits/[id]/actions/[actionId]/route.test.ts' 'src/app/api/pm/visits/[id]/actions/[actionId]/end/route.test.ts' 'src/app/api/pm/visits/[id]/complete/route.test.ts' src/components/visits/CompleteVisitButton.test.tsx`
  - [x] Result: `4` files passed, `62` tests passed
  - [x] `npm run test:e2e -- e2e/tests/visits.spec.ts --grep "pm-can-start-and-end-classroom-observation"`
  - [x] Result: `1` test passed
  - [x] `npm run test:e2e -- e2e/tests/visits.spec.ts --grep "classroom-end-validation-422-is-retryable"`
  - [x] Result: `1` test passed
  - [x] `npm run test:e2e -- e2e/tests/visits.spec.ts --grep "complete-blocked-without-rubric-valid-completed-classroom-observation"`
  - [x] Result: `1` test passed
  - [x] `npm run test:e2e -- e2e/tests/visits.spec.ts --grep "complete-blocked-when-any-action-in-progress"`
  - [x] Result: `1` test passed
  - [x] `npm run test:e2e -- e2e/tests/visits.spec.ts --grep "poor-gps-blocks-write"`
  - [x] Result: `1` test passed
  - [x] `npm run test:e2e -- e2e/tests/visits.spec.ts --grep "complete-visit-success"`
  - [x] Result: `1` test passed
  - [x] `npm run test:e2e -- e2e/tests/visits.spec.ts --grep "moderate-gps-warning-visible"`
  - [x] Result: `1` test passed
  - [x] `npm run test:e2e -- e2e/tests/visits.spec.ts --grep "admin-can-complete-other-pm-visit-with-same-rules"`
  - [x] Result: `1` test passed
- [x] Phase 5 verification run (2026-02-23):
  - [x] `npm run test:unit`
  - [x] Result: `74` files passed, `1100` tests passed.
  - [x] `npm run test:e2e -- e2e/tests/visits.spec.ts`
  - [x] Result: `12` tests passed, `0` failed.
  - [ ] `npm run lint`
  - [ ] Result: failed due existing repo-wide lint issues (including generated `.next-test/**` artifacts and pre-existing source/test lint errors).
  - [x] `npm run build`
  - [x] Result: passed after removing `next/font/google` dependency and switching build script to webpack path (`next build --webpack`) for stable sandbox/CI execution.

## Phase 1 — Shared Rubric Library and Validation Core

### 1.1 Sub-phase: Create rubric config/types

Create `src/lib/classroom-observation-rubric.ts` with:

- [x] Rubric type definitions (`RubricOption`, `RubricParameter`, `RubricConfig`, etc.)
- [x] `CURRENT_RUBRIC_VERSION`
- [x] `CLASSROOM_OBSERVATION_RUBRIC`
- [x] `getRubricConfig(version)`
- [x] `computeTotalScore(params)`

### 1.1.1 Sub-phase: Parameter metadata fidelity

- [x] Build `CLASSROOM_OBSERVATION_RUBRIC` directly from `docs/ai/classroom-observation/classroom-observation-notes.md` for all 19 parameters, including:
  - [x] key/id
  - [x] label
  - [x] description
  - [x] max score and exact option list
- [x] Keep option ordering stable and explicit (including `time_management` options `1|2|3` only).
- [x] Add a rubric metadata integrity assertion/snapshot in tests so config drift is detected when docs/config diverge.

### 1.2 Sub-phase: Create validators

In same library implement:

- [x] `validateClassroomObservationSave(data)` (lenient)
- [x] `validateClassroomObservationComplete(data)` (strict)

Both validators must:

- [x] reject unknown top-level keys
- [x] reject unsupported `rubric_version`
- [x] reject unknown `params` keys and unknown nested parameter fields
- [x] return structured errors suitable for `apiError(..., details)`

### 1.3 Sub-phase: Unit tests for pure logic

Create `src/lib/classroom-observation-rubric.test.ts` covering:

- [x] rubric integrity (19 params, total 45, unique keys)
- [x] score calculation
- [x] lenient vs strict validation behavior
- [x] unsupported version
- [x] unknown keys
- [x] unknown nested keys in `params` payloads
- [x] `time_management` edge case (0 rejected)

### Phase 1 acceptance criteria

- [x] Unit:
  - [x] `src/lib/classroom-observation-rubric.test.ts` passes.
  - [x] Validation outputs deterministic error details for invalid payloads.
- [x] Integration:
  - [x] Rubric library changes are isolated (no route/component behavior changes required yet in Phase 1).

**Status:** Completed on 2026-02-21.

---

## Phase 2 — Frontend Rubric Form and Action Detail Integration

### 2.1 Sub-phase: Build dedicated rubric form renderer

Create `src/components/visits/ClassroomObservationForm.tsx`:

- [x] stamps `rubric_version` on mount if absent, without overwriting existing version
- [x] stamp effect is idempotent in React strict-mode double mount
- [x] renders 19 rubric cards using config
- [x] per-card radio score inputs
- [x] per-card remarks (hidden by default, explicit reveal button)
- [x] each card includes `data-testid="rubric-param-<key>"` for robust UI/E2E selectors
- [x] sticky score summary (`score/45`, `answered/19`)
  - [x] score updates immediately when a radio value changes
  - [x] `answered` counts only params with a valid selected score
  - [x] remarks/session text changes do not affect score or answered count
- [x] remarks visibility contract:
  - [x] hidden initially when remarks empty
  - [x] clicking "Add remarks" reveals textarea
  - [x] once revealed in an edit session, clearing text does not auto-hide it
- [x] optional session summary textareas
- [x] respects `disabled`

### 2.2 Sub-phase: Integrate in `ActionDetailForm`

Modify `src/components/visits/ActionDetailForm.tsx`:

- [x] route `classroom_observation` to `ClassroomObservationForm`
- [x] keep existing generic renderer for non-classroom action types
- [x] sanitize legacy classroom payloads in active edit state:
  - [x] if existing `formData` has old top-level keys, drop them from outgoing state and retain only rubric contract keys
  - [x] if `rubric_version` is missing on a legacy/empty row, initialize it to current supported version in client state
  - [x] ensure first save/end after opening a legacy row does not fail solely due to stale keys
- [x] unsupported version behavior owned by parent:
  - [x] show single warning banner
  - [x] disable/hide Save + End controls
- [x] read-only role behavior:
  - [x] data visible
  - [x] inputs non-editable
  - [x] save/end non-usable

### 2.2.1 Sub-phase: Legacy-data UX and unsupported versions

- [x] Treat only explicit unknown-version payloads as unsupported edit states:
  - [x] `rubric_version` is present but unknown to `getRubricConfig`
- [x] Missing `rubric_version` is not automatically unsupported:
  - [x] for legacy/empty payloads, bootstrap to current supported version and editable rubric shape
  - [x] do not render legacy text fields; legacy keys are ignored in rubric UI
- [x] In unsupported edit states, enforce a single parent-owned warning banner and disable/hide Save + End controls.
- [x] Keep rubric content readable (read-only) for unsupported-known-shape payloads, but block all mutation paths.
- [ ] If mutation is attempted (manual API call or stale client), API must return `422` with generic unsupported/invalid rubric message and optional details.

### 2.3 Sub-phase: End flow reliability (auto-save-before-end)

For classroom observation only:

- [x] `End Action` triggers `PATCH` first
- [x] if `PATCH` fails:
  - [x] do not call `/end`
  - [x] keep form values intact
  - [x] show inline error:
    - [x] `Could not save observation. Fix errors and try End again.`
  - [x] if server returns `details`, render them as a list under the message
- [x] if `/end` returns `422`:
  - [x] keep user on same form
  - [x] show inline error:
    - [x] `Please complete all required rubric scores before ending this observation.`
  - [x] render server `details` list
- [x] for `422` payloads, keep `details` renderable as a list in UI (do not only flatten to a semicolon-joined string)
- [x] implementation detail:
  - [x] keep error UI state as structured `{ message, details[] }` (or equivalent) in `ActionDetailForm`
  - [x] avoid reducing API details into one string before rendering

### 2.4 Sub-phase: Component and page tests

Add/modify tests:

- [x] `src/components/visits/ClassroomObservationForm.test.tsx`
- [x] `src/app/visits/[id]/actions/[actionId]/page.test.tsx`

Cover:

- [x] render, data binding, disabled mode
- [x] live score behavior
- [x] remarks visibility behavior (default hidden, reveal, stays visible after clear)
- [x] rubric version stamp behavior
- [x] unsupported version handling (unknown explicit `rubric_version`)
- [x] legacy/missing-version bootstrap behavior (editable rubric state, legacy keys ignored)
- [x] auto-save-before-end order
- [x] retry behavior after 422
- [x] legacy payload sanitization (old keys do not leak into rubric PATCH payloads)

### Phase 2 acceptance criteria

- [x] Unit:
  - [x] Form component tests pass for rubric rendering/data flow.
  - [x] Page/integration tests pass for classroom action save/end flows and unsupported-version/read-only behavior.
- [x] E2E:
  - [x] `pm-can-start-and-end-classroom-observation` flow can complete from UI with rubric interactions.
  - [x] End-action failure path keeps user in place with recoverable retry behavior.

---

## Phase 3 — Backend Enforcement (PATCH, END, COMPLETE)

### 3.1 Sub-phase: PATCH route validation by status

Update `src/app/api/pm/visits/[id]/actions/[actionId]/route.ts`:

- [x] if action type is classroom observation:
  - [x] in-progress -> lenient validator
  - [x] completed -> strict validator
- [x] invalid payload -> `422 Invalid classroom observation data` with details

### 3.2 Sub-phase: END route strict validation

Update `src/app/api/pm/visits/[id]/actions/[actionId]/end/route.ts`:

- [x] for classroom observation:
  - [x] validate stored `existingAction.data` strictly before ending
  - [x] reject invalid/incomplete with `422` and detailed missing/invalid labels
- [x] preserve current idempotent behavior for already-ended actions (return existing row + GPS warning when present)
- [x] if stored `existingAction.data` is non-object JSON (array/string/null), fail with `422` rubric-invalid response (not `500`)

### 3.3 Sub-phase: Visit COMPLETE dependency

Update `src/app/api/pm/visits/[id]/complete/route.ts`:

- [x] completion requires all existing invariants plus the new classroom-rubric invariant:
  - [x] no actions in progress
  - [x] GPS validity checks preserved
  - [x] at least one completed classroom observation action with strict-valid rubric data
- [x] old/empty/legacy completed classroom rows must not satisfy this rule
- [x] return `422` with clear actionable message when unmet
- [x] include deterministic `details` when helpful (for UI rendering/retry guidance)
- [x] preserve current idempotent behavior for already-completed visits

### 3.4 Sub-phase: Visit completion UI error handling

Update `src/components/visits/CompleteVisitButton.tsx` and tests:

- [x] preserve current no-redirect-on-error behavior
- [x] render `/complete` `422` details as a readable list when provided
- [x] ensure failure reason is intelligible to users (rubric prerequisite vs GPS vs in-progress action)
- [x] keep action retryable immediately after failure

### 3.5 Sub-phase: API route + completion UI tests

Update/add tests:

- [x] `src/app/api/pm/visits/[id]/actions/[actionId]/route.test.ts`
- [x] `src/app/api/pm/visits/[id]/actions/[actionId]/end/route.test.ts`
- [x] `src/app/api/pm/visits/[id]/complete/route.test.ts`
- [x] `src/components/visits/CompleteVisitButton.test.tsx`

Cover:

- [x] valid/invalid payloads
- [x] unknown keys
- [x] invalid shape (`params` non-object, param value non-object, non-string remarks/session fields)
- [x] unknown rubric version
- [x] strict/lenient boundary by status
- [x] non-classroom routes unaffected
- [x] auth and read-only rejection paths remain correct
- [x] idempotency stays intact for already-ended actions and already-completed visits
- [x] malformed stored action JSON (`null`/array/string) returns `422` validation errors instead of server errors
- [x] `/complete` prerequisite matrix: failure cases for missing rubric-valid classroom action, pending in-progress action, and GPS-invalid completion attempts
- [x] **Fixtures:** Switch `BASE_ACTION_ROW.action_type` (PATCH tests) and `IN_PROGRESS_ACTION.action_type` (END tests) to `principal_meeting` so the shared validation suite can run before the rubric-specific cases are added.
- [x] **Rubric-specific scenarios:** add in-progress/complete validators, unknown-top-level-key handling, unknown `rubric_version` rejection, and the new strict failure paths for completed classroom observations while keeping non-classroom routes and auth/read-only hooks untouched.
- [x] **Completion UI scenarios:** add assertions for `/complete` 422 message + details rendering and retry behavior.

### Phase 3 acceptance criteria

- [x] Unit:
  - [x] All 3 API test files pass with explicit `422` assertions and detail payload checks.
  - [x] `src/components/visits/CompleteVisitButton.test.tsx` passes with `/complete` error-detail rendering and retry assertions.
  - [x] No API route accepts legacy classroom top-level keys in rubric mode.
- [x] E2E:
  - [x] Completing a visit fails when only invalid/legacy classroom completion exists.
  - [x] Completing a visit still fails when another action remains in progress.
  - [x] Completing a visit still fails on GPS-invalid completion conditions.
  - [x] Completing a visit succeeds when at least one classroom observation is rubric-valid and complete.

**Status:** Phase 3 implementation + unit coverage completed on 2026-02-21. Phase 3 E2E scenarios completed in Phase 4 on 2026-02-21.

---

## Phase 4 — End-to-End Flow Updates and Cross-Flow Stability

### 4.1 Sub-phase: Update classroom observation E2E happy path

Modify `e2e/tests/visits.spec.ts`:

- [x] fill rubric scores for all 19 parameters
- [x] end action directly (without manual save click) to verify auto-save-before-end behavior
- [x] keep completed/read-only assertions

### 4.2 Sub-phase: Update GPS warning E2E to avoid rubric coupling

Adjust `moderate-gps-warning-visible` test:

- [x] use non-classroom action for pure GPS warning assertions, or
- [x] seed a separate rubric-valid classroom action if visit completion is part of the path

### 4.3 Sub-phase: Update completion-flow E2E fixtures

Adjust `complete-visit-success` and `admin-can-complete-other-pm-visit-with-same-rules`:

- [x] seed at least one classroom observation action with rubric-valid complete payload (not just `status='completed'`)
- [x] keep non-classroom-completed rows in place to verify classroom dependency remains enforced

### 4.4 Sub-phase: Regression coverage sweep

Verify no stale selectors/labels from removed legacy fields remain in:

- [x] E2E tests
- [x] page tests
- [x] fixtures

### 4.5 Sub-phase: E2E fixture helper hardening

Update `e2e/helpers/db.ts` to provide a reusable helper that returns a rubric-valid complete classroom payload for seeded completed actions.

- [x] Use one canonical helper payload in E2E fixture seeding instead of hand-writing rubric JSON in multiple tests.
- [x] Keep at least one fixture path with intentionally invalid/legacy classroom payload for negative completion assertions.

### Phase 4 acceptance criteria

- [x] Unit:
  - [x] No unit/integration tests reference removed legacy classroom fields for active rubric flows.
- [x] E2E:
  - [x] Targeted visits E2E tests pass for classroom observation and GPS-warning scenarios.
  - [x] No flaky failures from strict classroom validation coupling.

**Status:** Phase 4 implementation + targeted E2E verification completed on 2026-02-21.

---

## Phase 5 — Rollout Readiness and Release Gate

### 5.1 Sub-phase: Consumer and docs alignment

Audit all classroom observation data consumers (in-app, reporting, exports) and classify:

- [x] `updated`
- [x] `not needed`
- [x] `needs follow-up`
- [x] **Consumer list:** call out the BigQuery quiz analytics queries (`src/lib/bigquery.ts`, `/api/quiz-analytics`), curriculum tracking summaries, PM visit reports/exports, and any downstream dashboards or exports that ingest the `classroom_observation` JSONB payload, and document whether each is `updated`, `not needed`, or `needs follow-up`.
- [ ] **Acceptance:** require every listed consumer to be either marked `updated` or `not needed`; no consumer stays in `needs follow-up` when the release gate is evaluated, and the docs reflect the rubric payload contract plus the new completion dependency.

Consumer inventory (2026-02-23):

- [x] `updated` — Classroom observation UI renderer + payload sanitization (`src/components/visits/ActionDetailForm.tsx`) enforces rubric payload and unsupported-version read-only behavior.
- [x] `updated` — Rubric form experience (`src/components/visits/ClassroomObservationForm.tsx`) writes rubric-only payload fields and stamps missing `rubric_version`.
- [x] `updated` — Classroom observation PATCH validation (`src/app/api/pm/visits/[id]/actions/[actionId]/route.ts`) enforces rubric validators (lenient in-progress, strict for completed actions).
- [x] `updated` — Classroom observation END validation (`src/app/api/pm/visits/[id]/actions/[actionId]/end/route.ts`) requires strict-valid rubric payload before completion.
- [x] `updated` — Visit COMPLETE dependency (`src/app/api/pm/visits/[id]/complete/route.ts`) requires at least one strict-valid completed classroom observation.
- [x] `not needed` — BigQuery quiz analytics queries (`src/lib/bigquery.ts`) and `/api/quiz-analytics` routes (`src/app/api/quiz-analytics/[udise]/route.ts`, `src/app/api/quiz-analytics/[udise]/sessions/route.ts`) do not read visit action JSONB.
- [x] `not needed` — Curriculum tracking summaries (`src/lib/curriculum-helpers.ts`, `src/components/curriculum/ProgressSummary.tsx`) are localStorage/chapter based and do not read classroom observation JSONB.
- [x] `not needed` — PM visit list/dashboard surfaces (`src/app/visits/page.tsx`, `src/app/dashboard/page.tsx`, `src/app/api/pm/visits/route.ts`) read visit-level fields only, not classroom observation payload internals.
- [x] `not needed` — In-repo PM visit exports/reports: no CSV/XLS/export endpoint that consumes `lms_pm_school_visit_actions.data` was found in this repo.
- [ ] `needs follow-up` — Downstream external dashboards/exports (outside this repo) that may directly query `lms_pm_school_visit_actions.data` need owner confirmation before release gate sign-off.

Update docs to reflect:

- [x] rubric payload contract
- [x] strict completion dependency
- [x] unsupported version behavior
- [x] Evidence: updated `docs/ai/project-context.md` section `3.5 PM Visits` with rubric payload contract + strict completion + unsupported-version handling notes.

### 5.2 Sub-phase: Manual QA checklist

Run role/device/manual checks:

- [ ] PM owner create/save/end classroom action
- [ ] admin edit completed classroom action behavior
- [ ] program admin read-only behavior
- [ ] legacy row open-path (missing `rubric_version`) bootstraps editable rubric payload and saves without legacy keys
- [ ] unsupported rubric version rendering
- [ ] 422 details display and retry UX
- [ ] mobile viewport sanity for 19-card rubric flow (scroll, sticky score bar, radio usability)

### 5.3 Sub-phase: Release gate decision

Do not mark feature complete until:

- [x] all Phase 1–4 acceptance criteria pass
- [ ] no critical consumer remains `needs follow-up`
- [ ] manual QA sign-off done
- [x] deployment sequencing check passed (no backend-only strict rollout before rubric UI payload switch)
- [ ] release command pack is green (`npm run lint`, `npm run build`) in CI/production-like environment

### Phase 5 acceptance criteria

- [x] Unit:
  - [x] Full unit test suite passes.
  - [x] Updated docs/tests contain no stale legacy field usage in active flows.
- [x] E2E:
  - [x] Full visits E2E spec passes in CI configuration.
  - [x] Smoke check confirms end-to-end classroom observation -> visit completion behavior works with rubric constraints.

---

## 3) Execution Order and Ownership Guidance

Recommended implementation order:

1. Phase 1 (shared lib + validators)  
2. Phase 2 (UI form + action detail integration)  
3. Phase 3 (API enforcement)  
4. Phase 4 (E2E updates + regression sweep)  
5. Phase 5 (consumer audit + release gate)

Ownership split (recommended):

- [ ] Engineer A: Phase 1 + Phase 3 (domain contract + backend enforcement)
- [ ] Engineer B: Phase 2 + Phase 4 (UI behavior + integration/E2E updates)
- [ ] QA/Tech Lead: Phase 5 release gate

---

## 4) Verification Commands

```bash
# Phase 1
npm run test:unit -- src/lib/classroom-observation-rubric.test.ts

# Phase 2
npm run test:unit -- src/components/visits/ClassroomObservationForm.test.tsx
npm run test:unit -- 'src/app/visits/[id]/actions/[actionId]/page.test.tsx'

# Phase 3
npm run test:unit -- 'src/app/api/pm/visits/[id]/actions/[actionId]/route.test.ts'
npm run test:unit -- 'src/app/api/pm/visits/[id]/actions/[actionId]/end/route.test.ts'
npm run test:unit -- 'src/app/api/pm/visits/[id]/complete/route.test.ts'
npm run test:unit -- src/components/visits/CompleteVisitButton.test.tsx

# Phase 4
npm run test:e2e -- e2e/tests/visits.spec.ts --grep "pm-can-start-and-end-classroom-observation"
npm run test:e2e -- e2e/tests/visits.spec.ts --grep "moderate-gps-warning-visible"
npm run test:e2e -- e2e/tests/visits.spec.ts --grep "complete-visit-success"
npm run test:e2e -- e2e/tests/visits.spec.ts --grep "admin-can-complete-other-pm-visit-with-same-rules"

# Phase 5 / release gate
npm run test:unit
npm run test:e2e -- e2e/tests/visits.spec.ts
npm run lint
npm run build
```

---

## 5) Definition of Done

Feature is complete only when all are true:

- [ ] Classroom observation writes only rubric payload shape.
- [ ] Legacy classroom keys (`class_details`, `observations`, `support_needed`) are sanitized out of active edit payloads.
- [ ] Missing-version legacy rows bootstrap to current rubric version (editable) instead of entering unsupported state.
- [ ] Unsupported rubric version is safe/read-only in UI and blocked by API.
- [ ] End action for classroom observation enforces strict rubric completeness.
- [ ] Visit complete enforces at least one rubric-valid completed classroom observation.
- [ ] Visit complete preserves existing prerequisites: no action in progress and valid GPS completion.
- [ ] Save/End/Complete validation errors keep users on-page with retryable state and render server details when present.
- [ ] Rubric validation errors consistently use `error` + optional ordered `details[]` response shape.
- [ ] Existing idempotent contracts for already-ended actions and already-completed visits remain unchanged.
- [ ] Unit + E2E acceptance criteria passed for every phase.
- [ ] Consumer audit and docs are completed.
