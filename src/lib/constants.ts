// Academic year used in BigQuery queries and the student enrollment list grade
// join — update when the new session starts.
export const CURRENT_ACADEMIC_YEAR = "2026-2027";

// Program IDs. Kept here (not in permissions.ts) so client components can
// import them without pulling in the server-only DB pool.
// NOTE (transitional): this hand-maintained list is the known debt the centre
// rollout is chipping away at — the long-term fix is to read `program` from the
// DB. Until then, add a program here when a non-JNV centre is onboarded.
export const PROGRAM_IDS = {
  COE: 1,
  NODAL: 2,
  NVS: 64,
  // Non-JNV centre programs (centre rollout — Punjab CoE meritorious schools, EMRS, RGNV).
  PUNJAB_COE: 74,
  PUNJAB_NODAL: 94,
  EMRS_COE: 78,
  UTTARAKHAND_COE: 88, // RGNV (Rajiv Gandhi Navodaya Vidyalaya) schools
  KARNATAKA_COE: 97, // GPUC Shimoga
  MAHARASHTRA_COACHING_TESTPREP: 99, // Mumbai Andheri/Dadar, Pune FC Road/Kasarwadi
  MAHARASHTRA_COACHING_FOUNDATION: 100, // Mumbai/Pune Foundation Coaching
} as const;

// Canonical display order for program IDs (JNV first, then non-JNV centres).
export const PROGRAM_IDS_ORDERED: number[] = Object.values(PROGRAM_IDS);

// Physical-centre programs — every program EXCEPT NVS. As far as LMS features
// go (curriculum, quiz sessions, visits, PM dashboard, summary stats) these are
// all equivalent; NVS is the sole exception (NVS-only users are gated out of
// those features). Derived from PROGRAM_IDS so a newly onboarded program is
// included automatically — no separate list to keep in sync.
export const PHYSICAL_CENTRE_PROGRAM_IDS: number[] = Object.values(
  PROGRAM_IDS,
).filter((id) => id !== PROGRAM_IDS.NVS);

// Maps program_ids to the BigQuery `student_program` label.
// Keep in sync with AddUserModal's PROGRAMS list.
export const PROGRAM_ID_TO_LABEL: Record<number, string> = {
  [PROGRAM_IDS.COE]: "JNV CoE",
  [PROGRAM_IDS.NODAL]: "JNV Nodal",
  [PROGRAM_IDS.NVS]: "JNV NVS",
  [PROGRAM_IDS.PUNJAB_COE]: "Punjab CoE",
  [PROGRAM_IDS.PUNJAB_NODAL]: "Punjab Nodal",
  [PROGRAM_IDS.EMRS_COE]: "EMRS CoE",
  [PROGRAM_IDS.UTTARAKHAND_COE]: "Uttarakhand CoE",
  [PROGRAM_IDS.KARNATAKA_COE]: "Karnataka CoE",
  [PROGRAM_IDS.MAHARASHTRA_COACHING_TESTPREP]: "Maharashtra Coaching Test Prep",
  [PROGRAM_IDS.MAHARASHTRA_COACHING_FOUNDATION]: "Maharashtra Coaching Foundation",
};

export const HOLISTIC_MENTORSHIP_PROGRAM_IDS = [
  PROGRAM_IDS.COE,
  PROGRAM_IDS.PUNJAB_COE,
  PROGRAM_IDS.EMRS_COE,
  PROGRAM_IDS.UTTARAKHAND_COE,
  PROGRAM_IDS.MAHARASHTRA_COACHING_TESTPREP,
] as const;

export type HolisticMentorshipProgramId =
  (typeof HOLISTIC_MENTORSHIP_PROGRAM_IDS)[number];

export function isHolisticMentorshipProgramId(
  value: unknown,
): value is HolisticMentorshipProgramId {
  return typeof value === "number" &&
    HOLISTIC_MENTORSHIP_PROGRAM_IDS.some((programId) => programId === value);
}

// Historical Holistic Notes are a reviewed one-time import for the original
// JNV and EMRS cohorts only. Keep this narrower than the live runtime
// allowlist: the newly enabled Programs do not have an approved source
// snapshot or baseline and must never inherit the EMRS assumptions.
export const HOLISTIC_HISTORICAL_IMPORT_PROGRAM_IDS = [
  PROGRAM_IDS.COE,
  PROGRAM_IDS.EMRS_COE,
] as const;

export type HolisticHistoricalImportProgramId =
  (typeof HOLISTIC_HISTORICAL_IMPORT_PROGRAM_IDS)[number];

export function isHolisticHistoricalImportProgramId(
  value: unknown,
): value is HolisticHistoricalImportProgramId {
  return typeof value === "number" &&
    HOLISTIC_HISTORICAL_IMPORT_PROGRAM_IDS.some((programId) => programId === value);
}

export const ACADEMIC_MENTORSHIP_PROGRAM_ALLOWLIST = ["*"] as const;
