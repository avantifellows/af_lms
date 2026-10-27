-- School Visit Summary School page fixture (#470, slice #480): the Teachers line at VSWMIXED
-- (20261027120000_seed_visit_summary_school_wise_fixture.sql). It already has an active Nodal
-- Centre (9004721) and an active JNV NVS Centre (9004722); this adds an active CoE Centre
-- (9004821) and an inactive CoE Centre (9004822). Teaching seats, and the hand-worked Teachers
-- line e2e/tests/school-visit-summary-school-wise.spec.ts asserts:
--
--   CoE 9004821    physics Asha Rao · chemistry (vacant) · subject_tbd Ravi Kumar (teacher subject
--                  Biology) · physics Deleted Seat Teacher (seat deleted → hidden) · pm VSW Page PM
--                  (not a teaching seat → hidden)
--                  → "CoE BIOLOGY - Ravi Kumar · CHEMISTRY - Vacant · PHYSICS - Asha Rao"
--   Nodal 9004721  maths Kiran Patel · subject_tbd Meena Shah (no teacher subject) · apc (vacant)
--                  → "Nodal APC - Vacant · MATHS - Kiran Patel · SUBJECT TBD - Meena Shah"
--   Closed CoE 9004822  maths Closed Centre Teacher → hidden (inactive Centre)
--   NVS 9004722    physics NVS Teacher → hidden (not a physical Centre)
--
-- Users 9004821–9004828 exist only to sit in these seats; none can sign in.

UPDATE public.centres SET type_code = 'nodal' WHERE id = 9004721;

INSERT INTO public.centres
  (id, name, school_id, is_physical, is_active, program_id, type_code)
VALUES
  (9004821, 'VSW E2E Mixed CoE', 900472, true, true, 1, 'coe'),
  (9004822, 'VSW E2E Mixed Closed CoE', 900472, true, false, 1, 'coe')
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  school_id = EXCLUDED.school_id,
  is_physical = EXCLUDED.is_physical,
  is_active = EXCLUDED.is_active,
  program_id = EXCLUDED.program_id,
  type_code = EXCLUDED.type_code,
  updated_at = NOW();

INSERT INTO public."user" (id, email, first_name, last_name, role, inserted_at, updated_at)
VALUES
  (9004821, 'e2e-vsw-teacher-asha@test.local', 'Asha', 'Rao', 'teacher', NOW(), NOW()),
  (9004822, 'e2e-vsw-teacher-ravi@test.local', 'Ravi', 'Kumar', 'teacher', NOW(), NOW()),
  (9004823, 'e2e-vsw-teacher-meena@test.local', 'Meena', 'Shah', 'teacher', NOW(), NOW()),
  (9004824, 'e2e-vsw-teacher-kiran@test.local', 'Kiran', 'Patel', 'teacher', NOW(), NOW()),
  (9004825, 'e2e-vsw-teacher-deleted@test.local', 'Deleted Seat', 'Teacher', 'teacher', NOW(), NOW()),
  (9004826, 'e2e-vsw-teacher-closed@test.local', 'Closed Centre', 'Teacher', 'teacher', NOW(), NOW()),
  (9004827, 'e2e-vsw-teacher-nvs@test.local', 'NVS', 'Teacher', 'teacher', NOW(), NOW()),
  (9004828, 'e2e-vsw-page-pm@test.local', 'VSW Page', 'PM', 'teacher', NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

-- Subject 3 = Biology (db-dump). Meena Shah's teacher row has no subject.
INSERT INTO public.teacher (id, user_id, teacher_id, subject_id, is_af_teacher, inserted_at, updated_at)
VALUES
  (9004822, 9004822, 'AF9004822', 3, true, NOW(), NOW()),
  (9004823, 9004823, 'AF9004823', NULL, true, NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.centre_positions (id, centre_id, role, user_id, deleted_at)
VALUES
  (9004821, 9004821, 'physics', 9004821, NULL),
  (9004822, 9004821, 'chemistry', NULL, NULL),
  (9004823, 9004821, 'subject_tbd', 9004822, NULL),
  (9004824, 9004821, 'physics', 9004825, '2026-10-01 06:00:00'),
  (9004825, 9004821, 'pm', 9004828, NULL),
  (9004826, 9004721, 'maths', 9004824, NULL),
  (9004827, 9004721, 'subject_tbd', 9004823, NULL),
  (9004828, 9004721, 'apc', NULL, NULL),
  (9004829, 9004822, 'maths', 9004826, NULL),
  (9004830, 9004722, 'physics', 9004827, NULL)
ON CONFLICT (id) DO NOTHING;
