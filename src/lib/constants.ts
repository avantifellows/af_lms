// Academic year used in BigQuery queries and the student enrollment list grade
// join — update when the new session starts.
export const CURRENT_ACADEMIC_YEAR = "2026-2027";

// Program IDs. Kept here (not in permissions.ts) so client components can
// import them without pulling in the server-only DB pool.
export const PROGRAM_IDS = {
  COE: 1,
  NODAL: 2,
  NVS: 64,
} as const;

// Canonical display order for program IDs.
export const PROGRAM_IDS_ORDERED: number[] = Object.values(PROGRAM_IDS);

// Maps program_ids to the BigQuery `student_program` label.
// Keep in sync with AddUserModal's PROGRAMS list.
export const PROGRAM_ID_TO_LABEL: Record<number, string> = {
  [PROGRAM_IDS.COE]: "JNV CoE",
  [PROGRAM_IDS.NODAL]: "JNV Nodal",
  [PROGRAM_IDS.NVS]: "JNV NVS",
};
