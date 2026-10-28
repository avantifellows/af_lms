-- Mirrors db-service migration
-- 20261027100000_add_legacy_conversation_to_blended_learning_student_links
-- (branch feat/bl-legacy-latest-conversation): the Profile Doc's latest
-- conversation summary on Blended Learning Student Links, and its action
-- items as Action Items with from_profile_doc and no Conversation. Re-diff
-- with .mex/patterns/mirror-db-service-schema-in-e2e.md if that migration
-- changes.

ALTER TABLE blended_learning_student_links
  ADD COLUMN legacy_conversation_summary text;

COMMENT ON COLUMN blended_learning_student_links.legacy_conversation_summary IS
  'Summary of the latest Profile Doc entry (af_lms links importer), shown in the conversation history at legacy_last_contact_on';

ALTER TABLE blended_learning_student_links ADD CONSTRAINT bl_student_links_legacy_conversation_summary_check
  CHECK (
    legacy_conversation_summary IS NULL
    OR (
      legacy_conversation_summary ~ '[^[:space:]]'
      AND char_length(legacy_conversation_summary) <= 2000
    )
  );

ALTER TABLE blended_learning_action_items
  ADD COLUMN from_profile_doc boolean DEFAULT false NOT NULL;

COMMENT ON COLUMN blended_learning_action_items.from_profile_doc IS
  'Loaded from the latest Profile Doc entry by the af_lms links importer; such an Action Item has no Conversation';

ALTER TABLE blended_learning_action_items ALTER COLUMN conversation_id DROP NOT NULL;

ALTER TABLE blended_learning_action_items ADD CONSTRAINT bl_action_items_source_check
  CHECK ((conversation_id IS NOT NULL) <> from_profile_doc);

CREATE UNIQUE INDEX bl_action_items_profile_doc_unique
  ON blended_learning_action_items (student_id, text, owner)
  WHERE from_profile_doc;
