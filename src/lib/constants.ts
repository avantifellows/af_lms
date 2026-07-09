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
  // Non-JNV centre programs (centre rollout — Punjab CoE meritorious schools + EMRS).
  PUNJAB_COE: 74,
  PUNJAB_NODAL: 94,
  EMRS_COE: 78,
} as const;

// Canonical display order for program IDs (JNV first, then non-JNV centres).
export const PROGRAM_IDS_ORDERED: number[] = Object.values(PROGRAM_IDS);

// The CoE/Nodal ("academic intervention") program family: JNV CoE/Nodal plus the
// state-centre programs (Punjab CoE/Nodal, EMRS CoE). These are the programs that
// grant the CoE/Nodal feature set (curriculum, quiz sessions, visits, PM
// dashboard, summary stats) and form the curriculum's program universe. NVS is
// deliberately excluded — NVS-only users are gated out of those features. Add a
// new non-JNV centre program here (as well as to PROGRAM_IDS) when it onboards.
export const COE_NODAL_PROGRAM_IDS: number[] = [
  PROGRAM_IDS.COE,
  PROGRAM_IDS.NODAL,
  PROGRAM_IDS.PUNJAB_COE,
  PROGRAM_IDS.PUNJAB_NODAL,
  PROGRAM_IDS.EMRS_COE,
];

// Maps program_ids to the BigQuery `student_program` label.
// Keep in sync with AddUserModal's PROGRAMS list.
export const PROGRAM_ID_TO_LABEL: Record<number, string> = {
  [PROGRAM_IDS.COE]: "JNV CoE",
  [PROGRAM_IDS.NODAL]: "JNV Nodal",
  [PROGRAM_IDS.NVS]: "JNV NVS",
  [PROGRAM_IDS.PUNJAB_COE]: "Punjab CoE",
  [PROGRAM_IDS.PUNJAB_NODAL]: "Punjab Nodal",
  [PROGRAM_IDS.EMRS_COE]: "EMRS CoE",
};

export const ACADEMIC_MENTORSHIP_PROGRAM_ALLOWLIST = ["*"] as const;
