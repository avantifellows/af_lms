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
--
-- Each School has one completed Visit by e2e-vsw-pm@test.local. The region VSW_E2E (and
-- VSWNOREG's NULL region) is outside every fixture user's region scope, and no Centre maps a Centre Exam Track, so Curriculum
-- Summary rows and the region-scoped PM / Program Admin lists are unchanged.

INSERT INTO public.school
  (id, code, name, inserted_at, updated_at, udise_code, af_school_category, region, state, district, program_ids)
VALUES
  (900471, 'VSWPHYS', 'VSW Physical School', NOW(), NOW(), '47000000471', 'JNV', 'VSW_E2E', 'Gujarat', 'Anand', ARRAY[1]::integer[]),
  (900472, 'VSWMIXED', 'VSW Mixed JNV', NOW(), NOW(), '47000000472', 'JNV', 'VSW_E2E', 'Gujarat', 'Kutch', ARRAY[2, 64]::integer[]),
  (900473, 'VSWNVS', 'VSW NVS-only JNV', NOW(), NOW(), '47000000473', 'JNV', 'VSW_E2E', 'Gujarat', 'Surat', ARRAY[64]::integer[]),
  (900474, 'VSWOFF', 'VSW Inactive Centre School', NOW(), NOW(), '47000000474', 'JNV', 'VSW_E2E', 'Gujarat', 'Valsad', ARRAY[1]::integer[]),
  (900475, 'VSWNOREG', 'VSW No Region School', NOW(), NOW(), '47000000475', 'GSSS', NULL, 'Gujarat', 'Rajkot', ARRAY[1]::integer[])
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
  (9004751, 'VSW E2E No Region CoE', 900475, true, true, 1)
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
  (9004705, 'VSWNOREG', 'e2e-vsw-pm@test.local', '2026-10-09', 'completed', '2026-10-09 04:00:00', '2026-10-09 07:00:00', '2026-10-09 07:00:00')
ON CONFLICT (id) DO NOTHING;
