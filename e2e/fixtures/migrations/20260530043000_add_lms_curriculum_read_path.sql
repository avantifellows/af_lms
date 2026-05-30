CREATE TABLE IF NOT EXISTS public.lms_chapter_exam_configs (
    id bigserial PRIMARY KEY,
    chapter_id bigint NOT NULL REFERENCES public.chapter(id),
    exam_track character varying(32) NOT NULL,
    is_in_syllabus boolean NOT NULL DEFAULT true,
    prescribed_minutes integer NOT NULL DEFAULT 0,
    coverage_sequence integer NOT NULL,
    inserted_by_email character varying(255),
    updated_by_email character varying(255),
    inserted_at timestamp(0) without time zone NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
    updated_at timestamp(0) without time zone NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
    CONSTRAINT lms_chapter_exam_configs_exam_track_check
      CHECK (exam_track IN ('jee_main', 'jee_advanced', 'neet')),
    CONSTRAINT lms_chapter_exam_configs_prescribed_minutes_check
      CHECK (prescribed_minutes >= 0),
    CONSTRAINT lms_chapter_exam_configs_coverage_sequence_check
      CHECK (coverage_sequence > 0),
    CONSTRAINT lms_chapter_exam_configs_out_of_syllabus_minutes_check
      CHECK (is_in_syllabus OR prescribed_minutes = 0),
    CONSTRAINT lms_chapter_exam_configs_chapter_track_unique
      UNIQUE (chapter_id, exam_track)
);

CREATE TABLE IF NOT EXISTS public.lms_curriculum_logs (
    id bigserial PRIMARY KEY,
    school_code character varying(255) NOT NULL,
    program_id bigint NOT NULL REFERENCES public.program(id),
    grade_id bigint NOT NULL REFERENCES public.grade(id),
    subject_id bigint NOT NULL REFERENCES public.subject(id),
    exam_track character varying(32) NOT NULL,
    log_date date NOT NULL,
    duration_minutes integer NOT NULL,
    created_by_email character varying(255),
    inserted_by_email character varying(255),
    updated_by_email character varying(255),
    deleted_at timestamp(0) without time zone,
    inserted_at timestamp(0) without time zone NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
    updated_at timestamp(0) without time zone NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
    CONSTRAINT lms_curriculum_logs_exam_track_check
      CHECK (exam_track IN ('jee_main', 'jee_advanced', 'neet')),
    CONSTRAINT lms_curriculum_logs_duration_minutes_check
      CHECK (duration_minutes > 0 AND duration_minutes <= 720)
);

CREATE TABLE IF NOT EXISTS public.lms_curriculum_log_topics (
    id bigserial PRIMARY KEY,
    curriculum_log_id bigint NOT NULL REFERENCES public.lms_curriculum_logs(id),
    topic_id bigint NOT NULL REFERENCES public.topic(id),
    inserted_at timestamp(0) without time zone NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
    updated_at timestamp(0) without time zone NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
    CONSTRAINT lms_curriculum_log_topics_log_topic_unique
      UNIQUE (curriculum_log_id, topic_id)
);

CREATE TABLE IF NOT EXISTS public.lms_curriculum_chapter_completions (
    id bigserial PRIMARY KEY,
    school_code character varying(255) NOT NULL,
    program_id bigint NOT NULL REFERENCES public.program(id),
    chapter_id bigint NOT NULL REFERENCES public.chapter(id),
    exam_track character varying(32) NOT NULL,
    completed_at timestamp(0) without time zone NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
    completed_by_email character varying(255),
    inserted_by_email character varying(255),
    updated_by_email character varying(255),
    deleted_at timestamp(0) without time zone,
    inserted_at timestamp(0) without time zone NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
    updated_at timestamp(0) without time zone NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
    CONSTRAINT lms_curriculum_chapter_completions_exam_track_check
      CHECK (exam_track IN ('jee_main', 'jee_advanced', 'neet'))
);

CREATE INDEX IF NOT EXISTS lms_curriculum_logs_active_scope_index
  ON public.lms_curriculum_logs (school_code, program_id, grade_id, subject_id, exam_track)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS lms_curriculum_log_topics_log_id_index
  ON public.lms_curriculum_log_topics (curriculum_log_id);

CREATE UNIQUE INDEX IF NOT EXISTS lms_curriculum_chapter_completions_active_unique
  ON public.lms_curriculum_chapter_completions
    (school_code, program_id, chapter_id, exam_track)
  WHERE deleted_at IS NULL;

INSERT INTO public.program
  (id, name, product_id, inserted_at, updated_at)
VALUES
  (1, 'JNV CoE', 1, NOW(), NOW()),
  (2, 'JNV Nodal', 1, NOW(), NOW()),
  (64, 'JNV NVS', 1, NOW(), NOW())
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  updated_at = NOW();

INSERT INTO public.grade (id, number, inserted_at, updated_at)
VALUES
  (3, 11, NOW(), NOW()),
  (4, 12, NOW(), NOW())
ON CONFLICT (id) DO UPDATE SET
  number = EXCLUDED.number,
  updated_at = NOW();

INSERT INTO public.subject (id, code, inserted_at, updated_at, name)
VALUES
  (2, 'chemistry', NOW(), NOW(), '[{"subject":"Chemistry","lang_code":"en"}]'::jsonb),
  (3, 'biology', NOW(), NOW(), '[{"subject":"Biology","lang_code":"en"}]'::jsonb),
  (4, 'physics', NOW(), NOW(), '[{"subject":"Physics","lang_code":"en"}]'::jsonb)
ON CONFLICT (id) DO UPDATE SET
  code = EXCLUDED.code,
  name = EXCLUDED.name,
  updated_at = NOW();

INSERT INTO public.school
  (id, code, name, inserted_at, updated_at, udise_code, af_school_category, region, state, district, program_ids)
VALUES
  (900075, 'LMS75', 'LMS Fixture School', NOW(), NOW(), '75000000075', 'JNV', 'AHMEDABAD', 'Gujarat', 'Ahmedabad', ARRAY[1, 2, 64]::integer[]),
  (900076, 'LMS75EMPTY', 'LMS Empty Program Fixture School', NOW(), NOW(), '75000000076', 'JNV', 'AHMEDABAD', 'Gujarat', 'Ahmedabad', ARRAY[64]::integer[])
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

INSERT INTO public.chapter
  (id, code, grade_id, subject_id, inserted_at, updated_at, name)
VALUES
  (90007501, 'LMS75-PH01', 3, 4, NOW(), NOW(), '[{"chapter":"Fixture Alpha Physics","lang_code":"en"}]'::jsonb),
  (90007502, 'LMS75-PH02', 3, 4, NOW(), NOW(), '[{"chapter":"Fixture Beta Physics","lang_code":"en"}]'::jsonb),
  (90007503, 'LMS75-CH01', 3, 2, NOW(), NOW(), '[{"chapter":"Fixture Chemistry","lang_code":"en"}]'::jsonb),
  (90007504, 'LMS75-BIO01', 4, 3, NOW(), NOW(), '[{"chapter":"Fixture Biology","lang_code":"en"}]'::jsonb)
ON CONFLICT (id) DO UPDATE SET
  code = EXCLUDED.code,
  grade_id = EXCLUDED.grade_id,
  subject_id = EXCLUDED.subject_id,
  name = EXCLUDED.name,
  updated_at = NOW();

INSERT INTO public.topic
  (id, code, chapter_id, inserted_at, updated_at, name)
VALUES
  (900075011, 'LMS75-PH01-T01', 90007501, NOW(), NOW(), '[{"topic":"Alpha Motion","lang_code":"en"}]'::jsonb),
  (900075021, 'LMS75-PH02-T01', 90007502, NOW(), NOW(), '[{"topic":"Beta Forces","lang_code":"en"}]'::jsonb),
  (900075031, 'LMS75-CH01-T01', 90007503, NOW(), NOW(), '[{"topic":"Chemical Fixture","lang_code":"en"}]'::jsonb),
  (900075041, 'LMS75-BIO01-T01', 90007504, NOW(), NOW(), '[{"topic":"Biology Fixture","lang_code":"en"}]'::jsonb)
ON CONFLICT (id) DO UPDATE SET
  code = EXCLUDED.code,
  chapter_id = EXCLUDED.chapter_id,
  name = EXCLUDED.name,
  updated_at = NOW();

INSERT INTO public.lms_chapter_exam_configs
  (chapter_id, exam_track, is_in_syllabus, prescribed_minutes, coverage_sequence, inserted_by_email, updated_by_email)
VALUES
  (90007501, 'jee_main', true, 90, 1, 'e2e@avantifellows.org', 'e2e@avantifellows.org'),
  (90007502, 'jee_main', true, 120, 1, 'e2e@avantifellows.org', 'e2e@avantifellows.org'),
  (90007501, 'jee_advanced', true, 150, 2, 'e2e@avantifellows.org', 'e2e@avantifellows.org'),
  (90007503, 'jee_advanced', false, 0, 3, 'e2e@avantifellows.org', 'e2e@avantifellows.org'),
  (90007504, 'neet', true, 180, 1, 'e2e@avantifellows.org', 'e2e@avantifellows.org')
ON CONFLICT (chapter_id, exam_track) DO UPDATE SET
  is_in_syllabus = EXCLUDED.is_in_syllabus,
  prescribed_minutes = EXCLUDED.prescribed_minutes,
  coverage_sequence = EXCLUDED.coverage_sequence,
  updated_by_email = EXCLUDED.updated_by_email,
  updated_at = NOW();
