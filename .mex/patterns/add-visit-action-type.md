---
name: add-visit-action-type
description: Add a new PM visit action type — a ~8-file coordinated change across config lib, validators, form component, registry, and stats. Use when extending the visit action registry.
triggers:
  - "new action type"
  - "add visit action"
  - "visit interaction type"
  - "action type registry"
edges:
  - target: context/visits.md
    condition: for the registry model, lifecycle, and access semantics
  - target: context/conventions.md
    condition: for naming + colocated test conventions
  - target: patterns/add-component.md
    condition: when building the form component + its test
last_updated: 2026-06-25
---

# Add a Visit Action Type

## Context
Read `context/visits.md` first. Each action type is self-contained but spans ~8 files in
lockstep (config lib, form, two dispatch sites, registration, server route, two tests). Copy the closest existing type as a template: binary-question checklist types
(`af-team-interaction.ts` + `AFTeamInteractionForm.tsx`) or the rubric type
(`classroom-observation-rubric.ts` + `ClassroomObservationForm.tsx`). Shared note helpers
live in `src/lib/visit-form-utils.ts`. There is **no** per-type bootstrap/sanitize helper —
the form owns the `data` shape and validators read it directly.

## Steps
1. **Register the type** — add a key + label to `ACTION_TYPES` in `src/lib/visit-actions.ts`. Decide required vs optional (`OPTIONAL_ACTION_TYPE_VALUES`).
2. **Config lib** — create `src/lib/<type>.ts` following the existing pattern: the `<TYPE>_CONFIG` constant (sections/questions or rubric), the `<Type>Data` interface, `validate<Type>Save` (loose) + `validate<Type>Complete` (full completeness) — both return `{ valid, errors }` — and the `extractRemarks` + `computeInlineStats` helpers. Use the `additional_notes` helpers from `visit-form-utils.ts` (`appendActionAdditionalNotes`, `validateActionAdditionalNotes`, `isPlainObject`).
3. **Form component** — create `src/components/visits/<Type>Form.tsx` (use `RadioPair`/`RemarkField` primitives for checklist types). The form builds the `data` payload object itself. Forms that need teachers fetch `/api/pm/teachers`.
4. **Dispatch** — wire the new type into `ActionDetailForm.tsx` (render the form) and `ActionPointList.tsx` (summary stats + label via the type's `computeInlineStats`/`extractRemarks`).
5. **Server validation** — ensure the action patch route (`src/app/api/pm/visits/[id]/actions/[actionId]/route.ts`) dispatches on `action_type` + `action.status` to your `validate<Type>Save`/`Complete`.
6. **Tests** — colocate `<type>.test.ts` (validators: save passes with gaps, complete fails on gaps) and `<Type>Form.test.tsx`. Mirror an existing type's tests.

## Gotchas
- **Save vs complete are different functions** — saving a draft must tolerate gaps; completing must enforce full data. Don't reuse one for both.
- **Naming follows the type key, with one exception** — `individual_af_teacher_interaction`'s validators are `validateIndividualTeacherSave`/`validateIndividualTeacherComplete` (no "AF"). Match the lib you copy, don't assume.
- **Optional types** (like `school_staff_interaction`) must not break completeness/aggregate code — guard for absence in `ActionPointList` stats and visit-complete logic.
- **Miss a dispatch site and it silently won't render** — the type must appear in `ACTION_TYPES`, `ActionDetailForm`, `ActionPointList`, AND the server validator. Grep all four.
- **`data` is JSONB** — keep keys stable; guard unknown shapes with `isPlainObject` before reading.
- Completed action data is admin-only-editable (`canEditCompletedActionData`) — don't add a path that lets a PM mutate completed data.
- Never log GPS.

## Verify
- [ ] New key in `ACTION_TYPES`; correct required/optional classification.
- [ ] `validate*Save` and `validate*Complete` both exist and differ in strictness.
- [ ] Form renders via `ActionDetailForm`; stats/label wired in `ActionPointList`.
- [ ] Server action route validates the new type.
- [ ] Colocated lib + form tests added; `npm test` + `npm run lint` pass.

## Debug
- Form doesn't appear → missing dispatch in `ActionDetailForm` or key not in `ACTION_TYPES`.
- Visit won't complete → `validate*Complete` rejecting; check required keys vs the `data` payload.
- Stats blank on the visit summary → extractor not registered in `ActionPointList`.

## Update Scaffold
- [ ] Update `context/visits.md` if the type count or shared-helper set changed.
- [ ] Update `.mex/ROUTER.md` "Current Project State" (action type count).
