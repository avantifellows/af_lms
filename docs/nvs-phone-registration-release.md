# NVS Phone Registration Mode release notes

## Coordinated deployment

AF LMS now selects `PHONE_REGISTRATION_MODE` as the active code-controlled
Registration Mode for JNV NVS Add Student, Bulk Upload, template download, and
the scoped phone-cohort Edit path. The DB Service release must flip its matching
mode/version constant and deploy with this AF LMS change. The mode is not
database-backed or School-selectable.

During a coordination window, registration must be treated as unavailable until
both services agree. A DB Service `registration_mode_mismatch` response is
surfaced by AF LMS as a fail-closed `503` without row results or a partial LMS
write. Pause retries until the matching releases are deployed and healthy.

## Manual Portal rollout gate

Portal has no code change for this release. On staging or the first production
School, use a disposable or approved test Student and record the result without
committing personal data:

1. Create a JNV NVS Student through Phone Registration Mode with a valid
   10-digit parent phone and Date of Birth.
2. Confirm the created Student's `student_id` equals the normalized phone and
   that the auth-group membership is `EnableStudents`.
3. Open Portal, select the `EnableStudents` auth group, and enter the phone as
   Student ID plus the Student's Date of Birth.
4. Confirm login reaches the correct Student experience. Record the environment,
   School/test reference, timestamp, and pass/fail result in the release ticket.

This smoke check is a deployment gate, not an automated Portal test.

## Known accepted constraint

The small concurrent-create race remains accepted because no cross-table database
constraint spans Student and auth-group membership. It is documented by ADR 0006
and is not changed by this activation slice.
