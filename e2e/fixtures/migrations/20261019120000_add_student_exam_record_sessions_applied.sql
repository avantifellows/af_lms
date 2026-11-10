-- Mirrors db-service 20261019120000_add_sessions_applied_to_student_exam_record,
-- which db-dump.sql predates.

ALTER TABLE public.student_exam_record ADD COLUMN sessions_applied integer[];
