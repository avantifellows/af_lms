-- Mirrors db-service migration
-- 20261027120000_create_blended_learning_resources_and_common_action_items
-- (branch feat/bl-admin-manage): admin-managed Resources (seeded with the
-- Mentor Toolkit doc) and Common Action Items, whose pushed Action Items have
-- no Conversation. Re-diff with .mex/patterns/mirror-db-service-schema-in-e2e.md
-- if that migration changes.

CREATE TABLE blended_learning_resources (
  id bigserial PRIMARY KEY,
  title varchar(200) NOT NULL,
  url text NOT NULL,
  position integer NOT NULL,
  created_by_email varchar(255),
  updated_by_email varchar(255),
  inserted_at timestamp(0) NOT NULL DEFAULT now(),
  updated_at timestamp(0) NOT NULL DEFAULT now()
);

ALTER TABLE blended_learning_resources ADD CONSTRAINT bl_resources_title_check CHECK (title ~ '[^[:space:]]');

ALTER TABLE blended_learning_resources ADD CONSTRAINT bl_resources_url_check
  CHECK (url ~ '^https://[^[:space:]]+$');

ALTER TABLE blended_learning_resources ADD CONSTRAINT bl_resources_position_check CHECK (position >= 1);

ALTER TABLE blended_learning_resources ADD CONSTRAINT bl_resources_created_by_email_check
  CHECK (created_by_email IS NULL OR created_by_email ~ '[^[:space:]]');

ALTER TABLE blended_learning_resources ADD CONSTRAINT bl_resources_updated_by_email_check
  CHECK (updated_by_email IS NULL OR updated_by_email ~ '[^[:space:]]');

INSERT INTO blended_learning_resources (title, url, position)
VALUES (
  'Mentor Toolkit: Supporting Students Through Non-Academic Stress',
  'https://docs.google.com/document/d/1kST-wRFTWgczw7SqBAxW97KNyJ0fzuBoOBsIelTQ8W0/edit?usp=sharing',
  1
);

CREATE TABLE blended_learning_common_action_items (
  id bigserial PRIMARY KEY,
  text text NOT NULL,
  owner varchar(255) NOT NULL,
  target_kind varchar(255) NOT NULL,
  target_grade integer,
  target_mentor_user_id bigint CONSTRAINT blended_learning_common_action_items_target_mentor_user_id_fkey REFERENCES "user"(id),
  created_by_email varchar(255) NOT NULL,
  removed_at timestamp(0),
  removed_by_email varchar(255),
  inserted_at timestamp(0) NOT NULL DEFAULT now(),
  updated_at timestamp(0) NOT NULL DEFAULT now()
);

ALTER TABLE blended_learning_common_action_items ADD CONSTRAINT bl_common_action_items_text_check
  CHECK (text ~ '[^[:space:]]' AND char_length(text) <= 500);

ALTER TABLE blended_learning_common_action_items ADD CONSTRAINT bl_common_action_items_owner_check
  CHECK (owner IN ('student', 'mentor', 'parent'));

ALTER TABLE blended_learning_common_action_items ADD CONSTRAINT bl_common_action_items_target_check
  CHECK (
    (
      target_kind = 'all'
      AND target_grade IS NULL
      AND target_mentor_user_id IS NULL
    )
    OR (
      target_kind = 'grade'
      AND target_grade IS NOT NULL
      AND target_grade IN (12, 13)
      AND target_mentor_user_id IS NULL
    )
    OR (
      target_kind = 'mentor'
      AND target_grade IS NULL
      AND target_mentor_user_id IS NOT NULL
    )
  );

ALTER TABLE blended_learning_common_action_items ADD CONSTRAINT bl_common_action_items_created_by_email_check
  CHECK (created_by_email ~ '[^[:space:]]');

ALTER TABLE blended_learning_common_action_items ADD CONSTRAINT bl_common_action_items_removal_check
  CHECK (
    (removed_at IS NULL AND removed_by_email IS NULL)
    OR (
      removed_at IS NOT NULL
      AND removed_by_email IS NOT NULL
      AND removed_by_email ~ '[^[:space:]]'
    )
  );

ALTER TABLE blended_learning_action_items ALTER COLUMN conversation_id DROP NOT NULL;

ALTER TABLE blended_learning_action_items
  ADD COLUMN common_action_item_id bigint
    CONSTRAINT blended_learning_action_items_common_action_item_id_fkey
    REFERENCES blended_learning_common_action_items(id);

ALTER TABLE blended_learning_action_items ADD CONSTRAINT bl_action_items_source_check
  CHECK ((conversation_id IS NULL) <> (common_action_item_id IS NULL));

CREATE UNIQUE INDEX bl_action_items_common_student_unique
  ON blended_learning_action_items (common_action_item_id, student_id)
  WHERE common_action_item_id IS NOT NULL;
