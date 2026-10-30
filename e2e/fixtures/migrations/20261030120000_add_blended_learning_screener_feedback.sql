-- Mirrors db-service migration
-- 20261030120000_add_blended_learning_screener_feedback
-- (branch feat/bl-screener-feedback): "Was the screener form used?" on a
-- Conversation (screener_used, NULL without a Screener link and on an
-- Attempt), and the once-per-Student Screener Feedback ratings. Re-diff with
-- .mex/patterns/mirror-db-service-schema-in-e2e.md if that migration changes.

ALTER TABLE blended_learning_conversations
  ADD COLUMN screener_used boolean;

COMMENT ON COLUMN blended_learning_conversations.screener_used IS
  'Was the screener form used? NULL when the Student had no Screener link, and on an Attempt';

ALTER TABLE blended_learning_conversations ADD CONSTRAINT bl_conversations_screener_used_check
  CHECK (screener_used IS NULL OR kind = 'conversation');

CREATE TABLE blended_learning_screener_feedback (
  id bigserial PRIMARY KEY,
  student_id bigint NOT NULL CONSTRAINT blended_learning_screener_feedback_student_id_fkey REFERENCES student(id),
  conversation_id bigint NOT NULL,
  mentor_user_id bigint NOT NULL CONSTRAINT blended_learning_screener_feedback_mentor_user_id_fkey REFERENCES "user"(id),
  helped_understand smallint NOT NULL,
  more_comfortable smallint NOT NULL,
  inserted_at timestamp(0) NOT NULL DEFAULT now(),
  CONSTRAINT blended_learning_screener_feedback_conversation_id_fkey FOREIGN KEY (conversation_id, student_id)
    REFERENCES blended_learning_conversations(id, student_id)
);

CREATE UNIQUE INDEX bl_screener_feedback_student_unique
  ON blended_learning_screener_feedback (student_id);

ALTER TABLE blended_learning_screener_feedback ADD CONSTRAINT bl_screener_feedback_helped_understand_check
  CHECK (helped_understand BETWEEN 1 AND 5);

ALTER TABLE blended_learning_screener_feedback ADD CONSTRAINT bl_screener_feedback_more_comfortable_check
  CHECK (more_comfortable BETWEEN 1 AND 5);
