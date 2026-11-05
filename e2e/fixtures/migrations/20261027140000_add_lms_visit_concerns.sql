-- Visit Concerns schema for e2e (issue #470, slice #478). None of these tables is in
-- db-dump.sql. Production DDL is owned by db-service migration
-- `20261028120000_create_lms_visit_concerns.exs` (db-service issue #823); this mirrors its
-- tables, indexes, CHECKs, function and trigger. If that migration changes, re-diff a pg_dump
-- of this file against a pg_dump of the Ecto migration
-- (patterns/mirror-db-service-schema-in-e2e.md) and match it. Idempotent, so a local dump
-- refreshed after that migration (db-dump.sql is not committed) still loads.
-- Timestamps are `timestamp without time zone` holding UTC.

CREATE TABLE IF NOT EXISTS lms_visit_concerns (
  id bigserial PRIMARY KEY,
  school_code text NOT NULL,
  kind text NOT NULL,
  text text NOT NULL,
  status text,
  inserted_at timestamp(0) NOT NULL DEFAULT now(),
  updated_at timestamp(0) NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lms_visit_concern_mentions (
  id bigserial PRIMARY KEY,
  concern_id bigint NOT NULL CONSTRAINT lms_visit_concern_mentions_concern_id_fkey REFERENCES lms_visit_concerns(id) ON DELETE CASCADE,
  visit_id bigint NOT NULL CONSTRAINT lms_visit_concern_mentions_visit_id_fkey REFERENCES lms_pm_school_visits(id),
  snippet text NOT NULL,
  inserted_at timestamp(0) NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lms_visit_concern_events (
  id bigserial PRIMARY KEY,
  concern_id bigint NOT NULL CONSTRAINT lms_visit_concern_events_concern_id_fkey REFERENCES lms_visit_concerns(id),
  kind text NOT NULL,
  body text,
  author_email text,
  visit_id bigint CONSTRAINT lms_visit_concern_events_visit_id_fkey REFERENCES lms_pm_school_visits(id),
  inserted_at timestamp(0) NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lms_visit_note_summaries (
  visit_id bigint PRIMARY KEY CONSTRAINT lms_visit_note_summaries_visit_id_fkey REFERENCES lms_pm_school_visits(id),
  fingerprint text NOT NULL,
  prompt_version text NOT NULL,
  summarised_at timestamp(0) NOT NULL
);

CREATE INDEX IF NOT EXISTS lms_visit_concerns_school_code_kind_index
  ON lms_visit_concerns (school_code, kind);

CREATE UNIQUE INDEX IF NOT EXISTS lms_visit_concern_mentions_concern_id_visit_id_index
  ON lms_visit_concern_mentions (concern_id, visit_id);

CREATE INDEX IF NOT EXISTS lms_visit_concern_mentions_visit_id_index
  ON lms_visit_concern_mentions (visit_id);

CREATE INDEX IF NOT EXISTS lms_visit_concern_events_concern_id_inserted_at_index
  ON lms_visit_concern_events (concern_id, inserted_at);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lms_visit_concerns_kind_check') THEN
    ALTER TABLE lms_visit_concerns
      ADD CONSTRAINT lms_visit_concerns_kind_check
      CHECK (kind IN ('concern', 'highlight'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lms_visit_concerns_status_check') THEN
    ALTER TABLE lms_visit_concerns
      ADD CONSTRAINT lms_visit_concerns_status_check
      CHECK (status IN ('open', 'resolved'));
  END IF;

  -- Highlights have no status; Concerns always have one.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lms_visit_concerns_kind_status_check') THEN
    ALTER TABLE lms_visit_concerns
      ADD CONSTRAINT lms_visit_concerns_kind_status_check
      CHECK ((kind = 'concern') = (status IS NOT NULL));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lms_visit_concern_events_kind_check') THEN
    ALTER TABLE lms_visit_concern_events
      ADD CONSTRAINT lms_visit_concern_events_kind_check
      CHECK (kind IN ('resolved', 'reopened', 'comment', 'auto_reopened'));
  END IF;

  -- Only an auto_reopened event names a Visit; it has no author and no body.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lms_visit_concern_events_auto_reopened_check') THEN
    ALTER TABLE lms_visit_concern_events
      ADD CONSTRAINT lms_visit_concern_events_auto_reopened_check
      CHECK ((kind = 'auto_reopened') = (author_email IS NULL AND visit_id IS NOT NULL AND body IS NULL));
  END IF;

  -- Human events carry a non-blank body of at most 2000 characters after trimming.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lms_visit_concern_events_body_check') THEN
    ALTER TABLE lms_visit_concern_events
      ADD CONSTRAINT lms_visit_concern_events_body_check
      CHECK (
        kind = 'auto_reopened' OR
        (body IS NOT NULL AND body ~ '[^[:space:]]' AND char_length(btrim(body)) <= 2000)
      );
  END IF;

  -- Human events have a non-blank author and never name a Visit.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lms_visit_concern_events_author_check') THEN
    ALTER TABLE lms_visit_concern_events
      ADD CONSTRAINT lms_visit_concern_events_author_check
      CHECK (
        kind = 'auto_reopened' OR
        (author_email IS NOT NULL AND author_email ~ '[^[:space:]]' AND visit_id IS NULL)
      );
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION lms_protect_visit_concern_events()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Visit concern events are append-only'
    USING ERRCODE = '23514';
END;
$$;

DROP TRIGGER IF EXISTS lms_visit_concern_events_append_only
  ON lms_visit_concern_events;

CREATE TRIGGER lms_visit_concern_events_append_only
BEFORE UPDATE OR DELETE ON lms_visit_concern_events
FOR EACH ROW EXECUTE FUNCTION lms_protect_visit_concern_events();
