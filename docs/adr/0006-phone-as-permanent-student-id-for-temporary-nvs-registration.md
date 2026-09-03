# Phone as permanent Student ID for temporary NVS registration

Until HQ approves collection of PEN, Grade 10 Roll Number, and Annual Family Income, the JNV NVS Phone Registration Mode stores the normalized 10-digit parent phone number, starting from 6 through 9, as the Student ID in the `EnableStudents` auth group. The Student continues to authenticate with Student ID plus Date of Birth, and adding the restricted fields after approval does not replace this phone-based Student ID. This lets registration start without a new Portal identity model and avoids breaking login when the approved registration rules return.

## Consequences

- Two Students cannot share one phone-based Student ID inside `EnableStudents`; a second Student must use another parent or guardian phone.
- The same phone-based Student ID may exist in another auth group.
- Phone Registration Mode is inferred from JNV NVS membership, `EnableStudents` membership, and equality between Student ID and normalized parent phone; no separate mode value is stored on the Student.
- An authorized phone correction changes both the contact phone and Student ID atomically after duplicate checks, and records both old and new values in the existing LMS Student write audit.
- Phone correction is limited to scoped Admin, Program Manager, and Program Admin users through LMS. Other update paths are unsupported for this cohort until the generic DB Service student-update import becomes auth-group-aware; the follow-up is tracked in `avantifellows/db-service#703`.
- Portal login already sends the selected auth-group id and verifies membership before accepting Student ID plus Date of Birth, so Phone Registration Mode does not require a Portal code change.
- New Students registered after the approval change may use the normal Grade 10 Roll Number-based Student ID rule, while earlier Phone Registration Mode Students keep their original identity.
- DB Service checks phone-based Student ID uniqueness inside `EnableStudents` before creation, but no database-level constraint spans the Student and auth-group membership tables. The accepted consequence is a small concurrent-request race that may require manual cleanup; database-backed enforcement remains outside this change.
