-- Mirrors db-service migration
-- 20261123120000_harden_blended_learning_mapping_tables
-- (branch fix/bl-mapping-table-hardening): on the Mapping and Supervision
-- tables, academic_year must be YYYY-YYYY with consecutive years, source and
-- reason text can't be whitespace only, an ended row names who ended it (except
-- a Mapping the db-service dropout cleanup ends), [started_at, ended_at)
-- periods can't overlap, and updated_at moves on every UPDATE that changes the
-- row. Every statement is re-runnable.
-- Re-diff with .mex/patterns/mirror-db-service-schema-in-e2e.md if that
-- migration changes.

CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE blended_learning_mentor_mentee_mappings DROP CONSTRAINT IF EXISTS blm_mappings_academic_year_format_check;
ALTER TABLE blended_learning_mentor_mentee_mappings ADD CONSTRAINT blm_mappings_academic_year_format_check CHECK (
  CASE
    WHEN academic_year ~ '^[0-9]{4}-[0-9]{4}$'
      THEN substring(academic_year FROM 6 FOR 4)::integer =
           substring(academic_year FROM 1 FOR 4)::integer + 1
    ELSE false
  END
);

ALTER TABLE blended_learning_mentor_supervisions DROP CONSTRAINT IF EXISTS blm_supervisions_academic_year_format_check;
ALTER TABLE blended_learning_mentor_supervisions ADD CONSTRAINT blm_supervisions_academic_year_format_check CHECK (
  CASE
    WHEN academic_year ~ '^[0-9]{4}-[0-9]{4}$'
      THEN substring(academic_year FROM 6 FOR 4)::integer =
           substring(academic_year FROM 1 FOR 4)::integer + 1
    ELSE false
  END
);

ALTER TABLE blended_learning_mentor_mentee_mappings DROP CONSTRAINT IF EXISTS blm_mappings_lifecycle_check;
ALTER TABLE blended_learning_mentor_mentee_mappings ADD CONSTRAINT blm_mappings_lifecycle_check CHECK (
  assignment_source ~ '[^[:space:]]' AND
  (
    ended_at IS NULL AND ended_by_user_id IS NULL AND ended_by_email IS NULL AND
    end_source IS NULL AND end_reason IS NULL AND end_audit_reason IS NULL
    OR
    ended_at IS NOT NULL AND end_source IS NOT NULL AND end_source ~ '[^[:space:]]' AND
    end_reason IS NOT NULL AND end_reason ~ '[^[:space:]]' AND ended_at >= started_at
  )
);

ALTER TABLE blended_learning_mentor_supervisions DROP CONSTRAINT IF EXISTS blm_supervisions_lifecycle_check;
ALTER TABLE blended_learning_mentor_supervisions ADD CONSTRAINT blm_supervisions_lifecycle_check CHECK (
  assignment_source ~ '[^[:space:]]' AND
  (
    ended_at IS NULL AND ended_by_user_id IS NULL AND ended_by_email IS NULL AND
    end_source IS NULL AND end_reason IS NULL AND end_audit_reason IS NULL
    OR
    ended_at IS NOT NULL AND end_source IS NOT NULL AND end_source ~ '[^[:space:]]' AND
    end_reason IS NOT NULL AND end_reason ~ '[^[:space:]]' AND ended_at >= started_at
  )
);

ALTER TABLE blended_learning_mentor_mentee_mappings DROP CONSTRAINT IF EXISTS blm_mappings_ended_by_check;
ALTER TABLE blended_learning_mentor_mentee_mappings ADD CONSTRAINT blm_mappings_ended_by_check CHECK (
  ended_at IS NULL OR ended_by_user_id IS NOT NULL OR ended_by_email IS NOT NULL OR
  end_source = 'db_service_student_eligibility'
);

ALTER TABLE blended_learning_mentor_supervisions DROP CONSTRAINT IF EXISTS blm_supervisions_ended_by_check;
ALTER TABLE blended_learning_mentor_supervisions ADD CONSTRAINT blm_supervisions_ended_by_check CHECK (
  ended_at IS NULL OR ended_by_user_id IS NOT NULL OR ended_by_email IS NOT NULL
);

ALTER TABLE blended_learning_mentor_mentee_mappings DROP CONSTRAINT IF EXISTS blm_mappings_no_overlapping_periods;
ALTER TABLE blended_learning_mentor_mentee_mappings ADD CONSTRAINT blm_mappings_no_overlapping_periods
  EXCLUDE USING gist (student_id WITH =, academic_year WITH =, tsrange(started_at, ended_at, '[)') WITH &&);

ALTER TABLE blended_learning_mentor_supervisions DROP CONSTRAINT IF EXISTS blm_supervisions_no_overlapping_periods;
ALTER TABLE blended_learning_mentor_supervisions ADD CONSTRAINT blm_supervisions_no_overlapping_periods
  EXCLUDE USING gist (supervisor_user_id WITH =, mentor_user_id WITH =, academic_year WITH =, tsrange(started_at, ended_at, '[)') WITH &&);

CREATE OR REPLACE FUNCTION blended_learning_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := date_trunc('second', timezone('UTC', clock_timestamp()));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS blm_mappings_touch_updated_at ON blended_learning_mentor_mentee_mappings;
CREATE TRIGGER blm_mappings_touch_updated_at
BEFORE UPDATE ON blended_learning_mentor_mentee_mappings
FOR EACH ROW WHEN (OLD.* IS DISTINCT FROM NEW.*) EXECUTE FUNCTION blended_learning_touch_updated_at();

DROP TRIGGER IF EXISTS blm_supervisions_touch_updated_at ON blended_learning_mentor_supervisions;
CREATE TRIGGER blm_supervisions_touch_updated_at
BEFORE UPDATE ON blended_learning_mentor_supervisions
FOR EACH ROW WHEN (OLD.* IS DISTINCT FROM NEW.*) EXECUTE FUNCTION blended_learning_touch_updated_at();
