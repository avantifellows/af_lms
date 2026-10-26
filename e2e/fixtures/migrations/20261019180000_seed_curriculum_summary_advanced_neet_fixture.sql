-- Curriculum Summary shared JEE Advanced + NEET class (#417, decision Q20). One Grade 12 Centre
-- mapped to JEE Advanced and NEET, in its own region (SUMMARY_ADV_E2E) so the PM's SUMMARY_E2E
-- rows and the Admin's Grade 11 counts are unchanged. e2e/tests/curriculum-summary.spec.ts
-- works its literals out by hand from these rows.
--
-- Grade 12 content: one new JEE Advanced-only Physics Chapter (prescribed 2h) and the existing
-- NEET-only Fixture Biology (prescribed 3h). Nothing new is added to JEE Main or NEET, so the
-- Grade 12 JEE Main and NEET classes keep their Chapter lists.

INSERT INTO public.chapter
  (id, code, grade_id, subject_id, inserted_at, updated_at, name)
VALUES
  (90008701, 'SUM-ADV-PH01', 4, 4, NOW(), NOW(), '[{"chapter":"Summary Advanced Optics","lang_code":"en"}]'::jsonb)
ON CONFLICT (id) DO UPDATE SET
  code = EXCLUDED.code,
  grade_id = EXCLUDED.grade_id,
  subject_id = EXCLUDED.subject_id,
  name = EXCLUDED.name,
  updated_at = NOW();

INSERT INTO public.lms_chapter_exam_configs
  (chapter_id, exam_track, is_in_syllabus, prescribed_minutes, coverage_sequence, inserted_by_email, updated_by_email)
VALUES
  (90008701, 'jee_advanced', true, 120, 1, 'e2e@avantifellows.org', 'e2e@avantifellows.org')
ON CONFLICT (chapter_id, exam_track) DO NOTHING;

INSERT INTO public.school
  (id, code, name, inserted_at, updated_at, udise_code, af_school_category, region, state, district, program_ids)
VALUES
  (900087, 'SUMM87', 'Summary Valsad Advanced School', NOW(), NOW(), '81000000087', 'JNV', 'SUMMARY_ADV_E2E', 'Gujarat', 'Valsad', ARRAY[1]::integer[])
ON CONFLICT (id) DO UPDATE SET
  code = EXCLUDED.code,
  name = EXCLUDED.name,
  udise_code = EXCLUDED.udise_code,
  af_school_category = EXCLUDED.af_school_category,
  region = EXCLUDED.region,
  state = EXCLUDED.state,
  district = EXCLUDED.district,
  program_ids = EXCLUDED.program_ids,
  updated_at = NOW();

INSERT INTO public.centres
  (id, name, school_id, is_physical, is_active, program_id)
VALUES
  (9000871, 'Summary E2E Valsad Advanced Neet', 900087, true, true, 1)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  school_id = EXCLUDED.school_id,
  is_physical = EXCLUDED.is_physical,
  is_active = EXCLUDED.is_active,
  program_id = EXCLUDED.program_id,
  updated_at = NOW();

-- Grade id 4 = Grade 12.
INSERT INTO public.centre_exam_tracks
  (centre_id, grade_id, exam_track_code)
VALUES
  (9000871, 4, 'jee_advanced'),
  (9000871, 4, 'neet')
ON CONFLICT (centre_id, grade_id, exam_track_code) DO NOTHING;

INSERT INTO public.lms_curriculum_plans
  (id, title, academic_year, grade_id, exam_tracks, status, closure_date, activated_at, inserted_by_email, updated_by_email)
VALUES
  (900005, 'Summary G12 Advanced NEET Plan', '2026-2027', 4, ARRAY['jee_advanced', 'neet']::text[], 'active', DATE '2027-02-28', TIMESTAMP '2026-04-01 00:00:00', 'e2e@avantifellows.org', 'e2e@avantifellows.org')
ON CONFLICT (id) DO NOTHING;

-- Optics due 1 Jul, Fixture Biology due 15 Jul; no test dates (due + 1).
INSERT INTO public.lms_curriculum_plan_chapters
  (plan_id, chapter_id, due_date, test_date, inserted_by_email, updated_by_email)
VALUES
  (900005, 90008701, DATE '2026-07-01', NULL, 'e2e@avantifellows.org', 'e2e@avantifellows.org'),
  (900005, 90007504, DATE '2026-07-15', NULL, 'e2e@avantifellows.org', 'e2e@avantifellows.org')
ON CONFLICT (plan_id, chapter_id) DO NOTHING;

INSERT INTO public.lms_curriculum_plan_assignments
  (plan_id, centre_id, grade_id, academic_year, inserted_by_email, updated_by_email)
VALUES
  (900005, 9000871, 4, '2026-2027', 'e2e@avantifellows.org', 'e2e@avantifellows.org')
ON CONFLICT (centre_id, grade_id, academic_year) DO NOTHING;

-- Optics was marked complete under both tracks (counted once); Fixture Biology is open.
INSERT INTO public.lms_curriculum_chapter_completions
  (school_code, program_id, chapter_id, exam_track, completed_at, completed_by_email, inserted_by_email, updated_by_email, deleted_at)
VALUES
  ('SUMM87', 1, 90008701, 'jee_advanced', TIMESTAMP '2026-06-25 04:00:00', 'e2e@avantifellows.org', 'e2e@avantifellows.org', 'e2e@avantifellows.org', NULL),
  ('SUMM87', 1, 90008701, 'neet', TIMESTAMP '2026-06-28 04:00:00', 'e2e@avantifellows.org', 'e2e@avantifellows.org', 'e2e@avantifellows.org', NULL);
