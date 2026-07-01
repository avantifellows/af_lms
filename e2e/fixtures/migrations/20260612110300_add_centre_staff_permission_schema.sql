ALTER TABLE public.user_permission
  ADD COLUMN IF NOT EXISTS user_id bigint REFERENCES public."user"(id),
  ADD COLUMN IF NOT EXISTS revoked_at timestamp(0) without time zone;

CREATE INDEX IF NOT EXISTS user_permission_user_id_index
  ON public.user_permission (user_id);

CREATE TABLE IF NOT EXISTS public.centre_option_sets (
  id bigserial PRIMARY KEY,
  code character varying(255) NOT NULL,
  label character varying(255) NOT NULL,
  allow_multi boolean DEFAULT false NOT NULL,
  sort_order integer DEFAULT 0 NOT NULL,
  inserted_at timestamp(0) without time zone DEFAULT now() NOT NULL,
  updated_at timestamp(0) without time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS centre_option_sets_code_unique
  ON public.centre_option_sets (code);

CREATE TABLE IF NOT EXISTS public.centre_options (
  id bigserial PRIMARY KEY,
  option_set_id bigint NOT NULL REFERENCES public.centre_option_sets(id),
  code character varying(255) NOT NULL,
  label character varying(255) NOT NULL,
  sort_order integer DEFAULT 0 NOT NULL,
  is_active boolean DEFAULT true NOT NULL,
  inserted_at timestamp(0) without time zone DEFAULT now() NOT NULL,
  updated_at timestamp(0) without time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS centre_options_option_set_code_unique
  ON public.centre_options (option_set_id, code);

CREATE INDEX IF NOT EXISTS centre_options_option_set_id_index
  ON public.centre_options (option_set_id);

CREATE TABLE IF NOT EXISTS public.centres (
  id bigserial PRIMARY KEY,
  name character varying(255) NOT NULL,
  school_id bigint REFERENCES public.school(id),
  type_code character varying(255),
  category_code character varying(255),
  sub_category_code character varying(255),
  stream_codes text[] DEFAULT '{}'::text[] NOT NULL,
  is_physical boolean DEFAULT false NOT NULL,
  is_active boolean DEFAULT true NOT NULL,
  program_id bigint REFERENCES public.program(id),
  inserted_at timestamp(0) without time zone DEFAULT now() NOT NULL,
  updated_at timestamp(0) without time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS centres_school_id_index
  ON public.centres (school_id);

CREATE INDEX IF NOT EXISTS centres_type_code_index
  ON public.centres (type_code);

CREATE INDEX IF NOT EXISTS centres_category_code_index
  ON public.centres (category_code);

CREATE INDEX IF NOT EXISTS centres_sub_category_code_index
  ON public.centres (sub_category_code);

CREATE INDEX IF NOT EXISTS centres_stream_codes_index
  ON public.centres USING gin (stream_codes);

CREATE INDEX IF NOT EXISTS centres_program_id_index
  ON public.centres (program_id);

CREATE TABLE IF NOT EXISTS public.staff (
  id bigserial PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES public."user"(id),
  employee_code character varying(255) NOT NULL,
  staff_type character varying(255) NOT NULL,
  designation character varying(255),
  exit_date date,
  inserted_at timestamp(0) without time zone DEFAULT now() NOT NULL,
  updated_at timestamp(0) without time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS staff_employee_code_index
  ON public.staff (employee_code);

CREATE UNIQUE INDEX IF NOT EXISTS staff_user_id_index
  ON public.staff (user_id);

CREATE INDEX IF NOT EXISTS staff_staff_type_index
  ON public.staff (staff_type);

CREATE TABLE IF NOT EXISTS public.centre_positions (
  id bigserial PRIMARY KEY,
  centre_id bigint NOT NULL REFERENCES public.centres(id),
  role character varying(255) NOT NULL,
  user_id bigint REFERENCES public."user"(id),
  hr_code character varying(255),
  notes text,
  deleted_at timestamp(0) without time zone,
  inserted_at timestamp(0) without time zone DEFAULT now() NOT NULL,
  updated_at timestamp(0) without time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS centre_positions_centre_id_index
  ON public.centre_positions (centre_id);

CREATE INDEX IF NOT EXISTS centre_positions_user_id_index
  ON public.centre_positions (user_id);

CREATE UNIQUE INDEX IF NOT EXISTS centre_positions_active_assignment_unique
  ON public.centre_positions (centre_id, role, user_id)
  WHERE deleted_at IS NULL AND user_id IS NOT NULL;
