-- Mirrors db-service 20260528120000_create_lms_student_documents_table, which
-- db-dump.sql predates. The JEE form card stores its confirmation page here
-- (through the DB Service, which e2e stubs). Proven pg_dump-identical with
-- patterns/mirror-db-service-schema-in-e2e.md.

CREATE TABLE public.lms_student_documents (
    id bigserial PRIMARY KEY,
    student_id bigint NOT NULL,
    document_type character varying(50) NOT NULL,
    pages jsonb DEFAULT '[]'::jsonb NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    uploaded_by character varying(255) NOT NULL,
    deleted_at timestamp(0) without time zone,
    inserted_at timestamp(0) without time zone DEFAULT (now() AT TIME ZONE 'UTC') NOT NULL,
    updated_at timestamp(0) without time zone DEFAULT (now() AT TIME ZONE 'UTC') NOT NULL,
    CONSTRAINT lms_student_documents_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.student(id)
);

CREATE INDEX lms_student_documents_student_id_index ON public.lms_student_documents (student_id);
CREATE INDEX lms_student_documents_document_type_index ON public.lms_student_documents (document_type);
CREATE INDEX lms_student_documents_student_id_document_type_index
  ON public.lms_student_documents (student_id, document_type);
CREATE INDEX lms_student_documents_active_idx
  ON public.lms_student_documents (student_id, document_type) WHERE deleted_at IS NULL;
