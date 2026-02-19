# School Visit Action Points — Implementation & Testing Plan

**Plan date:** 2026-02-16  
**Last updated:** 2026-02-19  
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

- [x] Add `lms_pm_visit_actions` table (DDL below; omit DB-level action type enum enforcement)
- [x] Add index on `lms_pm_visit_actions(visit_id)`
- [x] Ensure defaults/timestamps use UTC: `NOW() AT TIME ZONE 'UTC'`
  - [x] **Decision:** do **not** enforce action types in DB via `CHECK (action_type IN (...))`. Treat `action_type` as free-form `VARCHAR(50)` and validate against `ACTION_TYPES` in app code (single source of truth).
- [x] Implemented in db-service migration: `priv/repo/migrations/20260217120000_add_visit_actions_and_update_school_visits.exs`

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

- [x] Add `completed_at TIMESTAMP` to `lms_pm_school_visits` (UTC)
- [x] Drop `lms_pm_school_visits.data` (JSONB)
- [x] Drop `lms_pm_school_visits.ended_at`
- [x] Drop any index/constraint that references `ended_at` (if present)
- [x] Confirm `status` stays only `in_progress|completed` (no “ended” state)

### 0.3 Verification checklist (local)

- [x] Migration runs cleanly on local dev (db-service)
- [x] `lms_pm_visit_actions` exists with constraints + `visit_id` index
- [x] `lms_pm_school_visits` has `completed_at`
- [x] `lms_pm_school_visits` no longer has `data`, `ended_at`
- [x] No GPS lat/lng fields are accidentally logged by DB triggers (should be none)

### 0.4 Pre-cutover data cleanup (staging/prod)

We are intentionally doing a hard cutover with **no data migration**; pre-existing visits in the old JSONB model must be cleared so nothing “half-exists” during/after deployment.

- [x] Local dry run completed (`dbservice_dev`, 2026-02-17): `DELETE FROM lms_pm_school_visits;` executed successfully (`visits: 5 -> 0`, `visit_actions: 0 -> 0`).
- [x] Team decision: staging/prod cleanup is deferred to final cutover.
- [x] Staging/prod execution moved to dedicated release task in Section 9 (“Cutover data cleanup task (staging/prod)”).

---

## 2) Phase 1 — Backend Cutover (af_lms API routes)

### 1.1 Shared constants + helpers (P0)

- [x] Add/centralize `ACTION_TYPES` map + `ActionType` union
- [x] Add explicit policy helpers (used across API + UI):
  - [x] **Reads:** allowed for visit owner PM, `admin`, and scoped `program_admin` (including when visit is completed).
  - [x] **Writes:** denied for passcode users everywhere; `program_admin` is read-only everywhere.
  - [x] **Completed visit:** terminal and read-only for everyone (reject all write routes when `visit.status === "completed"`).
  - [x] **Completed action:** only `admin` can edit action `data` after `status="completed"`; PM owner can view but cannot edit.
- [x] Define **scope** semantics (single implementation used everywhere):
  - [x] `scoped program_admin` / `admin` means: user can view the visit/action only if they can access `visit.school_code` via `canAccessSchoolSync(permission, visit.school_code, school.region?)`.
  - [x] Add a single helper to load `school.region` only when needed (permission level 2), and reuse it across list/detail/actions/complete routes.
- [x] Reuse `validateGpsReading()` / geo-validation thresholds (≤100m ok, 100–500m warn, >500m reject)
- [x] Add visit/action “locking” helper: if `visit.status === "completed"`, reject all write routes
- [x] Add shared visits auth helper(s) used by **all** `/api/pm/visits/*` routes:
  - [x] reject passcode users on all visits routes
  - [x] enforce `canView` vs `canEdit`
  - [x] enforce owner/admin/program_admin semantics consistently
  - [x] Add shared API error helper so route errors consistently return `{ error: string; details?: string[] }`

Implementation notes (2026-02-18):
- Added `src/lib/visit-actions.ts` (`ACTION_TYPES`, `ActionType`, status constants, runtime guard).
- Added `src/lib/visits-policy.ts` (shared auth, scope, owner/admin/program_admin policy, completed-visit lock, shared API error envelope, JSON body parsing helper).
- Refactored all current `/api/pm/visits/*` route handlers to use shared auth/policy/error helpers (`route.ts`, `[id]/route.ts`, `[id]/end/route.ts`).
- Updated UI visit detail authorization to use shared read policy helper (`src/app/visits/[id]/page.tsx`).

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
- [x] Type-level: action types compile-time constrained
- [x] GPS validation: warns vs rejects exactly as geo-tracking
- [x] No response returns raw `*_lat/*_lng` fields
- [x] Passcode users are rejected on both read and write visits routes
- [x] Error response shape is consistent across all visits routes (`{ error, details? }`)
- [x] Unit targets:
  - [x] `src/lib/geo-validation.test.ts` covers threshold behavior used by actions + complete flows.
  - [x] Add/extend a constants/helper test for `ACTION_TYPES` + `ActionType` exhaustiveness.

Validation run (2026-02-18):
- `npm run test:unit -- src/lib/visit-actions.test.ts src/lib/visits-policy.test.ts src/app/api/pm/visits/route.test.ts src/app/api/pm/visits/[id]/route.test.ts src/app/api/pm/visits/[id]/end/route.test.ts`
- `npm run lint -- src/app/api/pm/visits src/lib/visit-actions.ts src/lib/visits-policy.ts src/app/visits/[id]/page.tsx`

### 1.2 Update `GET /api/pm/visits` (cutover-safe list)

Implementation tasks:
- [x] Stop selecting/returning `data` and `ended_at` (columns dropped)
- [x] Add optional `pm_email` filter (admin/program_admin only)
- [x] Keep `limit` default at `50` when query param is missing
- [x] Avoid N+1 scope checks: when `permission.level === 2`, do not fetch `school.region` per row; join `school` (or filter by region in SQL) once and apply scope consistently
- [x] Ensure role semantics:
  - `program_manager`: only own visits
  - `program_admin`: read-only, all visits within scope (scope determined by `canAccessSchoolSync` against `visit.school_code`)
  - `admin`: read/write all accessible visits (same scope rule; no “level bypass”)
- [x] Return `completed_at` (and use it in UI later)

Testing checklist:
- [x] PM sees only own visits
- [x] Program admin can list but cannot create/edit in other routes
- [x] Admin can filter by `pm_email`
- [x] Program admin `pm_email` filter works only within scoped visibility
- [x] `limit` default behavior is covered (`50` when absent)
- [x] Completed visits show `completed_at` (not `ended_at`)
- [x] Unit target: `src/app/api/pm/visits/route.test.ts` (`GET` role matrix + `pm_email` filter).
- [x] E2E point: visits list verifies role visibility (PM/admin/program_admin where supported) and no `ended_at` UI.

Validation run (2026-02-18):
- `npm run test:unit -- src/app/api/pm/visits/route.test.ts`
- `npm run test:unit -- 'src/app/api/pm/visits/[id]/route.test.ts'`
- `npm run lint -- src/app/api/pm/visits/route.ts src/lib/visits-policy.ts src/app/api/pm/visits/route.test.ts`
- `npm run test:e2e -- e2e/tests/visits.spec.ts`

### 1.3 Update `POST /api/pm/visits` (start visit)

Implementation tasks:
- [x] Remove JSONB `initialData` initialization entirely (visit starts with **zero actions**)
- [x] Keep start-visit GPS capture (visit-level) as-is
- [x] Ensure response shape matches design doc (id, visit_date, optional warning)

Testing checklist:
- [x] Creates visit row without `data`
- [x] Creates visit with start GPS fields set
- [x] `visit_date` is persisted as IST-derived date (`Asia/Kolkata`)
- [x] Passcode users rejected
- [x] Unit targets:
  - [x] `src/app/api/pm/visits/route.test.ts` (`POST` create path, passcode reject, warning payload).
  - [x] `src/components/visits/NewVisitForm.test.tsx` (`Start Visit` request payload/redirect + GPS error states).
- [x] E2E point: start-visit flow from `/school/[udise]/visit/new` to `/visits/[id]`.

Implementation notes (2026-02-18):
- Updated `src/app/api/pm/visits/route.ts` `POST` insert to remove the dropped `data` column and preserve only visit metadata + start GPS columns.
- Kept response contract unchanged: `{ id, visit_date, warning? }`.
- Extended `src/app/api/pm/visits/route.test.ts` assertions for:
  - no `data` in insert SQL
  - start GPS fields inserted
  - IST-derived `visit_date` expression
  - warning payload contract

Validation run (2026-02-18):
- `npm run test:unit -- src/app/api/pm/visits/route.test.ts src/components/visits/NewVisitForm.test.tsx`
- `npm run lint -- src/app/api/pm/visits/route.ts src/app/api/pm/visits/route.test.ts`
- `npm run test:e2e -- e2e/tests/visits.spec.ts`

### 1.4 Replace visit detail route: `GET /api/pm/visits/[id]`

Implementation tasks:
- [x] Return `{ visit, actions }` in one response
- [x] Only return **non-deleted** actions (`deleted_at IS NULL`)
- [x] Sort actions by `inserted_at ASC, id ASC` (stable creation order)
- [x] Do not return raw GPS coordinates (privacy)
- [x] Ensure non-owner reads are only possible when `canAccessSchoolSync(permission, visit.school_code, school.region?)` is true

Testing checklist:
- [x] Visit returned without sensitive coordinates
- [x] Actions list excludes soft-deleted rows
- [x] Sorting stable by `inserted_at ASC, id ASC`
- [x] Unit target: `src/app/api/pm/visits/[id]/route.test.ts` (`GET` returns `{ visit, actions }`, strips coordinates, excludes `deleted_at`).
- [ ] E2E point: visit detail page loads action cards in creation order.

Implementation notes (2026-02-18):
- Updated `src/app/api/pm/visits/[id]/route.ts` `GET` handler to:
  - return visit metadata plus action list in one payload (`{ visit, actions }`)
  - enforce scoped non-owner reads via `school.region`-backed `canAccessSchoolSync` policy path
  - fetch action rows from `lms_pm_visit_actions` with `deleted_at IS NULL` and stable ordering (`inserted_at ASC, id ASC`)
  - avoid selecting raw GPS coordinates in both visit and action queries
- Extended `src/app/api/pm/visits/[id]/route.test.ts` GET coverage for:
  - payload shape (`{ visit, actions }`)
  - SQL-level guarantees (no coordinate selection, soft-delete filter, stable ordering)
  - scoped read behavior for owner PM, in-scope admin, and out-of-scope program admin

Validation run (2026-02-18):
- `npm run test:unit -- 'src/app/api/pm/visits/[id]/route.test.ts'`
- `npm run lint -- 'src/app/api/pm/visits/[id]/route.ts' 'src/app/api/pm/visits/[id]/route.test.ts'`
- `npm run test:e2e -- e2e/tests/visits.spec.ts`
- E2E infra update: `e2e/helpers/db.ts` now runs versioned SQL migrations from `e2e/fixtures/migrations/*.sql` (tracked via `e2e_schema_migrations`) after loading `db-dump.sql`; current migration adds visit-schema compatibility (`completed_at` + `lms_pm_visit_actions` + index) so local E2E resets run against required schema without API workarounds.

### 1.5 Remove old section update routes

Implementation tasks:
- [x] Delete `POST /api/pm/visits/[id]/end` route (replaced by `/complete`)
- [x] Remove `PATCH /api/pm/visits/[id]` JSONB section update logic
- [x] Remove `PUT /api/pm/visits/[id]` completion route (replaced by `/complete`)

Testing checklist:
- [x] No tests reference removed routes
- [x] No code path queries `visit.data` anywhere
- [x] Unit cleanup:
  - [x] Remove `src/app/api/pm/visits/[id]/end/route.test.ts`.
  - [x] Remove legacy `PATCH`/`PUT` section-based tests from `src/app/api/pm/visits/[id]/route.test.ts`.
- [x] E2E cleanup: remove `/visits/:id/principal` route assertions from `e2e/tests/visits.spec.ts`.

Implementation notes (2026-02-18):
- Deleted legacy API surface:
  - removed `src/app/api/pm/visits/[id]/end/route.ts`
  - removed `PATCH`/`PUT` handlers from `src/app/api/pm/visits/[id]/route.ts` (GET-only now)
- Removed legacy tests:
  - deleted `src/app/api/pm/visits/[id]/end/route.test.ts`
  - rewrote `src/app/api/pm/visits/[id]/route.test.ts` to GET coverage only
- Removed stale UI paths tied to section JSON updates:
  - `src/app/visits/[id]/page.tsx` now renders action-point timeline from `lms_pm_visit_actions` (no `visit.data`)
  - `src/app/visits/[id]/principal/page.tsx` now redirects back to `/visits/[id]`
  - removed legacy `EndVisitButton` component/test that still targeted `/end`
- Eliminated remaining `visit.data` runtime dependency by removing dashboard open-issues JSONB query (`src/app/dashboard/page.tsx`) and aligning dashboard tests.
- Updated `e2e/tests/visits.spec.ts` to remove principal-route flow and fixed-section assertions; detail-page assertions now validate action-point summary.

Validation run (2026-02-18):
- `npm run test:unit -- 'src/app/api/pm/visits/[id]/route.test.ts' 'src/app/visits/[id]/page.test.tsx' 'src/app/visits/[id]/principal/page.test.tsx' 'src/app/dashboard/page.test.tsx'`
- `npm run lint -- 'src/app/api/pm/visits/[id]/route.ts' 'src/app/api/pm/visits/[id]/route.test.ts' 'src/app/visits/[id]/page.tsx' 'src/app/visits/[id]/page.test.tsx' 'src/app/visits/[id]/principal/page.tsx' 'src/app/visits/[id]/principal/page.test.tsx' 'src/app/dashboard/page.tsx' 'src/app/dashboard/page.test.tsx' 'e2e/tests/visits.spec.ts'`
- `npm run test:e2e -- e2e/tests/visits.spec.ts`

### 1.6 Cross-route auth + API contract hardening (P0)

Implementation tasks:
- [x] Apply the same authorization rules to all currently implemented visits routes (`/visits`, `/visits/[id]`), with shared helpers prepared for `/actions/*` and `/complete`
  - [x] `program_manager`: own visit read/write
  - [x] `program_admin`: scoped read-only (no create/edit/start/end/complete)
  - [x] `admin` (`permission.role === "admin"`): read/write within accessible scope
- [x] Ensure route handlers do not infer admin behavior from `permission.level`
- [x] Make scope checks explicit and consistent:
  - [x] For any read route where the user is not the owner PM, require shared `canAccessSchoolSync(permission, visit.school_code, school.region?)` policy check.
  - [x] Ensure “out-of-scope” is consistently `403` (not `404`) unless the resource truly does not exist / is soft-deleted.
- [x] Ensure all visits route responses follow documented contracts (request fields, response fields, and error envelope)

Testing checklist:
- [x] Unit matrix includes owner/non-owner/admin/program_admin/passcode across current phase-1 detail/list/write routes
- [x] Program admin read-only behavior is explicitly tested on write routes (403)
- [x] Route contract tests verify shape for success and error payloads (including `details` when applicable)

Implementation notes (2026-02-18):
- Updated `src/lib/visits-policy.ts` with shared role/scope helpers:
  - `isScopedVisitsRole()` to make non-owner scope-filter roles explicit (`admin`, `program_admin`)
  - `canAccessVisitSchoolScope()` as the shared school-scope check consumed by routes/policies
- Updated `src/app/api/pm/visits/route.ts`:
  - list route now applies scope predicates only for scoped non-owner roles (`admin`/`program_admin`)
  - owner PM list behavior is role-based and no longer tightened implicitly by `permission.level`
  - start-visit school scope check now uses shared policy helper and returns consistent `403` error envelope
- Expanded route/policy unit coverage:
  - `src/app/api/pm/visits/route.test.ts`: owner-PM query contract, explicit non-level PM behavior, and error envelope assertions
  - `src/app/api/pm/visits/[id]/route.test.ts`: admin out-of-scope `403` and error envelope assertions
  - `src/lib/visits-policy.test.ts`: scoped-role helper behavior

Validation run (2026-02-18):
- `npm run test:unit -- src/lib/visits-policy.test.ts src/app/api/pm/visits/route.test.ts 'src/app/api/pm/visits/[id]/route.test.ts'`
- `npm run lint -- src/lib/visits-policy.ts src/lib/visits-policy.test.ts src/app/api/pm/visits/route.ts src/app/api/pm/visits/route.test.ts 'src/app/api/pm/visits/[id]/route.test.ts'`

---

## 3) Phase 2 — Action APIs (CRUD + lifecycle)

### 2.1 `GET/POST /api/pm/visits/[id]/actions`

Implementation tasks:
- [x] `GET`: list non-deleted actions, sorted by `inserted_at ASC, id ASC`
- [x] `POST`: create action with `action_type`, default `status="pending"`, `data={}`
- [x] Enforce “visit not completed” for `POST`
- [x] Enforce shared auth semantics (`program_admin` read-only, passcode rejected, PM owner rules)

Testing checklist:
- [x] Create returns 201 with action row
- [x] Invalid action_type rejected (400)
- [x] Cannot create when visit completed (409/400)
- [x] `GET` access matrix: owner PM + admin + scoped program_admin allowed; out-of-scope denied
- [x] `POST` denies program_admin and passcode users
- [x] Unit target: `src/app/api/pm/visits/[id]/actions/route.test.ts` (`GET`/`POST` + invalid type + completed lock).
- [ ] E2E point: add action from visit detail and verify pending card appears.

Implementation notes (2026-02-18):
- Added `src/app/api/pm/visits/[id]/actions/route.ts` with:
  - `GET` list endpoint returning non-deleted actions in stable order (`inserted_at ASC, id ASC`)
  - `POST` create endpoint requiring valid `action_type` (`ACTION_TYPES` runtime guard), defaulting to `status='pending'` and `data='{}'`
  - shared visit auth policy enforcement (`requireVisitsAccess`, `enforceVisitReadAccess`, `enforceVisitWriteAccess`)
  - completed-visit write lock enforcement via shared helper (`409`)
- Added unit coverage in `src/app/api/pm/visits/[id]/actions/route.test.ts`:
  - GET matrix: owner PM/in-scope admin allowed; out-of-scope program_admin denied; passcode denied
  - POST matrix: program_admin/passcode denied; missing/invalid action type validation; completed-visit lock
  - SQL assertions: soft-delete filter, stable ordering, and create defaults

Validation run (2026-02-18):
- `npm run test:unit -- 'src/app/api/pm/visits/[id]/actions/route.test.ts'`
- `npm run test:unit -- src/lib/visits-policy.test.ts src/app/api/pm/visits/route.test.ts 'src/app/api/pm/visits/[id]/route.test.ts' 'src/app/api/pm/visits/[id]/actions/route.test.ts'`
- `npm run lint -- 'src/app/api/pm/visits/[id]/actions/route.ts' 'src/app/api/pm/visits/[id]/actions/route.test.ts'`

### 2.2 `PATCH/DELETE /api/pm/visits/[id]/actions/[actionId]`

Implementation tasks:
- [x] **Add `GET`** for a single action (needed by `/visits/[id]/actions/[actionId]` UI):
  - [x] Returns `{ visit, action }` (or `{ action }` plus minimal `visit` fields required for read-only gating).
  - [x] Treat soft-deleted actions as not-found (`404` if `deleted_at IS NOT NULL`).
  - [x] Do not return raw GPS coordinates (privacy).
- [x] `PATCH`: update `data` only (no status changes here)
  - [x] Enforce edit policy: if `action.status="completed"`, allow `PATCH` only for `admin` (PM owner gets `409`)
- [x] `DELETE`: soft delete only when `status="pending"` (set `deleted_at`; keep row)
- [x] Validate action belongs to visit (route binding)
- [x] Treat soft-deleted actions as not-found: if `deleted_at IS NOT NULL`, return `404` for all action routes
- [x] Enforce “visit not completed” for `PATCH` and `DELETE` (immutability policy)
- [x] Ensure successful writes update `updated_at` using UTC write timestamp semantics
- [x] Enforce shared auth semantics (`program_admin` read-only, passcode rejected, PM owner/admin checks)

Testing checklist:
- [x] GET returns `{ visit, action }` payload without coordinate fields; enforces route binding + auth matrix
- [x] PATCH updates JSONB data and bumps `updated_at`
- [x] PATCH rejected if visit completed
- [x] PATCH rejected for non-admin when action is completed (admin can PATCH)
- [x] DELETE rejected if status != pending
- [x] DELETE sets `deleted_at`, bumps `updated_at`, and action disappears from list
- [x] PATCH/DELETE deny program_admin and passcode users
- [x] Unit target: `src/app/api/pm/visits/[id]/actions/[actionId]/route.test.ts` (route binding + pending-only delete).
- [ ] E2E point: delete pending action card and confirm it disappears without page reload.

Implementation notes (2026-02-19):
- Added `src/app/api/pm/visits/[id]/actions/[actionId]/route.ts` with `GET`, `PATCH`, and `DELETE`.
- `GET` now returns `{ visit, action }`, validates visit/action route binding, and treats soft-deleted rows as `404` via `deleted_at IS NULL`.
- `PATCH` updates only `data` (no status/timestamp transitions), enforces completed-visit lock, and enforces completed-action edit policy (`admin` only).
- `DELETE` is pending-only soft delete (`deleted_at` set; row retained) and returns `404` for already soft-deleted rows.
- Both write operations explicitly set `updated_at = (NOW() AT TIME ZONE 'UTC')`.
- Route uses shared auth/policy helpers (`requireVisitsAccess`, `enforceVisitReadAccess`, `enforceVisitWriteAccess`, `enforceVisitWriteLock`) for PM/admin/program_admin/passcode semantics.

Validation run (2026-02-19):
- `npm run test:unit -- 'src/app/api/pm/visits/[id]/actions/[actionId]/route.test.ts'`
- `npm run test:unit -- 'src/app/api/pm/visits/[id]/actions/route.test.ts' 'src/app/api/pm/visits/[id]/actions/[actionId]/route.test.ts'`
- `npm run lint -- 'src/app/api/pm/visits/[id]/actions/[actionId]/route.ts' 'src/app/api/pm/visits/[id]/actions/[actionId]/route.test.ts'`

### 2.3 `POST /start` and `POST /end` action lifecycle

Implementation tasks:
- [x] `POST /start`: requires start GPS; idempotent if already started
- [x] `POST /end`: requires end GPS; rejects if not started; idempotent if already ended
- [x] Status + timestamps rules:
  - start sets `started_at` (UTC) and `status="in_progress"`
  - end sets `ended_at` (UTC) and `status="completed"`
- [x] Ensure successful start/end writes set `updated_at` (UTC)
- [x] Enforce “visit not completed” for both routes
- [x] Implement start/end transitions with atomic conditional updates (or transaction) to avoid race-condition state drift
- [x] Response contract: do not return raw lat/lng; return only status/timestamps and optional `warning`

Testing checklist:
- [x] Start from pending sets started_at + status + `updated_at`
- [x] Second start is idempotent (no crash, no overwrite of `started_at`/`updated_at`)
- [x] End without start rejected
- [x] End from in_progress sets ended_at + status + `updated_at`
- [x] Second end is idempotent (no overwrite of `ended_at`/`updated_at`)
- [x] GPS accuracy >500 rejected; 100–500 warning returned
- [x] Success payloads do not contain `*_lat`/`*_lng` fields
- [x] Start/end deny program_admin and passcode users
- [x] Concurrent requests do not produce invalid transitions
- [x] Unit targets:
  - [x] `src/app/api/pm/visits/[id]/actions/[actionId]/start/route.test.ts`.
  - [x] `src/app/api/pm/visits/[id]/actions/[actionId]/end/route.test.ts`.
- [ ] E2E points:
  - [ ] start pending action -> in_progress.
  - [ ] end in_progress action -> completed.
  - [ ] moderate accuracy warning and >500m rejection paths.

Implementation notes (2026-02-19):
- Added `src/app/api/pm/visits/[id]/actions/[actionId]/start/route.ts` and `src/app/api/pm/visits/[id]/actions/[actionId]/end/route.ts`.
- Both routes enforce shared write auth, completed-visit write lock, and soft-delete `404` behavior.
- `POST /start` uses atomic conditional update (`status='pending' AND started_at IS NULL AND ended_at IS NULL`) to transition to `in_progress`, with idempotent success when already started.
- `POST /end` requires `started_at`, uses atomic conditional update (`status='in_progress' AND started_at IS NOT NULL AND ended_at IS NULL`) to transition to `completed`, with idempotent success when already ended.
- Both routes validate GPS with shared thresholds, store GPS coordinates server-side, but return only non-coordinate fields plus optional warning.
- Both lifecycle writes explicitly set `updated_at = (NOW() AT TIME ZONE 'UTC')`.

Validation run (2026-02-19):
- `npm run test:unit -- 'src/app/api/pm/visits/[id]/actions/[actionId]/start/route.test.ts' 'src/app/api/pm/visits/[id]/actions/[actionId]/end/route.test.ts'`
- `npm run test:unit -- 'src/app/api/pm/visits/[id]/actions/[actionId]/route.test.ts' 'src/app/api/pm/visits/[id]/actions/[actionId]/start/route.test.ts' 'src/app/api/pm/visits/[id]/actions/[actionId]/end/route.test.ts'`
- `npm run lint -- 'src/app/api/pm/visits/[id]/actions/[actionId]/route.ts' 'src/app/api/pm/visits/[id]/actions/[actionId]/start/route.ts' 'src/app/api/pm/visits/[id]/actions/[actionId]/end/route.ts' 'src/app/api/pm/visits/[id]/actions/[actionId]/route.test.ts' 'src/app/api/pm/visits/[id]/actions/[actionId]/start/route.test.ts' 'src/app/api/pm/visits/[id]/actions/[actionId]/end/route.test.ts'`

---

## 4) Phase 3 — Visit Completion API

### 3.1 `POST /api/pm/visits/[id]/complete`

Implementation tasks:
- [x] Require end GPS payload (visit-level completion GPS)
- [x] Validate completion rules:
  - at least one `classroom_observation` action is `completed`
  - no actions are `in_progress`
- [x] Validation queries must consider **non-deleted actions only** (`deleted_at IS NULL`)
- [x] Write: set `status="completed"`, set `completed_at` (UTC), set end GPS in visit row
- [x] Ensure successful completion write also updates `updated_at` (UTC)
- [x] Idempotency:
  - if already completed, return success with existing `completed_at` (do not overwrite)
- [x] Validate-and-complete in one transaction/locked flow so actions cannot change between validation and completion write
- [x] Response contract: do not return raw lat/lng; return only status/completed_at and optional `warning`

Testing checklist:
- [x] Reject when no completed classroom observation
- [x] Reject when any action is in_progress
- [x] Success sets `completed_at` + status + `updated_at`
- [x] Second call is idempotent (no overwrite of completion fields/`updated_at`)
- [x] Admin completion allowed but must follow same validations + GPS
- [x] Program admin and passcode users cannot complete
- [x] Success payload does not contain `*_lat`/`*_lng` fields
- [x] Unit targets:
  - [x] `src/app/api/pm/visits/[id]/complete/route.test.ts`.
  - [x] `src/components/visits/CompleteVisitButton.test.tsx` (API error/success/warning rendering).
- [ ] E2E points:
  - [ ] blocked without completed classroom observation.
  - [ ] blocked when any action is in_progress.
  - [ ] success path transitions visit to read-only completed state.

Implementation notes (2026-02-19):
- Added `src/app/api/pm/visits/[id]/complete/route.ts` with shared write auth semantics, required completion GPS validation, and idempotent-complete behavior.
- Completion rule checks (`>=1 completed classroom observation`, `no in-progress actions`) and the completion write are executed in one SQL statement using CTEs so validation and write share the same statement snapshot.
- Completion validation explicitly ignores soft-deleted actions (`deleted_at IS NULL`).
- Successful completion writes `status='completed'`, `completed_at`, end GPS (`end_lat/end_lng/end_accuracy`), and `updated_at` in UTC.
- Added `src/app/api/pm/visits/[id]/complete/route.test.ts` covering auth matrix, rule validation failures, poor GPS rejection, idempotency, admin completion, and response privacy contract (no coordinate fields).
- Added `src/components/visits/CompleteVisitButton.tsx` and `src/components/visits/CompleteVisitButton.test.tsx` covering `/complete` API error rendering, success warning rendering, and GPS acquisition/cancel UX.

Validation run (2026-02-19):
- `npm run test:unit -- 'src/app/api/pm/visits/[id]/complete/route.test.ts' src/components/visits/CompleteVisitButton.test.tsx`
- `npm run lint -- 'src/app/api/pm/visits/[id]/complete/route.ts' 'src/app/api/pm/visits/[id]/complete/route.test.ts' src/components/visits/CompleteVisitButton.tsx src/components/visits/CompleteVisitButton.test.tsx`

---

## 5) Phase 4 — Frontend Cutover (Visits UI)

### 4.1 Visit detail page rewrite (`/visits/[id]`)

Implementation tasks:
- [x] Remove fixed “section” links entirely
- [x] Fetch `{ visit, actions }` and render **ActionPointList**
- [x] Replace EndVisitButton with **CompleteVisitButton**
- [x] Badges: only `In Progress` and `Completed` (no “Ended”)
- [x] Completed visit UI is read-only (no add/start/end/delete/edit)

Testing checklist:
- [x] Renders action cards with correct labels/status
- [x] Completed state disables all write UI
- [x] No UI references `ended_at` or sections
- [x] Unit target: `src/app/visits/[id]/page.test.tsx` (no 6-section UI, 2-state badge only, no `End Visit`).
- [x] E2E point: visit detail page contains action cards, not fixed-section links.

Implementation notes (2026-02-19):
- Added `src/components/visits/ActionPointList.tsx` and moved action-card rendering from `src/app/visits/[id]/page.tsx` into the component.
- Updated `src/app/visits/[id]/page.tsx` to:
  - keep a 2-state visit badge (`In Progress` / `Completed`);
  - render `CompleteVisitButton` for editable in-progress visits;
  - render explicit read-only messaging for completed visits and read-only roles.
- Updated `src/app/visits/[id]/page.test.tsx` to cover action-card rendering, no legacy `End Visit` UI, and completed read-only behavior.

Validation run (2026-02-19):
- `npm run test:unit -- 'src/app/visits/[id]/page.test.tsx'`
- `npm run lint -- 'src/app/visits/[id]/page.tsx' 'src/app/visits/[id]/page.test.tsx' src/components/visits/ActionPointList.tsx`
- `npm run test:e2e -- e2e/tests/visits.spec.ts`

### 4.2 Action list + interactions

Implementation tasks:
- [x] Add Action Point modal/picker (creates pending action)
- [x] Pending card: Start + Delete
- [x] In-progress card: Open
- [x] Completed card: View Details
- [x] Delete shown only for pending

Testing checklist:
- [x] Add creates card without reload breakage
- [x] Delete removes pending card
- [x] Start triggers GPS capture and moves to in_progress
- [x] Unit targets:
  - [x] `src/components/visits/ActionPointList.test.tsx`.
  - [x] `src/components/visits/ActionTypePickerModal.test.tsx`.
- [x] E2E point: add -> start -> delete (pending only) action-card interactions.

Implementation notes (2026-02-19):
- Added `src/components/visits/ActionTypePickerModal.tsx` for action-type selection and create flow.
- Upgraded `src/components/visits/ActionPointList.tsx` to a client component with local action state and interaction handlers:
  - create pending action via `POST /api/pm/visits/[id]/actions`,
  - start pending action with GPS via `POST /api/pm/visits/[id]/actions/[actionId]/start`,
  - delete pending action via `DELETE /api/pm/visits/[id]/actions/[actionId]`.
- Added card-level CTAs by status:
  - `pending`: `Start` + `Delete`,
  - `in_progress`: `Open`,
  - `completed`: `View Details`.
- Updated visit detail integration to pass `visitId` into the action list (`src/app/visits/[id]/page.tsx`).
- Added/updated tests:
  - unit: `src/components/visits/ActionPointList.test.tsx`, `src/components/visits/ActionTypePickerModal.test.tsx`,
  - e2e: `e2e/tests/visits.spec.ts` interaction coverage for add/start/delete flow (plus admin assertion hardening for duplicate `In Progress` badges after action-state mutations).

Validation run (2026-02-19):
- `npm run test:unit -- src/components/visits/ActionPointList.test.tsx src/components/visits/ActionTypePickerModal.test.tsx 'src/app/visits/[id]/page.test.tsx'`
- `npm run lint -- src/components/visits/ActionPointList.tsx src/components/visits/ActionPointList.test.tsx src/components/visits/ActionTypePickerModal.tsx src/components/visits/ActionTypePickerModal.test.tsx 'src/app/visits/[id]/page.tsx'`
- `npm run test:e2e -- e2e/tests/visits.spec.ts`

### 4.3 Visits list page (`/visits`)

Implementation tasks:
- [x] Show 2-state status consistently
- [x] Use `completed_at` for “Completed at” column (not `inserted_at`, not `ended_at`)
- [x] Add admin/program_admin filters (including `pm_email`) and map them to list API query-contract params

Testing checklist:
- [x] Completed timestamp uses completed_at
- [x] No ended-state displayed
- [x] Admin/program_admin filters call API params correctly and respect scoped results
- [x] Unit targets:
  - [x] `src/app/visits/page.test.tsx` (completed timestamp source + 2-state list).
  - [x] `src/components/VisitsTab.test.tsx` (no `ended_at` fixture usage).
- [x] E2E point: `/visits` list groups only by In Progress/Completed.

Implementation notes (2026-02-19):
- Updated `src/app/visits/page.tsx` to:
  - enforce two-state rendering only (`In Progress`, `Completed`) with no ended-state UI references,
  - use `completed_at` for completed-row timestamp display (with safe fallback),
  - add scoped filter controls for `admin`/`program_admin` (`school_code`, `status`, `pm_email`),
  - map filter fields to list API query-contract parameter names (`school_code`, `status`, `pm_email`) and apply matching role/scope-aware query behavior.
- Expanded `src/app/visits/page.test.tsx` for:
  - completed timestamp source assertion (`completed_at` instead of `inserted_at`),
  - two-state list assertions (no `Ended` labels/headers),
  - admin/program_admin filter coverage and scoped SQL predicate checks.
- Updated `src/components/VisitsTab.test.tsx` typings cleanup and preserved fixture shape without `ended_at`.

Validation run (2026-02-19):
- `npm run test:unit -- src/app/visits/page.test.tsx src/components/VisitsTab.test.tsx`
- `npm run lint -- src/app/visits/page.tsx src/app/visits/page.test.tsx src/components/VisitsTab.test.tsx`
- `npm run test:e2e -- e2e/tests/visits.spec.ts`

### 4.4 Dashboard + tabs cleanup (deploy blocker)

Implementation tasks:
- [x] Remove the dashboard open-issues widget (`getOpenIssuesCount()`), since it queried `visit.data->'issueLog'`
- [x] Update visit history tabs/components to not depend on `ended_at` or `data`
- [x] Update `src/components/visits/NewVisitForm.tsx` workflow copy from fixed sections to action-card lifecycle wording
- [x] Delete or redirect any legacy fixed “section pages” that read `visit.data` or call the removed section PATCH route (e.g. `/visits/[id]/principal`) so they can’t crash post-cutover
- [x] Frontend guardrails for passcode users:
  - [x] Hide/disable Visits entry points (dashboard links, school tabs) for passcode sessions.
  - [x] If a passcode user lands on `/visits/*` via direct URL, redirect (or render a clear forbidden state) instead of showing a generic crash/stack.

Testing checklist:
- [x] Dashboard renders without querying dropped columns
- [x] School Visits tab renders and loads visits list successfully
- [x] Start-visit workflow copy reflects action cards (not fixed sections)
- [x] Unit targets:
  - [x] `src/app/dashboard/page.test.tsx` (no `issueLog`/`visit.data` dependency).
  - [x] `src/components/SchoolTabs.test.tsx` (remove `ended_at` logic; 2-state history badges and labels only).
  - [x] `src/components/VisitsTab.test.tsx` with new response shape.
- [x] E2E point: dashboard and school visits tab load without 500s after cutover.

Implementation notes (2026-02-19):
- Updated `src/components/visits/NewVisitForm.tsx` workflow guidance from fixed sections to action-card lifecycle copy (`add/start/open/end/complete` with classroom-observation rule).
- Updated `src/components/visits/NewVisitForm.test.tsx` assertions to validate action-card copy and removed stale section wording expectations.
- Hardened passcode direct-URL guardrails in UI pages:
  - `src/app/visits/page.tsx` now redirects passcode users to `session.schoolCode` (or `/dashboard` fallback) before permission lookups.
  - `src/app/visits/[id]/page.tsx` now applies the same early passcode redirect behavior.
- Added passcode redirect coverage to server-page tests:
  - `src/app/visits/page.test.tsx`
  - `src/app/visits/[id]/page.test.tsx`
- Kept legacy fixed section route safe via redirect (`src/app/visits/[id]/principal/page.tsx` redirects to `/visits/[id]`).

Validation run (2026-02-19):
- `npm run test:unit -- src/app/dashboard/page.test.tsx src/components/SchoolTabs.test.tsx src/components/VisitsTab.test.tsx src/components/visits/NewVisitForm.test.tsx 'src/app/visits/page.test.tsx' 'src/app/visits/[id]/page.test.tsx'`
- `npm run lint -- src/components/visits/NewVisitForm.tsx src/components/visits/NewVisitForm.test.tsx src/app/visits/page.tsx src/app/visits/page.test.tsx 'src/app/visits/[id]/page.tsx' 'src/app/visits/[id]/page.test.tsx'`
- `npm run test:e2e -- e2e/tests/dashboard.spec.ts e2e/tests/school.spec.ts e2e/tests/visits.spec.ts`

---

## 6) Phase 5 — Action Form Pages

### 5.1 Dynamic action route: `/visits/[id]/actions/[actionId]`

Implementation tasks:
- [x] Single dynamic page that loads action + visit, then dispatches by `action_type`
- [x] Use `GET /api/pm/visits/[id]/actions/[actionId]` (or equivalent) to load action `data` reliably (avoid needing full visit+actions payload if not required)
- [x] Common header shows action status + timestamps
- [x] Save behavior uses `PATCH .../actions/[actionId]` (data only)
- [x] End Action button calls `POST .../end` with GPS
- [x] If action is soft-deleted (`deleted_at` set), show 404 (or redirect) and do not render the form
- [x] If action is completed:
  - [x] PM owner: view-only (no save, no edit controls)
  - [x] Admin: editable (can PATCH `data`) until the visit itself is completed
- [x] If visit is completed: always view-only for everyone (no writes)

Testing checklist:
- [x] Loads correct renderer per action_type
- [x] Save persists data and preserves other fields
- [x] End Action transitions to completed with GPS
- [x] Unit target: `src/app/visits/[id]/actions/[actionId]/page.test.tsx`.
- [x] Migration cleanup: replace `src/app/visits/[id]/principal/page.test.tsx` with dynamic action-page tests.
- [ ] E2E point: open action details, save data, and end action from the dynamic route.

Implementation notes (2026-02-19):
- Added dynamic action detail page `src/app/visits/[id]/actions/[actionId]/page.tsx` with:
  - visit + action loading (single-action query with `deleted_at IS NULL` soft-delete handling),
  - shared visit-role scope checks (`program_manager` owner rules, scoped `admin` access),
  - explicit action-not-found state for soft-deleted/missing action rows.
- Added action-detail client form shell `src/components/visits/ActionDetailForm.tsx`:
  - dispatches renderer sections by `action_type`,
  - shows shared status/timestamp header,
  - saves action `data` via `PATCH /api/pm/visits/[id]/actions/[actionId]`,
  - ends action with GPS via `POST /api/pm/visits/[id]/actions/[actionId]/end`,
  - enforces read-only behavior for completed visit, PM-completed action, and role-based restrictions.
- Added dynamic route unit coverage in `src/app/visits/[id]/actions/[actionId]/page.test.tsx` for renderer dispatch, save data preservation, GPS end flow, completed-action PM/admin policy, completed-visit lock, and soft-delete 404 behavior.
- Replaced legacy principal fixed-route unit coverage by removing `src/app/visits/[id]/principal/page.test.tsx` in favor of dynamic action-page coverage.

Validation run (2026-02-19):
- `npm run test:unit -- 'src/app/visits/[id]/actions/[actionId]/page.test.tsx'`
- `npm run test:unit -- 'src/app/visits/[id]/page.test.tsx'`
- `npm run lint -- 'src/app/visits/[id]/actions/[actionId]/page.tsx' 'src/app/visits/[id]/actions/[actionId]/page.test.tsx' src/components/visits/ActionDetailForm.tsx`

### 5.2 Form build order (P0 → P1)

- [x] P0: Classroom Observation (required for completion)
- [x] P1: Principal Meeting (ported from existing page, now action-based)
- [x] P2: Remaining action types (thin forms initially; iterate fields later)

Testing checklist:
- [x] At least one classroom observation can be completed end-to-end
- [x] Principal meeting action can be created, started, saved, ended
- [x] Unit targets (incremental):
  - [x] classroom observation renderer tests first (P0).
  - [x] principal meeting renderer tests next (P1).
- [x] E2E point: one full visit using classroom observation + one principal meeting action before completion.

Implementation notes (2026-02-19):
- Extended dynamic action-page test coverage (`src/app/visits/[id]/actions/[actionId]/page.test.tsx`) to validate:
  - classroom observation renderer dispatch (`classroom_observation`) and classroom save+end transition flow,
  - principal meeting renderer dispatch (`principal_meeting`) and principal save+end flow through the dynamic route.
- Extended action-list interaction coverage (`src/components/visits/ActionPointList.test.tsx`) with explicit principal-meeting creation test, complementing existing start/delete behavior assertions.
- Confirmed P2 renderer readiness in `src/components/visits/ActionDetailForm.tsx` for all remaining MVP action types as thin forms (title/description/fields) using shared save/end lifecycle controls.
- Added 5.2 full-flow E2E coverage in `e2e/tests/visits.spec.ts`:
  - PM creates `classroom_observation` + `principal_meeting` actions,
  - starts both actions from visit detail,
  - saves and ends both actions on the dynamic action page,
  - completes the visit and verifies read-only post-completion UI.
- Hardened action-card E2E selectors by adding stable card attributes in `src/components/visits/ActionPointList.tsx` (`data-action-type`, `data-action-status`) so start/open/delete interactions are card-scoped instead of order-dependent.
- Fixed dynamic action end-flow stability by updating `readActionFromPayload()` in `src/components/visits/ActionDetailForm.tsx` to coerce numeric-string IDs (`id`, `visit_id`) returned by E2E DB responses. This prevents false `Failed to end action` UI errors when the API returns `"id":"123"` style payloads.
- Added regression coverage in `src/app/visits/[id]/actions/[actionId]/page.test.tsx` for `/end` responses that return numeric-string IDs.

Validation run (2026-02-19):
- `npm run test:unit -- 'src/app/visits/[id]/actions/[actionId]/page.test.tsx' src/components/visits/ActionPointList.test.tsx`
- `npm run lint -- src/components/visits/ActionDetailForm.tsx 'src/app/visits/[id]/actions/[actionId]/page.test.tsx' src/components/visits/ActionPointList.tsx e2e/tests/visits.spec.ts`
- `npm run test:e2e -- e2e/tests/visits.spec.ts --grep "PM can complete classroom observation and principal meeting actions before completing visit"`
- `npm run test:e2e -- e2e/tests/visits.spec.ts`

---

## 7) Phase 6 — Automated Tests (Unit + E2E)

### 6.1 Unit tests (API routes) — exact files + cases

Update existing tests:
- [x] `src/app/api/pm/visits/route.test.ts`
  - [x] `GET`: PM only sees own visits; `program_admin` can list scoped visits read-only; `admin` can list + `pm_email` filter.
  - [x] `GET`: `program_admin` `pm_email` filter is scoped (cannot access out-of-scope PM visits).
  - [x] `GET`: response uses `completed_at` and never returns `ended_at`.
  - [x] `POST`: creates visit without `data`; includes start GPS + optional warning + IST-derived `visit_date`.
  - [x] `POST`: passcode user rejected; `program_admin` rejected for create.
- [x] `src/app/api/pm/visits/[id]/route.test.ts`
  - [x] `GET`: returns `{ visit, actions }` with actions sorted by `inserted_at ASC, id ASC`.
  - [x] `GET`: excludes soft-deleted actions (`deleted_at IS NULL` only).
  - [x] `GET`: no raw coordinate fields (`start_lat/lng`, `end_lat/lng`) in response payload.
  - [x] `GET`: auth matrix includes owner PM, admin, scoped program_admin, out-of-scope reject, passcode reject.
  - [x] `GET`: completed visit is still readable for owner PM/admin/scoped program_admin (reads remain allowed after completion).
  - [x] Remove legacy section tests (`PATCH` section update + `PUT` complete) from this file.

Remove obsolete tests:
- [x] Delete `src/app/api/pm/visits/[id]/end/route.test.ts` (route removed in new model).

Add new tests:
- [x] `src/app/api/pm/visits/[id]/complete/route.test.ts`
  - [x] rejects when no completed `classroom_observation`.
  - [x] rejects when any action is `in_progress`.
  - [x] ignores soft-deleted actions in validation queries.
  - [x] success path sets `status=completed` + `completed_at` + visit end GPS + `updated_at`.
  - [x] idempotent second complete call returns success and does not overwrite prior completion fields/`updated_at`.
  - [x] admin can complete other PM visit but still requires GPS + same validations.
  - [x] program_admin/passcode cannot complete (403).
  - [x] response payload does not include coordinate fields.
- [x] `src/app/api/pm/visits/[id]/actions/route.test.ts`
  - [x] `GET` lists non-deleted actions in creation order (`inserted_at ASC, id ASC`).
  - [x] `POST` creates `pending` action with valid `action_type`.
  - [x] invalid `action_type` returns 400.
  - [x] write blocked when visit is already completed.
  - [x] `GET` auth matrix includes scoped program_admin read access and passcode rejection.
  - [x] `POST` rejects program_admin and passcode users.
- [x] `src/app/api/pm/visits/[id]/actions/[actionId]/route.test.ts`
  - [x] `GET` returns action payload (no coordinates) and enforces route binding + soft-delete 404.
  - [x] `PATCH` updates only `data` (status/timestamps immutable here) and bumps `updated_at`.
  - [x] `PATCH` on a completed action: PM owner gets `409`, admin succeeds.
  - [x] `PATCH` rejects if action does not belong to `visit_id`.
  - [x] `PATCH`/`DELETE` on a soft-deleted action returns `404`.
  - [x] `DELETE` allowed only for `pending`; sets `deleted_at` (soft delete) and bumps `updated_at`.
  - [x] `DELETE` rejects for `in_progress`/`completed`.
  - [x] `PATCH`/`DELETE` reject program_admin and passcode users.
- [x] `src/app/api/pm/visits/[id]/actions/[actionId]/start/route.test.ts`
  - [x] pending → in_progress sets `started_at` + start GPS + `updated_at`.
  - [x] second start is idempotent and does not overwrite `started_at`/`updated_at`.
  - [x] GPS >500m rejected; 100–500m warning returned.
  - [x] write blocked if visit completed.
  - [x] start on a soft-deleted action returns `404`.
  - [x] program_admin/passcode cannot start actions.
  - [x] response payload does not include coordinate fields.
- [x] `src/app/api/pm/visits/[id]/actions/[actionId]/end/route.test.ts`
  - [x] in_progress → completed sets `ended_at` + end GPS + `updated_at`.
  - [x] end without start rejected.
  - [x] second end is idempotent and does not overwrite `ended_at`/`updated_at`.
  - [x] write blocked if visit completed.
  - [x] end on a soft-deleted action returns `404`.
  - [x] program_admin/passcode cannot end actions.
  - [x] response payload does not include coordinate fields.

Implementation notes (2026-02-19):
- Closed remaining 6.1 API test gaps by extending:
  - `src/app/api/pm/visits/[id]/route.test.ts` with scoped `program_admin` read-allow coverage and explicit completed-visit readability matrix coverage (owner PM, in-scope admin, in-scope program_admin).
  - `src/app/api/pm/visits/[id]/actions/route.test.ts` with explicit in-scope `program_admin` read-only success coverage for `GET`.
  - `src/app/api/pm/visits/[id]/actions/[actionId]/route.test.ts` with explicit soft-deleted action `404` assertions for both `PATCH` and `DELETE`.
- Confirmed obsolete route test removal remains in place: `src/app/api/pm/visits/[id]/end/route.test.ts` deleted.

Validation run (2026-02-19):
- `npm run test:unit -- src/app/api/pm/visits/route.test.ts 'src/app/api/pm/visits/[id]/route.test.ts'`
- `npm run test:unit -- 'src/app/api/pm/visits/[id]/complete/route.test.ts'`
- `npm run test:unit -- 'src/app/api/pm/visits/[id]/actions/route.test.ts' 'src/app/api/pm/visits/[id]/actions/[actionId]/route.test.ts'`
- `npm run test:unit -- 'src/app/api/pm/visits/[id]/actions/[actionId]/start/route.test.ts' 'src/app/api/pm/visits/[id]/actions/[actionId]/end/route.test.ts'`
- `npm run lint -- 'src/app/api/pm/visits/[id]/route.test.ts' 'src/app/api/pm/visits/[id]/actions/route.test.ts' 'src/app/api/pm/visits/[id]/actions/[actionId]/route.test.ts'`

### 6.2 Unit tests (components/pages) — exact files + cases

Update existing tests:
- [x] `src/app/visits/[id]/page.test.tsx`
  - [x] remove 6 fixed sections assertions and `0 of 6 sections` progress assertions.
  - [x] assert action-card list render, 2-state badge only (`In Progress`/`Completed`), and read-only state on completed visits.
  - [x] assert no `Ended` badge and no `End Visit` button.
- [x] `src/app/visits/page.test.tsx`
  - [x] assert completed rows render `completed_at` (not `inserted_at`/`ended_at`) for completion timestamp.
  - [x] add `program_admin` list visibility + filter behavior assertions for mandatory list filters.
- [x] `src/components/VisitsTab.test.tsx`
  - [x] update fixtures to use `completed_at`; remove `ended_at` dependency.
- [x] `src/components/SchoolTabs.test.tsx`
  - [x] remove ended-state badge/link assertions.
  - [x] assert 2-state semantics only (`In Progress`/`Completed`) + `completed_at` rendering where used.
- [x] `src/components/visits/NewVisitForm.test.tsx`
  - [x] remove legacy “Visit Workflow sections” assertions tied to old fixed-section model.
  - [x] assert new workflow copy references action points/cards and dynamic action flow.

Replace legacy component tests:
- [x] Replace `src/components/visits/EndVisitButton.test.tsx` with `src/components/visits/CompleteVisitButton.test.tsx`
  - [x] GPS acquisition + cancel/retry flow.
  - [x] validation error rendering from `/complete` API.
  - [x] success path reload/navigation behavior.
  - [x] moderate GPS warning rendering.

Add new tests:
- [x] `src/components/visits/ActionPointList.test.tsx`
  - [x] pending card shows Start + Delete.
  - [x] in_progress card shows Open only.
  - [x] completed card shows View Details only.
- [x] `src/components/visits/ActionTypePickerModal.test.tsx`
  - [x] available action types rendered from `ACTION_TYPES`.
  - [x] selecting + submit calls create handler with correct `action_type`.
- [x] `src/app/visits/[id]/actions/[actionId]/page.test.tsx`
  - [x] renderer dispatch by `action_type`.
  - [x] Save uses `PATCH .../actions/[actionId]`.
  - [x] End Action uses `POST .../actions/[actionId]/end`.
  - [x] Completed action is read-only for PM owner but editable for admin.
  - [x] Soft-deleted action returns 404 UI state (or redirects) and does not render form.
  - [x] Replace `src/app/visits/[id]/principal/page.test.tsx` with dynamic action-page coverage (route no longer fixed to `/principal`).

Implementation notes (2026-02-19):
- Closed remaining 6.2 component/page coverage gaps by extending tests in:
  - `src/app/visits/[id]/page.test.tsx` (explicit no-`Ended` assertion),
  - `src/app/visits/page.test.tsx` (program_admin mandatory filter visibility + query-param mapping with scoped predicate),
  - `src/components/SchoolTabs.test.tsx` (completed timestamp rendering assertions),
  - `src/components/visits/CompleteVisitButton.test.tsx` (cancel + retry acquisition flow),
  - `src/components/visits/ActionPointList.test.tsx` (strict status-specific CTA coverage),
  - `src/components/visits/ActionTypePickerModal.test.tsx` (action types asserted from `ACTION_TYPES` constants).
- Confirmed dynamic action detail coverage remains in `src/app/visits/[id]/actions/[actionId]/page.test.tsx` and legacy fixed-route unit test replacement remains complete.

Validation run (2026-02-19):
- `npm run test:unit -- src/app/visits/page.test.tsx 'src/app/visits/[id]/page.test.tsx'`
- `npm run test:unit -- src/components/SchoolTabs.test.tsx src/components/VisitsTab.test.tsx src/components/visits/NewVisitForm.test.tsx`
- `npm run test:unit -- src/components/visits/CompleteVisitButton.test.tsx src/components/visits/ActionPointList.test.tsx src/components/visits/ActionTypePickerModal.test.tsx`
- `npm run test:unit -- 'src/app/visits/[id]/actions/[actionId]/page.test.tsx'`

### 6.3 E2E tests (Playwright) — exact files + scenarios

Fixture/helper updates:
- [x] `e2e/helpers/db.ts`
  - [x] update `seedTestVisit()` to insert visit rows without `data`/`ended_at`.
  - [x] add helper to seed actions with explicit status (`pending`, `in_progress`, `completed`) for deterministic tests.
- [x] Ensure E2E schema matches cutover model without relying on legacy dump columns:
  - [x] Added versioned migration `e2e/fixtures/migrations/20260219161000_drop_legacy_visit_columns.sql` to drop `lms_pm_school_visits.data` and `lms_pm_school_visits.ended_at` (and legacy `ended_at` index) after dump restore.

Rewrite `e2e/tests/visits.spec.ts` with these explicit scenarios:
- [x] `visits-list-shows-two-states`: only In Progress + Completed groupings, no Ended.
- [x] `pm-can-add-and-delete-pending-action`: add action card, then delete while pending.
- [x] `pm-can-start-and-end-classroom-observation`: mock GPS, verify status transitions.
- [x] `complete-blocked-without-completed-classroom-observation`: error shown.
- [x] `complete-blocked-when-any-action-in-progress`: error shown.
- [x] `complete-visit-success`: after one completed classroom observation, complete visit succeeds and page becomes read-only.
- [x] `moderate-gps-warning-visible`: 100–500m warning coverage for start/end/complete lifecycle requests.
- [x] `poor-gps-blocks-write`: >500m blocks start/end/complete.
- [x] `admin-can-complete-other-pm-visit-with-same-rules`: admin path still enforces GPS + validation.
- [x] `program-admin-read-only`: program_admin can list/view scoped visits but cannot add/start/end/complete actions.
- [x] `legacy-routes-are-gone`: no navigation/assertions to `/visits/:id/principal` or `/api/pm/visits/:id/end`.

Implementation notes (2026-02-19):
- Rewrote `e2e/tests/visits.spec.ts` around the 6.3 scenario contract with 11 explicit tests mapped 1:1 to the checklist.
- Updated `e2e/helpers/db.ts`:
  - removed legacy `visit.data` fallback logic from `seedTestVisit()`,
  - added `seedVisitAction()` for deterministic action-status seeding (`pending`, `in_progress`, `completed`).
- Added E2E schema migration `e2e/fixtures/migrations/20260219161000_drop_legacy_visit_columns.sql` so restored dumps are forced into the cutover visit schema before tests run.
- Included scoped-role and legacy-surface assertions in E2E:
  - `program_admin` read-only UI + write-route `403` checks,
  - removed-surface checks for absent `/principal` navigation and `404` for `/api/pm/visits/:id/end`.

Validation run (2026-02-19):
- `npm run test:e2e -- e2e/tests/visits.spec.ts`
- `npm run lint -- e2e/helpers/db.ts e2e/tests/visits.spec.ts`

### 6.4 Test execution commands (must run before merge)

Unit (targeted visit stack):
- [x] `npm run test:unit -- src/app/api/pm/visits/route.test.ts 'src/app/api/pm/visits/[id]/route.test.ts'`
- [x] `npm run test:unit -- 'src/app/api/pm/visits/[id]/complete/route.test.ts'`
- [x] `npm run test:unit -- 'src/app/api/pm/visits/[id]/actions/route.test.ts' 'src/app/api/pm/visits/[id]/actions/[actionId]/route.test.ts'`
- [x] `npm run test:unit -- 'src/app/api/pm/visits/[id]/actions/[actionId]/start/route.test.ts' 'src/app/api/pm/visits/[id]/actions/[actionId]/end/route.test.ts'`
- [x] `npm run test:unit -- src/app/visits/page.test.tsx 'src/app/visits/[id]/page.test.tsx'`
- [x] `npm run test:unit -- src/components/SchoolTabs.test.tsx src/components/VisitsTab.test.tsx src/components/visits/NewVisitForm.test.tsx`
- [x] `npm run test:unit -- src/components/visits/CompleteVisitButton.test.tsx src/components/visits/ActionPointList.test.tsx src/components/visits/ActionTypePickerModal.test.tsx`
- [x] `npm run test:unit -- 'src/app/visits/[id]/actions/[actionId]/page.test.tsx'`

E2E (visits flow):
- [x] `npm run test:e2e -- e2e/tests/visits.spec.ts`

Pre-merge full confidence:
- [x] `npm run test:unit`
- [x] `npm run test:e2e`

Validation run (2026-02-19):
- `npm run test:unit` (passed: 72 files, 1061 tests)
- `npm run test:e2e` (passed: 28 tests)

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

### Cutover data cleanup task (staging/prod)

- [ ] Final decision before cutover: clear all visits vs keep completed history only.
- [ ] Staging cleanup SQL run before migration:
  - [ ] Preferred: `DELETE FROM lms_pm_school_visits;`
  - [ ] Alternative: `DELETE FROM lms_pm_school_visits WHERE status <> 'completed';`
- [ ] Staging verification: `/visits` shows no legacy visits before new UI deploy.
- [ ] Production cleanup SQL run before migration:
  - [ ] Preferred: `DELETE FROM lms_pm_school_visits;`
  - [ ] Alternative: `DELETE FROM lms_pm_school_visits WHERE status <> 'completed';`
- [ ] Production verification: `/visits` shows no legacy visits before new UI deploy.

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

### Later improvements (non-blocking)

- [ ] E2E schema setup hardening:
  - [ ] regenerate `e2e/fixtures/db-dump.sql` from a post-cutover schema snapshot.
  - [ ] remove temporary compat SQL once dump is current (`e2e/fixtures/migrations/20260218190000_add_visit_actions_compat.sql`, `e2e/fixtures/migrations/20260219161000_drop_legacy_visit_columns.sql`).
  - [ ] evaluate replacing fixture-only schema deltas with a single source-of-truth migration flow for E2E resets (for example, invoking db-service migrations in CI/local).
