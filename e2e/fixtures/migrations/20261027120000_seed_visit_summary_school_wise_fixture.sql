-- School Visit Summary school-wise fixture (#470). The Visit Summary covers only Schools with an
-- active physical Centre; e2e/tests/school-visit-summary-school-wise.spec.ts reads these rows.
-- Later #470 slices extend this set (Visit Concerns, Highlights, more Visits), so keep the School
-- codes and the PM stable:
--
--   VSWPHYS  physical-only School: one active CoE Centre                      → in view
--   VSWMIXED mixed JNV: an active Nodal Centre and an active JNV NVS Centre    → in view
--   VSWNVS   NVS-only JNV: only an active JNV NVS Centre                       → out of view
--   VSWOFF   only physical Centre is inactive                                  → out of view
--   VSWNOREG non-JNV School with no region (region IS NULL): one active CoE Centre → in view,
--            under the "No region (non-JNV)" Region option (#476)
--   VSWOLD   physical-only School last visited in 2025 → a stale Last visit on the School-wise tab (#477)
--
-- Each School except VSWOLD has one completed Visit by e2e-vsw-pm@test.local. A second PM,
-- e2e-vsw-pm2@test.local, has four more (#477), so School-wise counts differ per School:
--   VSWPHYS  completed two days before today (IST) and in progress on 2026-09-01
--   VSWOLD   completed on 2025-08-01 and 2025-07-15
-- #478 adds VSWCONA–VSWCOND (900477–900480, Centres 9004771/9004781/9004791/9004801), visited only by
-- e2e-vsw-pm3@test.local (Visits 9004720–9004731; one by e2e-vsw-pm4@test.local, one soft-deleted).
-- Their Visit Concerns are in 20261027140100_seed_visit_concerns_fixture.sql.
-- e2e-vsw-seated-pm@test.local (program_manager, no Visits) holds a `pm` seat at VSWPHYS's CoE and
-- at VSWNVS's NVS Centre, so the Visit Summary shows them VSWPHYS only. The region VSW_E2E (and
-- VSWNOREG's NULL region) is outside every fixture user's region scope, and no Centre maps a Centre Exam Track, so Curriculum
-- Summary rows and the region-scoped PM / Program Admin lists are unchanged.

INSERT INTO public.school
  (id, code, name, inserted_at, updated_at, udise_code, af_school_category, region, state, district, program_ids)
VALUES
  (900471, 'VSWPHYS', 'VSW Physical School', NOW(), NOW(), '47000000471', 'JNV', 'VSW_E2E', 'Gujarat', 'Anand', ARRAY[1]::integer[]),
  (900472, 'VSWMIXED', 'VSW Mixed JNV', NOW(), NOW(), '47000000472', 'JNV', 'VSW_E2E', 'Gujarat', 'Kutch', ARRAY[2, 64]::integer[]),
  (900473, 'VSWNVS', 'VSW NVS-only JNV', NOW(), NOW(), '47000000473', 'JNV', 'VSW_E2E', 'Gujarat', 'Surat', ARRAY[64]::integer[]),
  (900474, 'VSWOFF', 'VSW Inactive Centre School', NOW(), NOW(), '47000000474', 'JNV', 'VSW_E2E', 'Gujarat', 'Valsad', ARRAY[1]::integer[]),
  (900475, 'VSWNOREG', 'VSW No Region School', NOW(), NOW(), '47000000475', 'GSSS', NULL, 'Gujarat', 'Rajkot', ARRAY[1]::integer[]),
  (900476, 'VSWOLD', 'VSW Old Visit School', NOW(), NOW(), '47000000476', 'JNV', 'VSW_E2E', 'Gujarat', 'Bharuch', ARRAY[1]::integer[])
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

-- Program 1 = JNV CoE, Program 2 = JNV Nodal, Program 64 = JNV NVS.
INSERT INTO public.centres
  (id, name, school_id, is_physical, is_active, program_id)
VALUES
  (9004711, 'VSW E2E Physical CoE', 900471, true, true, 1),
  (9004721, 'VSW E2E Mixed Nodal', 900472, true, true, 2),
  (9004722, 'VSW E2E Mixed NVS', 900472, false, true, 64),
  (9004731, 'VSW E2E NVS Only', 900473, false, true, 64),
  (9004741, 'VSW E2E Closed CoE', 900474, true, false, 1),
  (9004751, 'VSW E2E No Region CoE', 900475, true, true, 1),
  (9004761, 'VSW E2E Old Visit CoE', 900476, true, true, 1)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  school_id = EXCLUDED.school_id,
  is_physical = EXCLUDED.is_physical,
  is_active = EXCLUDED.is_active,
  program_id = EXCLUDED.program_id,
  updated_at = NOW();

INSERT INTO public.lms_pm_school_visits
  (id, school_code, pm_email, visit_date, status, inserted_at, updated_at, completed_at)
VALUES
  (9004701, 'VSWPHYS', 'e2e-vsw-pm@test.local', '2026-10-05', 'completed', '2026-10-05 04:00:00', '2026-10-05 07:00:00', '2026-10-05 07:00:00'),
  (9004702, 'VSWMIXED', 'e2e-vsw-pm@test.local', '2026-10-06', 'completed', '2026-10-06 04:00:00', '2026-10-06 07:00:00', '2026-10-06 07:00:00'),
  (9004703, 'VSWNVS', 'e2e-vsw-pm@test.local', '2026-10-07', 'completed', '2026-10-07 04:00:00', '2026-10-07 07:00:00', '2026-10-07 07:00:00'),
  (9004704, 'VSWOFF', 'e2e-vsw-pm@test.local', '2026-10-08', 'completed', '2026-10-08 04:00:00', '2026-10-08 07:00:00', '2026-10-08 07:00:00'),
  (9004705, 'VSWNOREG', 'e2e-vsw-pm@test.local', '2026-10-09', 'completed', '2026-10-09 04:00:00', '2026-10-09 07:00:00', '2026-10-09 07:00:00'),
  (9004706, 'VSWPHYS', 'e2e-vsw-pm2@test.local', (NOW() AT TIME ZONE 'Asia/Kolkata')::date - 2, 'completed', NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'),
  (9004707, 'VSWPHYS', 'e2e-vsw-pm2@test.local', '2026-09-01', 'in_progress', '2026-09-01 04:00:00', '2026-09-01 04:00:00', NULL),
  (9004708, 'VSWOLD', 'e2e-vsw-pm2@test.local', '2025-08-01', 'completed', '2025-08-01 04:00:00', '2025-08-01 07:00:00', '2025-08-01 07:00:00'),
  (9004709, 'VSWOLD', 'e2e-vsw-pm2@test.local', '2025-07-15', 'completed', '2025-07-15 04:00:00', '2025-07-15 07:00:00', '2025-07-15 07:00:00')
ON CONFLICT (id) DO NOTHING;

-- Visit Concerns Schools (#478).
INSERT INTO public.school
  (id, code, name, inserted_at, updated_at, udise_code, af_school_category, region, state, district, program_ids)
VALUES
  (900477, 'VSWCONA', 'VSW Concern Alpha', NOW(), NOW(), '47000000477', 'JNV', 'VSW_E2E', 'Gujarat', 'Anand', ARRAY[1]::integer[]),
  (900478, 'VSWCONB', 'VSW Concern Bravo', NOW(), NOW(), '47000000478', 'JNV', 'VSW_E2E', 'Gujarat', 'Kheda', ARRAY[1]::integer[]),
  (900479, 'VSWCONC', 'VSW Concern Charlie', NOW(), NOW(), '47000000479', 'JNV', 'VSW_E2E', 'Gujarat', 'Patan', ARRAY[1]::integer[]),
  (900480, 'VSWCOND', 'VSW Concern Delta', NOW(), NOW(), '47000000480', 'JNV', 'VSW_E2E', 'Gujarat', 'Dahod', ARRAY[1]::integer[])
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
  (9004771, 'VSW E2E Concern Alpha CoE', 900477, true, true, 1),
  (9004781, 'VSW E2E Concern Bravo CoE', 900478, true, true, 1),
  (9004791, 'VSW E2E Concern Charlie CoE', 900479, true, true, 1),
  (9004801, 'VSW E2E Concern Delta CoE', 900480, true, true, 1)
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
  (9004720, 'VSWCONA', 'e2e-vsw-pm3@test.local', '2026-06-10', 'completed', '2026-06-10 04:00:00', '2026-06-10 07:00:00', '2026-06-10 07:00:00', NULL),
  (9004721, 'VSWCONA', 'e2e-vsw-pm3@test.local', '2026-08-06', 'completed', '2026-08-06 04:00:00', '2026-08-06 06:00:00', '2026-08-06 06:00:00', NULL),
  (9004722, 'VSWCONA', 'e2e-vsw-pm3@test.local', '2026-08-06', 'completed', '2026-08-06 08:00:00', '2026-08-06 10:00:00', '2026-08-06 10:00:00', NULL),
  (9004723, 'VSWCONA', 'e2e-vsw-pm3@test.local', '2026-09-15', 'completed', '2026-09-15 04:00:00', '2026-09-15 07:00:00', '2026-09-15 07:00:00', NULL),
  (9004724, 'VSWCONA', 'e2e-vsw-pm3@test.local', '2026-09-20', 'completed', '2026-09-20 04:00:00', '2026-09-22 07:00:00', '2026-09-20 07:00:00', '2026-09-22 07:00:00'),
  (9004725, 'VSWCONA', 'e2e-vsw-pm3@test.local', '2026-09-25', 'completed', '2026-09-25 04:00:00', '2026-09-25 07:00:00', '2026-09-25 07:00:00', NULL),
  (9004726, 'VSWCONB', 'e2e-vsw-pm3@test.local', '2026-07-01', 'completed', '2026-07-01 04:00:00', '2026-07-01 07:00:00', '2026-07-01 07:00:00', NULL),
  (9004727, 'VSWCONB', 'e2e-vsw-pm3@test.local', '2026-08-01', 'completed', '2026-08-01 04:00:00', '2026-08-01 07:00:00', '2026-08-01 07:00:00', NULL),
  (9004728, 'VSWCONB', 'e2e-vsw-pm3@test.local', '2026-09-01', 'completed', '2026-09-01 04:00:00', '2026-09-01 07:00:00', '2026-09-01 07:00:00', NULL),
  (9004729, 'VSWCONB', 'e2e-vsw-pm4@test.local', '2026-10-02', 'completed', '2026-10-02 04:00:00', '2026-10-02 07:00:00', '2026-10-02 07:00:00', NULL),
  (9004730, 'VSWCONC', 'e2e-vsw-pm3@test.local', '2026-09-10', 'completed', '2026-09-10 04:00:00', '2026-09-10 07:00:00', '2026-09-10 07:00:00', NULL),
  (9004731, 'VSWCOND', 'e2e-vsw-pm3@test.local', '2026-09-12', 'completed', '2026-09-12 04:00:00', '2026-09-12 07:00:00', '2026-09-12 07:00:00', NULL)
ON CONFLICT (id) DO NOTHING;

-- A seated PM: their `pm` seats make VSWPHYS and VSWNVS visit-managed; the physical-only rule
-- then hides VSWNVS.
INSERT INTO public."user" (id, email, role, inserted_at, updated_at)
VALUES (9004791, 'e2e-vsw-seated-pm@test.local', 'teacher', NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.user_permission
  (email, level, role, program_ids, school_codes, regions, full_name, read_only, user_id, revoked_at)
VALUES
  ('e2e-vsw-seated-pm@test.local', 1, 'program_manager', ARRAY[1, 2], NULL, NULL, 'VSW Seated PM', false, 9004791, NULL)
ON CONFLICT (email) DO UPDATE SET
  level = EXCLUDED.level,
  role = EXCLUDED.role,
  program_ids = EXCLUDED.program_ids,
  school_codes = EXCLUDED.school_codes,
  regions = EXCLUDED.regions,
  full_name = EXCLUDED.full_name,
  read_only = EXCLUDED.read_only,
  user_id = EXCLUDED.user_id,
  revoked_at = EXCLUDED.revoked_at;

INSERT INTO public.centre_positions (id, centre_id, role, user_id)
VALUES
  (9004791, 9004711, 'pm', 9004791),
  (9004792, 9004731, 'pm', 9004791)
ON CONFLICT (id) DO NOTHING;
