-- Curriculum Summary v2 fixture (#417 / #426). One Summary row per Centre + Grade, measured
-- against its Curriculum Plan. Every Centre sits at a "Summary E2E" JNV School in region
-- SUMMARY_E2E (one in SUMMARY_E2E_OTHER for scope checks); e2e/tests/curriculum-summary.spec.ts
-- works its expected pills and header numbers out by hand from these rows.
--
-- Content stays off Grade 11 JEE Main / JEE Advanced (Fixture Alpha / Beta Physics only) so the
-- teacher-logging and plan-authoring specs keep their Chapter lists. New Grade 11 content is
-- NEET only; Grade 12 gains two JEE Main Maths Chapters.

-- Fixture Alpha Physics is also in the NEET syllabus, so a NEET-only class has Physics.
INSERT INTO public.lms_chapter_exam_configs
  (chapter_id, exam_track, is_in_syllabus, prescribed_minutes, coverage_sequence, inserted_by_email, updated_by_email)
VALUES
  (90007501, 'neet', true, 60, 1, 'e2e@avantifellows.org', 'e2e@avantifellows.org')
ON CONFLICT (chapter_id, exam_track) DO NOTHING;

INSERT INTO public.chapter
  (id, code, grade_id, subject_id, inserted_at, updated_at, name)
VALUES
  (90008101, 'SUM-CH01', 3, 2, NOW(), NOW(), '[{"chapter":"Summary Chem Bonding","lang_code":"en"}]'::jsonb),
  (90008102, 'SUM-CH02', 3, 2, NOW(), NOW(), '[{"chapter":"Summary Chem Thermo","lang_code":"en"}]'::jsonb),
  (90008103, 'SUM-BIO01', 3, 3, NOW(), NOW(), '[{"chapter":"Summary Bio Cells","lang_code":"en"}]'::jsonb),
  (90008104, 'SUM-BIO02', 3, 3, NOW(), NOW(), '[{"chapter":"Summary Bio Plants","lang_code":"en"}]'::jsonb),
  (90008105, 'SUM-BIO03', 3, 3, NOW(), NOW(), '[{"chapter":"Summary Bio Animals","lang_code":"en"}]'::jsonb),
  (90008106, 'SUM-BIO04', 3, 3, NOW(), NOW(), '[{"chapter":"Summary Bio Genetics","lang_code":"en"}]'::jsonb),
  (90008201, 'SUM-MA01', 4, 1, NOW(), NOW(), '[{"chapter":"Summary Maths Limits","lang_code":"en"}]'::jsonb),
  (90008202, 'SUM-MA02', 4, 1, NOW(), NOW(), '[{"chapter":"Summary Maths Vectors","lang_code":"en"}]'::jsonb)
ON CONFLICT (id) DO UPDATE SET
  code = EXCLUDED.code,
  grade_id = EXCLUDED.grade_id,
  subject_id = EXCLUDED.subject_id,
  name = EXCLUDED.name,
  updated_at = NOW();

INSERT INTO public.lms_chapter_exam_configs
  (chapter_id, exam_track, is_in_syllabus, prescribed_minutes, coverage_sequence, inserted_by_email, updated_by_email)
VALUES
  (90008101, 'neet', true, 60, 1, 'e2e@avantifellows.org', 'e2e@avantifellows.org'),
  (90008102, 'neet', true, 60, 2, 'e2e@avantifellows.org', 'e2e@avantifellows.org'),
  (90008103, 'neet', true, 60, 1, 'e2e@avantifellows.org', 'e2e@avantifellows.org'),
  (90008104, 'neet', true, 60, 2, 'e2e@avantifellows.org', 'e2e@avantifellows.org'),
  (90008105, 'neet', true, 60, 3, 'e2e@avantifellows.org', 'e2e@avantifellows.org'),
  (90008106, 'neet', true, 60, 4, 'e2e@avantifellows.org', 'e2e@avantifellows.org'),
  (90008201, 'jee_main', true, 60, 1, 'e2e@avantifellows.org', 'e2e@avantifellows.org'),
  (90008202, 'jee_main', true, 60, 2, 'e2e@avantifellows.org', 'e2e@avantifellows.org')
ON CONFLICT (chapter_id, exam_track) DO NOTHING;

INSERT INTO public.school
  (id, code, name, inserted_at, updated_at, udise_code, af_school_category, region, state, district, program_ids)
VALUES
  (900081, 'SUMM81', 'Summary Anand School', NOW(), NOW(), '81000000081', 'JNV', 'SUMMARY_E2E', 'Gujarat', 'Anand', ARRAY[1, 2]::integer[]),
  (900082, 'SUMM82', 'Summary Bhuj School', NOW(), NOW(), '81000000082', 'JNV', 'SUMMARY_E2E', 'Gujarat', 'Kutch', ARRAY[1, 2]::integer[]),
  (900083, 'SUMM83', 'Summary Surat School', NOW(), NOW(), '81000000083', 'JNV', 'SUMMARY_E2E', 'Gujarat', 'Surat', ARRAY[1, 2]::integer[]),
  (900084, 'SUMM84', 'Summary Other Region School', NOW(), NOW(), '81000000084', 'JNV', 'SUMMARY_E2E_OTHER', 'Gujarat', 'Rajkot', ARRAY[1]::integer[]),
  (900085, 'SUMM85', 'Summary Vapi School', NOW(), NOW(), '81000000085', 'JNV', 'SUMMARY_E2E', 'Gujarat', 'Valsad', ARRAY[1, 2]::integer[]),
  (900086, 'SUMM86', 'Summary Navsari School', NOW(), NOW(), '81000000086', 'JNV', 'SUMMARY_E2E', 'Gujarat', 'Navsari', ARRAY[1]::integer[])
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

-- Program 1 = JNV CoE, Program 2 = JNV Nodal.
INSERT INTO public.centres
  (id, name, school_id, is_physical, is_active, program_id)
VALUES
  (9000811, 'Summary E2E Anand Main', 900081, true, true, 1),
  (9000812, 'Summary E2E Anand Shared', 900081, true, true, 2),
  (9000821, 'Summary E2E Bhuj Neet', 900082, true, true, 1),
  (9000822, 'Summary E2E Bhuj Setup', 900082, true, true, 2),
  (9000831, 'Summary E2E Surat CET', 900083, true, true, 1),
  (9000832, 'Summary E2E Surat Draft', 900083, true, true, 2),
  (9000841, 'Summary E2E Other Region', 900084, true, true, 1),
  (9000851, 'Summary E2E Vapi Unassigned', 900085, true, true, 1),
  (9000852, 'Summary E2E Vapi Closed', 900085, true, true, 2),
  (9000861, 'Summary E2E Navsari One', 900086, true, true, 1),
  (9000862, 'Summary E2E Navsari Two', 900086, true, true, 1)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  school_id = EXCLUDED.school_id,
  is_physical = EXCLUDED.is_physical,
  is_active = EXCLUDED.is_active,
  program_id = EXCLUDED.program_id,
  updated_at = NOW();

-- Grade id 3 = Grade 11, 4 = Grade 12. Navsari Two maps nothing: it only makes Navsari One's
-- School + Program ambiguous.
INSERT INTO public.centre_exam_tracks
  (centre_id, grade_id, exam_track_code)
VALUES
  (9000811, 3, 'jee_main'),
  (9000811, 4, 'jee_main'),
  (9000812, 3, 'jee_main'),
  (9000812, 3, 'neet'),
  (9000821, 3, 'neet'),
  (9000822, 3, 'jee_main'),
  (9000822, 3, 'jee_advanced'),
  (9000831, 3, 'cet'),
  (9000832, 3, 'jee_main'),
  (9000841, 3, 'jee_main'),
  (9000851, 3, 'jee_main'),
  (9000852, 3, 'jee_main'),
  (9000861, 3, 'jee_main')
ON CONFLICT (centre_id, grade_id, exam_track_code) DO NOTHING;

INSERT INTO public.lms_curriculum_plans
  (id, title, academic_year, grade_id, exam_tracks, status, closure_date, activated_at, inserted_by_email, updated_by_email)
VALUES
  (900001, 'Summary G11 Active Plan', '2026-2027', 3, ARRAY['jee_main', 'neet']::text[], 'active', DATE '2027-02-28', TIMESTAMP '2026-04-01 00:00:00', 'e2e@avantifellows.org', 'e2e@avantifellows.org'),
  (900002, 'Summary G11 Draft Plan', '2026-2027', 3, ARRAY['jee_main']::text[], 'draft', DATE '2027-02-28', NULL, 'e2e@avantifellows.org', 'e2e@avantifellows.org'),
  (900003, 'Summary G11 Closed Plan', '2026-2027', 3, ARRAY['jee_main']::text[], 'active', DATE '2026-07-31', TIMESTAMP '2026-04-01 00:00:00', 'e2e@avantifellows.org', 'e2e@avantifellows.org'),
  (900004, 'Summary G12 Active Plan', '2026-2027', 4, ARRAY['jee_main']::text[], 'active', DATE '2027-02-28', TIMESTAMP '2026-04-01 00:00:00', 'e2e@avantifellows.org', 'e2e@avantifellows.org')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.lms_curriculum_plan_chapters
  (plan_id, chapter_id, due_date, test_date, inserted_by_email, updated_by_email)
VALUES
  (900001, 90007501, DATE '2026-06-30', NULL, 'e2e@avantifellows.org', 'e2e@avantifellows.org'),
  (900001, 90007502, DATE '2026-07-31', NULL, 'e2e@avantifellows.org', 'e2e@avantifellows.org'),
  (900001, 90008101, DATE '2026-07-15', NULL, 'e2e@avantifellows.org', 'e2e@avantifellows.org'),
  (900001, 90008102, DATE '2026-09-30', NULL, 'e2e@avantifellows.org', 'e2e@avantifellows.org'),
  (900001, 90008103, DATE '2026-06-15', NULL, 'e2e@avantifellows.org', 'e2e@avantifellows.org'),
  (900001, 90008104, DATE '2026-07-10', NULL, 'e2e@avantifellows.org', 'e2e@avantifellows.org'),
  (900001, 90008105, DATE '2026-08-10', NULL, 'e2e@avantifellows.org', 'e2e@avantifellows.org'),
  (900001, 90008106, DATE '2026-08-12', NULL, 'e2e@avantifellows.org', 'e2e@avantifellows.org'),
  (900002, 90007501, DATE '2026-06-30', NULL, 'e2e@avantifellows.org', 'e2e@avantifellows.org'),
  (900003, 90007501, DATE '2026-06-30', NULL, 'e2e@avantifellows.org', 'e2e@avantifellows.org'),
  (900003, 90007502, DATE '2026-07-20', NULL, 'e2e@avantifellows.org', 'e2e@avantifellows.org'),
  (900004, 90008201, DATE '2026-07-01', NULL, 'e2e@avantifellows.org', 'e2e@avantifellows.org'),
  (900004, 90008202, DATE '2026-08-01', NULL, 'e2e@avantifellows.org', 'e2e@avantifellows.org')
ON CONFLICT (plan_id, chapter_id) DO NOTHING;

INSERT INTO public.lms_curriculum_plan_assignments
  (plan_id, centre_id, grade_id, academic_year, inserted_by_email, updated_by_email)
VALUES
  (900001, 9000811, 3, '2026-2027', 'e2e@avantifellows.org', 'e2e@avantifellows.org'),
  (900001, 9000812, 3, '2026-2027', 'e2e@avantifellows.org', 'e2e@avantifellows.org'),
  (900001, 9000821, 3, '2026-2027', 'e2e@avantifellows.org', 'e2e@avantifellows.org'),
  (900001, 9000822, 3, '2026-2027', 'e2e@avantifellows.org', 'e2e@avantifellows.org'),
  (900002, 9000832, 3, '2026-2027', 'e2e@avantifellows.org', 'e2e@avantifellows.org'),
  (900003, 9000852, 3, '2026-2027', 'e2e@avantifellows.org', 'e2e@avantifellows.org'),
  (900004, 9000811, 4, '2026-2027', 'e2e@avantifellows.org', 'e2e@avantifellows.org')
ON CONFLICT (centre_id, grade_id, academic_year) DO NOTHING;

-- completed_at is UTC wall clock (as the app writes it); IST = UTC + 5:30.
INSERT INTO public.lms_curriculum_chapter_completions
  (school_code, program_id, chapter_id, exam_track, completed_at, completed_by_email, inserted_by_email, updated_by_email, deleted_at)
VALUES
  -- Anand Main (single JEE Main): Beta was completed last academic year.
  ('SUMM81', 1, 90007501, 'jee_main', TIMESTAMP '2026-06-20 04:00:00', 'e2e@avantifellows.org', 'e2e@avantifellows.org', 'e2e@avantifellows.org', NULL),
  ('SUMM81', 1, 90007502, 'jee_main', TIMESTAMP '2026-03-20 04:00:00', 'e2e@avantifellows.org', 'e2e@avantifellows.org', 'e2e@avantifellows.org', NULL),
  ('SUMM81', 1, 90008201, 'jee_main', TIMESTAMP '2026-07-02 04:00:00', 'e2e@avantifellows.org', 'e2e@avantifellows.org', 'e2e@avantifellows.org', NULL),
  -- Anand Shared (JEE Main + NEET): Alpha under both tracks, Beta (JEE Main only) under NEET,
  -- Plants at 01:30 IST on 16 Aug, Thermo early (not yet due).
  ('SUMM81', 2, 90007501, 'jee_main', TIMESTAMP '2026-06-25 04:00:00', 'e2e@avantifellows.org', 'e2e@avantifellows.org', 'e2e@avantifellows.org', NULL),
  ('SUMM81', 2, 90007501, 'neet', TIMESTAMP '2026-06-28 04:00:00', 'e2e@avantifellows.org', 'e2e@avantifellows.org', 'e2e@avantifellows.org', NULL),
  ('SUMM81', 2, 90007502, 'neet', TIMESTAMP '2026-07-25 04:00:00', 'e2e@avantifellows.org', 'e2e@avantifellows.org', 'e2e@avantifellows.org', NULL),
  ('SUMM81', 2, 90008103, 'neet', TIMESTAMP '2026-06-10 04:00:00', 'e2e@avantifellows.org', 'e2e@avantifellows.org', 'e2e@avantifellows.org', NULL),
  ('SUMM81', 2, 90008104, 'neet', TIMESTAMP '2026-08-15 20:00:00', 'e2e@avantifellows.org', 'e2e@avantifellows.org', 'e2e@avantifellows.org', NULL),
  ('SUMM81', 2, 90008102, 'neet', TIMESTAMP '2026-08-01 04:00:00', 'e2e@avantifellows.org', 'e2e@avantifellows.org', 'e2e@avantifellows.org', NULL),
  -- Bhuj Neet (single NEET): everything due is done.
  ('SUMM82', 1, 90007501, 'neet', TIMESTAMP '2026-07-05 04:00:00', 'e2e@avantifellows.org', 'e2e@avantifellows.org', 'e2e@avantifellows.org', NULL),
  ('SUMM82', 1, 90008101, 'neet', TIMESTAMP '2026-07-10 04:00:00', 'e2e@avantifellows.org', 'e2e@avantifellows.org', 'e2e@avantifellows.org', NULL),
  ('SUMM82', 1, 90008103, 'neet', TIMESTAMP '2026-06-12 04:00:00', 'e2e@avantifellows.org', 'e2e@avantifellows.org', 'e2e@avantifellows.org', NULL),
  ('SUMM82', 1, 90008104, 'neet', TIMESTAMP '2026-07-08 04:00:00', 'e2e@avantifellows.org', 'e2e@avantifellows.org', 'e2e@avantifellows.org', NULL),
  ('SUMM82', 1, 90008105, 'neet', TIMESTAMP '2026-08-09 04:00:00', 'e2e@avantifellows.org', 'e2e@avantifellows.org', 'e2e@avantifellows.org', NULL),
  ('SUMM82', 1, 90008106, 'neet', TIMESTAMP '2026-08-11 04:00:00', 'e2e@avantifellows.org', 'e2e@avantifellows.org', 'e2e@avantifellows.org', NULL),
  -- Vapi Closed: Alpha completed after the plan closed (still counts).
  ('SUMM85', 2, 90007501, 'jee_main', TIMESTAMP '2026-08-05 04:00:00', 'e2e@avantifellows.org', 'e2e@avantifellows.org', 'e2e@avantifellows.org', NULL);
