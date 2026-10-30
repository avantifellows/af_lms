-- Intervention flags schema for e2e (issue #470, slice #475). Neither table is in
-- db-dump.sql. This mirrors db-service 20260925120000_create_lms_student_intervention_flags.
-- Keep it identical to the db-service DDL: re-diff a pg_dump of this file against a
-- pg_dump of the Ecto migration whenever that migration changes. Idempotent, so a local
-- dump refreshed after that migration (db-dump.sql is not committed) still loads.

CREATE TABLE IF NOT EXISTS lms_student_intervention_flags (
  id bigserial PRIMARY KEY,
  student_id bigint NOT NULL CONSTRAINT lms_student_intervention_flags_student_id_fkey REFERENCES student(id),
  school_id bigint NOT NULL CONSTRAINT lms_student_intervention_flags_school_id_fkey REFERENCES school(id),
  program_id bigint CONSTRAINT lms_student_intervention_flags_program_id_fkey REFERENCES program(id),
  status varchar(255) NOT NULL,
  raised_by_email varchar(255) NOT NULL,
  raised_by_user_id bigint CONSTRAINT lms_student_intervention_flags_raised_by_user_id_fkey REFERENCES "user"(id),
  resolved_at timestamp(0),
  inserted_at timestamp(0) NOT NULL DEFAULT now(),
  updated_at timestamp(0) NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lms_student_intervention_flag_updates (
  id bigserial PRIMARY KEY,
  flag_id bigint NOT NULL CONSTRAINT lms_student_intervention_flag_updates_flag_id_fkey REFERENCES lms_student_intervention_flags(id),
  author_email varchar(255) NOT NULL,
  author_user_id bigint CONSTRAINT lms_student_intervention_flag_updates_author_user_id_fkey REFERENCES "user"(id),
  body text,
  status_from varchar(255),
  status_to varchar(255),
  inserted_at timestamp(0) NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS lms_intervention_flags_one_open_per_student
  ON lms_student_intervention_flags (student_id)
  WHERE status = 'open';

CREATE INDEX IF NOT EXISTS lms_intervention_flags_school_status_idx
  ON lms_student_intervention_flags (school_id, status);

CREATE INDEX IF NOT EXISTS lms_intervention_flag_updates_flag_time_idx
  ON lms_student_intervention_flag_updates (flag_id, inserted_at);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lms_intervention_flags_status_check') THEN
    ALTER TABLE lms_student_intervention_flags
      ADD CONSTRAINT lms_intervention_flags_status_check
      CHECK (status IN ('open', 'resolved'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lms_intervention_flags_resolved_at_check') THEN
    ALTER TABLE lms_student_intervention_flags
      ADD CONSTRAINT lms_intervention_flags_resolved_at_check
      CHECK ((status = 'resolved') = (resolved_at IS NOT NULL));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lms_intervention_flag_updates_status_check') THEN
    ALTER TABLE lms_student_intervention_flag_updates
      ADD CONSTRAINT lms_intervention_flag_updates_status_check
      CHECK ((status_from IS NULL OR status_from IN ('open', 'resolved')) AND
(status_to IS NULL OR status_to IN ('open', 'resolved'))
);
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION lms_protect_intervention_flag_updates()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.body IS NULL
     AND (NEW.id, NEW.flag_id, NEW.author_email, NEW.author_user_id,
          NEW.status_from, NEW.status_to, NEW.inserted_at)
         IS NOT DISTINCT FROM
         (OLD.id, OLD.flag_id, OLD.author_email, OLD.author_user_id,
          OLD.status_from, OLD.status_to, OLD.inserted_at) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Intervention flag updates are append-only (only body may be cleared)'
    USING ERRCODE = '23514';
END;
$$;

DROP TRIGGER IF EXISTS lms_intervention_flag_updates_append_only
  ON lms_student_intervention_flag_updates;

CREATE TRIGGER lms_intervention_flag_updates_append_only
BEFORE UPDATE OR DELETE ON lms_student_intervention_flag_updates
FOR EACH ROW EXECUTE FUNCTION lms_protect_intervention_flag_updates();
