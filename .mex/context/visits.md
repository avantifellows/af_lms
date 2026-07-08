---
name: visits
description: PM school visits — lifecycle, GPS validation, the visits-policy access layer, and the 7-type visit action registry. Load when working on visits or visit action types.
triggers:
  - "visit"
  - "action type"
  - "action point"
  - "gps"
  - "visits-policy"
  - "classroom observation"
  - "pm visit"
edges:
  - target: context/permissions.md
    condition: when the access question is general (not visit-specific)
  - target: context/architecture.md
    condition: when seeing where visits sit in the request flow
  - target: patterns/add-visit-action-type.md
    condition: when adding a new visit action type
  - target: context/data-access.md
    condition: when writing visit rows (direct Postgres, not the DB Service)
last_updated: 2026-06-30
---

# PM School Visits

A Program Manager (PM) opens a visit at a school, performs one or more typed "actions"
(interactions/observations), then completes the visit. GPS is captured at start/end.
Visit rows are LMS-owned and written **directly to Postgres** (not the DB Service).

## DB tables
- **`lms_pm_school_visits`** — 2-state lifecycle: `in_progress` → `completed` (`completed_at`). Holds `school_code`, `pm_email`, `visit_date` (derived server-side as IST date), start/end GPS columns, `deleted_at` soft delete. No `data` column, no `ended_at`. Ecto timestamps.
- **`lms_pm_school_visit_actions`** — one row per action: `action_type`, `status` (`pending`/`in_progress`/`completed`), start/end GPS+timestamps, `data` JSONB (the type-specific payload), `deleted_at`.
- Action types are enforced in **app code** (`ACTION_TYPES` in `src/lib/visit-actions.ts`), not a DB CHECK.

## Access layer — `src/lib/visits-policy.ts` (NOT raw permissions)
Visit routes do **not** call `canAccessSchool` directly. They use:
- `requireVisitsAccess(session, "view"|"edit")` → `{ ok, actor }` or `{ ok:false, response }`. Blocks passcode users, resolves the permission, checks the `visits` feature.
- `enforceVisitReadAccess` / `enforceVisitWriteAccess(actor, target)` — per-visit ownership: a **program_manager** sees/edits only their own visits (`pm_email` match); **admin** has scoped read/write; **program_admin** has scoped **read-only**.
- `enforceVisitWriteLock(status)` — returns 409 if the visit is `completed` (completed visits are read-only; only `admin` may edit completed action *data*, via `canEditCompletedActionData`).
- `buildVisitScopePredicate(actor, opts)` — SQL `WHERE` fragment to scope list queries (handles level 1/2/3 + seat schools).
- `apiError(status, error, details?)` — the standard structured error response for these routes.

Role semantics: **PM owner** = read/write own; **admin** = scoped read/write; **program_admin** = scoped read-only; **passcode** = blocked.

## GPS — `src/lib/geo-validation.ts`
`validateGpsReading(body, "start"|"end")` reads `${prefix}_lat/_lng/_accuracy`. Rejects (422) accuracy > 500m or out-of-range lat/lng; warns (still accepts) between 100–500m. **Never log lat/lng.** Routes that need GPS: create visit, action start, action end, complete visit.

## The action-type registry (7 types)
Types: `principal_interaction`, `classroom_observation`, `group_student_discussion`,
`individual_student_discussion`, `af_team_interaction`, `individual_af_teacher_interaction`,
`school_staff_interaction` (the only one in `OPTIONAL_ACTION_TYPE_VALUES`).

Each type is implemented across coordinated files:
- **`src/lib/<type>.ts`** — the config constant (`<TYPE>_CONFIG`: sections/questions or rubric), the `<Type>Data` interface, `validate<Type>Save` + `validate<Type>Complete` (both return `{ valid, errors }`; save = looser, complete = full completeness), plus `extractRemarks` + `computeInlineStats` for the summary view.
- **`src/components/visits/<Type>Form.tsx`** — the form, rendered via `ActionDetailForm.tsx` which dispatches on `action_type`. The form component owns the `data` payload shape — there is **no** per-type bootstrap/sanitize function.
- **Shared helpers** — `src/lib/visit-form-utils.ts`: `isPlainObject` plus the `additional_notes` helpers (`readActionAdditionalNotes`, `appendActionAdditionalNotes`, `validateActionAdditionalNotes`). Validators read the JSONB `data` directly.
- **Registration** — entry in `ACTION_TYPES` (`src/lib/visit-actions.ts`); the summary stats + label are wired in `ActionPointList.tsx`, which calls each type's `computeInlineStats`/`extractRemarks`.

Most types follow the **binary-question checklist** shape (`RadioPair` yes/no + optional remark per question); classroom observation uses a versioned **rubric** (`getRubricConfig`, `CURRENT_RUBRIC_VERSION`, `computeTotalScore`). Teacher-fetching forms pull from `/api/pm/teachers`, backed by `getVisitTeachersForSchool`: active real AF teachers with active LMS permissions and active teacher-type Centre seats at active Centres linked to the Visit's School. There is no fallback to broad `user_permission.role = 'teacher'` scope.

**Naming exception:** validator names mirror the type key, *except* `individual_af_teacher_interaction`, whose validators are `validateIndividualTeacherSave`/`validateIndividualTeacherComplete` (no "AF").

## Route map
`src/app/api/pm/visits/route.ts` (list/create) · `.../[id]/route.ts` (get/delete) ·
`.../[id]/complete/route.ts` · `.../[id]/actions/route.ts` (add) ·
`.../[id]/actions/[actionId]/route.ts` (get/patch) · `.../start` · `.../end`.
Pages: `src/app/visits/[id]/...` and `src/app/school/[udise]/visit/...`; read-only summary under `src/app/school-visit-summary/[id]`.

## Gotchas
- Use **`visits-policy` helpers**, not `permissions.ts` directly, in visit routes — they encode PM-owner vs admin vs program_admin semantics.
- **Save vs complete** validation are different functions — a draft can save with gaps; complete demands full data.
- Completed visits are write-locked (`enforceVisitWriteLock`); only `admin` edits completed action data.
- Adding a type means touching ~8 files in lockstep — follow `patterns/add-visit-action-type.md`, and note `school_staff_interaction` is optional so completeness/aggregate code must tolerate its absence.
