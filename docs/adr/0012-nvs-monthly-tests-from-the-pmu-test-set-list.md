# NVS Monthly Tests come from the PMU test set list in Firestore, with times and grades from `session`
Superseded by ADR 0014 (24 Nov 2026).

The Test Attendance Tab (#517) groups System-wide Mandated Test Papers into Monthly Tests. Which Papers make up a Monthly Test, and its name, come from the PMU test set list: the Firestore document `pmu_live_tracking_sessions/nvs`, field `test_sets: [{label, quiz_ids}]`, which the PMU team already keeps up to date for PMU Live Tracking. Each Paper's opening time, closing time, grade and on/off state come from the LMS `session` table, matched on the quiz id (`platform_id`). This is the LMS's first Firestore read. It goes through the Firestore REST API with the Google service account the LMS already uses for BigQuery, so `google-auth-library` is a direct dependency and the Firestore SDK is not added. One server-only module (`src/lib/test-set-list.ts`) reads the list, and nothing else in the LMS knows where it lives.

## Considered Options

- **Group Papers by `session` tags alone (test purpose, month in the name or dates).** Rejected. The PMU team already maintains the list for Live Tracking, so a second rule would be a second source of truth. Test dates and grades also shift from month to month: in August 2026 the Grade 12 Papers ran from 19 to 24 August, and the Grade 11 Papers were scheduled for 26 to 30 August and then switched off. A date or name rule could group Papers wrongly.
- **Add the Firestore SDK.** Rejected for one document read. The REST API with the existing service account is enough.

## Consequences

- A Monthly Test appears on the tab only once the PMU team has added it to the list and its first Paper has opened. If the set is missing from the list, the tab doesn't show it.
- The list's `current` mark is ignored. Running and closed come from the `session` times.
- The list is cached in process for 5 minutes, the delay Live Tracking already accepts. If it can't be read, the tab shows an error, never an empty year.
- The reader can be replaced by a future PMU calendar module without touching the rules.
