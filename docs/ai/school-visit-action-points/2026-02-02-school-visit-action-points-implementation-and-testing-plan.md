# School Visit Action Points — Implementation & Testing Plan

**Plan date:** 2026-02-16  
**Last updated:** 2026-02-16  
**Source design doc:** `docs/ai/school-visit-action-points/2026-02-02-visit-action-points.md`  
**Visual reference:** `docs/ai/school-visit-action-points/visual-explanation-visit-action-points.md`

---

## 0) Scope (Hard Cutover / MVP)

**Goal:** replace section-based visit JSON (`lms_pm_school_visits.data`) with **per-action tracking** in `lms_pm_visit_actions`, including:

- Action lifecycle: `pending → in_progress → completed`
- Action-level GPS + timestamps on start/end
- Visit lifecycle: only `in_progress → completed` (no “ended” state)
- Completion rules:
  - GPS required to complete (same thresholds as geo-tracking)
  - **≥ 1 completed `classroom_observation`**
  - **No actions left `in_progress`**
- Hard cutover DB + app deploy together (breaking change, no migration)

**Non-goals (explicit):**
- Migrating old JSONB visit data
- Re-introducing `issueLog` (dashboard widget removed until redesigned)
- Offline-first or “capture GPS and sync later”
- Returning raw GPS coordinates in API responses (privacy)

---

## 1) Phase 0 — DB-Service Migration (hard dependency)

### 0.1 Create actions table

- [ ] Add `lms_pm_visit_actions` table (DDL below; omit DB-level action type enum enforcement)
- [ ] Add index on `lms_pm_visit_actions(visit_id)`
- [ ] Ensure defaults/timestamps use UTC: `NOW() AT TIME ZONE 'UTC'`
  - [ ] **Decision:** do **not** enforce action types in DB via `CHECK (action_type IN (...))`. Treat `action_type` as free-form `VARCHAR(50)` and validate against `ACTION_TYPES` in app code (single source of truth).

DDL (reference):

```sql
CREATE TABLE lms_pm_visit_actions (
  id SERIAL PRIMARY KEY,
  visit_id INTEGER NOT NULL REFERENCES lms_pm_school_visits(id) ON DELETE CASCADE,

  -- Action identification (validated in app code against ACTION_TYPES; no DB CHECK)
  action_type VARCHAR(50) NOT NULL,

  -- Soft delete (so accidental deletes don't destroy typed data)
  deleted_at TIMESTAMP,

  -- Geo tracking - Start
  started_at TIMESTAMP,
  start_lat DECIMAL(10, 8),
  start_lng DECIMAL(11, 8),
  start_accuracy DECIMAL(10, 2),  -- GPS accuracy in meters

  -- Geo tracking - End
  ended_at TIMESTAMP,
  end_lat DECIMAL(10, 8),
  end_lng DECIMAL(11, 8),
  end_accuracy DECIMAL(10, 2),    -- GPS accuracy in meters

  -- Status
  status VARCHAR(20) DEFAULT 'pending'
    CHECK (status IN ('pending', 'in_progress', 'completed')),
  CONSTRAINT lms_pm_visit_actions_deleted_pending_check
    CHECK (deleted_at IS NULL OR status = 'pending'),
  CONSTRAINT lms_pm_visit_actions_status_timestamps_check
    CHECK (
      (status = 'pending'     AND started_at IS NULL AND ended_at IS NULL) OR
      (status = 'in_progress' AND started_at IS NOT NULL AND ended_at IS NULL) OR
      (status = 'completed'   AND started_at IS NOT NULL AND ended_at IS NOT NULL)
    ),
  CONSTRAINT lms_pm_visit_actions_time_order_check
    CHECK (ended_at IS NULL OR ended_at >= started_at),

  -- Action-specific form data
  data JSONB DEFAULT '{}',

  -- Timestamps (Ecto convention)
  inserted_at TIMESTAMP NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
  updated_at TIMESTAMP NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC')
);

CREATE INDEX idx_visit_actions_visit_id ON lms_pm_visit_actions(visit_id);
```

### 0.2 Visit table schema changes

- [ ] Add `completed_at TIMESTAMP` to `lms_pm_school_visits` (UTC)
- [ ] Drop `lms_pm_school_visits.data` (JSONB)
- [ ] Drop `lms_pm_school_visits.ended_at`
- [ ] Drop any index/constraint that references `ended_at` (if present)
- [ ] Confirm `status` stays only `in_progress|completed` (no “ended” state)

### 0.3 Verification checklist (local)

- [ ] Migration runs cleanly on local dev (db-service)
- [ ] `lms_pm_visit_actions` exists with constraints + `visit_id` index
- [ ] `lms_pm_school_visits` has `completed_at`
- [ ] `lms_pm_school_visits` no longer has `data`, `ended_at`
- [ ] No GPS lat/lng fields are accidentally logged by DB triggers (should be none)

### 0.4 Pre-cutover data cleanup (staging/prod)

We are intentionally doing a hard cutover with **no data migration**; pre-existing visits in the old JSONB model must be cleared so nothing “half-exists” during/after deployment.

- [ ] **Decision:** clear existing school visits before applying the migration (at minimum all non-completed visits; safest is to clear all).
- [ ] Run cleanup SQL **before** dropping columns (while `data`/`ended_at` still exist if you want to inspect them):
  - [ ] `DELETE FROM lms_pm_school_visits;` (preferred for a clean slate)
  - [ ] If you must keep completed history: `DELETE FROM lms_pm_school_visits WHERE status <> 'completed';`
- [ ] Verification: `/visits` renders and shows no legacy visits after cleanup (before deploying new UI).

---

## 2) Phase 1 — Backend Cutover (af_lms API routes)

### 1.1 Shared constants + helpers (P0)

- [ ] Add/centralize `ACTION_TYPES` map + `ActionType` union
- [ ] Add explicit policy helpers (used across API + UI):
  - [ ] **Reads:** allowed for visit owner PM, `admin`, and scoped `program_admin` (including when visit is completed).
  - [ ] **Writes:** denied for passcode users everywhere; `program_admin` is read-only everywhere.
  - [ ] **Completed visit:** terminal and read-only for everyone (reject all write routes when `visit.status === "completed"`).
  - [ ] **Completed action:** only `admin` can edit action `data` after `status="completed"`; PM owner can view but cannot edit.
- [ ] Define **scope** semantics (single implementation used everywhere):
  - [ ] `scoped program_admin` / `admin` means: user can view the visit/action only if they can access `visit.school_code` via `canAccessSchoolSync(permission, visit.school_code, school.region?)`.
  - [ ] Add a single helper to load `school.region` only when needed (permission level 2), and reuse it across list/detail/actions/complete routes.
- [ ] Reuse `validateGpsReading()` / geo-validation thresholds (≤100m ok, 100–500m warn, >500m reject)
- [ ] Add visit/action “locking” helper: if `visit.status === "completed"`, reject all write routes
- [ ] Add shared visits auth helper(s) used by **all** `/api/pm/visits/*` routes:
  - [ ] reject passcode users on all visits routes
  - [ ] enforce `canView` vs `canEdit`
  - [ ] enforce owner/admin/program_admin semantics consistently
  - [ ] Add shared API error helper so route errors consistently return `{ error: string; details?: string[] }`

Status codes (recommendation; keep consistent across all visits/action routes):

| Case | Status | Notes |
|---|---:|---|
| Not logged in | `401` | No session |
| Authenticated but not allowed | `403` | passcode user, `program_admin` on write routes, non-owner PM, etc. |
| Resource not found / wrong binding | `404` | visit/action id does not exist OR action not in visit OR action is soft-deleted |
| State conflict | `409` | visit completed lock; deleting non-pending; editing completed action as non-admin |
| Validation failed | `422` | completion rules; GPS accuracy >500m; end-without-start |
| Bad request | `400` | invalid JSON/body, missing required fields, invalid `action_type` (not in `ACTION_TYPES`) |

Testing checklist:
- [ ] Type-level: action types compile-time constrained
- [ ] GPS validation: warns vs rejects exactly as geo-tracking
- [ ] No response returns raw `*_lat/*_lng` fields
- [ ] Passcode users are rejected on both read and write visits routes
- [ ] Error response shape is consistent across all visits routes (`{ error, details? }`)
- [ ] Unit targets:
  - [ ] `src/lib/geo-validation.test.ts` covers threshold behavior used by actions + complete flows.
  - [ ] Add/extend a constants/helper test for `ACTION_TYPES` + `ActionType` exhaustiveness.

### 1.2 Update `GET /api/pm/visits` (cutover-safe list)

Implementation tasks:
- [ ] Stop selecting/returning `data` and `ended_at` (columns dropped)
- [ ] Add optional `pm_email` filter (admin/program_admin only)
- [ ] Keep `limit` default at `50` when query param is missing
- [ ] Avoid N+1 scope checks: when `permission.level === 2`, do not fetch `school.region` per row; join `school` (or filter by region in SQL) once and apply scope consistently
- [ ] Ensure role semantics:
  - `program_manager`: only own visits
  - `program_admin`: read-only, all visits within scope (scope determined by `canAccessSchoolSync` against `visit.school_code`)
  - `admin`: read/write all accessible visits (same scope rule; no “level bypass”)
- [ ] Return `completed_at` (and use it in UI later)

Testing checklist:
- [ ] PM sees only own visits
- [ ] Program admin can list but cannot create/edit in other routes
- [ ] Admin can filter by `pm_email`
- [ ] Program admin `pm_email` filter works only within scoped visibility
- [ ] `limit` default behavior is covered (`50` when absent)
- [ ] Completed visits show `completed_at` (not `ended_at`)
- [ ] Unit target: `src/app/api/pm/visits/route.test.ts` (`GET` role matrix + `pm_email` filter).
- [ ] E2E point: visits list verifies role visibility (PM/admin/program_admin where supported) and no `ended_at` UI.

### 1.3 Update `POST /api/pm/visits` (start visit)

Implementation tasks:
- [ ] Remove JSONB `initialData` initialization entirely (visit starts with **zero actions**)
- [ ] Keep start-visit GPS capture (visit-level) as-is
- [ ] Ensure response shape matches design doc (id, visit_date, optional warning)

Testing checklist:
- [ ] Creates visit row without `data`
- [ ] Creates visit with start GPS fields set
- [ ] `visit_date` is persisted as IST-derived date (`Asia/Kolkata`)
- [ ] Passcode users rejected
- [ ] Unit targets:
  - [ ] `src/app/api/pm/visits/route.test.ts` (`POST` create path, passcode reject, warning payload).
  - [ ] `src/components/visits/NewVisitForm.test.tsx` (`Start Visit` request payload/redirect + GPS error states).
- [ ] E2E point: start-visit flow from `/school/[udise]/visit/new` to `/visits/[id]`.

### 1.4 Replace visit detail route: `GET /api/pm/visits/[id]`

Implementation tasks:
- [ ] Return `{ visit, actions }` in one response
- [ ] Only return **non-deleted** actions (`deleted_at IS NULL`)
- [ ] Sort actions by `inserted_at ASC, id ASC` (stable creation order)
- [ ] Do not return raw GPS coordinates (privacy)
- [ ] Ensure non-owner reads are only possible when `canAccessSchoolSync(permission, visit.school_code, school.region?)` is true

Testing checklist:
- [ ] Visit returned without sensitive coordinates
- [ ] Actions list excludes soft-deleted rows
- [ ] Sorting stable by `inserted_at ASC, id ASC`
- [ ] Unit target: `src/app/api/pm/visits/[id]/route.test.ts` (`GET` returns `{ visit, actions }`, strips coordinates, excludes `deleted_at`).
- [ ] E2E point: visit detail page loads action cards in creation order.

### 1.5 Remove old section update routes

Implementation tasks:
- [ ] Delete `POST /api/pm/visits/[id]/end` route (replaced by `/complete`)
- [ ] Remove `PATCH /api/pm/visits/[id]` JSONB section update logic
- [ ] Remove `PUT /api/pm/visits/[id]` completion route (replaced by `/complete`)

Testing checklist:
- [ ] No tests reference removed routes
- [ ] No code path queries `visit.data` anywhere
- [ ] Unit cleanup:
  - [ ] Remove `src/app/api/pm/visits/[id]/end/route.test.ts`.
  - [ ] Remove legacy `PATCH`/`PUT` section-based tests from `src/app/api/pm/visits/[id]/route.test.ts`.
- [ ] E2E cleanup: remove `/visits/:id/principal` route assertions from `e2e/tests/visits.spec.ts`.

### 1.6 Cross-route auth + API contract hardening (P0)

Implementation tasks:
- [ ] Apply the same authorization rules to **every** visits route (`/visits`, `/visits/[id]`, `/actions/*`, `/complete`)
  - [ ] `program_manager`: own visit read/write
  - [ ] `program_admin`: scoped read-only (no create/edit/start/end/complete)
  - [ ] `admin` (`permission.role === "admin"`): read/write within accessible scope
- [ ] Ensure route handlers do not infer admin behavior from `permission.level`
- [ ] Make scope checks explicit and consistent:
  - [ ] For any read route where the user is not the owner PM, require `canAccessSchoolSync(permission, visit.school_code, school.region?)` (same helper everywhere).
  - [ ] Ensure “out-of-scope” is consistently `403` (not `404`) unless the resource truly does not exist / is soft-deleted.
- [ ] Ensure all visits route responses follow documented contracts (request fields, response fields, and error envelope)

Testing checklist:
- [ ] Unit matrix includes owner/non-owner/admin/program_admin/passcode across detail/actions/lifecycle/complete routes
- [ ] Program admin read-only behavior is explicitly tested on write routes (403)
- [ ] Route contract tests verify shape for success and error payloads (including `details` when applicable)

---

## 3) Phase 2 — Action APIs (CRUD + lifecycle)

### 2.1 `GET/POST /api/pm/visits/[id]/actions`

Implementation tasks:
- [ ] `GET`: list non-deleted actions, sorted by `inserted_at ASC, id ASC`
- [ ] `POST`: create action with `action_type`, default `status="pending"`, `data={}`
- [ ] Enforce “visit not completed” for `POST`
- [ ] Enforce shared auth semantics (`program_admin` read-only, passcode rejected, PM owner rules)

Testing checklist:
- [ ] Create returns 201 with action row
- [ ] Invalid action_type rejected (400)
- [ ] Cannot create when visit completed (409/400)
- [ ] `GET` access matrix: owner PM + admin + scoped program_admin allowed; out-of-scope denied
- [ ] `POST` denies program_admin and passcode users
- [ ] Unit target: `src/app/api/pm/visits/[id]/actions/route.test.ts` (`GET`/`POST` + invalid type + completed lock).
- [ ] E2E point: add action from visit detail and verify pending card appears.

### 2.2 `PATCH/DELETE /api/pm/visits/[id]/actions/[actionId]`

Implementation tasks:
- [ ] **Add `GET`** for a single action (needed by `/visits/[id]/actions/[actionId]` UI):
  - [ ] Returns `{ visit, action }` (or `{ action }` plus minimal `visit` fields required for read-only gating).
  - [ ] Treat soft-deleted actions as not-found (`404` if `deleted_at IS NOT NULL`).
  - [ ] Do not return raw GPS coordinates (privacy).
- [ ] `PATCH`: update `data` only (no status changes here)
  - [ ] Enforce edit policy: if `action.status="completed"`, allow `PATCH` only for `admin` (PM owner gets `409`)
- [ ] `DELETE`: soft delete only when `status="pending"` (set `deleted_at`; keep row)
- [ ] Validate action belongs to visit (route binding)
- [ ] Treat soft-deleted actions as not-found: if `deleted_at IS NOT NULL`, return `404` for all action routes
- [ ] Enforce “visit not completed” for `PATCH` and `DELETE` (immutability policy)
- [ ] Ensure successful writes update `updated_at` using UTC write timestamp semantics
- [ ] Enforce shared auth semantics (`program_admin` read-only, passcode rejected, PM owner/admin checks)

Testing checklist:
- [ ] GET returns `{ action }` payload without coordinate fields; enforces route binding + auth matrix
- [ ] PATCH updates JSONB data and bumps `updated_at`
- [ ] PATCH rejected if visit completed
- [ ] PATCH rejected for non-admin when action is completed (admin can PATCH)
- [ ] DELETE rejected if status != pending
- [ ] DELETE sets `deleted_at`, bumps `updated_at`, and action disappears from list
- [ ] PATCH/DELETE deny program_admin and passcode users
- [ ] Unit target: `src/app/api/pm/visits/[id]/actions/[actionId]/route.test.ts` (route binding + pending-only delete).
- [ ] E2E point: delete pending action card and confirm it disappears without page reload.

### 2.3 `POST /start` and `POST /end` action lifecycle

Implementation tasks:
- [ ] `POST /start`: requires start GPS; idempotent if already started
- [ ] `POST /end`: requires end GPS; rejects if not started; idempotent if already ended
- [ ] Status + timestamps rules:
  - start sets `started_at` (UTC) and `status="in_progress"`
  - end sets `ended_at` (UTC) and `status="completed"`
- [ ] Ensure successful start/end writes set `updated_at` (UTC)
- [ ] Enforce “visit not completed” for both routes
- [ ] Implement start/end transitions with atomic conditional updates (or transaction) to avoid race-condition state drift
- [ ] Response contract: do not return raw lat/lng; return only status/timestamps and optional `warning`

Testing checklist:
- [ ] Start from pending sets started_at + status + `updated_at`
- [ ] Second start is idempotent (no crash, no overwrite of `started_at`/`updated_at`)
- [ ] End without start rejected
- [ ] End from in_progress sets ended_at + status + `updated_at`
- [ ] Second end is idempotent (no overwrite of `ended_at`/`updated_at`)
- [ ] GPS accuracy >500 rejected; 100–500 warning returned
- [ ] Success payloads do not contain `*_lat`/`*_lng` fields
- [ ] Start/end deny program_admin and passcode users
- [ ] Concurrent requests do not produce invalid transitions
- [ ] Unit targets:
  - [ ] `src/app/api/pm/visits/[id]/actions/[actionId]/start/route.test.ts`.
  - [ ] `src/app/api/pm/visits/[id]/actions/[actionId]/end/route.test.ts`.
- [ ] E2E points:
  - [ ] start pending action -> in_progress.
  - [ ] end in_progress action -> completed.
  - [ ] moderate accuracy warning and >500m rejection paths.

---

## 4) Phase 3 — Visit Completion API

### 3.1 `POST /api/pm/visits/[id]/complete`

Implementation tasks:
- [ ] Require end GPS payload (visit-level completion GPS)
- [ ] Validate completion rules:
  - at least one `classroom_observation` action is `completed`
  - no actions are `in_progress`
- [ ] Validation queries must consider **non-deleted actions only** (`deleted_at IS NULL`)
- [ ] Write: set `status="completed"`, set `completed_at` (UTC), set end GPS in visit row
- [ ] Ensure successful completion write also updates `updated_at` (UTC)
- [ ] Idempotency:
  - if already completed, return success with existing `completed_at` (do not overwrite)
- [ ] Validate-and-complete in one transaction/locked flow so actions cannot change between validation and completion write
- [ ] Response contract: do not return raw lat/lng; return only status/completed_at and optional `warning`

Testing checklist:
- [ ] Reject when no completed classroom observation
- [ ] Reject when any action is in_progress
- [ ] Success sets `completed_at` + status + `updated_at`
- [ ] Second call is idempotent (no overwrite of completion fields/`updated_at`)
- [ ] Admin completion allowed but must follow same validations + GPS
- [ ] Program admin and passcode users cannot complete
- [ ] Success payload does not contain `*_lat`/`*_lng` fields
- [ ] Unit targets:
  - [ ] `src/app/api/pm/visits/[id]/complete/route.test.ts`.
  - [ ] `src/components/visits/CompleteVisitButton.test.tsx` (API error/success/warning rendering).
- [ ] E2E points:
  - [ ] blocked without completed classroom observation.
  - [ ] blocked when any action is in_progress.
  - [ ] success path transitions visit to read-only completed state.

---

## 5) Phase 4 — Frontend Cutover (Visits UI)

### 4.1 Visit detail page rewrite (`/visits/[id]`)

Implementation tasks:
- [ ] Remove fixed “section” links entirely
- [ ] Fetch `{ visit, actions }` and render **ActionPointList**
- [ ] Replace EndVisitButton with **CompleteVisitButton**
- [ ] Badges: only `In Progress` and `Completed` (no “Ended”)
- [ ] Completed visit UI is read-only (no add/start/end/delete/edit)

Testing checklist:
- [ ] Renders action cards with correct labels/status
- [ ] Completed state disables all write UI
- [ ] No UI references `ended_at` or sections
- [ ] Unit target: `src/app/visits/[id]/page.test.tsx` (no 6-section UI, 2-state badge only, no `End Visit`).
- [ ] E2E point: visit detail page contains action cards, not fixed-section links.

### 4.2 Action list + interactions

Implementation tasks:
- [ ] Add Action Point modal/picker (creates pending action)
- [ ] Pending card: Start + Delete
- [ ] In-progress card: Open
- [ ] Completed card: View Details
- [ ] Delete shown only for pending

Testing checklist:
- [ ] Add creates card without reload breakage
- [ ] Delete removes pending card
- [ ] Start triggers GPS capture and moves to in_progress
- [ ] Unit targets:
  - [ ] `src/components/visits/ActionPointList.test.tsx`.
  - [ ] `src/components/visits/ActionTypePickerModal.test.tsx`.
- [ ] E2E point: add -> start -> delete (pending only) action-card interactions.

### 4.3 Visits list page (`/visits`)

Implementation tasks:
- [ ] Show 2-state status consistently
- [ ] Use `completed_at` for “Completed at” column (not `inserted_at`, not `ended_at`)
- [ ] Add admin/program_admin filters (including `pm_email`) and map them to list API

Testing checklist:
- [ ] Completed timestamp uses completed_at
- [ ] No ended-state displayed
- [ ] Admin/program_admin filters call API params correctly and respect scoped results
- [ ] Unit targets:
  - [ ] `src/app/visits/page.test.tsx` (completed timestamp source + 2-state list).
  - [ ] `src/components/VisitsTab.test.tsx` (remove `ended_at` fixture usage).
- [ ] E2E point: `/visits` list groups only by In Progress/Completed.

### 4.4 Dashboard + tabs cleanup (deploy blocker)

Implementation tasks:
- [ ] Remove the dashboard open-issues widget (`getOpenIssuesCount()`), since it queried `visit.data->'issueLog'`
- [ ] Update visit history tabs/components to not depend on `ended_at` or `data`
- [ ] Update `src/components/visits/NewVisitForm.tsx` workflow copy from fixed sections to action-card lifecycle wording
- [ ] Delete or redirect any legacy fixed “section pages” that read `visit.data` or call the removed section PATCH route (e.g. `/visits/[id]/principal`) so they can’t crash post-cutover
- [ ] Frontend guardrails for passcode users:
  - [ ] Hide/disable Visits entry points (dashboard links, school tabs) for passcode sessions.
  - [ ] If a passcode user lands on `/visits/*` via direct URL, redirect (or render a clear forbidden state) instead of showing a generic crash/stack.

Testing checklist:
- [ ] Dashboard renders without querying dropped columns
- [ ] School Visits tab renders and loads visits list successfully
- [ ] Start-visit workflow copy reflects action cards (not fixed sections)
- [ ] Unit targets:
  - [ ] `src/app/dashboard/page.test.tsx` (no `issueLog`/`visit.data` dependency).
  - [ ] `src/components/SchoolTabs.test.tsx` (remove `ended_at` logic; 2-state history badges and labels only).
  - [ ] `src/components/VisitsTab.test.tsx` with new response shape.
- [ ] E2E point: dashboard and school visits tab load without 500s after cutover.

---

## 6) Phase 5 — Action Form Pages

### 5.1 Dynamic action route: `/visits/[id]/actions/[actionId]`

Implementation tasks:
- [ ] Single dynamic page that loads action + visit, then dispatches by `action_type`
- [ ] Use `GET /api/pm/visits/[id]/actions/[actionId]` (or equivalent) to load action `data` reliably (avoid needing full visit+actions payload if not required)
- [ ] Common header shows action status + timestamps
- [ ] Save behavior uses `PATCH .../actions/[actionId]` (data only)
- [ ] End Action button calls `POST .../end` with GPS
- [ ] If action is soft-deleted (`deleted_at` set), show 404 (or redirect) and do not render the form
- [ ] If action is completed:
  - [ ] PM owner: view-only (no save, no edit controls)
  - [ ] Admin: editable (can PATCH `data`) until the visit itself is completed
- [ ] If visit is completed: always view-only for everyone (no writes)

Testing checklist:
- [ ] Loads correct renderer per action_type
- [ ] Save persists data and preserves other fields
- [ ] End Action transitions to completed with GPS
- [ ] Unit target: `src/app/visits/[id]/actions/[actionId]/page.test.tsx`.
- [ ] Migration cleanup: replace `src/app/visits/[id]/principal/page.test.tsx` with dynamic action-page tests.
- [ ] E2E point: open action details, save data, and end action from the dynamic route.

### 5.2 Form build order (P0 → P1)

- [ ] P0: Classroom Observation (required for completion)
- [ ] P1: Principal Meeting (ported from existing page, now action-based)
- [ ] P2: Remaining action types (thin forms initially; iterate fields later)

Testing checklist:
- [ ] At least one classroom observation can be completed end-to-end
- [ ] Principal meeting action can be created, started, saved, ended
- [ ] Unit targets (incremental):
  - [ ] classroom observation renderer tests first (P0).
  - [ ] principal meeting renderer tests next (P1).
- [ ] E2E point: one full visit using classroom observation + one principal meeting action before completion.

---

## 7) Phase 6 — Automated Tests (Unit + E2E)

### 6.1 Unit tests (API routes) — exact files + cases

Update existing tests:
- [ ] `src/app/api/pm/visits/route.test.ts`
  - [ ] `GET`: PM only sees own visits; `program_admin` can list scoped visits read-only; `admin` can list + `pm_email` filter.
  - [ ] `GET`: `program_admin` `pm_email` filter is scoped (cannot access out-of-scope PM visits).
  - [ ] `GET`: response uses `completed_at` and never returns `ended_at`.
  - [ ] `POST`: creates visit without `data`; includes start GPS + optional warning + IST-derived `visit_date`.
  - [ ] `POST`: passcode user rejected; `program_admin` rejected for create.
- [ ] `src/app/api/pm/visits/[id]/route.test.ts`
  - [ ] `GET`: returns `{ visit, actions }` with actions sorted by `inserted_at ASC, id ASC`.
  - [ ] `GET`: excludes soft-deleted actions (`deleted_at IS NULL` only).
  - [ ] `GET`: no raw coordinate fields (`start_lat/lng`, `end_lat/lng`) in response payload.
  - [ ] `GET`: auth matrix includes owner PM, admin, scoped program_admin, out-of-scope reject, passcode reject.
  - [ ] `GET`: completed visit is still readable for owner PM/admin/scoped program_admin (reads remain allowed after completion).
  - [ ] Remove legacy section tests (`PATCH` section update + `PUT` complete) from this file.

Remove obsolete tests:
- [ ] Delete `src/app/api/pm/visits/[id]/end/route.test.ts` (route removed in new model).

Add new tests:
- [ ] `src/app/api/pm/visits/[id]/complete/route.test.ts`
  - [ ] rejects when no completed `classroom_observation`.
  - [ ] rejects when any action is `in_progress`.
  - [ ] ignores soft-deleted actions in validation queries.
  - [ ] success path sets `status=completed` + `completed_at` + visit end GPS + `updated_at`.
  - [ ] idempotent second complete call returns success and does not overwrite prior completion fields/`updated_at`.
  - [ ] admin can complete other PM visit but still requires GPS + same validations.
  - [ ] program_admin/passcode cannot complete (403).
  - [ ] response payload does not include coordinate fields.
- [ ] `src/app/api/pm/visits/[id]/actions/route.test.ts`
  - [ ] `GET` lists non-deleted actions in creation order (`inserted_at ASC, id ASC`).
  - [ ] `POST` creates `pending` action with valid `action_type`.
  - [ ] invalid `action_type` returns 400.
  - [ ] write blocked when visit is already completed.
  - [ ] `GET` auth matrix includes scoped program_admin read access and passcode rejection.
  - [ ] `POST` rejects program_admin and passcode users.
- [ ] `src/app/api/pm/visits/[id]/actions/[actionId]/route.test.ts`
  - [ ] `GET` returns action payload (no coordinates) and enforces route binding + soft-delete 404.
  - [ ] `PATCH` updates only `data` (status/timestamps immutable here) and bumps `updated_at`.
  - [ ] `PATCH` on a completed action: PM owner gets `409`, admin succeeds.
  - [ ] `PATCH` rejects if action does not belong to `visit_id`.
  - [ ] `PATCH`/`DELETE` on a soft-deleted action returns `404`.
  - [ ] `DELETE` allowed only for `pending`; sets `deleted_at` (soft delete) and bumps `updated_at`.
  - [ ] `DELETE` rejects for `in_progress`/`completed`.
  - [ ] `PATCH`/`DELETE` reject program_admin and passcode users.
- [ ] `src/app/api/pm/visits/[id]/actions/[actionId]/start/route.test.ts`
  - [ ] pending → in_progress sets `started_at` + start GPS + `updated_at`.
  - [ ] second start is idempotent and does not overwrite `started_at`/`updated_at`.
  - [ ] GPS >500m rejected; 100–500m warning returned.
  - [ ] write blocked if visit completed.
  - [ ] start on a soft-deleted action returns `404`.
  - [ ] program_admin/passcode cannot start actions.
  - [ ] response payload does not include coordinate fields.
- [ ] `src/app/api/pm/visits/[id]/actions/[actionId]/end/route.test.ts`
  - [ ] in_progress → completed sets `ended_at` + end GPS + `updated_at`.
  - [ ] end without start rejected.
  - [ ] second end is idempotent and does not overwrite `ended_at`/`updated_at`.
  - [ ] write blocked if visit completed.
  - [ ] end on a soft-deleted action returns `404`.
  - [ ] program_admin/passcode cannot end actions.
  - [ ] response payload does not include coordinate fields.

### 6.2 Unit tests (components/pages) — exact files + cases

Update existing tests:
- [ ] `src/app/visits/[id]/page.test.tsx`
  - [ ] remove 6 fixed sections assertions and `0 of 6 sections` progress assertions.
  - [ ] assert action-card list render, 2-state badge only (`In Progress`/`Completed`), and read-only state on completed visits.
  - [ ] assert no `Ended` badge and no `End Visit` button.
- [ ] `src/app/visits/page.test.tsx`
  - [ ] assert completed rows render `completed_at` (not `inserted_at`/`ended_at`) for completion timestamp.
  - [ ] add `program_admin` list visibility + filter behavior assertions for mandatory list filters.
- [ ] `src/components/VisitsTab.test.tsx`
  - [ ] update fixtures to use `completed_at`; remove `ended_at` dependency.
- [ ] `src/components/SchoolTabs.test.tsx`
  - [ ] remove ended-state badge/link assertions.
  - [ ] assert 2-state semantics only (`In Progress`/`Completed`) + `completed_at` rendering where used.
- [ ] `src/components/visits/NewVisitForm.test.tsx`
  - [ ] remove legacy “Visit Workflow sections” assertions tied to old fixed-section model.
  - [ ] assert new workflow copy references action points/cards and dynamic action flow.

Replace legacy component tests:
- [ ] Replace `src/components/visits/EndVisitButton.test.tsx` with `src/components/visits/CompleteVisitButton.test.tsx`
  - [ ] GPS acquisition + cancel/retry flow.
  - [ ] validation error rendering from `/complete` API.
  - [ ] success path reload/navigation behavior.
  - [ ] moderate GPS warning rendering.

Add new tests:
- [ ] `src/components/visits/ActionPointList.test.tsx`
  - [ ] pending card shows Start + Delete.
  - [ ] in_progress card shows Open only.
  - [ ] completed card shows View Details only.
- [ ] `src/components/visits/ActionTypePickerModal.test.tsx`
  - [ ] available action types rendered from `ACTION_TYPES`.
  - [ ] selecting + submit calls create handler with correct `action_type`.
- [ ] `src/app/visits/[id]/actions/[actionId]/page.test.tsx`
  - [ ] renderer dispatch by `action_type`.
  - [ ] Save uses `PATCH .../actions/[actionId]`.
  - [ ] End Action uses `POST .../actions/[actionId]/end`.
  - [ ] Completed action is read-only for PM owner but editable for admin.
  - [ ] Soft-deleted action returns 404 UI state (or redirects) and does not render form.
  - [ ] Replace `src/app/visits/[id]/principal/page.test.tsx` with dynamic action-page coverage (route no longer fixed to `/principal`).

### 6.3 E2E tests (Playwright) — exact files + scenarios

Fixture/helper updates:
- [ ] `e2e/helpers/db.ts`
  - [ ] update `seedTestVisit()` to insert visit rows without `data`/`ended_at`.
  - [ ] add helper to seed actions with explicit status (`pending`, `in_progress`, `completed`) for deterministic tests.
- [ ] Regenerate `e2e/fixtures/db-dump.sql` against new schema (includes `lms_pm_visit_actions`, removed visit JSONB columns).

Rewrite `e2e/tests/visits.spec.ts` with these explicit scenarios:
- [ ] `visits-list-shows-two-states`: only In Progress + Completed groupings, no Ended.
- [ ] `pm-can-add-and-delete-pending-action`: add action card, then delete while pending.
- [ ] `pm-can-start-and-end-classroom-observation`: mock GPS, verify status transitions.
- [ ] `complete-blocked-without-completed-classroom-observation`: error shown.
- [ ] `complete-blocked-when-any-action-in-progress`: error shown.
- [ ] `complete-visit-success`: after one completed classroom observation, complete visit succeeds and page becomes read-only.
- [ ] `moderate-gps-warning-visible`: 100–500m warning shown during start/end/complete.
- [ ] `poor-gps-blocks-write`: >500m blocks start/end/complete.
- [ ] `admin-can-complete-other-pm-visit-with-same-rules`: admin path still enforces GPS + validation.
- [ ] `program-admin-read-only`: program_admin can list/view scoped visits but cannot add/start/end/complete actions.
- [ ] `legacy-routes-are-gone`: no navigation/assertions to `/visits/:id/principal` or `/api/pm/visits/:id/end`.

### 6.4 Test execution commands (must run before merge)

Unit (targeted visit stack):
- [ ] `npm run test:unit -- src/app/api/pm/visits/route.test.ts 'src/app/api/pm/visits/[id]/route.test.ts'`
- [ ] `npm run test:unit -- 'src/app/api/pm/visits/[id]/complete/route.test.ts'`
- [ ] `npm run test:unit -- 'src/app/api/pm/visits/[id]/actions/route.test.ts' 'src/app/api/pm/visits/[id]/actions/[actionId]/route.test.ts'`
- [ ] `npm run test:unit -- 'src/app/api/pm/visits/[id]/actions/[actionId]/start/route.test.ts' 'src/app/api/pm/visits/[id]/actions/[actionId]/end/route.test.ts'`
- [ ] `npm run test:unit -- src/app/visits/page.test.tsx 'src/app/visits/[id]/page.test.tsx'`
- [ ] `npm run test:unit -- src/components/SchoolTabs.test.tsx src/components/VisitsTab.test.tsx src/components/visits/NewVisitForm.test.tsx`
- [ ] `npm run test:unit -- src/components/visits/CompleteVisitButton.test.tsx src/components/visits/ActionPointList.test.tsx src/components/visits/ActionTypePickerModal.test.tsx`
- [ ] `npm run test:unit -- 'src/app/visits/[id]/actions/[actionId]/page.test.tsx'`

E2E (visits flow):
- [ ] `npm run test:e2e -- e2e/tests/visits.spec.ts`

Pre-merge full confidence:
- [ ] `npm run test:unit`
- [ ] `npm run test:e2e`

---

## 8) Phase 7 — Manual QA (mobile-first)

### Devices / browsers

- [ ] Android Chrome
- [ ] iOS Safari

### Scenarios

- [ ] Start visit with good GPS; add action; start/end; complete visit
- [ ] Accuracy 100–500m warns but allows start/end/complete
- [ ] Accuracy >500m blocks start/end/complete with clear message
- [ ] Deny location permission: actionable error + retry path
- [ ] Try completing with no classroom observation completed: blocked
- [ ] Try completing with an action in progress: blocked
- [ ] Completed visit is read-only (no edits, no new actions)
- [ ] Admin can complete other PM’s visit (still requires GPS + rules)
- [ ] Program admin can view scoped visits but cannot perform write/lifecycle actions

---

## 9) Release Checklist (Hard Cutover)

Only do this after Phases 0–8 are complete and tests are green.

### Deployment sequencing (no partial deploys)

- [ ] Staging: deploy db-service migrations + af_lms changes together
- [ ] Smoke: start visit, create action, complete action, complete visit
- [ ] Staging: visits list + dashboard render without dropped-column errors
- [ ] Production: deploy db-service migrations + af_lms changes together
- [ ] Production smoke: repeat core flows

### Post-release checks

- [ ] No 500s from routes that used to reference `data` / `ended_at`
- [ ] Visits list shows only 2 states everywhere
- [ ] No raw GPS coordinates in logs (spot-check)
- [ ] Passcode users do not see visit entry points; direct URL access returns a clear forbidden/redirect (no crashes)
- [ ] Update `docs/ai/project-context.md` to remove the 3-state `/end` workflow + `EndVisitButton` references and reflect the new 2-state `/complete` model
- [ ] Repo-wide dead-reference sweep is clean (deploy blocker):
  - [ ] `rg -n \"visit\\.data|ended_at|EndVisitButton|/api/pm/visits/\\[id\\]/end|/visits/\\[id\\]/principal\" src e2e docs`
