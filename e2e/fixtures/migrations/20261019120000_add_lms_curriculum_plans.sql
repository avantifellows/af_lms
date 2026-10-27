-- Mirrors the db-service migration for Curriculum Plans (#417 / #420). db-service owns the
-- production schema (ADR 0001); this file only lets e2e run against the same shape.
CREATE TABLE IF NOT EXISTS public.lms_curriculum_plans (
    id bigserial PRIMARY KEY,
    title text NOT NULL CHECK (btrim(title) <> ''),
    academic_year text NOT NULL CHECK (
      academic_year ~ '^\d{4}-\d{4}$'
      AND split_part(academic_year, '-', 2)::integer = split_part(academic_year, '-', 1)::integer + 1
    ),
    grade_id bigint NOT NULL REFERENCES public.grade(id),
    exam_tracks text[] NOT NULL CHECK (
      cardinality(exam_tracks) > 0
      AND exam_tracks <@ ARRAY['jee_main', 'jee_advanced', 'neet']::text[]
    ),
    status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active')),
    closure_date date NOT NULL,
    activated_at timestamp without time zone,
    inserted_by_email text,
    updated_by_email text,
    inserted_at timestamp without time zone NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
    updated_at timestamp without time zone NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC')
);

CREATE INDEX IF NOT EXISTS lms_curriculum_plans_academic_year_grade_index
  ON public.lms_curriculum_plans (academic_year, grade_id);

CREATE TABLE IF NOT EXISTS public.lms_curriculum_plan_chapters (
    id bigserial PRIMARY KEY,
    plan_id bigint NOT NULL REFERENCES public.lms_curriculum_plans(id) ON DELETE CASCADE,
    chapter_id bigint NOT NULL REFERENCES public.chapter(id),
    due_date date,
    test_date date,
    inserted_by_email text,
    updated_by_email text,
    inserted_at timestamp without time zone NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
    updated_at timestamp without time zone NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
    CONSTRAINT lms_curriculum_plan_chapters_test_date_requires_due_date
      CHECK (test_date IS NULL OR due_date IS NOT NULL),
    CONSTRAINT lms_curriculum_plan_chapters_plan_id_chapter_id_index
      UNIQUE (plan_id, chapter_id)
);

CREATE TABLE IF NOT EXISTS public.lms_curriculum_plan_assignments (
    id bigserial PRIMARY KEY,
    plan_id bigint NOT NULL REFERENCES public.lms_curriculum_plans(id) ON DELETE CASCADE,
    centre_id bigint NOT NULL REFERENCES public.centres(id),
    grade_id bigint NOT NULL REFERENCES public.grade(id),
    academic_year text NOT NULL,
    inserted_by_email text,
    updated_by_email text,
    inserted_at timestamp without time zone NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
    updated_at timestamp without time zone NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
    CONSTRAINT lms_curriculum_plan_assignments_centre_grade_year_index
      UNIQUE (centre_id, grade_id, academic_year)
);

CREATE INDEX IF NOT EXISTS lms_curriculum_plan_assignments_plan_id_index
  ON public.lms_curriculum_plan_assignments (plan_id);
