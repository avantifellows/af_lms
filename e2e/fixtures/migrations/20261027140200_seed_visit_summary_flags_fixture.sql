-- School Visit Summary Flags column fixture (#470, slice #479). Intervention flags at the
-- School-wise fixture Schools (20261027120000_seed_visit_summary_school_wise_fixture.sql); flags
-- tables come from the mirror 20261027130000_add_lms_student_intervention_flags.sql.
-- e2e/tests/school-visit-summary-school-wise.spec.ts asserts these hand-worked Flags counts:
--
--   VSWPHYS  two open CoE flags (9004752, 9004753) + one resolved CoE flag (9004754) → 2
--   VSWMIXED one open Nodal flag (9004755) + one open JNV NVS flag (9004756)        → 1 (NVS never counts)
--   VSWNOREG, VSWOLD and the concern Schools have no flags                            → 0
--
-- Students 9004795–9004798 (users 9004795–9004798) exist only to carry these flags: each open
-- flag needs its own Student (one open flag per Student). They are on no roster.

INSERT INTO public."user" (id, email, first_name, last_name, role, inserted_at, updated_at)
VALUES
  (9004795, 'e2e-vsw-flag-student-1@test.local', 'VSW Flag', 'Student One', 'student', NOW(), NOW()),
  (9004796, 'e2e-vsw-flag-student-2@test.local', 'VSW Flag', 'Student Two', 'student', NOW(), NOW()),
  (9004797, 'e2e-vsw-flag-student-3@test.local', 'VSW Flag', 'Student Three', 'student', NOW(), NOW()),
  (9004798, 'e2e-vsw-flag-student-4@test.local', 'VSW Flag', 'Student Four', 'student', NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.student (id, student_id, user_id, inserted_at, updated_at)
VALUES
  (9004795, 'E2E-VSW-FLAG-1', 9004795, NOW(), NOW()),
  (9004796, 'E2E-VSW-FLAG-2', 9004796, NOW(), NOW()),
  (9004797, 'E2E-VSW-FLAG-3', 9004797, NOW(), NOW()),
  (9004798, 'E2E-VSW-FLAG-4', 9004798, NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

-- Program 1 = JNV CoE, Program 2 = JNV Nodal, Program 64 = JNV NVS.
INSERT INTO public.lms_student_intervention_flags
  (id, student_id, school_id, program_id, status, raised_by_email, resolved_at, inserted_at, updated_at)
VALUES
  (9004752, 9004795, 900471, 1, 'open', 'e2e-vsw-pm@test.local', NULL, '2026-10-05 06:00:00', '2026-10-05 06:00:00'),
  (9004753, 9004796, 900471, 1, 'open', 'e2e-vsw-pm@test.local', NULL, '2026-10-05 06:10:00', '2026-10-05 06:10:00'),
  (9004754, 9004797, 900471, 1, 'resolved', 'e2e-vsw-pm@test.local', '2026-10-06 06:00:00', '2026-10-01 06:00:00', '2026-10-06 06:00:00'),
  (9004755, 9004797, 900472, 2, 'open', 'e2e-vsw-pm@test.local', NULL, '2026-10-06 06:00:00', '2026-10-06 06:00:00'),
  (9004756, 9004798, 900472, 64, 'open', 'e2e-vsw-pm@test.local', NULL, '2026-10-06 06:10:00', '2026-10-06 06:10:00')
ON CONFLICT DO NOTHING;

INSERT INTO public.lms_student_intervention_flag_updates
  (id, flag_id, author_email, body, status_from, status_to, inserted_at)
VALUES
  (9004752, 9004752, 'e2e-vsw-pm@test.local', 'Withdrawn in class for two weeks.', NULL, 'open', '2026-10-05 06:00:00'),
  (9004753, 9004753, 'e2e-vsw-pm@test.local', 'Frequent absences after illness.', NULL, 'open', '2026-10-05 06:10:00'),
  (9004754, 9004754, 'e2e-vsw-pm@test.local', 'Needs a quiet place to study.', NULL, 'open', '2026-10-01 06:00:00'),
  (9004755, 9004754, 'e2e-vsw-pm@test.local', 'Hostel room sorted.', 'open', 'resolved', '2026-10-06 06:00:00'),
  (9004756, 9004755, 'e2e-vsw-pm@test.local', 'Struggling after a family move.', NULL, 'open', '2026-10-06 06:00:00'),
  (9004757, 9004756, 'e2e-vsw-pm@test.local', 'NVS student needs counselling.', NULL, 'open', '2026-10-06 06:10:00')
ON CONFLICT DO NOTHING;
