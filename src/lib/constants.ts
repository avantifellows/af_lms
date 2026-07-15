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
} as const;

// Canonical display order for program IDs (JNV first, then non-JNV centres).
export const PROGRAM_IDS_ORDERED: number[] = Object.values(PROGRAM_IDS);

// Priority for attributing a student to ONE program when they sit in multiple
// program batches: JNV CoE → Nodal → NVS. Used by the roster and dashboard
// attribution LATERALs (array_position tiebreak). NOTE: intentionally the three
// JNV programs only — non-JNV centre programs aren't part of this tiebreak yet
// (see the attribution single-source follow-up). Keep in sync with the
// centre_students view's tiebreak until that lands.
export const PROGRAM_ATTRIBUTION_ORDER: number[] = [
  PROGRAM_IDS.COE,
  PROGRAM_IDS.NODAL,
  PROGRAM_IDS.NVS,
];

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
};

export const ACADEMIC_MENTORSHIP_PROGRAM_ALLOWLIST = ["*"] as const;
