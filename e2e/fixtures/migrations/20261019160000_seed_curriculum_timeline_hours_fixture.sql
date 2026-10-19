-- Curriculum Summary chapter timeline hours fixture (#417 / #430). LMS Curriculum Logs for
-- "Summary E2E Anand Shared" (School SUMM81, Program 2 = JNV Nodal, Grade 11, JEE Main + NEET)
-- under both class tracks, inside and outside each hours window ending 15 Aug 2026:
-- This AY = 1 Apr–15 Aug, Last 30 days = 17 Jul–15 Aug, Last 7 days = 9–15 Aug.
-- e2e/tests/curriculum-summary.spec.ts works its hours, cancellation and doubt-solving literals
-- out by hand from these rows. Logs never change Chapter status, so earlier literals hold.

INSERT INTO public.topic
  (id, code, chapter_id, inserted_at, updated_at, name)
VALUES
  (900081031, 'SUM-BIO01-T01', 90008103, NOW(), NOW(), '[{"topic":"Summary Cell Wall","lang_code":"en"}]'::jsonb),
  (900081032, 'SUM-BIO01-T02', 90008103, NOW(), NOW(), '[{"topic":"Summary Cell Nucleus","lang_code":"en"}]'::jsonb),
  (900081041, 'SUM-BIO02-T01', 90008104, NOW(), NOW(), '[{"topic":"Summary Plant Roots","lang_code":"en"}]'::jsonb)
ON CONFLICT (id) DO UPDATE SET
  code = EXCLUDED.code,
  chapter_id = EXCLUDED.chapter_id,
  name = EXCLUDED.name,
  updated_at = NOW();

-- Subject ids: 2 Chemistry, 3 Biology, 4 Physics. Grade id 3 = Grade 11.
INSERT INTO public.lms_curriculum_logs
  (id, school_code, program_id, grade_id, subject_id, exam_track, log_date, duration_minutes, log_type, chapter_id, created_by_email, inserted_by_email, updated_by_email, deleted_at)
VALUES
  -- Regular logs; hours split to Chapters by topic share.
  -- 90 min over Cell Wall, Cell Nucleus and Plant Roots: Bio Cells 60, Bio Plants 30 (Last 7 days).
  (90008301, 'SUMM81', 2, 3, 3, 'neet', DATE '2026-08-12', 90, 'regular', NULL, 'e2e@avantifellows.org', 'e2e@avantifellows.org', 'e2e@avantifellows.org', NULL),
  -- Alpha Motion: 120 min under JEE Main (Last 30 days) and 60 min under NEET (This AY only).
  (90008302, 'SUMM81', 2, 3, 4, 'jee_main', DATE '2026-08-01', 120, 'regular', NULL, 'e2e@avantifellows.org', 'e2e@avantifellows.org', 'e2e@avantifellows.org', NULL),
  (90008303, 'SUMM81', 2, 3, 4, 'neet', DATE '2026-06-10', 60, 'regular', NULL, 'e2e@avantifellows.org', 'e2e@avantifellows.org', 'e2e@avantifellows.org', NULL),
  -- Never counted: last academic year, after as-of, deleted, and a track the class doesn't run.
  (90008304, 'SUMM81', 2, 3, 4, 'jee_main', DATE '2026-03-25', 45, 'regular', NULL, 'e2e@avantifellows.org', 'e2e@avantifellows.org', 'e2e@avantifellows.org', NULL),
  (90008305, 'SUMM81', 2, 3, 3, 'neet', DATE '2026-08-16', 30, 'regular', NULL, 'e2e@avantifellows.org', 'e2e@avantifellows.org', 'e2e@avantifellows.org', NULL),
  (90008306, 'SUMM81', 2, 3, 3, 'neet', DATE '2026-08-10', 200, 'regular', NULL, 'e2e@avantifellows.org', 'e2e@avantifellows.org', 'e2e@avantifellows.org', TIMESTAMP '2026-08-11 04:00:00'),
  (90008307, 'SUMM81', 2, 3, 4, 'jee_advanced', DATE '2026-08-11', 50, 'regular', NULL, 'e2e@avantifellows.org', 'e2e@avantifellows.org', 'e2e@avantifellows.org', NULL),
  -- Class Cancellation Logs: Plants (Last 7 days), Alpha under JEE Main (Last 30 days) and under
  -- NEET (This AY only); a deleted one on Plants.
  (90008311, 'SUMM81', 2, 3, 3, 'neet', DATE '2026-08-13', NULL, 'class_cancelled', 90008104, 'e2e@avantifellows.org', 'e2e@avantifellows.org', 'e2e@avantifellows.org', NULL),
  (90008312, 'SUMM81', 2, 3, 4, 'jee_main', DATE '2026-07-20', NULL, 'class_cancelled', 90007501, 'e2e@avantifellows.org', 'e2e@avantifellows.org', 'e2e@avantifellows.org', NULL),
  (90008313, 'SUMM81', 2, 3, 4, 'neet', DATE '2026-05-05', NULL, 'class_cancelled', 90007501, 'e2e@avantifellows.org', 'e2e@avantifellows.org', 'e2e@avantifellows.org', NULL),
  (90008314, 'SUMM81', 2, 3, 3, 'neet', DATE '2026-08-14', NULL, 'class_cancelled', 90008104, 'e2e@avantifellows.org', 'e2e@avantifellows.org', 'e2e@avantifellows.org', TIMESTAMP '2026-08-14 10:00:00'),
  -- Doubt Solving Logs: Cells 45 min (Last 7 days), Alpha 30 min under JEE Main (Last 30 days),
  -- Alpha 60 min under NEET on 1 Apr (This AY), Alpha 20 min on 31 Mar (last academic year).
  (90008321, 'SUMM81', 2, 3, 3, 'neet', DATE '2026-08-14', 45, 'doubt_solving', 90008103, 'e2e@avantifellows.org', 'e2e@avantifellows.org', 'e2e@avantifellows.org', NULL),
  (90008322, 'SUMM81', 2, 3, 4, 'jee_main', DATE '2026-07-25', 30, 'doubt_solving', 90007501, 'e2e@avantifellows.org', 'e2e@avantifellows.org', 'e2e@avantifellows.org', NULL),
  (90008323, 'SUMM81', 2, 3, 4, 'neet', DATE '2026-04-01', 60, 'doubt_solving', 90007501, 'e2e@avantifellows.org', 'e2e@avantifellows.org', 'e2e@avantifellows.org', NULL),
  (90008324, 'SUMM81', 2, 3, 4, 'neet', DATE '2026-03-31', 20, 'doubt_solving', 90007501, 'e2e@avantifellows.org', 'e2e@avantifellows.org', 'e2e@avantifellows.org', NULL)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.lms_curriculum_log_topics
  (curriculum_log_id, topic_id)
VALUES
  (90008301, 900081031),
  (90008301, 900081032),
  (90008301, 900081041),
  (90008302, 900075011),
  (90008303, 900075011),
  (90008304, 900075011),
  (90008305, 900081031),
  (90008306, 900081031),
  (90008307, 900075011)
ON CONFLICT (curriculum_log_id, topic_id) DO NOTHING;
