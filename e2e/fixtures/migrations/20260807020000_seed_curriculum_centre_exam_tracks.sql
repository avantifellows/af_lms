INSERT INTO public.centres
  (id, name, school_id, is_physical, is_active, program_id)
VALUES
  (9000751, 'LMS CoE Centre', 900075, true, true, 1),
  (9000752, 'LMS Nodal Centre', 900075, true, true, 2),
  (9000761, 'LMS Empty School CoE Centre', 900076, true, true, 1)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  school_id = EXCLUDED.school_id,
  is_physical = EXCLUDED.is_physical,
  is_active = EXCLUDED.is_active,
  program_id = EXCLUDED.program_id,
  updated_at = NOW();

INSERT INTO public.centre_exam_tracks
  (centre_id, grade_id, exam_track_code)
VALUES
  (9000751, 3, 'jee_main'),
  (9000751, 3, 'jee_advanced'),
  (9000751, 4, 'neet'),
  (9000752, 3, 'jee_main'),
  (9000752, 3, 'jee_advanced'),
  (9000752, 4, 'neet'),
  (9000761, 3, 'jee_main')
ON CONFLICT (centre_id, grade_id, exam_track_code) DO NOTHING;
