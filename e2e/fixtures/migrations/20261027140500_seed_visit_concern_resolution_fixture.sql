-- Concern Resolution fixture (#470, slice #482): Resolve / Comment / Reopen on the School page.
-- Read by the "School page concern actions" tests in e2e/tests/school-visit-summary-school-wise.spec.ts.
-- Those tests write history, so they get their own School: VSWCONE "VSW Concern Echo" (region
-- VSW_E2E, active physical CoE 9004841), visited only by e2e-vsw-pm5@test.local, so no other
-- test's ?pms= literals move. Summary rows are older than the 20 Oct 2026 freshness literal.
--
-- Visits (completed): 9004733 2026-09-05 · 9004734 2026-10-05
-- Records:
--   9004813 open      Drinking water tank leaking   733        → resolved by the Resolve test
--   9004814 resolved  Hostel lights not working     733, 734   → commented on, then reopened
--   9004815 open      Exam timetable not shared     734        → resolved behind the page's back (409 test)
-- e2e-vsw-readonly@test.local is a read_only program admin: sees the concerns, gets no controls.

INSERT INTO public.school
  (id, code, name, inserted_at, updated_at, udise_code, af_school_category, region, state, district, program_ids)
VALUES
  (900481, 'VSWCONE', 'VSW Concern Echo', NOW(), NOW(), '47000000481', 'JNV', 'VSW_E2E', 'Gujarat', 'Bharuch', ARRAY[1]::integer[])
ON CONFLICT (id) DO UPDATE SET
  code = EXCLUDED.code,
  name = EXCLUDED.name,
  udise_code = EXCLUDED.udise_code,
  af_school_category = EXCLUDED.af_school_category,
  region = EXCLUDED.region,
  state = EXCLUDED.state,
  district = EXCLUDED.district,
  program_ids = EXCLUDED.program_ids,
  updated_at = NOW();

INSERT INTO public.centres
  (id, name, school_id, is_physical, is_active, program_id)
VALUES
  (9004841, 'VSW E2E Concern Echo CoE', 900481, true, true, 1)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  school_id = EXCLUDED.school_id,
  is_physical = EXCLUDED.is_physical,
  is_active = EXCLUDED.is_active,
  program_id = EXCLUDED.program_id,
  updated_at = NOW();

INSERT INTO public.lms_pm_school_visits
  (id, school_code, pm_email, visit_date, status, inserted_at, updated_at, completed_at, deleted_at)
VALUES
  (9004733, 'VSWCONE', 'e2e-vsw-pm5@test.local', '2026-09-05', 'completed', '2026-09-05 04:00:00', '2026-09-05 07:00:00', '2026-09-05 07:00:00', NULL),
  (9004734, 'VSWCONE', 'e2e-vsw-pm5@test.local', '2026-10-05', 'completed', '2026-10-05 04:00:00', '2026-10-05 07:00:00', '2026-10-05 07:00:00', NULL)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.lms_visit_concerns (id, school_code, kind, text, status, inserted_at, updated_at)
VALUES
  (9004813, 'VSWCONE', 'concern', 'Drinking water tank leaking', 'open', '2026-09-06 02:30:00', '2026-09-06 02:30:00'),
  (9004814, 'VSWCONE', 'concern', 'Hostel lights not working', 'resolved', '2026-09-06 02:30:00', '2026-09-10 05:00:00'),
  (9004815, 'VSWCONE', 'concern', 'Exam timetable not shared', 'open', '2026-10-06 02:30:00', '2026-10-06 02:30:00')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.lms_visit_concern_mentions (concern_id, visit_id, snippet, inserted_at)
VALUES
  (9004813, 9004733, 'Water tank leaks near the hostel', '2026-09-06 02:30:00'),
  (9004814, 9004733, 'Hostel corridor lights off', '2026-09-06 02:30:00'),
  (9004814, 9004734, 'Lights still flicker', '2026-10-06 02:30:00'),
  (9004815, 9004734, 'Timetable for exams not shared with students', '2026-10-06 02:30:00')
ON CONFLICT (concern_id, visit_id) DO NOTHING;

INSERT INTO public.lms_visit_concern_events (concern_id, kind, body, author_email, visit_id, inserted_at)
VALUES
  (9004814, 'resolved', 'Electrician replaced the wiring', 'e2e-vsw-pm3@test.local', NULL, '2026-09-10 05:00:00');

INSERT INTO public.lms_visit_note_summaries (visit_id, fingerprint, prompt_version, summarised_at)
VALUES
  (9004733, 'e2e-fp-9004733', 'e2e-v1', '2026-10-19 02:30:00'),
  (9004734, 'e2e-fp-9004734', 'e2e-v1', '2026-10-19 02:30:00')
ON CONFLICT (visit_id) DO NOTHING;

INSERT INTO public.user_permission
  (email, level, role, program_ids, school_codes, regions, full_name, read_only, user_id, revoked_at)
VALUES
  ('e2e-vsw-readonly@test.local', 3, 'program_admin', ARRAY[1, 2], NULL, NULL, 'VSW Read Only', true, NULL, NULL)
ON CONFLICT (email) DO NOTHING;
