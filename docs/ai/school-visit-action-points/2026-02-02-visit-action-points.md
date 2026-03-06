# Visit Action Points (Per-Action Tracking)

**Date:** 2026-02-02  
**Status:** In progress  
**Extracted from:** `2026-02-02-school-visit-geo-tracking.md`  
**Last updated:** 2026-02-16  
**Implementation & testing plan:** `docs/ai/school-visit-action-points/2026-02-02-school-visit-action-points-implementation-and-testing-plan.md`

This doc is intentionally **requirements + product decisions only**. Exact schema, API contracts, file lists, and test plans live in the implementation/testing plan.

---

## 0. Non-negotiables

**Terminology:** PM = **Program Manager** (the user who owns/creates the school visit).

1. **Hard cutover (intentional).** This is a breaking cutover from *section-based visit JSON* to *per-action tracking*, with **no data migration**. Old visit JSON data is explicitly disposable.
2. **Coordinated release.** The DB cutover and LMS cutover must ship together as one coordinated deploy. No partial deploys.
3. **Admin rules.** Admins may complete any visit they can access, but **admins do not bypass GPS or validation rules**.
4. **Timestamps (UTC).** All `*_at` timestamps must be stored as **UTC**.
5. **GPS privacy.** GPS coordinates are sensitive:
   - Never log raw coordinates.
   - Do not expose raw coordinates in normal responses; return only what the UI needs (statuses/timestamps and optional accuracy warnings).

## 1. Overview

Each school visit can have multiple **action points**: discrete tasks the PM performs during the visit. This feature adds:

- Action-level lifecycle: `pending → in_progress → completed`
- Action-level GPS capture + timestamps on start/end
- A simplified visit lifecycle: `in_progress → completed` (no separate “ended” concept)
- A simplified visit completion rule-set (see section 4)

**Prerequisite:** visit-level geo-tracking ships first. See `2026-02-02-school-visit-geo-tracking.md`.

## 2. Definitions

### Action point

An action point is one concrete thing the PM does during a visit (e.g. one classroom observation, one staff meeting). Each action point has:

- **Type** (what kind of action it is)
- **Status** (`pending`, `in_progress`, `completed`)
- **Start evidence** (timestamp + GPS reading)
- **End evidence** (timestamp + GPS reading)
- **Action-specific form data** (flexible payload scoped to the action’s form)

### Visit

A visit:

- Is either `in_progress` or `completed`
- Is **terminal** once completed (no undo)

## 3. Action Types (MVP)

Each action type maps to one concrete thing a PM does. If the PM does the same kind of thing multiple times, that creates multiple action points of the same type.

**MVP action types:**

- Principal Meeting
- Leadership Meeting
- Classroom Observation
- Group Student Discussion
- Individual Student Discussion
- Individual Staff Meeting
- Team Staff Meeting
- Teacher Feedback

**Note:** a “custom action” type is intentionally deferred until there’s a clear product use case.

## 4. Visit Completion (Behavior)

“End visit”, “complete visit”, and “finish visit” are treated as the same user intent: **complete the visit**.

Completing a visit:

1. Requires a valid GPS reading (same standards as visit geo-tracking).
2. Requires **at least one completed Classroom Observation** action point.
3. Requires **no action points left in progress** (all started actions must be ended first).
4. Applies equally to PMs and admins (admins do not bypass these checks).

## 5. Behavior Decisions

- **No fixed order:** action points do not have a prescribed sequence; display order is stable by creation time.
- **Concurrent actions allowed:** multiple action points may be `in_progress` simultaneously.
- **No skip status:** PMs can choose what to do; there is no “skipped” state.
- **Created on-demand:** new visits start with zero action points; PM adds action points as needed.
- **Pending-only deletion:** delete is only allowed before an action point starts, and is a soft delete to protect typed draft data.

## 6. Deferred / Out of Scope

- issue log (requires separate redesign)
- offline-first or “capture GPS and sync later”
- exposing raw GPS coordinates for maps (requires separate, tightly-scoped design)

## 7. Decisions Log (Product-Level)

| # | Topic | Decision |
|---|-------|----------|
| 1 | Migration | No data migration; hard cutover is acceptable. |
| 2 | Visit states | Visits have exactly two states: `in_progress` and `completed`. |
| 3 | Completion rule | ≥1 completed Classroom Observation required; other action types optional. |
| 4 | Action ordering | No fixed order; stable display ordering by creation time. |
| 5 | Concurrent actions | Multiple action points can be in progress at the same time. |
| 6 | Skip option | No skip status. |
| 7 | Custom action | Deferred until the use case is clear. |
| 8 | issue log | Deferred; separate feature/design. |
| 9 | Pending-only delete | Delete allowed only before start; use soft delete to protect typed data. |
| 10 | GPS privacy | Never log raw coordinates; avoid exposing coordinates in normal responses. |
| 11 | Timestamp standard | Store all `*_at` timestamps as UTC. |

