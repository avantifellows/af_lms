import { query } from "@/lib/db";
import { ALUMNI_COHORT_GRADE, ALUMNI_PROGRAM_ORDER, currentAcademicYear } from "./config";

// Reads for the Alumni tab, the same way the roster reads: grade from
// enrollment_record (group_type 'grade', per academic year), program from the
// batch enrollment, school from the school enrollment. Students are keyed by
// user.id (enrollment_user_id); alumni link via alumni.student_id = student.id.

/**
 * $1 current academic year, $2 grade, $3 program ids in attribution order.
 * Extra params start at $4.
 */
export const cohortParams = () => [currentAcademicYear(), ALUMNI_COHORT_GRADE, ALUMNI_PROGRAM_ORDER];

// One row per pass-out: last Grade 12 year before the current academic year,
// in no class this year (e.g. repeating Class 12), in an alumni program that
// year. Carries the pass-out year, the school that year, and whether an alumni
// row exists. `userFilter` narrows `er.user_id` in the first step.
export function cohortCte(userFilter = "") {
  return `
  g12 AS (
    SELECT er.user_id, MAX(er.academic_year) AS passout_year
    FROM enrollment_record er JOIN grade gr ON gr.id = er.group_id
    WHERE er.group_type = 'grade' AND gr.number = $2 AND er.academic_year < $1 ${userFilter}
    GROUP BY er.user_id
  ),
  cohort AS (
    SELECT DISTINCT ON (g.user_id) g.user_id, g.passout_year, p.name AS program
    FROM g12 g
    JOIN enrollment_record er ON er.user_id = g.user_id AND er.group_type = 'batch' AND er.academic_year = g.passout_year
    JOIN batch b ON b.id = er.group_id
    JOIN program p ON p.id = b.program_id
    WHERE b.program_id = ANY($3::int[])
      AND NOT EXISTS (
        SELECT 1 FROM enrollment_record cur
        WHERE cur.user_id = g.user_id AND cur.group_type = 'grade' AND cur.academic_year >= $1
      )
    ORDER BY g.user_id, array_position($3::int[], b.program_id::int)
  ),
  cohort_flagged AS (
    SELECT c.user_id, c.program, c.passout_year, s.id AS student_pk, s.student_id AS afid, s.status, s.stream,
      u.first_name, u.last_name, u.gender,
      sch.code AS school_code, sch.name AS school_name,
      EXISTS (SELECT 1 FROM alumni a WHERE a.student_id = s.id) AS is_alumni
    FROM cohort c
    JOIN "user" u ON u.id = c.user_id
    JOIN student s ON s.user_id = c.user_id
    LEFT JOIN LATERAL (
      SELECT sc.code, sc.name
      FROM enrollment_record er JOIN school sc ON sc.id = er.group_id
      WHERE er.user_id = c.user_id AND er.group_type = 'school'
      ORDER BY (er.academic_year = c.passout_year) DESC, er.is_current DESC, er.academic_year DESC NULLS LAST, er.id DESC
      LIMIT 1
    ) sch ON true
  )`;
}

// Alumni rows with their student, latest school and cohort year (the latest
// year they were in Grade 12). `where` filters on a/s/u columns.
function alumniRowsSql(where: string) {
  return `
  SELECT a.id AS alumni_id, s.user_id, s.student_id AS afid, u.first_name, u.last_name,
    a.ug_status, a.current_status, c.name AS college_ug, sch.code AS school_code, coh.academic_year AS cohort_year
  FROM alumni a
  JOIN student s ON s.id = a.student_id
  JOIN "user" u ON u.id = s.user_id
  LEFT JOIN college c ON c.id = a.college_id_ug
  LEFT JOIN LATERAL (
    SELECT sc.code
    FROM enrollment_record er JOIN school sc ON sc.id = er.group_id
    WHERE er.user_id = s.user_id AND er.group_type = 'school'
    ORDER BY er.academic_year DESC NULLS LAST, er.is_current DESC, er.id DESC
    LIMIT 1
  ) sch ON true
  LEFT JOIN LATERAL (
    SELECT er.academic_year
    FROM enrollment_record er JOIN grade gr ON gr.id = er.group_id
    WHERE er.user_id = s.user_id AND er.group_type = 'grade' AND gr.number = 12
    ORDER BY er.academic_year DESC NULLS LAST
    LIMIT 1
  ) coh ON true
  WHERE ${where}`;
}

const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
const fullName = (first: string | null, last: string | null) => clean(`${first ?? ""} ${last ?? ""}`) || "(no name)";

interface PersonRow {
  user_id: string;
  afid: string | null;
  first_name: string | null;
  last_name: string | null;
}

/** The fields every list row shares. */
const person = (r: PersonRow) => ({ userId: String(r.user_id), afid: r.afid || "", name: fullName(r.first_name, r.last_name) });

/** Newest cohort first, then by name. */
const byCohortThenName = (a: { cohortYear: string; name: string }, b: { cohortYear: string; name: string }) =>
  b.cohortYear.localeCompare(a.cohortYear) || a.name.localeCompare(b.name);

export interface PendingStudent {
  userId: string;
  afid: string;
  name: string;
  /** Academic year they passed out, e.g. "2025-2026". */
  cohortYear: string;
  program: string;
  gender: string;
  stream: string;
}

export interface AlumniListItem {
  /** alumni.id — how an existing alumnus is addressed (ADR 0008). */
  alumniId: string;
  userId: string;
  afid: string;
  name: string;
  cohortYear: string;
  ugStatus: string;
  currentStatus: string;
  collegeUg: string;
}

const SCHOOL_MEMBERS = (param: string) =>
  `SELECT e2.user_id FROM enrollment_record e2 WHERE e2.group_type = 'school' AND e2.group_id = ${param}`;

/** Pass-outs from this school with no alumni row yet (new entries). */
export async function listPendingForSchool(school: { id: string | number; code: string }): Promise<PendingStudent[]> {
  const rows = await query<PersonRow & {
    passout_year: string; program: string; gender: string | null; stream: string | null;
  }>(
    // Members are read once (MATERIALIZED): inlined, the big Punjab schools took ~450 ms, not ~130.
    `WITH school_members AS MATERIALIZED (${SCHOOL_MEMBERS("$4")}),
     ${cohortCte("AND er.user_id IN (SELECT user_id FROM school_members)")}
     SELECT user_id, afid, first_name, last_name, passout_year, program, gender, stream
     FROM cohort_flagged
     WHERE school_code = $5 AND NOT is_alumni AND COALESCE(status, '') <> 'dropout'`,
    [...cohortParams(), school.id, school.code],
  );
  return rows
    .map((r) => ({
      ...person(r),
      cohortYear: r.passout_year || "",
      program: r.program || "",
      gender: r.gender || "",
      stream: r.stream || "",
    }))
    .sort(byCohortThenName);
}

/** Existing alumni whose latest school is this one, all cohort years (edit list). */
export async function listAlumniForSchool(school: { id: string | number; code: string }): Promise<AlumniListItem[]> {
  const rows = await query<PersonRow & {
    alumni_id: string;
    cohort_year: string | null; ug_status: string | null; current_status: string | null; college_ug: string | null;
  }>(
    `SELECT * FROM (${alumniRowsSql(`s.user_id IN (${SCHOOL_MEMBERS("$1")})`)}) x WHERE school_code = $2`,
    [school.id, school.code],
  );
  return rows
    .map((r) => ({
      alumniId: String(r.alumni_id),
      ...person(r),
      cohortYear: r.cohort_year || "",
      ugStatus: r.ug_status || "",
      currentStatus: r.current_status || "",
      collegeUg: clean(r.college_ug),
    }))
    .sort(byCohortThenName);
}
