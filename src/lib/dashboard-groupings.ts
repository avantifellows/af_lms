import { query } from "@/lib/db";
import {
  CURRENT_ACADEMIC_YEAR,
  PROGRAM_IDS,
  PROGRAM_ATTRIBUTION_ORDER,
} from "@/lib/constants";
import { isCentreSeated, type UserPermission } from "@/lib/permissions";
import type { GradeCount } from "@/components/SchoolCard";

/**
 * Dashboard groupings — the disjoint scope views the dashboard tabs render.
 *
 * A student belongs to exactly one scope, keyed by their single attributed
 * program (CoE → Nodal → NVS tiebreak):
 *   - "Physical Centres"  → the centre_students view (attributed program matches
 *     a centre at the school). {@link getAccessibleCentresWithCounts}
 *   - "JNV NVS Schools"    → students whose attributed program is JNV NVS.
 *     {@link getNvsGradeCounts}
 * Because the scopes partition by attributed program, tab counts never double-
 * count the same student. (Provisional note: the attributed-program tiebreak is
 * still duplicated between this file and the centre_students view — see the
 * attribution single-source-of-truth follow-up.)
 */

export interface Centre {
  id: string;
  name: string;
  program_name: string | null;
  school_id: string | null;
  school_code: string | null;
  school_name: string | null;
  region: string | null;
  student_count: number;
  grade_counts: GradeCount[];
}

/** A centre resolved for its detail page: the centre + its parent school. */
export interface CentreDetail {
  id: string;
  name: string;
  program_id: number | null;
  program_name: string | null;
  school: {
    id: string;
    name: string;
    code: string;
    udise_code: string | null;
    district: string;
    state: string;
    region: string | null;
  } | null;
}

/**
 * Resolve a single active centre with its program and parent school for the
 * centre detail page. Returns null for an unknown/inactive centre. `school` is
 * null for a school-less (city) centre — the caller decides how to handle that
 * (the roster page needs a school for its school-keyed tabs).
 */
export async function getCentreWithSchool(
  centreId: string | number,
): Promise<CentreDetail | null> {
  const rows = await query<{
    id: string;
    name: string;
    program_id: number | null;
    program_name: string | null;
    school_id: string | null;
    school_name: string | null;
    school_code: string | null;
    udise_code: string | null;
    district: string | null;
    state: string | null;
    region: string | null;
  }>(
    `SELECT c.id, c.name, c.program_id, p.name AS program_name,
            sch.id AS school_id, sch.name AS school_name, sch.code AS school_code,
            sch.udise_code, sch.district, sch.state, sch.region
     FROM centres c
     LEFT JOIN program p ON p.id = c.program_id
     LEFT JOIN school sch ON sch.id = c.school_id
     WHERE c.id = $1 AND c.is_active`,
    [centreId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    program_id: row.program_id,
    program_name: row.program_name,
    school: row.school_id
      ? {
          id: row.school_id,
          name: row.school_name ?? "",
          code: row.school_code ?? "",
          udise_code: row.udise_code,
          district: row.district ?? "",
          state: row.state ?? "",
          region: row.region,
        }
      : null,
  };
}

interface CentreCountRow {
  id: string;
  name: string;
  program_name: string | null;
  school_id: string | null;
  school_code: string | null;
  school_name: string | null;
  region: string | null;
  grade: number | null;
  count: string;
}

/**
 * Which centres a viewer may see, resolved from their permission:
 *  - "all"     → admins (level 3)
 *  - "ids"     → a seated user (teacher) sees ONLY the centres they hold a seat
 *                at — not every centre at the school
 *  - "schools" → a seatless manager (PM/region) sees every centre at the schools
 *                they can access (school-scoped, as before)
 */
export type CentreAccess =
  | { kind: "all" }
  | { kind: "ids"; ids: number[] }
  | { kind: "schools"; codes: string[] };

/**
 * Turn a resolved permission + accessible school codes into a {@link CentreAccess}.
 * A user with any centre seats is treated as seat-scoped (sees only those
 * centres); one with no seats falls back to their school scope.
 */
export function resolveCentreAccess(
  permission: UserPermission | null,
  schoolCodes: string[] | "all",
): CentreAccess {
  const centres = permission?.scope?.centres;
  if (centres === "all") return { kind: "all" };
  // isCentreSeated guarantees a non-empty Set here.
  if (isCentreSeated(permission)) return { kind: "ids", ids: [...(centres as Set<number>)] };
  if (schoolCodes === "all") return { kind: "all" };
  return { kind: "schools", codes: schoolCodes };
}

/**
 * Active centres the user can access, each with its current-year student count
 * and grade breakdown from the centre_students view. Scope is decided by
 * {@link resolveCentreAccess}: admins see all, seated teachers see only their
 * seat centres, seatless managers see every centre at their accessible schools.
 * Centres with zero current-year students are still returned so freshly-
 * onboarded centres are visible.
 */
export async function getAccessibleCentresWithCounts(
  access: CentreAccess,
): Promise<Centre[]> {
  if (access.kind === "ids" && access.ids.length === 0) return [];
  if (access.kind === "schools" && access.codes.length === 0) return [];

  let scopeClause = "";
  const params: unknown[] = [CURRENT_ACADEMIC_YEAR];
  if (access.kind === "ids") {
    scopeClause = "AND c.id = ANY($2)";
    params.push(access.ids);
  } else if (access.kind === "schools") {
    scopeClause = "AND sch.code = ANY($2)";
    params.push(access.codes);
  }

  const rows = await query<CentreCountRow>(
    `SELECT
       c.id,
       c.name,
       p.name AS program_name,
       c.school_id,
       sch.code AS school_code,
       sch.name AS school_name,
       sch.region,
       cs.grade,
       COUNT(DISTINCT cs.user_id) AS count
     FROM centres c
     LEFT JOIN program p ON p.id = c.program_id
     LEFT JOIN school sch ON sch.id = c.school_id
     LEFT JOIN centre_students cs
       ON cs.centre_id = c.id AND cs.academic_year = $1
     WHERE c.is_active ${scopeClause}
     GROUP BY c.id, c.name, p.name, c.school_id, sch.code, sch.name, sch.region, cs.grade
     ORDER BY c.name, cs.grade`,
    params,
  );

  // Fold the per-(centre, grade) rows into one entity per centre.
  const byId = new Map<string, Centre>();
  for (const row of rows) {
    let centre = byId.get(row.id);
    if (!centre) {
      centre = {
        id: row.id,
        name: row.name,
        program_name: row.program_name,
        school_id: row.school_id,
        school_code: row.school_code,
        school_name: row.school_name,
        region: row.region,
        student_count: 0,
        grade_counts: [],
      };
      byId.set(row.id, centre);
    }
    // grade is null only for a centre with no current-year students (the LEFT
    // JOIN's empty side) — skip it but keep the (zero-count) centre.
    if (row.grade !== null) {
      const count = parseInt(row.count, 10);
      centre.grade_counts.push({ grade: row.grade, count });
      centre.student_count += count;
    }
  }
  return [...byId.values()];
}

/**
 * Per-(school, grade) counts of students whose single attributed program is
 * JNV NVS — the disjoint counterpart to the centre counts. Scoped to the given
 * school ids and the current academic year. Returned as a Map keyed by
 * school_id so the caller can merge into its loaded school cards.
 */
export async function getNvsGradeCounts(
  schoolIds: string[],
): Promise<Map<string, GradeCount[]>> {
  if (schoolIds.length === 0) return new Map();

  const rows = await query<{ school_id: string; grade: number; count: string }>(
    `SELECT s.id AS school_id, gr.number AS grade, COUNT(DISTINCT gu.user_id) AS count
     FROM school s
     JOIN "group" g ON g.type = 'school' AND g.child_id = s.id
     JOIN group_user gu ON gu.group_id = g.id
     JOIN enrollment_record er ON er.user_id = gu.user_id
       AND er.group_type = 'grade' AND er.is_current = true
       AND er.academic_year = $2
     JOIN grade gr ON er.group_id = gr.id
     -- Attribute each student to one program (CoE → Nodal → NVS), then keep
     -- only NVS-attributed students so this scope is disjoint from the centres.
     JOIN LATERAL (
       SELECT b.program_id
       FROM group_user gub
       JOIN "group" gb ON gub.group_id = gb.id AND gb.type = 'batch'
       JOIN batch b ON gb.child_id = b.id
       WHERE gub.user_id = gu.user_id
       ORDER BY array_position(ARRAY[${PROGRAM_ATTRIBUTION_ORDER.join(", ")}]::int[], b.program_id::int)
       LIMIT 1
     ) att ON true
     WHERE s.id = ANY($1) AND att.program_id = $3
     GROUP BY s.id, gr.number
     ORDER BY gr.number`,
    [schoolIds, CURRENT_ACADEMIC_YEAR, PROGRAM_IDS.NVS],
  );

  const byId = new Map<string, GradeCount[]>();
  for (const row of rows) {
    const list = byId.get(row.school_id) ?? [];
    list.push({ grade: row.grade, count: parseInt(row.count, 10) });
    byId.set(row.school_id, list);
  }
  return byId;
}
