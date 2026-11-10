-- Mirrors db-service 20261110120000_add_blended_learning_jee_form_updates
-- (pg_dump-identical; see patterns/mirror-db-service-schema-in-e2e.md): the
-- append-only JEE form updates, Mentor Flags raised by a not-filled update
-- (recipient 'jee_form', no Conversation) and Action Items completed by a
-- filled one.

CREATE FUNCTION public.blended_learning_protect_jee_form_update() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION 'Blended Learning JEE form updates are append-only'
    USING ERRCODE = '23514';
END;
$$;

CREATE TABLE public.blended_learning_jee_form_updates (
    id bigserial PRIMARY KEY,
    student_id bigint NOT NULL,
    exam_id bigint NOT NULL,
    exam_year integer NOT NULL,
    status character varying(255) NOT NULL,
    application_number character varying(255),
    confirmation_document_id bigint,
    reasons character varying(255)[],
    details text,
    mentor_user_id bigint NOT NULL,
    program_id bigint NOT NULL,
    academic_year character varying(255) NOT NULL,
    recorded_by_email character varying(255) NOT NULL,
    inserted_at timestamp(0) without time zone DEFAULT now() NOT NULL,
    CONSTRAINT blended_learning_jee_form_updates_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.student(id),
    CONSTRAINT blended_learning_jee_form_updates_exam_id_fkey FOREIGN KEY (exam_id) REFERENCES public.exam(id),
    CONSTRAINT blended_learning_jee_form_updates_confirmation_document_id_fkey
      FOREIGN KEY (confirmation_document_id) REFERENCES public.lms_student_documents(id),
    CONSTRAINT blended_learning_jee_form_updates_mentor_user_id_fkey FOREIGN KEY (mentor_user_id) REFERENCES public."user"(id),
    CONSTRAINT blended_learning_jee_form_updates_program_id_fkey FOREIGN KEY (program_id) REFERENCES public.program(id)
);

CREATE INDEX bl_jee_form_updates_student_exam_idx
  ON public.blended_learning_jee_form_updates (student_id, exam_id, exam_year, id DESC);
CREATE UNIQUE INDEX bl_jee_form_updates_id_student_unique
  ON public.blended_learning_jee_form_updates (id, student_id);

ALTER TABLE public.blended_learning_jee_form_updates
  ADD CONSTRAINT bl_jee_form_updates_status_check CHECK (status IN ('filled', 'not_filled')),
  ADD CONSTRAINT bl_jee_form_updates_exam_year_check CHECK (exam_year BETWEEN 2000 AND 2100),
  ADD CONSTRAINT bl_jee_form_updates_status_fields_check CHECK (
    (
      status = 'filled'
      AND application_number IS NOT NULL
      AND application_number ~ '[^[:space:]]'
      AND reasons IS NULL
      AND details IS NULL
    )
    OR (
      status = 'not_filled'
      AND application_number IS NULL
      AND confirmation_document_id IS NULL
      AND reasons IS NOT NULL
      AND cardinality(reasons) >= 1
      AND array_position(reasons, NULL) IS NULL
      AND reasons <@ ARRAY['certificate_not_available', 'document_issue', 'form_difficulty', 'awaiting_parent_salary', 'personal_issues', 'not_interested', 'not_prepared', 'phase_two', 'not_sharing_details', 'not_aware', 'other']::varchar[]
      AND (NOT ('other' = ANY(reasons)) OR details IS NOT NULL)
    )
  ),
  ADD CONSTRAINT bl_jee_form_updates_details_check
    CHECK (details IS NULL OR (details ~ '[^[:space:]]' AND char_length(details) <= 2000)),
  ADD CONSTRAINT bl_jee_form_updates_academic_year_check CHECK (academic_year ~ '[^[:space:]]'),
  ADD CONSTRAINT bl_jee_form_updates_recorded_by_email_check CHECK (recorded_by_email ~ '[^[:space:]]');

CREATE TRIGGER bl_jee_form_updates_immutable
BEFORE UPDATE OR DELETE ON public.blended_learning_jee_form_updates
FOR EACH ROW EXECUTE FUNCTION public.blended_learning_protect_jee_form_update();

ALTER TABLE public.blended_learning_mentor_flags
  ADD COLUMN jee_form_update_id bigint,
  ADD CONSTRAINT blended_learning_mentor_flags_jee_form_update_id_fkey
    FOREIGN KEY (jee_form_update_id, student_id) REFERENCES public.blended_learning_jee_form_updates(id, student_id);

CREATE UNIQUE INDEX bl_mentor_flags_jee_form_update_unique
  ON public.blended_learning_mentor_flags (jee_form_update_id) WHERE jee_form_update_id IS NOT NULL;

ALTER TABLE public.blended_learning_mentor_flags ALTER COLUMN conversation_id DROP NOT NULL;
ALTER TABLE public.blended_learning_mentor_flags DROP CONSTRAINT bl_mentor_flags_recipient_check;
ALTER TABLE public.blended_learning_mentor_flags ADD CONSTRAINT bl_mentor_flags_recipient_check
  CHECK (recipient IN ('emotional_wellbeing', 'physics', 'chemistry', 'maths', 'jee_form'));
ALTER TABLE public.blended_learning_mentor_flags ADD CONSTRAINT bl_mentor_flags_source_check CHECK (
  (conversation_id IS NOT NULL AND jee_form_update_id IS NULL AND recipient <> 'jee_form')
  OR (conversation_id IS NULL AND jee_form_update_id IS NOT NULL AND recipient = 'jee_form')
);

-- Ecto's name, which Postgres truncates to 63 characters as db-service's does.
ALTER TABLE public.blended_learning_action_items
  ADD COLUMN completed_by_jee_form_update_id bigint,
  ADD CONSTRAINT blended_learning_action_items_completed_by_jee_form_update_id_fkey
    FOREIGN KEY (completed_by_jee_form_update_id, student_id)
    REFERENCES public.blended_learning_jee_form_updates(id, student_id);

ALTER TABLE public.blended_learning_action_items DROP CONSTRAINT bl_action_items_completion_check;
ALTER TABLE public.blended_learning_action_items ADD CONSTRAINT bl_action_items_completion_check CHECK (
  (
    status = 'open'
    AND completed_by_conversation_id IS NULL
    AND completed_by_jee_form_update_id IS NULL
    AND completed_at IS NULL
    AND completed_by_email IS NULL
  )
  OR (
    status <> 'open'
    AND (completed_by_conversation_id IS NOT NULL)
      <> (completed_by_jee_form_update_id IS NOT NULL)
    AND completed_at IS NOT NULL
    AND completed_by_email IS NOT NULL
  )
);
