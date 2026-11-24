-- Visit Concerns fixture for the School-wise tab (#470, slice #478). Read by
-- e2e/tests/school-visit-summary-school-wise.spec.ts. The four physical-only Schools VSWCONA–VSWCOND
-- (region VSW_E2E) and their Visits live in 20261027120000_seed_visit_summary_school_wise_fixture.sql;
-- this file (after the 20261027140000 schema mirror) adds their concern records, mentions, history
-- and note summaries. The Visits are by e2e-vsw-pm3@test.local (plus one by e2e-vsw-pm4@test.local),
-- so the literals under ?pms=e2e-vsw-pm@test.local / e2e-vsw-pm2@test.local don't move.
--
-- Visits (all completed unless noted):
--   VSWCONA "VSW Concern Alpha"   9004720 2026-06-10 · 9004721 2026-08-06 · 9004722 2026-08-06 (same day)
--                                 · 9004723 2026-09-15 · 9004724 2026-09-20 (soft-deleted)
--                                 · 9004725 2026-09-25 (no summary row → "waiting")
--   VSWCONB "VSW Concern Bravo"   9004726 2026-07-01 · 9004727 2026-08-01 · 9004728 2026-09-01
--                                 · 9004729 2026-10-02 (by e2e-vsw-pm4)
--   VSWCONC "VSW Concern Charlie" 9004730 2026-09-10
--   VSWCOND "VSW Concern Delta"   9004731 2026-09-12
--
-- Records (live mentions = mentions on completed, non-deleted Visits; 9004802's 15 Sep snippet is
-- HTML-shaped so the School page's mention lines can be checked to render it as text):
--   9004801 Alpha concern open      Lab equipment missing            21, 22          → 2 visits, 1 date (not recurring)
--   9004802 Alpha concern open      Students lack <b>practice</b>…   20, 23          → 2 visits, auto-reopened
--   9004803 Alpha concern open      Timetable clashes…               23, 24(deleted) → 1 visit
--   9004804 Alpha concern resolved  Water cooler broken              20, 21, 23      → never counts
--   9004805 Alpha concern open      Physics teacher absent…          20, 23          → 2 visits, reopened
--   9004806 Alpha highlight         Strong peer learning culture     20, 21, 22, 23  → never counts
--   9004807 Alpha concern open      Broken benches in the hostel     24(deleted)     → hidden
--   9004808 Bravo concern open      Smartboard not working           26, 27, 28      → 3 visits
--   9004809 Bravo concern open      Library closed during study…     28, 29(pm4)     → 1 visit for pm3 only
--   9004810 Charlie concern open    Fee receipts pending             30              → 1 visit
--   9004811 Delta concern resolved  Shortage of chairs               31              → never counts
--   9004812 Delta highlight         Regular parent meetings          31              → never counts
--
-- Recurring = open, with live mentions on 2+ distinct visit dates in view (same-day Visits count
-- once; stakeholder decision 30 Oct 2026). The "N visits" labels still count Visits.
-- Hand-worked answers under ?pms=e2e-vsw-pm3@test.local (default sort Recurring issues desc):
--   Alpha   5 visits · 2 recurring (802, 805; 801's two Visits share 06 Aug), 4 open · top 802
--           "2 visits" (ties 805 on 2 dates, 2 visits and 15 Sep, lower id) · severity 1–2
--   Bravo   3 visits · 1 recurring (808), 2 open · top 808 "3 visits" · severity 1–2
--   Charlie 1 visit  · 0 recurring, 1 open · severity open-not-recurring
--   Delta   1 visit  · 0 recurring, 0 open · severity none
--   Stats: Schools 4 · Visits 10 · Schools with recurring concerns 2 · Open concerns 7
--   Freshness: summarised up to 20 Oct 2026, 14:00 IST (08:30 UTC) · 1 visit waiting (9004725)
-- Adding e2e-vsw-pm4: Bravo 4 visits, 2 recurring (808 on 3 dates stays top over 809's newer 2).
-- Only August 2026: Alpha 2 visits, 0 recurring (801's two Visits are one date), 1 open, severity
-- open-not-recurring; Bravo 1 visit, 0 recurring, 1 open; Schools with recurring concerns 0.
-- From 1 Sep 2026: Alpha 0 recurring, 3 open (802, 803, 805: the deleted Visit and the hidden concern don't count).

INSERT INTO public.lms_visit_concerns (id, school_code, kind, text, status, inserted_at, updated_at)
VALUES
  (9004801, 'VSWCONA', 'concern', 'Lab equipment missing', 'open', '2026-08-07 02:30:00', '2026-08-07 02:30:00'),
  (9004802, 'VSWCONA', 'concern', 'Students lack <b>practice</b> tests <img src=x onerror=alert(1)>', 'open', '2026-06-11 02:30:00', '2026-10-19 02:30:00'),
  (9004803, 'VSWCONA', 'concern', 'Timetable clashes with board exam preparation', 'open', '2026-09-16 02:30:00', '2026-09-16 02:30:00'),
  (9004804, 'VSWCONA', 'concern', 'Water cooler broken', 'resolved', '2026-06-11 02:30:00', '2026-09-16 05:00:00'),
  (9004805, 'VSWCONA', 'concern', 'Physics teacher absent on Saturdays', 'open', '2026-06-11 02:30:00', '2026-09-17 05:00:00'),
  (9004806, 'VSWCONA', 'highlight', 'Strong peer learning culture', NULL, '2026-06-11 02:30:00', '2026-06-11 02:30:00'),
  (9004807, 'VSWCONA', 'concern', 'Broken benches in the hostel', 'open', '2026-09-21 02:30:00', '2026-09-21 02:30:00'),
  (9004808, 'VSWCONB', 'concern', 'Smartboard not working', 'open', '2026-07-02 02:30:00', '2026-07-02 02:30:00'),
  (9004809, 'VSWCONB', 'concern', 'Library closed during study hours', 'open', '2026-09-02 02:30:00', '2026-09-02 02:30:00'),
  (9004810, 'VSWCONC', 'concern', 'Fee receipts pending', 'open', '2026-09-11 02:30:00', '2026-09-11 02:30:00'),
  (9004811, 'VSWCOND', 'concern', 'Shortage of chairs', 'resolved', '2026-09-13 02:30:00', '2026-09-20 05:00:00'),
  (9004812, 'VSWCOND', 'highlight', 'Regular parent meetings', NULL, '2026-09-13 02:30:00', '2026-09-13 02:30:00')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.lms_visit_concern_mentions (concern_id, visit_id, snippet, inserted_at)
VALUES
  (9004801, 9004721, 'Lab has no burettes', '2026-08-07 02:30:00'),
  (9004801, 9004722, 'Chemistry lab still short of equipment', '2026-08-07 02:30:00'),
  (9004802, 9004720, 'Few practice tests', '2026-06-11 02:30:00'),
  (9004802, 9004723, 'Practice tests still <b>missing</b> <img src=x onerror=alert(2)>', '2026-09-16 02:30:00'),
  (9004803, 9004723, 'Timetable clash', '2026-09-16 02:30:00'),
  (9004803, 9004724, 'Timetable clash again', '2026-09-21 02:30:00'),
  (9004804, 9004720, 'Cooler not working', '2026-06-11 02:30:00'),
  (9004804, 9004721, 'Cooler still broken', '2026-08-07 02:30:00'),
  (9004804, 9004723, 'Cooler broken', '2026-09-16 02:30:00'),
  (9004805, 9004720, 'Physics teacher missed Saturday class', '2026-06-11 02:30:00'),
  (9004805, 9004723, 'Physics teacher absent again', '2026-09-16 02:30:00'),
  (9004806, 9004720, 'Students teach each other', '2026-06-11 02:30:00'),
  (9004806, 9004721, 'Peer groups active', '2026-08-07 02:30:00'),
  (9004806, 9004722, 'Peer groups active', '2026-08-07 02:30:00'),
  (9004806, 9004723, 'Peer learning strong', '2026-09-16 02:30:00'),
  (9004807, 9004724, 'Hostel benches broken', '2026-09-21 02:30:00'),
  (9004808, 9004726, 'Smartboard dead', '2026-07-02 02:30:00'),
  (9004808, 9004727, 'Smartboard still dead', '2026-08-02 02:30:00'),
  (9004808, 9004728, 'Smartboard not repaired', '2026-09-02 02:30:00'),
  (9004809, 9004728, 'Library locked in study hours', '2026-09-02 02:30:00'),
  (9004809, 9004729, 'Library closed again', '2026-10-03 02:30:00'),
  (9004810, 9004730, 'Fee receipts not issued', '2026-09-11 02:30:00'),
  (9004811, 9004731, 'Not enough chairs', '2026-09-13 02:30:00'),
  (9004812, 9004731, 'Parent meeting held', '2026-09-13 02:30:00')
ON CONFLICT (concern_id, visit_id) DO NOTHING;

INSERT INTO public.lms_visit_concern_events (concern_id, kind, body, author_email, visit_id, inserted_at)
VALUES
  (9004802, 'resolved', 'Practice tests scheduled weekly', 'e2e-vsw-pm3@test.local', NULL, '2026-06-12 06:00:00'),
  (9004802, 'auto_reopened', NULL, NULL, 9004723, '2026-10-19 02:30:00'),
  (9004804, 'resolved', 'School replaced the cooler', 'e2e-vsw-pm3@test.local', NULL, '2026-09-16 05:00:00'),
  (9004805, 'resolved', 'Substitute teacher arranged', 'e2e-vsw-pm3@test.local', NULL, '2026-07-01 05:00:00'),
  (9004805, 'reopened', 'Substitute left after a month', 'e2e-vsw-pm3@test.local', NULL, '2026-09-17 05:00:00'),
  (9004811, 'resolved', 'Chairs delivered', 'e2e-vsw-pm3@test.local', NULL, '2026-09-20 05:00:00');

-- Every completed Visit is summarised except 9004725 (the deleted 9004724 was summarised before
-- it was deleted). The latest run was 20 Oct 2026 08:30 UTC.
INSERT INTO public.lms_visit_note_summaries (visit_id, fingerprint, prompt_version, summarised_at)
VALUES
  (9004720, 'e2e-fp-9004720', 'e2e-v1', '2026-10-19 02:30:00'),
  (9004721, 'e2e-fp-9004721', 'e2e-v1', '2026-10-19 02:30:00'),
  (9004722, 'e2e-fp-9004722', 'e2e-v1', '2026-10-19 02:30:00'),
  (9004723, 'e2e-fp-9004723', 'e2e-v1', '2026-10-19 02:30:00'),
  (9004724, 'e2e-fp-9004724', 'e2e-v1', '2026-10-19 02:30:00'),
  (9004726, 'e2e-fp-9004726', 'e2e-v1', '2026-10-19 02:30:00'),
  (9004727, 'e2e-fp-9004727', 'e2e-v1', '2026-10-19 02:30:00'),
  (9004728, 'e2e-fp-9004728', 'e2e-v1', '2026-10-19 02:30:00'),
  (9004729, 'e2e-fp-9004729', 'e2e-v1', '2026-10-20 08:30:00'),
  (9004730, 'e2e-fp-9004730', 'e2e-v1', '2026-10-19 02:30:00'),
  (9004731, 'e2e-fp-9004731', 'e2e-v1', '2026-10-19 02:30:00')
ON CONFLICT (visit_id) DO NOTHING;
