-- Mirrors db-service 20261124143246_tie_jee_form_confirmation_to_same_student
-- (pg_dump-identical; see patterns/mirror-db-service-schema-in-e2e.md): a JEE form
-- update's confirmation must be a document of the same Student.
-- Re-runnable: IF NOT EXISTS, and the FK dropped before it is added again.

CREATE UNIQUE INDEX IF NOT EXISTS lms_student_documents_id_student_unique
  ON public.lms_student_documents (id, student_id);

ALTER TABLE public.blended_learning_jee_form_updates
  DROP CONSTRAINT IF EXISTS blended_learning_jee_form_updates_confirmation_document_id_fkey,
  ADD CONSTRAINT blended_learning_jee_form_updates_confirmation_document_id_fkey
    FOREIGN KEY (confirmation_document_id, student_id) REFERENCES public.lms_student_documents(id, student_id);
