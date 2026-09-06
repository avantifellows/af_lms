CREATE TABLE IF NOT EXISTS public.centre_exam_tracks (
  id bigserial PRIMARY KEY,
  centre_id bigint NOT NULL REFERENCES public.centres(id),
  grade_id bigint NOT NULL REFERENCES public.grade(id),
  exam_track_code character varying(255) NOT NULL,
  inserted_at timestamp(0) without time zone DEFAULT now() NOT NULL,
  updated_at timestamp(0) without time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS centre_exam_tracks_centre_grade_track_unique
  ON public.centre_exam_tracks (centre_id, grade_id, exam_track_code);

CREATE INDEX IF NOT EXISTS centre_exam_tracks_grade_id_index
  ON public.centre_exam_tracks (grade_id);
