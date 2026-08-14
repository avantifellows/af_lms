ALTER TABLE public.lms_chapter_exam_configs
  DROP CONSTRAINT lms_chapter_exam_configs_exam_track_check,
  ADD CONSTRAINT lms_chapter_exam_configs_exam_track_check
    CHECK (exam_track IN ('jee_main', 'jee_advanced', 'neet', 'cet', 'math_foundation'));

ALTER TABLE public.lms_curriculum_logs
  DROP CONSTRAINT lms_curriculum_logs_exam_track_check,
  ADD CONSTRAINT lms_curriculum_logs_exam_track_check
    CHECK (exam_track IN ('jee_main', 'jee_advanced', 'neet', 'cet', 'math_foundation'));

ALTER TABLE public.lms_curriculum_chapter_completions
  DROP CONSTRAINT lms_curriculum_chapter_completions_exam_track_check,
  ADD CONSTRAINT lms_curriculum_chapter_completions_exam_track_check
    CHECK (exam_track IN ('jee_main', 'jee_advanced', 'neet', 'cet', 'math_foundation'));
