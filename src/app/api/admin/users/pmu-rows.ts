import { query } from "@/lib/db";
import { PMU_GOVT_SCHOOL_USER_ROLE, PMU_PROGRAM_ID, type PmuRole } from "@/lib/constants";

// Admin-side shape rules for the two PMU roles (ADR 0007). They keep a stored
// row pinned to JNV NVS: program is always [64], a Govt School User holds
// exactly one JNV School, and a Manager's explicit scope only names JNV Schools.

export type PmuRowInput = {
  role: PmuRole;
  level?: number;
  school_codes?: string[] | null;
  regions?: string[] | null;
};

export type PmuRow = {
  level: number;
  school_codes: string[] | null;
  regions: string[] | null;
  program_ids: number[];
};

export const PMU_SEATED_ERROR =
  "This user is assigned to a centre. Remove their centre assignments in Staff Management before giving them a PMU role.";

// Whether the person behind `email` holds an active centre seat. The seat's
// User is matched by email (case-insensitive) or through any user_permission
// row with that email, so a permission linked only by email still counts.
// POST checks the posted email (it upserts); PATCH checks the stored row's.
export async function isSeatedEmail(email: string) {
  const seats = await query<{ one: number }>(
    `SELECT 1 AS one
     FROM centre_positions cp
     WHERE cp.deleted_at IS NULL
       AND cp.user_id IN (
         SELECT u.id FROM "user" u WHERE LOWER(u.email) = LOWER($1)
         UNION
         SELECT up.user_id FROM user_permission up
         WHERE LOWER(up.email) = LOWER($1) AND up.user_id IS NOT NULL
       )
     LIMIT 1`,
    [email]
  );
  return seats.length > 0;
}

const GOVT_SHAPE_ERROR =
  "A PMU Govt School User must have School access with exactly one JNV School";
const NON_JNV_ERROR = "PMU roles can only be assigned JNV Schools";

function nonEmpty(value: string[] | null | undefined): value is string[] {
  return Array.isArray(value) && value.length > 0;
}

async function allJnvSchools(codes: string[]) {
  const rows = await query<{ code: string }>(
    `SELECT code FROM school
     WHERE af_school_category = 'JNV' AND code = ANY($1::text[])`,
    [codes]
  );
  const jnv = new Set(rows.map((row) => row.code));
  return codes.every((code) => jnv.has(code));
}

async function allRegionsHaveJnvSchools(regions: string[]) {
  const rows = await query<{ region: string }>(
    `SELECT DISTINCT region FROM school
     WHERE af_school_category = 'JNV' AND region = ANY($1::text[])`,
    [regions]
  );
  const found = new Set(rows.map((row) => row.region));
  return regions.every((region) => found.has(region));
}

function pinned(level: number, schoolCodes: string[] | null, regions: string[] | null) {
  return { level, school_codes: schoolCodes, regions, program_ids: [PMU_PROGRAM_ID] };
}

type PmuRowResult = { ok: true; row: PmuRow } | { ok: false; error: string };

async function jnvSchoolRow(schoolCodes: string[]): Promise<PmuRowResult> {
  if (!(await allJnvSchools(schoolCodes))) return { ok: false, error: NON_JNV_ERROR };
  return { ok: true, row: pinned(1, schoolCodes, null) };
}

async function resolveGovtSchoolUserRow(input: PmuRowInput): Promise<PmuRowResult> {
  const { level, school_codes, regions } = input;
  if (level !== 1 || nonEmpty(regions) || school_codes?.length !== 1) {
    return { ok: false, error: GOVT_SHAPE_ERROR };
  }
  return jnvSchoolRow(school_codes);
}

async function resolveManagerRow(input: PmuRowInput): Promise<PmuRowResult> {
  const { level, school_codes, regions } = input;
  if (level === 1) {
    if (!nonEmpty(school_codes)) {
      return { ok: false, error: "A PMU Manager with School access needs at least one JNV School" };
    }
    return jnvSchoolRow(school_codes);
  }
  if (level === 2) {
    if (!nonEmpty(regions) || !(await allRegionsHaveJnvSchools(regions))) {
      return {
        ok: false,
        error: "A PMU Manager with Region access needs at least one region, each with a JNV School",
      };
    }
    return { ok: true, row: pinned(2, null, regions) };
  }
  if (level === 3) return { ok: true, row: pinned(3, null, null) };
  return { ok: false, error: "Level must be between 1 and 3" };
}

/** Validates the effective PMU row; returns the row to store or a 400 message. */
export async function resolvePmuRow(input: PmuRowInput): Promise<PmuRowResult> {
  if (input.role === PMU_GOVT_SCHOOL_USER_ROLE) return resolveGovtSchoolUserRow(input);
  return resolveManagerRow(input);
}
