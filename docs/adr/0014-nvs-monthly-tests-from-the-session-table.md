# NVS Monthly Tests come from the `session` table

Supersedes ADR 0012. Decided by Dhyanesh and Deepansh on 20–24 Nov 2026.

The Test Attendance Tab (#517) groups System-wide Mandated Test Papers into Monthly Tests. Both which Papers make up a Monthly Test — and its name — and each Paper's opening time, closing time, grade and on/off state now come from the LMS Postgres `session` table. A Paper belongs to an NVS Monthly Test when its `session` row has `meta_data.test_purpose = 'system_wide_mandated'`, `meta_data.group = 'EnableStudents'`, `meta_data.grade` 11 or 12, `is_active = true`, a non-blank `platform_id`, and `start_time` (IST wall clock) inside the current academic year (1 Apr 2026 inclusive to 1 Apr 2027 exclusive, from `CURRENT_ACADEMIC_YEAR`). Papers are grouped by the IST calendar month they start in, oldest month first, and the Monthly Test is named after that month (for example, "September").

Under ADR 0012, the PMU team had to add each month's Papers to Firestore (`pmu_live_tracking_sessions/nvs`) by hand, and the production app's access to Firestore was never confirmed. On 20 Nov 2026, a read-only check on production showed that this `session` rule finds exactly the switched-on NVS Papers of the Firestore list in every month (July 7, August 7, September 14, October 14, November 18 = 60; Firestore also listed 7 August Grade 11 Papers that are switched off, which the tab already skipped). One server-only module (`src/lib/test-set-list.ts`, `getNvsTestSets()`) still owns the rule with the same return shape (`TestSet[]` = `{label, quizIds}[]`), and nothing else in the LMS knows how Monthly Tests are derived. Dropping Firestore also removes the 5-minute in-process cache and the `google-auth-library` dependency.

## Considered Options

- **Keep the PMU test set list in Firestore (ADR 0012).** Rejected. It required the PMU team to maintain each month's Papers in Firestore by hand, production Firestore access from the LMS was never confirmed, and the `session` table already holds the same switched-on Papers.
- **Query `session` without the auth-group filter or the academic-year bound.** Rejected. Without `meta_data.group = 'EnableStudents'` the query returns sessions from every other state; without the `CURRENT_ACADEMIC_YEAR` start-time bound it also returns 51 switched-on mandated NVS sessions from Sep 2025 to Jan 2026.

## Consequences

- The PMU team no longer maintains a separate Firestore list for the tab, and the LMS no longer reads Firestore or depends on `google-auth-library`.
- There is no 5-minute cache on the Monthly Test list; `session` is read directly from Postgres on each load.
- **Trade-off:** the hand-kept Firestore list acted as an explicit filter. Now any switched-on `system_wide_mandated` session for `EnableStudents` Grade 11 or 12 in the current academic year appears in that month's Monthly Test, including one created by mistake (this happened in another state's group with a "Cypress Quiz Session Edit" test session).
- Two rounds starting in the same calendar month appear as one Monthly Test.
- `getNvsTestSets()` keeps the same signature and return shape, so a future PMU calendar module can still replace `src/lib/test-set-list.ts` without touching the rules.
