-- Mirrors db-service 20261116085521_add_application_password_ciphertext_to_student_exam_record
-- and 20261116090707_create_lms_exam_password_reveals (pg_dump-identical; see
-- patterns/mirror-db-service-schema-in-e2e.md), which db-dump.sql predates:
-- the exam-portal password as AF LMS's KMS ciphertext, and the append-only log
-- of every reveal.

ALTER TABLE public.student_exam_record ADD COLUMN application_password_ciphertext text;

CREATE TABLE public.lms_exam_password_reveals (
    id bigserial PRIMARY KEY,
    student_id bigint NOT NULL CONSTRAINT lms_exam_password_reveals_student_id_fkey REFERENCES public.student(id),
    student_exam_record_id bigint NOT NULL,
    exam_id bigint NOT NULL CONSTRAINT lms_exam_password_reveals_exam_id_fkey REFERENCES public.exam(id),
    viewer_email text NOT NULL,
    viewer_role text NOT NULL,
    inserted_at timestamp(0) without time zone DEFAULT now() NOT NULL
);

CREATE INDEX lms_exam_password_reveals_student_id_inserted_at_index
    ON public.lms_exam_password_reveals USING btree (student_id, inserted_at);
CREATE INDEX lms_exam_password_reveals_viewer_email_inserted_at_index
    ON public.lms_exam_password_reveals USING btree (viewer_email, inserted_at);

ALTER TABLE public.lms_exam_password_reveals
    ADD CONSTRAINT lms_exam_password_reveals_viewer_check CHECK (
      viewer_email ~ '[^[:space:]]' AND viewer_email = lower(viewer_email) AND
      viewer_role ~ '[^[:space:]]'
    );

CREATE FUNCTION public.lms_protect_exam_password_reveals() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION 'Exam password reveals are append-only'
    USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER lms_exam_password_reveals_append_only
    BEFORE UPDATE OR DELETE ON public.lms_exam_password_reveals
    FOR EACH ROW EXECUTE FUNCTION public.lms_protect_exam_password_reveals();
