-- Mirrors db-service migration
-- 20261112120442_create_blended_learning_mentor_supervisions
-- (branch feat/bl-supervisor-view): a team-lead Mentor (supervisor_user_id)
-- views, read-only, another Mentor's (mentor_user_id) Students for one
-- academic year. Same lifecycle and audit columns as the Mapping table.
-- Re-diff with .mex/patterns/mirror-db-service-schema-in-e2e.md if that
-- migration changes.

CREATE TABLE blended_learning_mentor_supervisions (
  id bigserial PRIMARY KEY,
  supervisor_user_id bigint NOT NULL CONSTRAINT blended_learning_mentor_supervisions_supervisor_user_id_fkey REFERENCES "user"(id),
  mentor_user_id bigint NOT NULL CONSTRAINT blended_learning_mentor_supervisions_mentor_user_id_fkey REFERENCES "user"(id),
  academic_year varchar(255) NOT NULL,
  started_at timestamp(0) NOT NULL,
  assigned_by_user_id bigint CONSTRAINT blended_learning_mentor_supervisions_assigned_by_user_id_fkey REFERENCES "user"(id),
  assigned_by_email varchar(255),
  assignment_source varchar(255) NOT NULL,
  assignment_audit_reason varchar(500),
  ended_at timestamp(0),
  ended_by_user_id bigint CONSTRAINT blended_learning_mentor_supervisions_ended_by_user_id_fkey REFERENCES "user"(id),
  ended_by_email varchar(255),
  end_source varchar(255),
  end_reason varchar(255),
  end_audit_reason varchar(500),
  inserted_at timestamp(0) NOT NULL DEFAULT now(),
  updated_at timestamp(0) NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX blm_supervisions_active_pair_year_unique
  ON blended_learning_mentor_supervisions (supervisor_user_id, mentor_user_id, academic_year)
  WHERE ended_at IS NULL;

CREATE INDEX blm_supervisions_active_mentor_year_idx
  ON blended_learning_mentor_supervisions (mentor_user_id, academic_year)
  WHERE ended_at IS NULL;

ALTER TABLE blended_learning_mentor_supervisions ADD CONSTRAINT blm_supervisions_not_self_check
  CHECK (supervisor_user_id <> mentor_user_id);

ALTER TABLE blended_learning_mentor_supervisions ADD CONSTRAINT blm_supervisions_lifecycle_check CHECK (
  assignment_source <> '' AND
  (
    ended_at IS NULL AND ended_by_user_id IS NULL AND ended_by_email IS NULL AND
    end_source IS NULL AND end_reason IS NULL AND end_audit_reason IS NULL
    OR
    ended_at IS NOT NULL AND end_source IS NOT NULL AND end_source <> '' AND
    end_reason IS NOT NULL AND end_reason <> '' AND ended_at >= started_at
  )
);

ALTER TABLE blended_learning_mentor_supervisions ADD CONSTRAINT blm_supervisions_audit_fields_check CHECK (
  (assigned_by_email IS NULL OR assigned_by_email ~ '[^[:space:]]') AND
  (assignment_audit_reason IS NULL OR assignment_audit_reason ~ '[^[:space:]]') AND
  (ended_by_email IS NULL OR ended_by_email ~ '[^[:space:]]') AND
  (end_audit_reason IS NULL OR end_audit_reason ~ '[^[:space:]]')
);
