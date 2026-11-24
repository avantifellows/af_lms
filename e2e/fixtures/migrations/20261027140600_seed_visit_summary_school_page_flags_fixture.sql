-- School Visit Summary School page Intervention flags fixture (#470, slice #484). Builds on the
-- Flags column fixture (20261027140200_seed_visit_summary_flags_fixture.sql) so its School-wise
-- counts stay as they are (VSWPHYS 2, VSWMIXED 1). This adds:
--
--   - a CoE type on VSWPHYS's Centre 9004711, so its program-1 flags tag as CoE;
--   - flag 9004753 raised by a case variant of e2e-vsw-seated-pm@test.local, whose user_permission
--     full name is "VSW Seated PM" (the fixture PM e2e-vsw-pm@test.local has no permission row, so
--     their flags fall back to the email);
--   - a follow-up on VSWMIXED's Nodal flag 9004755 (two updates);
--   - current grade enrollments for the flag Students (grade ids 3 = 11, 4 = 12 in db-dump.sql).
--
-- Hand-worked Intervention flags sections e2e/tests/school-visit-summary-school-wise.spec.ts asserts
-- (open flags newest first):
--
--   VSWPHYS  "2 open · 1 resolved"
--            VSW Flag Student Two · Grade 12 · CoE · Raised by VSW Seated PM on 05 Oct 2026
--            VSW Flag Student One · Grade 11 · CoE · Raised by e2e-vsw-pm@test.local on 05 Oct 2026
--   VSWMIXED "1 open" (the JNV NVS flag 9004756 on VSW Flag Student Four never shows)
--            VSW Flag Student Three · Grade 11 · Nodal · Raised by e2e-vsw-pm@test.local on 06 Oct 2026 · 2 updates
--
-- These Students are on no roster, so the click-through test uses the deep-link flag 9004751 at
-- JNV Bundi (20261027130100_seed_intervention_flag_deep_link_fixture.sql) instead.

UPDATE public.centres SET type_code = 'coe' WHERE id = 9004711;

UPDATE public.lms_student_intervention_flags
SET raised_by_email = 'E2E-VSW-Seated-PM@test.local'
WHERE id = 9004753;

INSERT INTO public.lms_student_intervention_flag_updates
  (id, flag_id, author_email, body, status_from, status_to, inserted_at)
VALUES
  (9004758, 9004755, 'e2e-vsw-pm@test.local', 'Settling in after two counselling sessions.', NULL, NULL, '2026-10-08 06:00:00')
ON CONFLICT DO NOTHING;

INSERT INTO public.enrollment_record
  (id, academic_year, is_current, inserted_at, updated_at, start_date, end_date, group_id, group_type, user_id, subject_id)
VALUES
  (9004795, '2026-2027', true, NOW(), NOW(), '2026-04-01', NULL, 3, 'grade', 9004795, NULL),
  (9004796, '2026-2027', true, NOW(), NOW(), '2026-04-01', NULL, 4, 'grade', 9004796, NULL),
  (9004797, '2026-2027', true, NOW(), NOW(), '2026-04-01', NULL, 3, 'grade', 9004797, NULL)
ON CONFLICT (id) DO NOTHING;
