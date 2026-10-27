-- Mirrors db-service migration
-- 20261027100000_add_legacy_conversation_to_blended_learning_student_links
-- (branch feat/bl-legacy-latest-conversation): the Profile Doc's latest
-- conversation snapshot on Blended Learning Student Links. Re-diff with
-- .mex/patterns/mirror-db-service-schema-in-e2e.md if that migration changes.

ALTER TABLE blended_learning_student_links
  ADD COLUMN legacy_conversation_summary text,
  ADD COLUMN legacy_action_items jsonb;

COMMENT ON COLUMN blended_learning_student_links.legacy_conversation_summary IS
  'Summary of the latest Profile Doc entry (snapshot by af_lms links importer); superseded in the UI by the first app conversation';

COMMENT ON COLUMN blended_learning_student_links.legacy_action_items IS
  'Action items of the latest Profile Doc entry: JSON array of {text, owner} (snapshot by af_lms links importer); superseded by the first app conversation';

ALTER TABLE blended_learning_student_links ADD CONSTRAINT bl_student_links_legacy_conversation_summary_check
  CHECK (
    legacy_conversation_summary IS NULL
    OR (
      legacy_conversation_summary ~ '[^[:space:]]'
      AND char_length(legacy_conversation_summary) <= 2000
    )
  );

ALTER TABLE blended_learning_student_links ADD CONSTRAINT bl_student_links_legacy_action_items_check
  CHECK (
    legacy_action_items IS NULL
    OR CASE
      WHEN jsonb_typeof(legacy_action_items) = 'array'
        THEN jsonb_array_length(legacy_action_items) BETWEEN 1 AND 10
      ELSE false
    END
  );

ALTER TABLE blended_learning_student_links ADD CONSTRAINT bl_student_links_legacy_action_items_need_summary_check
  CHECK (legacy_action_items IS NULL OR legacy_conversation_summary IS NOT NULL);
