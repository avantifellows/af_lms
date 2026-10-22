import { query } from "@/lib/db";
import type { UserPermission } from "@/lib/permissions";
import { ALUMNI_PROGRAM_ORDER } from "./config";
import { schoolScopeSql } from "./scope";
import { cohortCte, cohortParams } from "./students";

// The schools on the Alumni home page: every school in the person's scope with
// pass-outs still to add or alumni on record, counted the same way the
// school's lists are (pass-outs by their pass-out-year school, alumni by their
// latest school).

export interface AlumniSchool {
  code: string;
  name: string;
  toAdd: number;
  alumni: number;
}

interface SchoolCountRow {
  code: string;
  name: string;
  region: string | null;
  to_add: number;
  alumni: number;
}

/**
 * The person's scope narrows the query up front (not after counting every
 * school), so a one-school manager's page reads only that school's students.
 */
export async function listAlumniSchools(permission: UserPermission): Promise<AlumniSchool[]> {
  const params = cohortParams();
  const scope = schoolScopeSql(permission, "sc.code", "sc.region", params.length + 1);
  const scoped = scope.sql !== "TRUE";
  const members = scoped
    ? `scoped_members AS MATERIALIZED (
         SELECT er.user_id FROM enrollment_record er JOIN school sc ON sc.id = er.group_id
         WHERE er.group_type = 'school' AND ${scope.sql}
       ),`
    : "";
  const inScope = (column: string) => (scoped ? `AND ${column} IN (SELECT user_id FROM scoped_members)` : "");
  const rows = await query<SchoolCountRow>(
    `WITH ${members} ${cohortCte(inScope("er.user_id"))},
     alumni_school AS (
       SELECT sch.code
       FROM alumni a
       JOIN student s ON s.id = a.student_id
       JOIN LATERAL (
         SELECT sc.code
         FROM enrollment_record er JOIN school sc ON sc.id = er.group_id
         WHERE er.user_id = s.user_id AND er.group_type = 'school'
         ORDER BY er.academic_year DESC NULLS LAST, er.is_current DESC, er.id DESC
         LIMIT 1
       ) sch ON true
       WHERE TRUE ${inScope("s.user_id")}
     ),
     counts AS (
       SELECT school_code AS code, COUNT(*) AS to_add, 0 AS alumni
       FROM cohort_flagged
       WHERE school_code IS NOT NULL AND NOT is_alumni AND COALESCE(status, '') <> 'dropout'
       GROUP BY school_code
       UNION ALL
       SELECT code, 0, COUNT(*) FROM alumni_school GROUP BY code
     )
     SELECT c.code, sc.name, sc.region, SUM(c.to_add)::int AS to_add, SUM(c.alumni)::int AS alumni
     FROM counts c JOIN school sc ON sc.code = c.code
     WHERE ${scope.sql}
     GROUP BY c.code, sc.name, sc.region`,
    [...params, ...scope.params],
  );
  return rows
    .map((r) => ({ code: r.code, name: r.name, toAdd: Number(r.to_add), alumni: Number(r.alumni) }))
    .sort((a, b) => b.toAdd - a.toAdd || a.name.localeCompare(b.name));
}

/** The school's name, or null when there's no school with this code. */
export async function getSchoolName(code: string): Promise<string | null> {
  const [school] = await query<{ name: string }>(`SELECT name FROM school WHERE code = $1`, [code]);
  return school?.name ?? null;
}

/**
 * Does this school belong on the Alumni side? Audience: physical centres
 * (CoE / Nodal programs), not NVS. True when any of its students was ever in
 * an alumni program, or it has alumni on record; an NVS-only school has
 * neither, so its page shows no (always empty) Alumni tab.
 */
export async function schoolHasAlumni(schoolId: string | number): Promise<boolean> {
  const [row] = await query<{ has_alumni: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM enrollment_record e
       JOIN enrollment_record eb ON eb.user_id = e.user_id AND eb.group_type = 'batch'
       JOIN batch b ON b.id = eb.group_id
       WHERE e.group_type = 'school' AND e.group_id = $1 AND b.program_id = ANY($2::int[])
     ) OR EXISTS (
       SELECT 1 FROM alumni a
       JOIN student s ON s.id = a.student_id
       JOIN enrollment_record e ON e.user_id = s.user_id AND e.group_type = 'school' AND e.group_id = $1
     ) AS has_alumni`,
    [schoolId, ALUMNI_PROGRAM_ORDER],
  );
  return Boolean(row?.has_alumni);
}
