-- Curriculum Summary v2 Chapter Test Status fixture (#417 / #428). Chapter-test quiz sessions for
-- the Summary Centres in 20261019130000_seed_curriculum_summary_fixture.sql, plus the batches,
-- school_batch links and CMS test / problem resources they need. Session times are IST wall
-- clock. e2e/tests/curriculum-summary.spec.ts works its Tests overdue literals out by hand from
-- these rows with as_of pinned to 2026-08-15.

-- Bio Animals (due 10 Aug) gets an explicit Chapter Test Date of 5 Aug, so it is Overdue from
-- 13 Aug instead of 19 Aug (due + 1 + 7).
UPDATE public.lms_curriculum_plan_chapters
   SET test_date = DATE '2026-08-05'
 WHERE plan_id = 900001
   AND chapter_id = 90008105;

-- A duplicate Bio Cells row (same code + subject + Grade). A CMS test linked to it counts for
-- the plan's Bio Cells Chapter.
INSERT INTO public.chapter
  (id, code, grade_id, subject_id, inserted_at, updated_at, name)
VALUES
  (90008107, 'SUM-BIO01', 3, 3, NOW(), NOW(), '[{"chapter":"Summary Bio Cells (duplicate)","lang_code":"en"}]'::jsonb)
ON CONFLICT (id) DO UPDATE SET
  code = EXCLUDED.code,
  grade_id = EXCLUDED.grade_id,
  subject_id = EXCLUDED.subject_id,
  name = EXCLUDED.name,
  updated_at = NOW();

-- Batch codes are what session meta_data.batch_id lists; program 1 = JNV CoE, 2 = JNV Nodal.
INSERT INTO public.batch
  (id, name, batch_id, program_id, inserted_at, updated_at)
VALUES
  (90009201, 'Summary Anand Nodal 11', 'SUMB-81-NODAL-11', 2, NOW(), NOW()),
  (90009202, 'Summary Anand CoE 11', 'SUMB-81-COE-11', 1, NOW(), NOW()),
  (90009203, 'Summary Bhuj CoE 11', 'SUMB-82-COE-11', 1, NOW(), NOW()),
  (90009204, 'Summary Surat Nodal 11', 'SUMB-83-NODAL-11', 2, NOW(), NOW())
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  batch_id = EXCLUDED.batch_id,
  program_id = EXCLUDED.program_id,
  updated_at = NOW();

INSERT INTO public.school_batch
  (id, school_id, batch_id, inserted_at, updated_at)
VALUES
  (90009211, 900081, 90009201, NOW(), NOW()),
  (90009212, 900081, 90009202, NOW(), NOW()),
  (90009213, 900082, 90009203, NOW(), NOW()),
  (90009214, 900083, 90009204, NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

-- CMS chapter tests (type 'test') and the problems of the one without a chapter_id.
INSERT INTO public.resource
  (id, type, subtype, code, name, type_params, inserted_at, updated_at)
VALUES
  -- Linked to Alpha Physics.
  (90009001, 'test', 'chapter_test', 'SUM-T-ALPHA', '[{"resource":"Summary Alpha Test","lang_code":"en"}]'::jsonb,
    '{"chapter_id": 90007501, "subjects": []}'::jsonb, NOW(), NOW()),
  -- No chapter_id: two of its three problems are Beta Physics, one is Alpha Physics.
  (90009002, 'test', 'chapter_test', 'SUM-T-MAJORITY', '[{"resource":"Summary Majority Test","lang_code":"en"}]'::jsonb,
    '{"subjects": [{"sections": [{"compulsory": {"problems": [{"id": 90009011}, {"id": 90009012}, {"id": 90009013}]}}]}]}'::jsonb,
    NOW(), NOW()),
  -- Neither a chapter_id nor problems: only the session name's Chapter code attributes it.
  (90009003, 'test', 'chapter_test', 'SUM-T-BLANK', '[{"resource":"Summary Blank Test","lang_code":"en"}]'::jsonb,
    '{"subjects": []}'::jsonb, NOW(), NOW()),
  -- Linked to the duplicate Bio Cells row.
  (90009004, 'test', 'chapter_test', 'SUM-T-CELLS', '[{"resource":"Summary Cells Test","lang_code":"en"}]'::jsonb,
    '{"chapter_id": 90008107, "subjects": []}'::jsonb, NOW(), NOW()),
  -- Linked to Bio Plants (used only by sessions that must never count).
  (90009005, 'test', 'chapter_test', 'SUM-T-PLANTS', '[{"resource":"Summary Plants Test","lang_code":"en"}]'::jsonb,
    '{"chapter_id": 90008104, "subjects": []}'::jsonb, NOW(), NOW()),
  -- Linked to Chem Bonding.
  (90009006, 'test', 'chapter_test', 'SUM-T-BONDING', '[{"resource":"Summary Bonding Test","lang_code":"en"}]'::jsonb,
    '{"chapter_id": 90008101, "subjects": []}'::jsonb, NOW(), NOW()),
  (90009011, 'problem', NULL, 'SUM-P-1', NULL, '{}'::jsonb, NOW(), NOW()),
  (90009012, 'problem', NULL, 'SUM-P-2', NULL, '{}'::jsonb, NOW(), NOW()),
  (90009013, 'problem', NULL, 'SUM-P-3', NULL, '{}'::jsonb, NOW(), NOW())
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
  (90009021, 90009011, 90007502, NOW(), NOW()),
  (90009022, 90009012, 90007502, NOW(), NOW()),
  (90009023, 90009013, 90007501, NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.session
  (id, name, platform, start_time, end_time, is_active, meta_data, inserted_at, updated_at)
VALUES
  -- Anand Shared: Alpha ended 2 Jul. The CMS test id is only in cms_source_id (cms_test_id holds
  -- a CMS page URL, as Session Manager writes it).
  (90009101, 'Summary Alpha Chapter Test', 'quiz', TIMESTAMP '2026-07-02 10:00:00', TIMESTAMP '2026-07-02 11:00:00', true,
    '{"cms_source": "nex-gen-cms", "test_format": "chapter_test", "status": "success", "grade": 11, "batch_id": "SUMB-81-NODAL-11", "cms_test_id": "https://cms.example/tests/90009001", "cms_source_id": "90009001"}'::jsonb,
    NOW(), NOW()),
  -- Anand Shared: Beta (majority of the test's problems) is scheduled for 20 Aug.
  (90009102, 'Summary Majority Chapter Test', 'quiz', TIMESTAMP '2026-08-20 10:00:00', TIMESTAMP '2026-08-20 11:00:00', true,
    '{"cms_source": "nex-gen-cms", "test_format": "chapter_test", "status": "success", "grade": 11, "batch_id": "SUMB-81-NODAL-11", "cms_test_id": "90009002", "cms_source_id": "90009002"}'::jsonb,
    NOW(), NOW()),
  -- Anand Shared: Chem Bonding, attributed by the Chapter code leading the session name; ended 20 Jul.
  (90009103, 'SUM-CH01 - Summary Bonding Chapter Test', 'quiz', TIMESTAMP '2026-07-20 10:00:00', TIMESTAMP '2026-07-20 11:00:00', true,
    '{"cms_source": "nex-gen-cms", "test_format": "chapter_test", "status": "success", "grade": 11, "batch_id": "SUMB-81-NODAL-11", "cms_test_id": "90009003", "cms_source_id": "90009003"}'::jsonb,
    NOW(), NOW()),
  -- Anand Shared: Bio Cells through the duplicate Chapter row; ended 20 Jun.
  (90009104, 'Summary Cells Chapter Test', 'quiz', TIMESTAMP '2026-06-20 10:00:00', TIMESTAMP '2026-06-20 11:00:00', true,
    '{"cms_source": "nex-gen-cms", "test_format": "chapter_test", "status": "success", "grade": 11, "batch_id": "SUMB-81-NODAL-11", "cms_test_id": "90009004", "cms_source_id": "90009004"}'::jsonb,
    NOW(), NOW()),
  -- Anand Shared: Bio Plants sessions that never count (inactive, failed, combined chapter test,
  -- legacy CMS, started before 1 Apr 2026). Bio Plants stays Overdue.
  (90009105, 'Summary Plants Inactive', 'quiz', TIMESTAMP '2026-07-12 10:00:00', TIMESTAMP '2026-07-12 11:00:00', false,
    '{"cms_source": "nex-gen-cms", "test_format": "chapter_test", "status": "success", "grade": 11, "batch_id": "SUMB-81-NODAL-11", "cms_test_id": "90009005", "cms_source_id": "90009005"}'::jsonb,
    NOW(), NOW()),
  (90009106, 'Summary Plants Failed', 'quiz', TIMESTAMP '2026-07-12 10:00:00', TIMESTAMP '2026-07-12 11:00:00', true,
    '{"cms_source": "nex-gen-cms", "test_format": "chapter_test", "status": "failed", "grade": 11, "batch_id": "SUMB-81-NODAL-11", "cms_test_id": "90009005", "cms_source_id": "90009005"}'::jsonb,
    NOW(), NOW()),
  (90009107, 'Summary Plants Combined', 'quiz', TIMESTAMP '2026-07-12 10:00:00', TIMESTAMP '2026-07-12 11:00:00', true,
    '{"cms_source": "nex-gen-cms", "test_format": "combined_chapter_test", "status": "success", "grade": 11, "batch_id": "SUMB-81-NODAL-11", "cms_test_id": "90009005", "cms_source_id": "90009005"}'::jsonb,
    NOW(), NOW()),
  (90009108, 'Summary Plants Legacy CMS', 'quiz', TIMESTAMP '2026-07-12 10:00:00', TIMESTAMP '2026-07-12 11:00:00', true,
    '{"test_format": "chapter_test", "status": "success", "grade": 11, "batch_id": "SUMB-81-NODAL-11", "cms_test_id": "90009005", "cms_source_id": "90009005"}'::jsonb,
    NOW(), NOW()),
  (90009109, 'Summary Plants Last Year', 'quiz', TIMESTAMP '2026-03-25 10:00:00', TIMESTAMP '2026-03-25 11:00:00', true,
    '{"cms_source": "nex-gen-cms", "test_format": "chapter_test", "status": "success", "grade": 11, "batch_id": "SUMB-81-NODAL-11", "cms_test_id": "90009005", "cms_source_id": "90009005"}'::jsonb,
    NOW(), NOW()),
  -- Anand Main and Bhuj Neet (two Centres, one session): Alpha ended 5 Jul.
  (90009110, 'Summary Alpha Multi-Centre Test', 'quiz', TIMESTAMP '2026-07-05 10:00:00', TIMESTAMP '2026-07-05 11:00:00', true,
    '{"cms_source": "nex-gen-cms", "test_format": "chapter_test", "status": "success", "grade": 11, "batch_id": "SUMB-81-COE-11, SUMB-82-COE-11", "cms_test_id": "90009001", "cms_source_id": "90009001"}'::jsonb,
    NOW(), NOW()),
  -- Bhuj Neet: Chem Bonding has started but has no end time, so it is Scheduled.
  (90009111, 'Summary Bonding Open Test', 'quiz', TIMESTAMP '2026-07-25 10:00:00', NULL, true,
    '{"cms_source": "nex-gen-cms", "test_format": "chapter_test", "status": "success", "grade": 11, "batch_id": "SUMB-82-COE-11", "cms_test_id": "90009006", "cms_source_id": "90009006"}'::jsonb,
    NOW(), NOW()),
  -- Surat Draft (No plan): Alpha ends late on the as-of day (Conducted); Beta is still to come.
  (90009112, 'Summary Surat Alpha Test', 'quiz', TIMESTAMP '2026-08-15 22:00:00', TIMESTAMP '2026-08-15 23:30:00', true,
    '{"cms_source": "nex-gen-cms", "test_format": "chapter_test", "status": "success", "grade": 11, "batch_id": "SUMB-83-NODAL-11", "cms_test_id": "90009001", "cms_source_id": "90009001"}'::jsonb,
    NOW(), NOW()),
  (90009113, 'Summary Surat Majority Test', 'quiz', TIMESTAMP '2026-08-20 10:00:00', TIMESTAMP '2026-08-20 11:00:00', true,
    '{"cms_source": "nex-gen-cms", "test_format": "chapter_test", "status": "success", "grade": 11, "batch_id": "SUMB-83-NODAL-11", "cms_test_id": "90009002", "cms_source_id": "90009002"}'::jsonb,
    NOW(), NOW())
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  platform = EXCLUDED.platform,
  start_time = EXCLUDED.start_time,
  end_time = EXCLUDED.end_time,
  is_active = EXCLUDED.is_active,
  meta_data = EXCLUDED.meta_data,
  updated_at = NOW();
