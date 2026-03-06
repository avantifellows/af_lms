 Testing Checklist — Geo-Tracking Feature

  Step 0: Set Up Test Users ✅ DONE

  ┌─────┬───────────────────────────┬───────────────────────────────────────────┬──────────────────────────────────────────────────────────────────┐
  │  #  │           Role            │                  Purpose                  │                           Confirmed                              │
  ├─────┼───────────────────────────┼───────────────────────────────────────────┼──────────────────────────────────────────────────────────────────┤
  │ A   │ admin (level 4)           │ Your main account                         │ deepansh.mathur@avantifellows.org                                 │
  ├─────┼───────────────────────────┼───────────────────────────────────────────┼──────────────────────────────────────────────────────────────────┤
  │ B   │ program_manager (level 1) │ PM who can start/end own visits           │ shivansh.gdrive@gmail.com — school 54026 (JNV Ashoknagar)        │
  ├─────┼───────────────────────────┼───────────────────────────────────────────┼──────────────────────────────────────────────────────────────────┤
  │ C   │ program_manager (level 1) │ Second PM to test cross-user restrictions │ deepansh.mathur96@gmail.com — school 74040 (JNV Raebareli)       │
  ├─────┼───────────────────────────┼───────────────────────────────────────────┼──────────────────────────────────────────────────────────────────┤
  │ D   │ teacher (level 1)         │ Should be blocked from visits entirely    │ deepansh.cooldude@gmail.com — school 64045 (JNV Aligarh)         │
  └─────┴───────────────────────────┴───────────────────────────────────────────┴──────────────────────────────────────────────────────────────────┘
  DB-verified: all 4 users have correct role, level, school_codes, program_ids.

  ---
  Test 1: Teacher cannot access visits (User D) ✅ PASS (after fix)

  You do: Log in as a teacher. Try navigating to /school/{any-udise}/visit/new.

  Expected: Redirected to /.

  Result: Initially FAILED — page had no server-side permission check (was a pure "use client" component).
  Fix applied: Split into server component (page.tsx) + client component (NewVisitForm.tsx).
  Server component checks getFeatureAccess(permission, "visits").canEdit; teachers get "none" → redirect("/").
  Re-tested: ✅ Teacher is now redirected to / immediately.

  ---
  Test 1b: PM cannot access visit/new for a school they don't have (User C) ✅ PASS (after fix)

  User C navigated to /school/54026/visit/new (not their school).

  Result: Initially FAILED — page only checked role, not school access. PM saw GPS form.
  Fix applied: Added canAccessSchool() check to server component; redirects to /school/{udise}.
  Re-tested: ✅ Redirected to /school/54026 → which shows "Access Denied" (correct chain).

  ---
  Test 2: PM starts a visit with good GPS (User B) ✅ PASS

  Visit ID: 2 (school 54026, shivansh.gdrive@gmail.com)

  DB verified:
  - start_lat=13.0156, start_lng=77.6613, start_accuracy=40m ✅
  - visit_date=2026-02-12 (IST) ✅
  - ended_at=NULL ✅
  - status='in_progress' ✅

  ---
  Test 3: PM ends the visit (User B) ✅ PASS

  Visit ID: 2

  DB verified:
  - ended_at=2026-02-12 23:05:05 (server-side) ✅
  - end_lat=13.0155, end_lng=77.6613, end_accuracy=40m ✅
  - updated_at changed (23:02:14 → 23:05:05) ✅
  - status still 'in_progress' ✅

  ---
  Test 4: Idempotent end (User B) ✅ PASS

  Re-called POST /api/pm/visits/2/end via browser console with different GPS coords.
  API returned: { message: "Visit already ended", ended_at: "2026-02-12T17:35:05.000Z" }
  DB verified: end_lat/lng/accuracy and updated_at all unchanged from Test 3 values.

  ---
  Test 5: PM cannot end another PM's visit (User C) ✅ PASS (after fix)

  User C called POST /api/pm/visits/2/end (User B's visit).

  Result: Initially FAILED — idempotency check ran before ownership check, so User C got
  "Visit already ended" (200) instead of 403.
  Fix applied: Swapped order in end/route.ts — ownership check now runs before idempotency.
  Re-tested: ✅ 403 { error: "You can only end your own visits" }

  ---
  Test 6: Admin can end any PM's visit (User A) ✅ PASS

  User C created visit ID 3 (school 74040). Admin (User A) ended it via console.
  API returned: { success: true }
  DB verified: ended_at=2026-02-12 23:26:58, end_lat/lng/accuracy populated ✅

  ---
  Test 7: PM cannot start visit at a school they don't have access to (User B) ✅ PASS

  User B called POST /api/pm/visits with school_code=74040 (not their school) via console.
  API returned: { error: "You do not have access to this school" } (403)
  Page-level also blocked (see Test 1b).

  ---
  Test 8: GPS permission denied ✅ PASS

  User B denied GPS permission on /school/54026/visit/new.
  Red error box with instructions shown. Start Visit button disabled.

  ---
  Test 9: GPS cancel ⏭️ SKIPPED (desktop)

  GPS acquisition too fast on desktop to click Cancel. Will test during mobile QA (Phase 3).

  ---
  Test 10: Visit detail page — owner sees timestamps correctly ✅ PASS

  User B viewed /visits/2. Started and ended timestamps shown in IST, blue "Ended" badge.
  Also fixed: School visits tab now shows started/ended times + correct ended badge (was showing
  yellow "In Progress" based on status column; now uses ended_at for blue "Ended" badge).

  ---
  Test 11: Admin can view any PM's visit ✅ PASS

  Admin viewed /visits/2 (User B's visit). Full detail page with timestamps visible.

  ---
  Test 12: Non-owner non-admin cannot view a visit ✅ PASS

  User C navigated to /visits/2 (User B's visit). Shown "Access Denied".

  ---
  Test 13: Visit without GPS (direct API call — should fail) ✅ PASS

  POST /api/pm/visits with no GPS fields → 400 "start_lat, start_lng, and start_accuracy are required and must be numbers"

  ---
  Test 14: Visit with bad GPS accuracy (>500m) ✅ PASS

  POST /api/pm/visits with start_accuracy=600 → 400 "GPS accuracy too low (600m). Move to an open area and try again."

  ---
  Test 15: Visit with moderate GPS accuracy (100-500m) ✅ PASS

  POST /api/pm/visits with start_accuracy=250 → 201 with warning "GPS accuracy is moderate (250m)..."
  DB verified: visit ID 4 created with start_accuracy=250.

  ---
  Test 16: Multiple visits same school same day ✅ PASS

  User B created 3 visits for school 54026 on 2026-02-12 (IDs: 2, 4, 5). No constraint issues.

  ---
  Test 17: Old visit (id=1) still works ✅ PASS

  Admin viewed /visits/1 (pre-geo-tracking visit, null GPS fields). Page renders normally, no crash, "In Progress" badge.
