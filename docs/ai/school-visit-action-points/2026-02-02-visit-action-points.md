# Visit Action Points (Per-Action Tracking)

**Date:** 2026-02-02
**Status:** Future (after geo-tracking Phase 1)
**Extracted from:** `2026-02-02-school-visit-geo-tracking.md`
**Last updated:** 2026-02-06

---

## 1. Overview

Each school visit can have multiple **action points** (tasks the PM performs during the visit). This feature adds per-action geo-tracking + status lifecycle, replacing the current nested JSONB `data` structure on `lms_pm_school_visits` with normalized rows in a new `lms_pm_visit_actions` table.

**Prerequisite:** Visit-level geo-tracking (Phase 1) must be shipped first. See `2026-02-02-school-visit-geo-tracking.md`.

### What action points are

- Each action point = one specific thing the PM does during a visit (e.g. one classroom observation, one individual staff meeting)
- Each action point stores:
  - Start: timestamp + GPS location
  - End: timestamp + GPS location
  - Status: pending / in_progress / completed
  - Form data (JSONB)

---

## 2. Schema: `lms_pm_visit_actions` Table

```sql
CREATE TABLE lms_pm_visit_actions (
  id SERIAL PRIMARY KEY,
  visit_id INTEGER NOT NULL REFERENCES lms_pm_school_visits(id) ON DELETE CASCADE,

  -- Action identification
  action_type VARCHAR(50) NOT NULL,
  action_label VARCHAR(255) NOT NULL,

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

  -- Action-specific form data
  data JSONB DEFAULT '{}',

  -- Timestamps (Ecto convention)
  inserted_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_visit_actions_visit_id ON lms_pm_visit_actions(visit_id);
CREATE INDEX idx_visit_actions_type ON lms_pm_visit_actions(action_type);
CREATE INDEX idx_visit_actions_status ON lms_pm_visit_actions(status);
CREATE INDEX idx_visit_actions_started ON lms_pm_visit_actions(started_at);
```

### Schema change on `lms_pm_school_visits`

The `data` JSONB column on `lms_pm_school_visits` will be **dropped entirely**. All per-section data moves to `lms_pm_visit_actions` rows. The remaining columns on `lms_pm_school_visits` are: `id`, `school_code`, `pm_email`, `visit_date`, `status`, `inserted_at`, `updated_at`.

---

## 3. Predefined Action Types

Each type maps to one concrete thing a PM does. Sub-types (e.g. group vs individual discussion) are broken out as separate types so each row in the table represents one clear action.

```typescript
const ACTION_TYPES = {
  principal_meeting: 'Principal Meeting',
  leadership_meeting: 'Leadership Meeting',
  classroom_observation: 'Classroom Observation',
  group_student_discussion: 'Group Student Discussion',
  individual_student_discussion: 'Individual Student Discussion',
  individual_staff_meeting: 'Individual Staff Meeting',
  team_staff_meeting: 'Team Staff Meeting',
  teacher_feedback: 'Teacher Feedback',
} as const;

type ActionType = keyof typeof ACTION_TYPES;
```

> **Note:** `custom` action type has been removed. We'll add it later when we have clarity on what custom actions should look like.

### Mapping from old JSONB structure

| Old JSONB key | New action type(s) |
|---|---|
| `principalMeeting` | `principal_meeting` |
| `leadershipMeetings` | `leadership_meeting` |
| `classroomObservations[]` | `classroom_observation` (one row per observation) |
| `studentDiscussions.groupDiscussions[]` | `group_student_discussion` (one row per discussion) |
| `studentDiscussions.individualDiscussions[]` | `individual_student_discussion` (one row per discussion) |
| `staffMeetings.teamMeeting` | `team_staff_meeting` |
| `staffMeetings.individualMeetings[]` | `individual_staff_meeting` (one row per meeting) |
| `teacherFeedback[]` | `teacher_feedback` (one row per feedback entry) |
| `issueLog[]` | **Deferred** — needs separate design work |

---

## 4. Behavior Decisions

- Action points have **no fixed order**. Display order uses `inserted_at` (creation order).
- Multiple actions can be **in_progress at the same time**.
- **No skip option.** PMs are free to start/end any action during a running visit. There is no "skip" status or skip UI.
- **No data migration needed.** The product hasn't launched yet and there are very few visits in production — existing visit data can be discarded. This is a clean cut: create the new table, update the API and UI, drop the old JSONB approach.
- The principal meeting form (only existing section UI) will need to be updated to use the new action-based API instead of the current `PATCH /api/pm/visits/[id]` with `{ section, data }`.

### Visit Completion Rules

A visit can be marked as complete when:
- At least **1 `classroom_observation`** action has `status = 'completed'`
- All other action types are **optional**

> This is a deliberate simplification from the current code, which requires principalMeeting, leadershipMeetings, classroomObservations, studentDiscussions, and teamMeeting to all be filled.

---

## 5. API Design

### Action Point CRUD

| Method | Route | Purpose |
|--------|-------|---------|
| `GET` | `/api/pm/visits/[id]/actions` | List actions for visit |
| `POST` | `/api/pm/visits/[id]/actions` | Create new action point |
| `PATCH` | `/api/pm/visits/[id]/actions/[actionId]` | Update action data |
| `DELETE` | `/api/pm/visits/[id]/actions/[actionId]` | Delete action |

### Action Lifecycle

| Method | Route | Purpose |
|--------|-------|---------|
| `POST` | `/api/pm/visits/[id]/actions/[actionId]/start` | Start action + location |
| `POST` | `/api/pm/visits/[id]/actions/[actionId]/end` | End action + location |

> **Note (future optimization):** The lifecycle endpoints (`/start`, `/end`) could be merged into the PATCH endpoint as status updates. Keeping them separate for now for clarity, but consolidating later would reduce the number of routes.

---

## 6. Data Model

```
lms_pm_school_visits (existing, `data` column dropped)
+-- id (PK)
+-- school_code, pm_email, visit_date, status
+-- inserted_at, updated_at
|
+-- lms_pm_visit_actions (1:many)
    +-- id (PK)
    +-- visit_id (FK)
    +-- action_type, action_label (NOT NULL)
    +-- started_at, start_lat, start_lng, start_accuracy
    +-- ended_at, end_lat, end_lng, end_accuracy
    +-- status: 'pending' | 'in_progress' | 'completed'
    +-- data (JSONB) — action-specific form data
    +-- inserted_at, updated_at
```

---

## 7. Implementation Strategy

No data migration needed — existing visits can be discarded (product not yet launched).

1. Create `lms_pm_visit_actions` table (via setup script or db-service migration)
2. Drop the `data` column from `lms_pm_school_visits`
3. Update `POST /api/pm/visits` to stop initializing the JSONB `data` structure
4. Add action CRUD and lifecycle API routes
5. Rewrite the visit detail page (`/visits/[id]`) to show actions from the new table instead of JSONB sections
6. Rewrite the principal meeting form to use the new action-based API
7. Update visit completion logic (`PUT /api/pm/visits/[id]`) to query action rows instead of JSONB keys
8. Update the dashboard's open issues count query (currently reads `data->'issueLog'` — remove or replace once issueLog is redesigned)
9. Build remaining section forms against the new action API from the start

---

## 8. Files to Create

- `src/app/api/pm/visits/[id]/actions/route.ts` — GET list + POST create
- `src/app/api/pm/visits/[id]/actions/[actionId]/route.ts` — PATCH update + DELETE
- `src/app/api/pm/visits/[id]/actions/[actionId]/start/route.ts` — POST start action
- `src/app/api/pm/visits/[id]/actions/[actionId]/end/route.ts` — POST end action
- `src/components/visits/ActionPointList.tsx` — action list UI component

## 9. Files to Modify

These existing files read from the JSONB `data` column and must be updated:

| File | What changes | Severity |
|------|-------------|----------|
| `src/app/api/pm/visits/route.ts` | **POST**: Remove `initialData` JSONB initialization. **GET** (list): Remove `data` from SELECT. | High |
| `src/app/api/pm/visits/[id]/route.ts` | **GET**: JOIN with `lms_pm_visit_actions` or return actions separately. **PATCH**: Remove `jsonb_set()` section-update logic entirely (replaced by action CRUD routes). **PUT** (complete): Rewrite validation to query action rows instead of JSONB fields. | High |
| `src/app/visits/[id]/page.tsx` | Rewrite `getSectionStatus()` — currently reads `visit.data.principalMeeting`, `visit.data.classroomObservations`, etc. Must query actions table instead. Remove `Visit.data` interface. | High |
| `src/app/visits/[id]/principal/page.tsx` | Currently loads `result.visit.data?.principalMeeting` and saves via `PATCH` with `{ section, data }`. Must be rewritten to load/save via action CRUD endpoints. | High |
| `src/app/dashboard/page.tsx` | `getOpenIssuesCount()` query uses `jsonb_array_elements(v.data->'issueLog')`. Must be removed or stubbed to return 0 until issueLog is redesigned. `getRecentVisits()` is fine (doesn't touch `data`). | Medium |
| `src/app/school/[udise]/page.tsx` | `getSchoolVisits()` query — currently fine (doesn't SELECT `data`), but verify no breakage after column drop. | Low |
| `src/app/visits/page.tsx` | Currently fine (doesn't SELECT `data`). No changes needed. | None |
| `src/components/SchoolTabs.tsx` | `VisitHistorySection` — currently fine (uses metadata only). No changes needed. | None |
| `scripts/setup-pm-tables.ts` | Remove or update the `data` column creation. Add `lms_pm_visit_actions` table creation. | Medium |

---

## 10. Decisions Log

| # | Topic | Decision |
|---|-------|----------|
| 1 | Data migration | No migration. Discard existing visits (product not launched, very few records). Clean cut to new table. |
| 2 | Action ordering | No fixed order. Display sorted by `inserted_at`. |
| 3 | Concurrent actions | Multiple actions can be in_progress at the same time. |
| 4 | Sub-type granularity | Each sub-type gets its own `action_type` (e.g. `group_student_discussion` and `individual_student_discussion` are separate types, not one type with a sub-type field). |
| 5 | Visit completion | Only requirement: at least 1 `classroom_observation` completed. All other action types are optional. (Simplified from current code which requires 5 sections.) |
| 6 | issueLog | Deferred — needs separate design work. Not included in this feature. |
| 7 | Skip action | No skip option. PMs start/end actions freely. No `skipped` status. |
| 8 | Custom action type | Removed. Will add later when we have clarity on the use case. |
| 9 | `action_label` | NOT NULL. For predefined types, defaults to the label from `ACTION_TYPES` map. |
| 10 | `data` column on visits | Dropped entirely. All section data lives in `lms_pm_visit_actions.data`. |
| 11 | Endpoint consolidation | Start/end kept as separate routes for now. May merge into PATCH later as an optimization. |

---

## 11. Open Questions

1. Should action types be stored in a DB table or remain as app-level constants?
2. Do we need action-level notes/comments beyond the JSONB `data` field?
3. What should the `issueLog` feature look like? (Deferred to separate planning.)
