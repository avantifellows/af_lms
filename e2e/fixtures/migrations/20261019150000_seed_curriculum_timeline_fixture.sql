-- Curriculum Summary chapter timeline fixture (#417 / #429). Two Grade 11 NEET Chapters that
-- "Summary G11 Active Plan" (900001) leaves undated, so the timeline lists them last in syllabus
-- order: Chemistry before Biology, although their ids and codes sort the other way. Undated
-- Chapters are never due, so the Summary's pills and Tests overdue are unchanged.

INSERT INTO public.chapter
  (id, code, grade_id, subject_id, inserted_at, updated_at, name)
VALUES
  (90008108, 'SUM-BIO05', 3, 3, NOW(), NOW(), '[{"chapter":"Summary Bio Ecology","lang_code":"en"}]'::jsonb),
  (90008109, 'SUM-CH03', 3, 2, NOW(), NOW(), '[{"chapter":"Summary Chem Organic","lang_code":"en"}]'::jsonb)
ON CONFLICT (id) DO UPDATE SET
  code = EXCLUDED.code,
  grade_id = EXCLUDED.grade_id,
  subject_id = EXCLUDED.subject_id,
  name = EXCLUDED.name,
  updated_at = NOW();

INSERT INTO public.lms_chapter_exam_configs
  (chapter_id, exam_track, is_in_syllabus, prescribed_minutes, coverage_sequence, inserted_by_email, updated_by_email)
VALUES
  (90008108, 'neet', true, 60, 5, 'e2e@avantifellows.org', 'e2e@avantifellows.org'),
  (90008109, 'neet', true, 60, 3, 'e2e@avantifellows.org', 'e2e@avantifellows.org')
ON CONFLICT (chapter_id, exam_track) DO NOTHING;
