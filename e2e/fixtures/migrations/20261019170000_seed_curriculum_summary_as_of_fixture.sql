-- Curriculum Summary as-of and duplicate-Chapter fixture (#417 final checks). Builds on the
-- Summary, Chapter Test and timeline hours fixtures (20261019130000–20261019160000).
-- e2e/tests/curriculum-summary.spec.ts works its literals out by hand from these rows.

-- Chapter Test sessions count for an as-of date only once they existed: created (inserted_at,
-- UTC) or started by the end of that day. The earlier fixture sessions were created at
-- migration time, so date their creation before any as-of the specs use.
UPDATE public.session
   SET inserted_at = TIMESTAMP '2026-06-01 00:00:00'
 WHERE id BETWEEN 90009101 AND 90009113;

-- A CMS test with no chapter_id whose problems are Alpha Physics ×2, Bio Cells ×2 and the
-- duplicate Bio Cells row ×1. By raw chapter id Alpha and Cells tie at 2 (Alpha wins on id);
-- once the duplicate rows are unified Cells has 3 and wins.
INSERT INTO public.resource
  (id, type, subtype, code, name, type_params, inserted_at, updated_at)
VALUES
  (90009007, 'test', 'chapter_test', 'SUM-T-UNIFIED', '[{"resource":"Summary Unified Majority Test","lang_code":"en"}]'::jsonb,
    '{"subjects": [{"sections": [{"compulsory": {"problems": [{"id": 90009014}, {"id": 90009015}, {"id": 90009016}, {"id": 90009017}, {"id": 90009018}]}}]}]}'::jsonb,
    NOW(), NOW()),
  (90009014, 'problem', NULL, 'SUM-P-4', NULL, '{}'::jsonb, NOW(), NOW()),
  (90009015, 'problem', NULL, 'SUM-P-5', NULL, '{}'::jsonb, NOW(), NOW()),
  (90009016, 'problem', NULL, 'SUM-P-6', NULL, '{}'::jsonb, NOW(), NOW()),
  (90009017, 'problem', NULL, 'SUM-P-7', NULL, '{}'::jsonb, NOW(), NOW()),
  (90009018, 'problem', NULL, 'SUM-P-8', NULL, '{}'::jsonb, NOW(), NOW())
ON CONFLICT (id) DO UPDATE SET
  type = EXCLUDED.type,
  subtype = EXCLUDED.subtype,
  code = EXCLUDED.code,
  name = EXCLUDED.name,
  type_params = EXCLUDED.type_params,
  updated_at = NOW();

INSERT INTO public.resource_chapter
  (id, resource_id, chapter_id, inserted_at, updated_at)
VALUES
  (90009024, 90009014, 90007501, NOW(), NOW()),
  (90009025, 90009015, 90007501, NOW(), NOW()),
  (90009026, 90009016, 90008103, NOW(), NOW()),
  (90009027, 90009017, 90008103, NOW(), NOW()),
  (90009028, 90009018, 90008107, NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.session
  (id, name, platform, start_time, end_time, is_active, meta_data, inserted_at, updated_at)
VALUES
  -- Anand Shared: a Bio Plants test for next academic year's cohort, created in July. It is
  -- outside the 2026-27 academic year, so it never counts and Bio Plants stays Overdue.
  (90009114, 'Summary Plants Next Year', 'quiz', TIMESTAMP '2027-07-10 10:00:00', TIMESTAMP '2027-07-10 11:00:00', true,
    '{"cms_source": "nex-gen-cms", "test_format": "chapter_test", "status": "success", "grade": 11, "batch_id": "SUMB-81-NODAL-11", "cms_test_id": "90009005", "cms_source_id": "90009005"}'::jsonb,
    TIMESTAMP '2026-07-01 00:00:00', NOW()),
  -- Anand Shared: a Bio Animals test (Chapter code in the name) created at 11:30 IST on 18 Aug
  -- for 25 Aug. Before 18 Aug it did not exist, so Bio Animals stays Overdue on 15 and 17 Aug;
  -- from 18 Aug it is Scheduled.
  (90009115, 'SUM-BIO03 - Summary Animals Chapter Test', 'quiz', TIMESTAMP '2026-08-25 10:00:00', TIMESTAMP '2026-08-25 11:00:00', true,
    '{"cms_source": "nex-gen-cms", "test_format": "chapter_test", "status": "success", "grade": 11, "batch_id": "SUMB-81-NODAL-11", "cms_test_id": "90009003", "cms_source_id": "90009003"}'::jsonb,
    TIMESTAMP '2026-08-18 06:00:00', NOW()),
  -- Bhuj Neet: the unified-majority test (Bio Cells), created 16 Aug and held 17 Aug.
  (90009116, 'Summary Unified Majority Test', 'quiz', TIMESTAMP '2026-08-17 10:00:00', TIMESTAMP '2026-08-17 11:00:00', true,
    '{"cms_source": "nex-gen-cms", "test_format": "chapter_test", "status": "success", "grade": 11, "batch_id": "SUMB-82-COE-11", "cms_test_id": "90009007", "cms_source_id": "90009007"}'::jsonb,
    TIMESTAMP '2026-08-16 04:00:00', NOW())
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  platform = EXCLUDED.platform,
  start_time = EXCLUDED.start_time,
  end_time = EXCLUDED.end_time,
  is_active = EXCLUDED.is_active,
  meta_data = EXCLUDED.meta_data,
  inserted_at = EXCLUDED.inserted_at,
  updated_at = NOW();

-- Anand Shared logs on 21 Aug under the duplicate Bio Cells row (90008107): a 20 min regular log
-- on its own topic, a Class Cancellation Log and 15 min of doubt solving. They count toward the
-- plan's Bio Cells Chapter. Logs never change Chapter status, and 21 Aug is after every as-of
-- the earlier hours literals use.
INSERT INTO public.topic
  (id, code, chapter_id, inserted_at, updated_at, name)
VALUES
  (900081071, 'SUM-BIO01-T03', 90008107, NOW(), NOW(), '[{"topic":"Summary Cell Membrane","lang_code":"en"}]'::jsonb)
ON CONFLICT (id) DO UPDATE SET
  code = EXCLUDED.code,
  chapter_id = EXCLUDED.chapter_id,
  name = EXCLUDED.name,
  updated_at = NOW();

INSERT INTO public.lms_curriculum_logs
  (id, school_code, program_id, grade_id, subject_id, exam_track, log_date, duration_minutes, log_type, chapter_id, created_by_email, inserted_by_email, updated_by_email, deleted_at)
VALUES
  (90008331, 'SUMM81', 2, 3, 3, 'neet', DATE '2026-08-21', 20, 'regular', NULL, 'e2e@avantifellows.org', 'e2e@avantifellows.org', 'e2e@avantifellows.org', NULL),
  (90008332, 'SUMM81', 2, 3, 3, 'neet', DATE '2026-08-21', NULL, 'class_cancelled', 90008107, 'e2e@avantifellows.org', 'e2e@avantifellows.org', 'e2e@avantifellows.org', NULL),
  (90008333, 'SUMM81', 2, 3, 3, 'neet', DATE '2026-08-21', 15, 'doubt_solving', 90008107, 'e2e@avantifellows.org', 'e2e@avantifellows.org', 'e2e@avantifellows.org', NULL)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.lms_curriculum_log_topics
  (curriculum_log_id, topic_id)
VALUES
  (90008331, 900081071)
ON CONFLICT (curriculum_log_id, topic_id) DO NOTHING;
