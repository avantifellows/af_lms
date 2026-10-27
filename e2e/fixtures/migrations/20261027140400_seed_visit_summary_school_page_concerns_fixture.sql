-- School page concern sections fixture (#470, slice #481). Builds on the Visit Concerns fixture
-- (20261027140100_seed_visit_concerns_fixture.sql) at VSWCONA "VSW Concern Alpha" and adds:
--   * 9004732: an in-progress Visit by e2e-vsw-pm4@test.local on 2026-10-01 that mentions
--     9004803 "Timetable clashes…". In-progress Visits' mentions are not live, so 9004803 stays at
--     1 visit. By pm4, so every ?pms=e2e-vsw-pm3@test.local literal on the School-wise tab holds.
--   * e2e-vsw-resolver@test.local with a case-variant duplicate user_permission row
--     (E2E-VSW-Resolver@test.local); the lower id wins, so the name is "VSW Resolver", once.
--   * a comment by the resolver on resolved 9004804 "Water cooler broken".
-- e2e-vsw-pm3@test.local has no user_permission row, so their history entries show the email.
--
-- Hand-worked School page for VSWCONA with no filters (Visits in view: 9004720 10 Jun, 9004721 and
-- 9004722 06 Aug, 9004723 15 Sep, 9004725 25 Sep (no mentions), 9004732 01 Oct in progress; the
-- soft-deleted 9004724 is never in view). Cards sort by visits, then latest mention, then id:
--   Needs attention (4)
--     9004802 Students lack <b>practice</b>…   Recurring · 2 visits  15 Sep · 10 Jun   reopened
--             history: Resolved by e2e-vsw-pm3 12 Jun 2026, 11:30 "Practice tests scheduled weekly"
--                      Reopened automatically: raised again in visit of 15 Sept 2026
--     9004805 Physics teacher absent…          Recurring · 2 visits  15 Sep · 10 Jun   reopened
--             history: Resolved "Substitute teacher arranged" · Reopened "Substitute left after a month"
--     9004801 Lab equipment missing            Recurring · 2 visits  06 Aug ×2
--     9004803 Timetable clashes…               1 visit               15 Sep
--   Going well (1)
--     9004806 Strong peer learning culture     4 visits              15 Sep · 06 Aug ×2 · 10 Jun
--   Resolved concerns (1)
--     9004804 Water cooler broken              3 visits              15 Sep · 06 Aug · 10 Jun
--             resolved by e2e-vsw-pm3@test.local on 16 Sept 2026; history: Resolved "School
--             replaced the cooler" · Comment by VSW Resolver "Cooler checked again and working"
--   Hidden: 9004807 (only mentioned in the soft-deleted Visit).
--   Visit-wise notes (newest first): 01 Oct (in progress, none) · 25 Sep (none) ·
--     15 Sep (802, 803, 804, 805 + 806) · 06 Aug ×2 (801, 804 + 806 / 801 + 806) · 10 Jun (802, 804, 805 + 806)
-- With ?from=2026-08-01&to=2026-08-31: Needs attention 801 "Recurring · 2 visits" only; Going
-- well 806 "2 visits"; Resolved 804 "1 visit"; Visit-wise notes the two 06 Aug Visits.

INSERT INTO public.lms_pm_school_visits
  (id, school_code, pm_email, visit_date, status, inserted_at, updated_at, completed_at, deleted_at)
VALUES
  (9004732, 'VSWCONA', 'e2e-vsw-pm4@test.local', '2026-10-01', 'in_progress', '2026-10-01 04:00:00', '2026-10-01 05:00:00', NULL, NULL)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.lms_visit_concern_mentions (concern_id, visit_id, snippet, inserted_at)
VALUES
  (9004803, 9004732, 'Timetable clash in October', '2026-10-01 05:00:00')
ON CONFLICT (concern_id, visit_id) DO NOTHING;

INSERT INTO public.user_permission
  (email, level, role, program_ids, school_codes, regions, full_name, read_only, user_id, revoked_at)
VALUES
  ('e2e-vsw-resolver@test.local', 3, 'program_admin', ARRAY[1, 2], NULL, NULL, 'VSW Resolver', true, NULL, NULL)
ON CONFLICT (email) DO NOTHING;

INSERT INTO public.user_permission
  (email, level, role, program_ids, school_codes, regions, full_name, read_only, user_id, revoked_at)
VALUES
  ('E2E-VSW-Resolver@test.local', 3, 'program_admin', ARRAY[1, 2], NULL, NULL, 'VSW Resolver Duplicate', true, NULL, NULL)
ON CONFLICT (email) DO NOTHING;

INSERT INTO public.lms_visit_concern_events (concern_id, kind, body, author_email, visit_id, inserted_at)
VALUES
  (9004804, 'comment', 'Cooler checked again and working', 'e2e-vsw-resolver@test.local', NULL, '2026-09-20 05:00:00');
