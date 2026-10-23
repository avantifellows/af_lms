-- Mirrors the db-service migration that lets Curriculum Plans serve CET and indexes the
-- plan tables' remaining foreign keys. db-service owns the production schema (ADR 0001).
ALTER TABLE public.lms_curriculum_plans
  DROP CONSTRAINT lms_curriculum_plans_exam_tracks_check,
  ADD CONSTRAINT lms_curriculum_plans_exam_tracks_check CHECK (
    cardinality(exam_tracks) > 0
    AND exam_tracks <@ ARRAY['jee_main', 'jee_advanced', 'neet', 'cet']::text[]
  );

CREATE INDEX IF NOT EXISTS lms_curriculum_plans_grade_id_index
  ON public.lms_curriculum_plans (grade_id);

CREATE INDEX IF NOT EXISTS lms_curriculum_plan_chapters_chapter_id_index
  ON public.lms_curriculum_plan_chapters (chapter_id);

CREATE INDEX IF NOT EXISTS lms_curriculum_plan_assignments_grade_id_index
  ON public.lms_curriculum_plan_assignments (grade_id);
