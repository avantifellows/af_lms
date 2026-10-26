-- Blended Learning Mentoring schema for e2e (issue #440). None of these tables
-- is in db-dump.sql. This mirrors, in order:
--   * db-service 20260921120000_create_blended_learning_mentor_mentee_mappings
--     and 20260921120002_ensure_blended_learning_mentor_mentee_mappings
--     (the ensure migration's idempotent form)
--   * db-service PR #804, migrations 20261022120000–20261022120700 (all eight)
-- Keep it identical to the db-service DDL: re-diff a pg_dump of this file
-- against a pg_dump of the Ecto migrations whenever PR #804 changes.

-- Blended Learning Mentor-Mentee Mappings (20260921120000 + ensure).
CREATE TABLE IF NOT EXISTS blended_learning_mentor_mentee_mappings (
  id bigserial PRIMARY KEY,
  student_id bigint NOT NULL CONSTRAINT blended_learning_mentor_mentee_mappings_student_id_fkey REFERENCES student(id),
  mentor_user_id bigint NOT NULL CONSTRAINT blended_learning_mentor_mentee_mappings_mentor_user_id_fkey REFERENCES "user"(id),
  school_id bigint CONSTRAINT blended_learning_mentor_mentee_mappings_school_id_fkey REFERENCES school(id),
  program_id bigint NOT NULL CONSTRAINT blended_learning_mentor_mentee_mappings_program_id_fkey REFERENCES program(id),
  academic_year varchar(255) NOT NULL,
  started_at timestamp(0) NOT NULL,
  -- Postgres truncates this name to 63 characters, as it does for Ecto's.
  assigned_by_user_id bigint CONSTRAINT blended_learning_mentor_mentee_mappings_assigned_by_user_id_fkey REFERENCES "user"(id),
  assigned_by_email varchar(255),
  assignment_source varchar(255) NOT NULL,
  assignment_audit_reason varchar(500),
  ended_at timestamp(0),
  ended_by_user_id bigint CONSTRAINT blended_learning_mentor_mentee_mappings_ended_by_user_id_fkey REFERENCES "user"(id),
  ended_by_email varchar(255),
  end_source varchar(255),
  end_reason varchar(255),
  end_audit_reason varchar(500),
  inserted_at timestamp(0) NOT NULL DEFAULT now(),
  updated_at timestamp(0) NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS blm_mappings_active_student_year_unique
  ON blended_learning_mentor_mentee_mappings (student_id, academic_year)
  WHERE ended_at IS NULL;

CREATE INDEX IF NOT EXISTS blm_mappings_active_program_year_idx
  ON blended_learning_mentor_mentee_mappings (program_id, academic_year, student_id)
  WHERE ended_at IS NULL;

CREATE INDEX IF NOT EXISTS blm_mappings_active_mentor_year_idx
  ON blended_learning_mentor_mentee_mappings (mentor_user_id, academic_year, student_id)
  WHERE ended_at IS NULL;

CREATE INDEX IF NOT EXISTS blm_mappings_student_history_idx
  ON blended_learning_mentor_mentee_mappings (student_id, academic_year, started_at);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'blm_mappings_lifecycle_check'
      AND conrelid = 'blended_learning_mentor_mentee_mappings'::regclass
  ) THEN
    ALTER TABLE blended_learning_mentor_mentee_mappings ADD CONSTRAINT blm_mappings_lifecycle_check CHECK (
      assignment_source <> '' AND
      (
        ended_at IS NULL AND ended_by_user_id IS NULL AND ended_by_email IS NULL AND
        end_source IS NULL AND end_reason IS NULL AND end_audit_reason IS NULL
        OR
        ended_at IS NOT NULL AND end_source IS NOT NULL AND end_source <> '' AND
        end_reason IS NOT NULL AND end_reason <> '' AND ended_at >= started_at
      )
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'blm_mappings_audit_fields_check'
      AND conrelid = 'blended_learning_mentor_mentee_mappings'::regclass
  ) THEN
    ALTER TABLE blended_learning_mentor_mentee_mappings ADD CONSTRAINT blm_mappings_audit_fields_check CHECK (
      (assigned_by_email IS NULL OR assigned_by_email ~ '[^[:space:]]') AND
      (assignment_audit_reason IS NULL OR assignment_audit_reason ~ '[^[:space:]]') AND
      (ended_by_email IS NULL OR ended_by_email ~ '[^[:space:]]') AND
      (end_audit_reason IS NULL OR end_audit_reason ~ '[^[:space:]]')
    );
  END IF;
END
$$;

-- 1 of 8: Blended Learning Student Links (20261022120000).
CREATE TABLE blended_learning_student_links (
  id bigserial PRIMARY KEY,
  student_id bigint NOT NULL CONSTRAINT blended_learning_student_links_student_id_fkey REFERENCES student(id),
  profile_doc_url text,
  screener_url text,
  legacy_last_contact_on date,
  inserted_at timestamp(0) NOT NULL DEFAULT now(),
  updated_at timestamp(0) NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX bl_student_links_student_unique ON blended_learning_student_links (student_id);

ALTER TABLE blended_learning_student_links ADD CONSTRAINT bl_student_links_profile_doc_url_check
  CHECK (profile_doc_url IS NULL OR profile_doc_url ~ '^https://[^[:space:]]+$');

ALTER TABLE blended_learning_student_links ADD CONSTRAINT bl_student_links_screener_url_check
  CHECK (screener_url IS NULL OR screener_url ~ '^https://[^[:space:]]+$');

-- 2 of 8: Blended Learning Conversation Drafts (20261022120100).
CREATE TABLE blended_learning_conversation_drafts (
  id bigserial PRIMARY KEY,
  student_id bigint NOT NULL CONSTRAINT blended_learning_conversation_drafts_student_id_fkey REFERENCES student(id),
  program_id bigint NOT NULL CONSTRAINT blended_learning_conversation_drafts_program_id_fkey REFERENCES program(id),
  academic_year varchar(255) NOT NULL,
  mentor_user_id bigint NOT NULL CONSTRAINT blended_learning_conversation_drafts_mentor_user_id_fkey REFERENCES "user"(id),
  created_by_email varchar(255) NOT NULL,
  state varchar(255) NOT NULL,
  occurred_on date,
  mode varchar(255),
  spoke_with varchar(255),
  duration_minutes integer,
  call_recording_s3_key text NOT NULL,
  recording_content_type varchar(255) NOT NULL,
  transcript_s3_key text,
  draft_summary text,
  draft_action_items jsonb,
  draft_notes jsonb,
  prompt_version varchar(255),
  model_id varchar(255),
  discarded_at timestamp(0),
  inserted_at timestamp(0) NOT NULL DEFAULT now(),
  updated_at timestamp(0) NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX bl_conversation_drafts_id_student_unique
  ON blended_learning_conversation_drafts (id, student_id);

CREATE UNIQUE INDEX bl_conversation_drafts_open_student_unique
  ON blended_learning_conversation_drafts (student_id)
  WHERE state IN ('transcribing', 'ready', 'failed');

ALTER TABLE blended_learning_conversation_drafts ADD CONSTRAINT bl_conversation_drafts_academic_year_check
  CHECK (academic_year ~ '[^[:space:]]');

ALTER TABLE blended_learning_conversation_drafts ADD CONSTRAINT bl_conversation_drafts_created_by_email_check
  CHECK (created_by_email ~ '[^[:space:]]');

ALTER TABLE blended_learning_conversation_drafts ADD CONSTRAINT bl_conversation_drafts_mode_check
  CHECK (mode IS NULL OR mode IN ('call', 'in_person'));

ALTER TABLE blended_learning_conversation_drafts ADD CONSTRAINT bl_conversation_drafts_spoke_with_check
  CHECK (spoke_with IS NULL OR spoke_with IN ('student', 'parent_or_sibling', 'both'));

ALTER TABLE blended_learning_conversation_drafts ADD CONSTRAINT bl_conversation_drafts_duration_minutes_check
  CHECK (duration_minutes IS NULL OR duration_minutes BETWEEN 1 AND 240);

ALTER TABLE blended_learning_conversation_drafts ADD CONSTRAINT bl_conversation_drafts_call_recording_s3_key_check
  CHECK (call_recording_s3_key ~ '[^[:space:]]');

ALTER TABLE blended_learning_conversation_drafts ADD CONSTRAINT bl_conversation_drafts_recording_content_type_check
  CHECK (recording_content_type ~ '^audio/');

ALTER TABLE blended_learning_conversation_drafts ADD CONSTRAINT bl_conversation_drafts_draft_action_items_check
  CHECK (draft_action_items IS NULL OR jsonb_typeof(draft_action_items) = 'array');

ALTER TABLE blended_learning_conversation_drafts ADD CONSTRAINT bl_conversation_drafts_draft_notes_check
  CHECK (draft_notes IS NULL OR jsonb_typeof(draft_notes) = 'array');

ALTER TABLE blended_learning_conversation_drafts ADD CONSTRAINT bl_conversation_drafts_state_check
  CHECK (state IN ('transcribing', 'ready', 'failed', 'discarded', 'saved'));

ALTER TABLE blended_learning_conversation_drafts ADD CONSTRAINT bl_conversation_drafts_ready_check
  CHECK (
    state <> 'ready'
    OR (
      draft_summary IS NOT NULL
      AND draft_summary ~ '[^[:space:]]'
      AND transcript_s3_key IS NOT NULL
      AND prompt_version IS NOT NULL
      AND model_id IS NOT NULL
    )
  );

ALTER TABLE blended_learning_conversation_drafts ADD CONSTRAINT bl_conversation_drafts_discarded_check
  CHECK (state <> 'discarded' OR discarded_at IS NOT NULL);

-- 3 of 8: Blended Learning Conversations and Attempts (20261022120200).
CREATE TABLE blended_learning_conversations (
  id bigserial PRIMARY KEY,
  student_id bigint NOT NULL CONSTRAINT blended_learning_conversations_student_id_fkey REFERENCES student(id),
  program_id bigint NOT NULL CONSTRAINT blended_learning_conversations_program_id_fkey REFERENCES program(id),
  academic_year varchar(255) NOT NULL,
  mentor_user_id bigint NOT NULL CONSTRAINT blended_learning_conversations_mentor_user_id_fkey REFERENCES "user"(id),
  logged_by_email varchar(255) NOT NULL,
  kind varchar(255) NOT NULL,
  occurred_on date NOT NULL,
  mode varchar(255),
  spoke_with varchar(255),
  duration_minutes integer,
  summary text,
  notes_html text,
  attempt_note text,
  call_recording_s3_key text,
  transcript_s3_key text,
  source_draft_id bigint,
  inserted_at timestamp(0) NOT NULL DEFAULT now(),
  CONSTRAINT blended_learning_conversations_source_draft_id_fkey FOREIGN KEY (source_draft_id, student_id)
    REFERENCES blended_learning_conversation_drafts(id, student_id)
);

CREATE INDEX bl_conversations_student_timeline_idx
  ON blended_learning_conversations (student_id, occurred_on DESC, id DESC);

CREATE INDEX bl_conversations_mentor_year_idx
  ON blended_learning_conversations (mentor_user_id, academic_year);

CREATE UNIQUE INDEX bl_conversations_id_student_unique
  ON blended_learning_conversations (id, student_id);

CREATE UNIQUE INDEX bl_conversations_source_draft_unique
  ON blended_learning_conversations (source_draft_id)
  WHERE source_draft_id IS NOT NULL;

ALTER TABLE blended_learning_conversations ADD CONSTRAINT bl_conversations_academic_year_check
  CHECK (academic_year ~ '[^[:space:]]');

ALTER TABLE blended_learning_conversations ADD CONSTRAINT bl_conversations_logged_by_email_check
  CHECK (logged_by_email ~ '[^[:space:]]');

ALTER TABLE blended_learning_conversations ADD CONSTRAINT bl_conversations_call_recording_s3_key_check
  CHECK (call_recording_s3_key IS NULL OR call_recording_s3_key ~ '[^[:space:]]');

ALTER TABLE blended_learning_conversations ADD CONSTRAINT bl_conversations_transcript_s3_key_check
  CHECK (transcript_s3_key IS NULL OR transcript_s3_key ~ '[^[:space:]]');

ALTER TABLE blended_learning_conversations ADD CONSTRAINT bl_conversations_kind_check
  CHECK (kind IN ('conversation', 'attempt'));

ALTER TABLE blended_learning_conversations ADD CONSTRAINT bl_conversations_mode_check
  CHECK (mode IS NULL OR mode IN ('call', 'in_person'));

ALTER TABLE blended_learning_conversations ADD CONSTRAINT bl_conversations_spoke_with_check
  CHECK (spoke_with IS NULL OR spoke_with IN ('student', 'parent_or_sibling', 'both'));

ALTER TABLE blended_learning_conversations ADD CONSTRAINT bl_conversations_duration_minutes_check
  CHECK (duration_minutes IS NULL OR duration_minutes BETWEEN 1 AND 240);

ALTER TABLE blended_learning_conversations ADD CONSTRAINT bl_conversations_kind_fields_check
  CHECK (
    (
      kind = 'conversation'
      AND mode IS NOT NULL
      AND spoke_with IS NOT NULL
      AND duration_minutes IS NOT NULL
      AND summary IS NOT NULL
      AND summary ~ '[^[:space:]]'
      AND attempt_note IS NULL
    )
    OR (
      kind = 'attempt'
      AND mode IS NULL
      AND spoke_with IS NULL
      AND duration_minutes IS NULL
      AND summary IS NULL
      AND notes_html IS NULL
      AND call_recording_s3_key IS NULL
      AND transcript_s3_key IS NULL
      AND source_draft_id IS NULL
    )
  );

ALTER TABLE blended_learning_conversations ADD CONSTRAINT bl_conversations_attempt_note_check
  CHECK (attempt_note IS NULL OR attempt_note ~ '[^[:space:]]');

CREATE FUNCTION blended_learning_protect_conversation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Blended Learning Conversations and Attempts are append-only'
    USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER bl_conversations_immutable
BEFORE UPDATE OR DELETE ON blended_learning_conversations
FOR EACH ROW EXECUTE FUNCTION blended_learning_protect_conversation();

-- 4 of 8: Blended Learning Action Items (20261022120300).
CREATE TABLE blended_learning_action_items (
  id bigserial PRIMARY KEY,
  conversation_id bigint NOT NULL,
  student_id bigint NOT NULL CONSTRAINT blended_learning_action_items_student_id_fkey REFERENCES student(id),
  position integer NOT NULL,
  text text NOT NULL,
  owner varchar(255) NOT NULL,
  status varchar(255) NOT NULL DEFAULT 'open',
  completed_by_conversation_id bigint,
  completed_at timestamp(0),
  completed_by_email varchar(255),
  inserted_at timestamp(0) NOT NULL DEFAULT now(),
  updated_at timestamp(0) NOT NULL DEFAULT now(),
  CONSTRAINT blended_learning_action_items_conversation_id_fkey FOREIGN KEY (conversation_id, student_id)
    REFERENCES blended_learning_conversations(id, student_id),
  CONSTRAINT blended_learning_action_items_completed_by_conversation_id_fkey FOREIGN KEY (completed_by_conversation_id, student_id)
    REFERENCES blended_learning_conversations(id, student_id)
);

CREATE UNIQUE INDEX bl_action_items_conversation_position_unique
  ON blended_learning_action_items (conversation_id, position);

CREATE INDEX bl_action_items_open_student_idx
  ON blended_learning_action_items (student_id)
  WHERE status = 'open';

ALTER TABLE blended_learning_action_items ADD CONSTRAINT bl_action_items_position_check CHECK (position >= 1);
ALTER TABLE blended_learning_action_items ADD CONSTRAINT bl_action_items_text_check CHECK (text ~ '[^[:space:]]');

ALTER TABLE blended_learning_action_items ADD CONSTRAINT bl_action_items_owner_check
  CHECK (owner IN ('student', 'mentor', 'parent'));

ALTER TABLE blended_learning_action_items ADD CONSTRAINT bl_action_items_status_check
  CHECK (status IN ('open', 'done'));

ALTER TABLE blended_learning_action_items ADD CONSTRAINT bl_action_items_completed_by_email_check
  CHECK (completed_by_email IS NULL OR completed_by_email ~ '[^[:space:]]');

ALTER TABLE blended_learning_action_items ADD CONSTRAINT bl_action_items_completion_check
  CHECK (
    (
      status = 'open'
      AND completed_by_conversation_id IS NULL
      AND completed_at IS NULL
      AND completed_by_email IS NULL
    )
    OR (
      status <> 'open'
      AND completed_by_conversation_id IS NOT NULL
      AND completed_at IS NOT NULL
      AND completed_by_email IS NOT NULL
    )
  );

-- 5 of 8: Blended Learning Conversation Photos (20261022120400).
CREATE TABLE blended_learning_conversation_photos (
  id bigserial PRIMARY KEY,
  conversation_id bigint NOT NULL CONSTRAINT blended_learning_conversation_photos_conversation_id_fkey REFERENCES blended_learning_conversations(id),
  s3_key text NOT NULL,
  content_type varchar(255) NOT NULL,
  byte_size integer NOT NULL,
  position integer NOT NULL,
  inserted_at timestamp(0) NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX bl_conversation_photos_conversation_position_unique
  ON blended_learning_conversation_photos (conversation_id, position);

ALTER TABLE blended_learning_conversation_photos ADD CONSTRAINT bl_conversation_photos_position_check
  CHECK (position BETWEEN 1 AND 5);

ALTER TABLE blended_learning_conversation_photos ADD CONSTRAINT bl_conversation_photos_s3_key_check
  CHECK (s3_key ~ '[^[:space:]]');

ALTER TABLE blended_learning_conversation_photos ADD CONSTRAINT bl_conversation_photos_content_type_check
  CHECK (content_type ~ '^image/');

ALTER TABLE blended_learning_conversation_photos ADD CONSTRAINT bl_conversation_photos_byte_size_check
  CHECK (byte_size BETWEEN 1 AND 10485760);

-- 6 of 8: Blended Learning Mentor Flags (20261022120500).
CREATE TABLE blended_learning_mentor_flags (
  id bigserial PRIMARY KEY,
  conversation_id bigint NOT NULL,
  student_id bigint NOT NULL CONSTRAINT blended_learning_mentor_flags_student_id_fkey REFERENCES student(id),
  recipient varchar(255) NOT NULL,
  comment text,
  raised_by_email varchar(255) NOT NULL,
  inserted_at timestamp(0) NOT NULL DEFAULT now(),
  CONSTRAINT blended_learning_mentor_flags_conversation_id_fkey FOREIGN KEY (conversation_id, student_id)
    REFERENCES blended_learning_conversations(id, student_id)
);

CREATE UNIQUE INDEX bl_mentor_flags_conversation_recipient_unique
  ON blended_learning_mentor_flags (conversation_id, recipient);

CREATE INDEX bl_mentor_flags_inserted_at_idx ON blended_learning_mentor_flags (inserted_at DESC);

ALTER TABLE blended_learning_mentor_flags ADD CONSTRAINT bl_mentor_flags_recipient_check
  CHECK (recipient IN ('emotional_wellbeing', 'physics', 'chemistry', 'maths'));

ALTER TABLE blended_learning_mentor_flags ADD CONSTRAINT bl_mentor_flags_comment_check
  CHECK (comment IS NULL OR comment ~ '[^[:space:]]');

ALTER TABLE blended_learning_mentor_flags ADD CONSTRAINT bl_mentor_flags_raised_by_email_check
  CHECK (raised_by_email ~ '[^[:space:]]');

-- 7 of 8: Blended Learning Flag Views (20261022120600).
CREATE TABLE blended_learning_flag_views (
  id bigserial PRIMARY KEY,
  viewer_email varchar(255) NOT NULL,
  last_seen_at timestamp(0) NOT NULL,
  inserted_at timestamp(0) NOT NULL DEFAULT now(),
  updated_at timestamp(0) NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX bl_flag_views_viewer_email_unique ON blended_learning_flag_views (lower(viewer_email));

ALTER TABLE blended_learning_flag_views ADD CONSTRAINT bl_flag_views_viewer_email_check
  CHECK (viewer_email ~ '[^[:space:]]');

-- 8 of 8: Blended Learning Transcription Requests (20261022120700).
CREATE TABLE blended_learning_transcription_requests (
  id bigserial PRIMARY KEY,
  request_key varchar(255) NOT NULL,
  draft_id bigint NOT NULL,
  student_id bigint NOT NULL CONSTRAINT blended_learning_transcription_requests_student_id_fkey REFERENCES student(id),
  requested_by_email varchar(255) NOT NULL,
  state varchar(255) NOT NULL DEFAULT 'queued',
  etl_run_id varchar(255),
  error_code varchar(255),
  inserted_at timestamp(0) NOT NULL DEFAULT now(),
  updated_at timestamp(0) NOT NULL DEFAULT now(),
  CONSTRAINT blended_learning_transcription_requests_draft_id_fkey FOREIGN KEY (draft_id, student_id)
    REFERENCES blended_learning_conversation_drafts(id, student_id)
);

CREATE UNIQUE INDEX bl_transcription_requests_key_unique
  ON blended_learning_transcription_requests (request_key);

CREATE UNIQUE INDEX bl_transcription_requests_active_draft_unique
  ON blended_learning_transcription_requests (draft_id)
  WHERE state IN ('queued', 'running');

ALTER TABLE blended_learning_transcription_requests ADD CONSTRAINT bl_transcription_requests_state_check
  CHECK (state IN ('queued', 'running', 'completed', 'failed'));

ALTER TABLE blended_learning_transcription_requests ADD CONSTRAINT bl_transcription_requests_state_metadata_check
  CHECK (
    (state = 'queued' AND etl_run_id IS NULL AND error_code IS NULL)
    OR (state IN ('running', 'completed') AND etl_run_id IS NOT NULL AND error_code IS NULL)
    OR (state = 'failed' AND etl_run_id IS NOT NULL)
  );

ALTER TABLE blended_learning_transcription_requests ADD CONSTRAINT bl_transcription_requests_safe_error_check
  CHECK (error_code IS NULL OR char_length(error_code) BETWEEN 1 AND 64);

ALTER TABLE blended_learning_transcription_requests ADD CONSTRAINT bl_transcription_requests_requested_by_email_check
  CHECK (requested_by_email ~ '[^[:space:]]');
