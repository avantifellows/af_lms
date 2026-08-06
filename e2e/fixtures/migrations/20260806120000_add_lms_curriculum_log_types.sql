-- Mirrors the db-service migration that introduces LMS Curriculum Log types.
-- Production schema is owned by db-service; this fixture keeps the e2e database
-- in step so the curriculum schema preflight passes locally.
--
-- Regular Class keeps deriving its chapters from topics and keeps the 1-720
-- minute duration rule. Class Cancelled stores one Chapter directly and no
-- duration. doubt_solving is accepted by the constraint now so the follow-up
-- slice needs no second migration.

ALTER TABLE public.lms_curriculum_logs
  ADD COLUMN IF NOT EXISTS log_type character varying(32) NOT NULL DEFAULT 'regular';

ALTER TABLE public.lms_curriculum_logs
  ADD COLUMN IF NOT EXISTS chapter_id bigint REFERENCES public.chapter(id);

ALTER TABLE public.lms_curriculum_logs
  ALTER COLUMN duration_minutes DROP NOT NULL;

ALTER TABLE public.lms_curriculum_logs
  DROP CONSTRAINT IF EXISTS lms_curriculum_logs_log_type_check;

ALTER TABLE public.lms_curriculum_logs
  ADD CONSTRAINT lms_curriculum_logs_log_type_check
    CHECK (log_type IN ('regular', 'class_cancelled', 'doubt_solving'));

ALTER TABLE public.lms_curriculum_logs
  DROP CONSTRAINT IF EXISTS lms_curriculum_logs_duration_minutes_check;

ALTER TABLE public.lms_curriculum_logs
  ADD CONSTRAINT lms_curriculum_logs_duration_minutes_check
    CHECK (
      CASE log_type
        WHEN 'class_cancelled' THEN duration_minutes IS NULL
        ELSE duration_minutes > 0 AND duration_minutes <= 720
      END
    );

ALTER TABLE public.lms_curriculum_logs
  DROP CONSTRAINT IF EXISTS lms_curriculum_logs_chapter_id_check;

ALTER TABLE public.lms_curriculum_logs
  ADD CONSTRAINT lms_curriculum_logs_chapter_id_check
    CHECK (
      CASE log_type
        WHEN 'regular' THEN chapter_id IS NULL
        ELSE chapter_id IS NOT NULL
      END
    );

-- At most one active Class Cancelled log per scope + Chapter + date.
CREATE UNIQUE INDEX IF NOT EXISTS lms_curriculum_logs_active_class_cancelled_unique
  ON public.lms_curriculum_logs
    (school_code, program_id, grade_id, subject_id, exam_track, chapter_id, log_date)
  WHERE log_type = 'class_cancelled' AND deleted_at IS NULL;
