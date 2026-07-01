ALTER TABLE public.student
  ADD COLUMN IF NOT EXISTS g10_board character varying(255),
  ADD COLUMN IF NOT EXISTS g10_roll_no character varying(255);

CREATE TABLE IF NOT EXISTS public.lms_student_write_audits (
  id bigserial PRIMARY KEY,
  action character varying(255) NOT NULL,
  actor_user_id integer,
  actor_email character varying(255),
  actor_login_type character varying(255),
  actor_role character varying(255),
  school_code character varying(255),
  school_udise_code character varying(255),
  program_id integer,
  upload_id character varying(255),
  upload_filename character varying(255),
  row_number integer,
  row_counts jsonb DEFAULT '{}'::jsonb NOT NULL,
  affected_identifiers jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_values jsonb DEFAULT '{}'::jsonb NOT NULL,
  changed_values jsonb DEFAULT '{}'::jsonb NOT NULL,
  inserted_at timestamp(0) without time zone DEFAULT now() NOT NULL,
  updated_at timestamp(0) without time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS lms_student_write_audits_upload_id_index
  ON public.lms_student_write_audits (upload_id);

CREATE INDEX IF NOT EXISTS lms_student_write_audits_school_code_index
  ON public.lms_student_write_audits (school_code);
