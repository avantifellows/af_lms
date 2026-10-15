import { query } from "@/lib/db";
import { canAccessSchoolSync, type UserPermission } from "@/lib/permissions";
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

export async function listAlumniSchools(permission: UserPermission): Promise<AlumniSchool[]> {
  const rows = await query<SchoolCountRow>(
    `WITH ${cohortCte()},
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
     GROUP BY c.code, sc.name, sc.region`,
    cohortParams(),
  );
  return rows
    .filter((r) => canAccessSchoolSync(permission, r.code, r.region ?? undefined))
    .map((r) => ({ code: r.code, name: r.name, toAdd: Number(r.to_add), alumni: Number(r.alumni) }))
    .sort((a, b) => b.toAdd - a.toAdd || a.name.localeCompare(b.name));
}

/** The school's name, or null when there's no school with this code. */
export async function getSchoolName(code: string): Promise<string | null> {
  const [school] = await query<{ name: string }>(`SELECT name FROM school WHERE code = $1`, [code]);
  return school?.name ?? null;
}
