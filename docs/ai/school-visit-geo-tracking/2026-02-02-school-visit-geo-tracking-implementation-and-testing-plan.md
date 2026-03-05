# School Visit Geo-Tracking — Implementation & Testing Plan

**Plan date:** 2026-02-02
**Split into separate file:** 2026-02-11
**Last updated:** 2026-02-12 (implementation progress)
**Source design doc:** `2026-02-02-school-visit-geo-tracking.md`

---

## 0. Scope (Phase 1 / MVP)

**Goal:** capture GPS + timestamp at **start** and **end** of a school visit.

Phase 1 ships:
- Start visit: create visit + save `start_lat/lng/accuracy` (start time = `inserted_at`)
- End visit: save `ended_at` (server-side) + `end_lat/lng/accuracy`
- Visit remains `status='in_progress'` even after ending (completion is later)

Phase 1 explicitly does not ship:
- "Complete visit" (strict validation across sections)
- Distance check vs school coordinates
- Offline capture + later sync

---

## 1. Phase 0 — DB-Service Migration (hard dependency) ✅ DONE

### 0.1 Migration: add geo columns + index ✅

- [x] Add migration in db-service to `ALTER TABLE lms_pm_school_visits`:
  - `start_lat`, `start_lng`, `start_accuracy`
  - `ended_at`
  - `end_lat`, `end_lng`, `end_accuracy`
- [x] Add index on `ended_at`
- [x] Keep types consistent with existing schema (TIMESTAMP without TZ)

**File:** `db-service/priv/repo/migrations/20260212120000_add_geo_tracking_to_lms_pm_school_visits.exs`

### 0.2 Verification checklist (staging → production)

- [x] Migration runs cleanly on local dev (`mix ecto.migrate` succeeded)
- [x] `lms_pm_school_visits` has all new columns
- [x] `ended_at` index exists
- [x] No unexpected nullability/defaults introduced (all nullable, no defaults — correct)
- [ ] Migration deployed to staging
- [ ] Migration deployed to production

---

## 2. Phase 1 — Backend (af_lms API routes) ✅ DONE

### 1.1 Start visit: `POST /api/pm/visits` ✅

Implementation tasks:
- [x] Require GPS payload: `start_lat`, `start_lng`, `start_accuracy`
- [x] Validate:
  - `lat` in `[-90, 90]`, `lng` in `[-180, 180]`
  - `accuracy` is a number (meters)
  - Reject `accuracy > 500`
- [x] Derive `visit_date` server-side: `(NOW() AT TIME ZONE 'Asia/Kolkata')::date`
- [x] Write start fields to the DB (start time remains `inserted_at DEFAULT NOW()`)
- [x] Return created visit id + `visit_date` + optional `warning`
- [x] Shared validation helper: `src/lib/geo-validation.ts`

**Files modified:** `src/app/api/pm/visits/route.ts`, `src/lib/geo-validation.ts` (new)

Testing checklist:
- [ ] Missing GPS payload → 400
- [ ] `accuracy > 500` → 400
- [ ] Valid payload → creates row with start columns populated
- [ ] `visit_date` matches IST date even when UTC date differs

### 1.2 End visit: `POST /api/pm/visits/[id]/end` ✅

Implementation tasks:
- [x] Require GPS payload: `end_lat`, `end_lng`, `end_accuracy`
- [x] Permission: PM can end only their own visit; admin (level 4) can end any visit
- [x] Idempotency: if `ended_at IS NOT NULL`, return success without changes
- [x] Write: `ended_at = NOW()` (server-side), end geo fields, `updated_at = NOW()`
- [x] Does not depend on section completion (Phase 1 rule)

**File:** `src/app/api/pm/visits/[id]/end/route.ts` (new)

Testing checklist:
- [ ] Non-owner PM ending a visit → 403
- [ ] Owner PM ending an in-progress visit → sets `ended_at` + end geo fields
- [ ] Second call after end → returns success (no 500)
- [ ] End visit rejects `accuracy > 500`

### 1.3 Read visit: `GET /api/pm/visits/[id]` ✅

Implementation tasks:
- [x] Include geo fields + `ended_at` in response
- [x] Privacy: owner PM + admins see exact `lat/lng`; others see only timestamps

**File modified:** `src/app/api/pm/visits/[id]/route.ts`

Testing checklist:
- [ ] Owner PM sees start/end lat/lng
- [ ] Admin sees start/end lat/lng
- [ ] Non-owner role sees no lat/lng (when/if visit viewing is enabled for them)

---

## 3. Phase 2 — Frontend (af_lms UI) ✅ DONE

### 2.1 Geolocation utility ✅

Implementation tasks:
- [x] `getAccurateLocation()` helper using `navigator.geolocation.watchPosition`
- [x] Enforce secure origin (allow `https:` and `http://localhost` / `http://127.0.0.1`)
- [x] Returns `{ promise, cancel }` for component cleanup
- [x] Spinner while waiting, "Cancel" option
- [x] Warn when `accuracy` is 100–500m; reject above 500m
- [x] 60s timeout with "Try again"
- [x] `getAccuracyStatus()` helper for UI display

**File:** `src/lib/geolocation.ts` (new)

Testing checklist:
- [ ] Cancel stops watch + no "stuck loading"
- [ ] Timeout shows retryable message
- [ ] Non-secure origin shows clear error

### 2.2 Start visit flow ✅

Implementation tasks:
- [x] Removed date picker (visit_date is now server-derived)
- [x] Auto-acquires GPS on mount with spinner + cancel
- [x] Shows accuracy status (good/moderate) with colored badges
- [x] Calls `POST /api/pm/visits` with GPS data
- [x] Redirects to visit detail page on success

**File modified:** `src/app/school/[udise]/visit/new/page.tsx`

Testing checklist:
- [ ] Permission denied shows "Location is required…" copy
- [ ] Successful create redirects and shows started state

### 2.3 End visit flow ✅

Implementation tasks:
- [x] `EndVisitButton` client component with GPS capture
- [x] Calls `POST /api/pm/visits/[id]/end`
- [x] Shows ended state (timestamp) on visit detail page
- [x] Visit detail page shows "Ended" badge (blue) distinct from "In Progress" (yellow)
- [x] Start/end timestamps displayed in IST

**Files:** `src/components/visits/EndVisitButton.tsx` (new), `src/app/visits/[id]/page.tsx` (modified)

Testing checklist:
- [ ] Successful end shows ended timestamp
- [ ] Re-click end is safe (idempotent server behavior)

### 2.4 Hide/disable "Complete visit" (Phase 1) ✅

Implementation tasks:
- [x] Removed broken `<form method="POST">` completion flow
- [x] Replaced with "End Visit" button (when not yet ended)
- [x] Shows "Visit ended" confirmation (when already ended)

**File modified:** `src/app/visits/[id]/page.tsx`

Testing checklist:
- [ ] No broken "Complete visit" action in UI

---

## 4. Phase 3 — Manual QA (mobile-focused) 🔲 NOT STARTED

### Devices / browsers

- [ ] Android Chrome
- [ ] iOS Safari

### Start/End scenarios

- [ ] First-time location prompt → allow → start visit succeeds
- [ ] Deny permission → shows actionable message; retry works after permission enabled
- [ ] "Low accuracy" (100–500m) → saved + warning shown
- [ ] "Too low accuracy" (>500m) → rejected; try again works
- [ ] Airplane mode / no internet → clear failure; app does not create partial visits
- [ ] End visit on a different device later → allowed; ends with current GPS (expected Phase 1 behavior)

---

## 5. Files Created/Modified (Phase 1) — Final

### db-service repo
- `priv/repo/migrations/20260212120000_add_geo_tracking_to_lms_pm_school_visits.exs` ✅ (new)

### af_lms repo

New files:
- `src/lib/geo-validation.ts` ✅ (shared GPS validation for API routes)
- `src/lib/geolocation.ts` ✅ (client-side watchPosition helper)
- `src/app/api/pm/visits/[id]/end/route.ts` ✅ (end visit endpoint)
- `src/components/visits/EndVisitButton.tsx` ✅ (client component)

Not created (decided unnecessary):
- `src/components/visits/StartVisitButton.tsx` — GPS logic lives directly in the page
- `src/types/visits.ts` — types kept inline in route files

Modified files:
- `src/app/api/pm/visits/route.ts` ✅ (GPS required on create, server-side visit_date)
- `src/app/api/pm/visits/[id]/route.ts` ✅ (geo fields in GET, privacy filtering)
- `src/app/visits/[id]/page.tsx` ✅ (ended_at display, End Visit button, removed Complete)
- `src/app/school/[udise]/visit/new/page.tsx` ✅ (GPS capture replaces date picker)

---

## 6. Release checklist

- [ ] DB migration deployed to staging + production
- [ ] Start visit works end-to-end on mobile (GPS required)
- [ ] End visit works end-to-end on mobile (GPS required, idempotent)
- [ ] No lat/lng logged in server logs
- [x] "Complete visit" is hidden/disabled for Phase 1
- [ ] Pilot PMs can access visits via `user_permission` gating
