-- Intervention flag deep link fixture (#470, slice #475). One open flag on a JNV CoE
-- Student who is on the current roster of JNV Bundi (school 615, code 14061, which has an
-- active physical Centre) in db-dump.sql. e2e/tests/intervention-flag-deep-link.spec.ts
-- opens /school/14061?tab=enrollment&flag=9004751 and expects the dialog for
-- "Aaditya Raj Dhawan" (student 307125).

INSERT INTO public.lms_student_intervention_flags
  (id, student_id, school_id, program_id, status, raised_by_email, inserted_at, updated_at)
VALUES
  (9004751, 307125, 615, 1, 'open', 'e2e-vsw-pm@test.local', '2026-10-05 06:00:00', '2026-10-05 06:00:00')
ON CONFLICT DO NOTHING;

INSERT INTO public.lms_student_intervention_flag_updates
  (id, flag_id, author_email, body, status_from, status_to, inserted_at)
VALUES
  (9004751, 9004751, 'e2e-vsw-pm@test.local', 'Missed two weeks after a family bereavement.', NULL, 'open', '2026-10-05 06:00:00')
ON CONFLICT DO NOTHING;
