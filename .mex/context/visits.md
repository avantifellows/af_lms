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
last_updated: 2026-10-27
---

# PM School Visits

A Program Manager (PM) or Program Admin opens a visit at an in-scope school, performs
one or more typed "actions" (interactions/observations), then completes the visit. GPS is captured at start/end.
Visit rows are LMS-owned and written **directly to Postgres** (not the DB Service).

Completion requirements are role-aware: PMs need completed Actions for all six mandatory Action Types
(all except School Staff Interaction), including a rubric-valid Classroom Observation. Admins may complete
any in-scope Visit and Program Admins may complete their own Visit with zero Actions. Every role still needs
valid end GPS and cannot complete while a non-deleted Action is in progress; repeat completion returns the
stored completion state without changing its GPS or timestamp.

## DB tables
- **`lms_pm_school_visits`** — 2-state lifecycle: `in_progress` → `completed` (`completed_at`). Holds `school_code`, `pm_email`, `visit_date` (derived server-side as IST date), start/end GPS columns, `deleted_at` soft delete. No `data` column, no `ended_at`. Ecto timestamps.
- **`lms_pm_school_visit_actions`** — one row per action: `action_type`, `status` (`pending`/`in_progress`/`completed`), start/end GPS+timestamps, `data` JSONB (the type-specific payload), `deleted_at`.
- Action types are enforced in **app code** (`ACTION_TYPES` in `src/lib/visit-actions.ts`), not a DB CHECK.

## Access layer — `src/lib/visits-policy.ts` (NOT raw permissions)
Visit routes do **not** call `canAccessSchool` directly. They use:
- `requireVisitsAccess(session, "view"|"edit")` → `{ ok, actor }` or `{ ok:false, response }`. Resolves the permission, checks the `visits` feature.
- `enforceVisitReadAccess` / `enforceVisitWriteAccess(actor, target)` — per-visit ownership: a **program_manager** edits only their own visits (`pm_email` match) and reads their own plus every visit at a **visit-managed School** (below); **admin** has scoped read/write; **program_admin** has scoped read access and edits only their own in-progress visits.
- **Visit-managed Schools (#291):** a Centre seat in `VISIT_MANAGER_SEAT_ROLES` (`pm`, `spm`, `ph`; `src/lib/staff-shared.ts`) at an **active** Centre (`centres.is_active`) makes that Centre's School visit-managed. Visits carry a School, not a Centre, so at a School with both a CoE and a Nodal centre a manager of either sees all its visits — intentional (Pritam, 14 Oct 2026): a PM's trip covers both centres' people. `resolveScope` collects them into `scope.visitManagedSchools`; `managesVisitSchool(actor, code)` reads it. The holder reads **every** visit there, whoever made it — read-only, never edit/complete/delete. APM and teaching seats give no visit visibility beyond their own. No reporting hierarchy is stored; Centre seats are the whole rule. A bare `getUserPermission` has no scope and manages nothing. They also get the Visit Summary (`/school-visit-summary` and `[id]`; `canViewVisitSummary`), scoped by `buildVisitSummaryScopePredicate` to the managed Schools **only** — not their own visits elsewhere. A `program_manager` with no managed School is still redirected to `/visits`.
- `buildOwnOrManagedVisitPredicate(actor, opts)` — the program_manager list scope (`LOWER(TRIM(pm_email)) = $n` OR `school_code = ANY(managed)`), used by `/visits`, `GET /api/pm/visits` (School Visit History tab) and the dashboard. Those lists name the visitor and offer only View (no Continue/Delete) on someone else's visit; `GET /api/pm/visits` returns `can_edit` per row (feature edit AND `canEditVisit`) for the School Visit History tab. Dashboard Recent Visits sorts the user's own in-progress visits first, so other people's stale ones can't push them out.
- `enforceVisitWriteLock(status)` — returns 409 if the visit is `completed` (completed visits are read-only; only `admin` may edit completed action *data*, via `canEditCompletedActionData`).
- `buildVisitScopePredicate(actor, opts)` — SQL `WHERE` fragment to scope list queries (handles level 1/2/3 + seat schools).
- `apiError(status, error, details?)` — the standard structured error response for these routes.

Visit pages that gate entry before calling an API must also use `getResolvedPermission`; a bare
`getUserPermission` omits Centre-seat-derived schools and programs. In particular, the new-Visit
page uses the resolved permission for its Visits feature check before rendering the form.

Role semantics: **PM owner** = read/write own, plus read-only on every visit at their visit-managed Schools; **admin** = scoped read/write; **program_admin** = scoped read plus write on owned in-progress Visits. `read_only` downgrades every role to view-only, and Visit/Action pages combine feature-level `canEdit` with the ownership policy before rendering mutation controls.

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

## Visitor display name
Visits store only `pm_email`. Wherever a visitor's name is shown (the School page Visit History tab via
`GET /api/pm/visits`, and the Visit Summary page), it is resolved from `user_permission.full_name` by
case-insensitive email match, falling back to the email when no name exists. The list API uses a
**scalar subquery** (preferring the non-revoked row) rather than a `LEFT JOIN user_permission`.
`user_permission.email` is unique only case-sensitively (`user_permission_email_index`), so a case variant of
the same address can exist as a second row and a case-insensitive join would duplicate visits. Visit History renders it as
"Visited by <name>" with the email as the hover title.

## Route map
`src/app/api/pm/visits/route.ts` (list/create; returns `pm_name` alongside `pm_email`) · `.../[id]/route.ts` (get/delete) ·
`.../[id]/complete/route.ts` · `.../[id]/actions/route.ts` (add) ·
`.../[id]/actions/[actionId]/route.ts` (get/patch) · `.../start` · `.../end`.
Pages: `src/app/visits/[id]/...` and `src/app/school/[udise]/visit/...`; read-only summary under `src/app/school-visit-summary/[id]`.

**Dashboard visits (#389, #291):** both dashboard views show Recent Visits (in-progress first, then newest; 10 rows; "View all" → `/visits`) and Total Visits, behind the `pm_dashboard` gate. Both use `visibleVisitPredicate` = `buildOwnOrManagedVisitPredicate` + `deleted_at IS NULL`, so the list never disagrees with the total. The total card is captioned "Yours" or "Yours and your centres'". Recent Visits must stay on Physical Centres: seated staff are pinned to that view (`resolveDashboardView`), and from 3 Sep to 14 Oct 2026 (PR #227 → #291) they had no route to their visits because Recent Visits was JNV-only. A failed count read throws rather than rendering 0. E2E: `e2e/tests/dashboard-visit-totals.spec.ts`.

## Gotchas
- Use **`visits-policy` helpers**, not `permissions.ts` directly, in visit routes — they encode PM and Program Admin ownership plus Admin scope semantics.
- **Save vs complete** validation are different functions — a draft can save with gaps; complete demands full data.
- Completed visits are write-locked (`enforceVisitWriteLock`); only `admin` edits completed action data.
- Adding a type means touching ~8 files in lockstep — follow `patterns/add-visit-action-type.md`, and note `school_staff_interaction` is optional so completeness/aggregate code must tolerate its absence.

**Visit Summary scope (#470 slice #474, built):** every `/school-visit-summary` query (the Visits list, its six stat cards and the School/PM filter options) builds its `WHERE` in the shared server-only module `src/lib/visit-summary-scope.ts` — `normalizeVisitSummaryFilters(searchParams)`, `buildVisitSummaryWhere(actor, filters, { startIndex?, exclude? })` (`exclude: "regions" | "schools" | "pms"` drops an option list's own filter) and `getVisitSummaryRegionOptions` / `getVisitSummarySchoolOptions` / `getVisitSummaryPmOptions`. The caller aliases the Visit as `v` and LEFT JOINs `school s ON s.code = v.school_code` (region scope reads `s.region`). The module always adds the **physical-only** predicate: `EXISTS` an `is_physical AND is_active` Centre at the Visit's School (`school.code` → `centres.school_id`). A Visit at a School with only a JNV NVS Centre, or whose only physical Centre is inactive, is absent from the table, every stat card and both option lists; a mixed JNV (physical + NVS Centre) still shows. The gate is unchanged (`visits` view + `canViewVisitSummary`, rows scoped by `buildVisitSummaryScopePredicate` inside the module). The visit detail page `/school-visit-summary/[id]` does **not** use the module and still shows any in-scope Visit. Later #470 slices must read Visits in view through this module.

**Region filter (#470 slice #476, built):** `regions=` is a comma list on `school.region`, like `schools=`/`pms=`. The sentinel `__none__` matches `school.region IS NULL` (non-JNV Schools) and is offered as **"No region (non-JNV)"**; named regions and the sentinel combine with OR. An unknown region just matches nothing. Region options are the distinct `s.region` of the Visits in view under every other filter (exclude-own-filter, as School and PM). The filter bar order is Region, School, PM, Status, Required Completion, Date Preset, From, To (one row at `xl`). Region, School and PM use the reusable client component `src/components/ui/SearchableMultiSelect.tsx`; a value in the URL that is no longer in the options stays listed, ticked, as "`<value>` (not in results)" so it can be unticked. Selecting writes the comma list and resets `page` (300 ms debounce, as before). E2E: `e2e/tests/school-visit-summary-school-wise.spec.ts` on fixture `20261027120000_seed_visit_summary_school_wise_fixture.sql` (Schools `VSWPHYS`, `VSWMIXED`, `VSWNVS`, `VSWOFF` in region `VSW_E2E`, plus `VSWNOREG` with no region; PM `e2e-vsw-pm@test.local`, Visits 9004701–9004705).

**Tabs and the School-wise tab (#470 slice #477, built):** `/school-visit-summary` has two tabs (`SummaryTabs` in the page): **School-wise** first and default (`tab=schools`, a missing or unknown `tab`) and **Visits** (`tab=visits`; its table, six stat cards, sort and 20-row pagination unchanged). Both share the filter bar; its "Clear filters" keeps `tab`, `sort` and `dir`. Tab links keep every filter param and drop `sort`, `dir` and `page`. **`sort`/`dir` are interpreted per tab**: each tab has its own whitelist (Visits: `SORT_COLUMNS` in the page; School-wise: `SCHOOL_WISE_SORT_COLUMNS` in `src/lib/visit-summary-school-wise.ts`), and a key from the other tab or anything unknown falls back to that tab's default (Visits `visit_date desc`, School-wise `school_name asc`); a bad `dir` falls back to the key's default direction. School-wise rows come from `getSchoolWiseView(actor, filters, sort)` (server-only), which groups the Visits in view from `buildVisitSummaryWhere` by School: one row per School with ≥ 1 Visit in view, any status. Columns School (region) · Visits · Last visit; sort keys `school_name` (asc), `visits` (desc), `last_visit` (desc), every tie broken by school name. No pagination. Stat cards: Schools · Visits (sum of the rows). Last visit shows **Stale** when it is more than `STALE_LAST_VISIT_DAYS` (45) days before today in IST (`isStaleLastVisit` in `src/lib/visit-summary.ts`; exactly 45 days is not stale). The recurring-concerns slice adds its sort key to `SCHOOL_WISE_SORT_COLUMNS` and makes it the default. E2E fixture additions: School `VSWOLD` (900476, last visited 2025), PM `e2e-vsw-pm2@test.local` (Visits 9004706–9004709, one dated two days before the seed day) and the seated PM `e2e-vsw-seated-pm@test.local` (`pm` seats at VSWPHYS and VSWNVS → sees VSWPHYS only).

## Planned: School-wise Visit Summary (issue #470, decided 27 Oct 2026, partly built)
- **Built (#474):** the physical-centre-only rule on the Visits list, stat cards and filter options, through the shared scope module above.
- **Built (#476):** the Region filter and the searchable Region/School/PM multi-selects (above).
- **Built (#477):** the School-wise / Visits tabs and the School-wise table without concern data (above).
- **Not built yet:** the School-wise concern columns (recurring issues, severity, top recurring concern, freshness line, `recurring=1`), the Flags column, the row link and School page, and the concern resolve/comment/reopen flow. All must stay physical-only, with no JNV NVS student data.
- Visit Concerns and Visit Highlights are permanent records produced by an etl-next LLM flow (3× daily) from completed visits' free text, matched visit by visit. A resolved concern auto-reopens when a later visit mentions it (ADR 0011). The LMS only reads them and writes the resolve/comment/reopen history.
- The full decisions and acceptance criteria are in the #470 issue body. Glossary terms are in `CONTEXT.md`. The base branch is `grill/issue-470-visit-summary-school-wise`.
