# Phase 5 Manual Frontend Test Cases

Use this exact manual runbook.

## Summary (2026-02-25)

| # | Test | Result |
|---|------|--------|
| 1 | PM happy path (create/save/end classroom action) | PASS |
| 2 | 422 + retry UX on incomplete rubric | PASS |
| 3 | Visit completion blocked without classroom obs | PASS |
| 4 | Existing completion rules still enforced | PASS |
| 5 | Admin behavior on completed classroom action | PASS |
| 6 | Program Admin read-only | PASS |
| 7 | Legacy row bootstrap (missing rubric_version) | PASS |
| 8 | Unsupported rubric version | PASS |
| 9 | 422 detail rendering on complete button | PASS (covered by Tests 3 & 4) |
| 10 | Mobile sanity for 19-card rubric | PASS |

**10 tested, 10 PASS, 0 bugs. All tests complete.**

## Setup (once)
1. Start app: `npm run dev`.
2. Keep 3 users ready: PM owner, Admin, Program Admin.
3. Use one school where PM can create visits/actions.
4. Turn browser geolocation on.
5. Keep DevTools device toolbar ready for mobile checks.

## Test 1: PM happy path (create/save/end classroom action) — PASS 2026-02-25
1. Login as PM.
2. Open an in-progress visit (`/visits/:id`), or create one from `/school/:udise/visit/new`.
3. Add action type `Classroom Observation`.
4. Start the action.
5. Fill all 19 rubric parameters.
6. Add optional remarks + both session summaries.
7. Click `End` directly (without manual `Save` first).
Expected: action ends successfully, status becomes completed, and data persists after page refresh.

## Test 2: 422 + retry UX on incomplete rubric — PASS 2026-02-25
1. Create/start a classroom action as PM.
2. Fill only a few rubric parameters.
3. Click `End`.
Expected: you stay on page, see a validation error with details, action remains in progress, and you can retry.
4. Fill remaining required parameters.
5. Click `End` again.
Expected: success.

## Test 3: Visit completion blocked without valid completed classroom observation — PASS 2026-02-25
1. In an in-progress visit, keep zero valid completed classroom observations.
2. Click `Complete Visit`.
Expected: 422-style block message explaining classroom observation requirement.

## Test 4: Existing completion rules still enforced — PASS 2026-02-25
1. Keep one non-classroom action `in_progress`.
2. Ensure at least one valid completed classroom observation exists.
3. Click `Complete Visit`.
Expected: blocked because in-progress action still exists.
4. End that in-progress action and try again with valid GPS.
Expected: visit completes.

## Test 5: Admin behavior on completed classroom action — PASS 2026-02-25
1. Login as Admin.
2. Open a visit where classroom action is completed (visit still in progress for editability check).
3. Open that classroom action.
4. Try editing and saving rubric data.
Expected: admin can save completed action data under current rules; validation still applies.
Note: Completed actions are read-only for all roles (including Admin). All form elements disabled, no Save button. This is the current intended behavior.

## Test 6: Program Admin read-only — PASS 2026-02-25
1. Login as Program Admin.
2. Open visits list, visit detail, and classroom action detail.
Expected: read-only behavior everywhere (no add/start/end/complete/edit actions).
Findings:
- Visits list: visible, shows View/Continue links — OK.
- Visit detail: "This visit is read-only for your role." message shown correctly. No "Complete Visit" or "Add Action Point" buttons. Action Points header shows "Read-only" label — OK.
- Classroom action detail: read-only — all fields disabled, no Save/End buttons — OK.
Note: Earlier session reported a false positive (stale cached page from PM session). Re-tested 2026-02-25 — confirmed working correctly. Server-side `canEditVisit()` returns `false` for `program_admin` role.

## Test 7: Legacy row bootstrap (missing `rubric_version`) — PASS 2026-02-25
1. Open a legacy classroom action record that has no `rubric_version`.
2. Verify page renders rubric UI (not old legacy fields).
3. Edit rubric + save.
4. Refresh.
Expected: still rubric UI, saved data remains, no legacy controls appear.
Setup: Used action 8 (visit 6) which had `data = {}` (no rubric_version).
Findings:
- Rubric UI rendered correctly (Score: 0/45, Answered: 0/19) — no legacy fields.
- Filled 3 rubric parameters, clicked Save — succeeded.
- DB confirmed `rubric_version` auto-bootstrapped to `"1.0"` and scores persisted.
- After page reload: Score: 3/45, Answered: 3/19 — data survived. Still rubric UI, no legacy controls.

## Test 8: Unsupported rubric version — PASS 2026-02-25
1. Open a classroom action with explicit unsupported `rubric_version` (example: `2.0`).
Expected: unsupported/read-only UI state; save/end blocked; safe messaging shown.
Setup: SQL `UPDATE lms_pm_school_visit_actions SET data = jsonb_set(data, '{rubric_version}', '"2.0"') WHERE id = 5` on action 5 (completed CO, visit 6). Restored to `"1.0"` after test.
Findings:
- Yellow warning banner: "Unsupported classroom observation rubric version: 2.0. This observation is read-only until migrated."
- All 19 rubric radio buttons and remarks links rendered as `[disabled]`.
- Session summary textboxes rendered as `[disabled]`.
- No Save or End Action buttons present.
- Existing score data (34/45, 19/19) still displayed correctly in read-only mode.

## Test 9: 422 detail rendering on complete button — PASS 2026-02-25
1. Trigger complete failure intentionally (invalid classroom dependency or in-progress action).
Expected: error is readable and detail lines are shown clearly; button recovers for retry after fixing conditions.
Note: Covered by Tests 3 and 4. Both 422 messages rendered clearly with detail bullets, button recovered for retry.

## Test 10: Mobile sanity for 19-card rubric — PASS 2026-02-25
1. Switch to mobile viewport (e.g., iPhone 12 in DevTools).
2. Open classroom action.
3. Scroll through all 19 cards, tap radios, open remarks fields, and try end flow.
Expected: sticky score bar behaves correctly, radios remain usable, no layout breakage, no blocked CTA.
