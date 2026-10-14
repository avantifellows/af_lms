import { query } from "@/lib/db";
import { ALUMNI_PROGRAM_ORDER, academicYearEnd } from "./config";
import { ALUMNI_FIELDS, type Values } from "./fields";
import { cohortCte, cohortParams } from "./students";

/** Shown when a student has no school enrollment at all. */
const NO_SCHOOL_CODE = "none";

// Loads everything the form needs for one student, from Postgres. A student
// with an alumni row is an "edit" (pre-filled from it); a cohort pass-out
// without one is "new".

export interface EntryIds {
  /** user.id — the key going forward (enrollment_user_id). */
  enrollmentUserId: string;
  /** student.id — what alumni.student_id holds. */
  studentId: string;
  /** alumni.id of the existing row (edits only). */
  alumniId: string;
}

export interface EntryContext {
  kind: "new" | "edit";
  ids: EntryIds;
  name: string;
  afid: string;
  program: string;
  school: string;
  /** school.code ("none" when there's no school enrollment) — for linking back to the school page. */
  schoolCode: string;
  cohortYear: string;
  /** Profile columns (sheet column names) — read-only in the form. */
  profile: Values;
  /** Alumni columns (sheet column names) — editable, pre-filled for edits. */
  alumni: Values;
  /** Display names for the college/branch codes in `alumni`. */
  codeNames: Record<string, string>;
}

/** Flattens a Postgres value (Date, boolean, number, null) to the string the form uses. */
function str(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).replace(/\s+/g, " ").trim();
}

/**
 * Form column → alumni table column. Same name except two that Postgres cut at
 * its 63-character identifier limit. College/branch columns hold college.id /
 * branch.id in the table but codes (C-xxxx / branch_id) in the form.
 */
const ALUMNI_DB_COLUMN: Record<string, string> = Object.fromEntries(
  ALUMNI_FIELDS.map((f) => [f.column, f.column.slice(0, 63)]),
);
export const CODE_COLUMNS = {
  college_id_ug: "college", college_id_pg: "college", branch_id_ug: "branch", branch_id_pg: "branch",
} as const;

// Profile (sheet column ← SQL expression over "user" u and student s).
const PROFILE_SQL = `
  u.first_name AS user_first_name, u.last_name AS user_last_name, u.gender AS user_gender,
  to_char(u.date_of_birth, 'YYYY-MM-DD') AS user_date_of_birth,
  s.category AS student_category,
  CASE WHEN s.physically_handicapped IS NULL THEN NULL WHEN s.physically_handicapped THEN 'TRUE' ELSE 'FALSE' END AS student_physically_handicapped,
  CASE WHEN s.has_category_certificate IS NULL THEN NULL WHEN s.has_category_certificate THEN 'Yes' ELSE 'No' END AS student_has_category_certificate,
  s.apaar_id AS student_apaar_id, u.phone AS user_phone, u.whatsapp_phone AS user_whatsapp_phone,
  u.email AS user_email, u.address AS user_address, u.city AS user_city, u.district AS user_district,
  u.state AS user_state, u.pincode AS user_pincode,
  s.stream AS student_stream, s.board_stream AS student_board_stream, s.family_type AS student_family_type,
  s.family_income AS student_family_income, s.annual_family_income AS student_annual_family_income,
  s.monthly_family_income AS student_monthly_family_income,
  s.percentage_in_grade_10_math AS student_percentage_in_grade_10_math,
  s.percentage_in_grade_10_science AS student_percentage_in_grade_10_science,
  s.percentage_in_grade_10_english AS student_percentage_in_grade_10_english,
  s.father_name AS student_father_name, s.father_phone AS student_father_phone,
  s.father_profession AS student_father_profession, s.father_education_level AS student_father_education_level,
  s.mother_name AS student_mother_name, s.mother_phone AS student_mother_phone,
  s.mother_profession AS student_mother_profession, s.mother_education_level AS student_mother_education_level,
  s.guardian_name AS student_guardian_name, s.guardian_phone AS student_guardian_phone,
  s.guardian_relation AS student_guardian_relation, s.guardian_profession AS student_guardian_profession,
  s.guardian_education_level AS student_guardian_education_level,
  s.g12_graduating_year AS student_g12_graduating_year`;

const PROFILE_COLUMNS = [...PROFILE_SQL.matchAll(/AS (\w+)/g)].map((m) => m[1]);

interface StudentRow extends Record<string, unknown> {
  user_id: string;
  student_pk: string;
  afid: string | null;
}

export async function getEntryContext(userId: string): Promise<EntryContext | null> {
  const [student] = await query<StudentRow>(
    `SELECT u.id AS user_id, s.id AS student_pk, s.student_id AS afid, ${PROFILE_SQL}
     FROM "user" u JOIN student s ON s.user_id = u.id
     WHERE u.id = $1
     ORDER BY s.id LIMIT 1`,
    [userId],
  );
  if (!student) return null;

  const profile: Values = {};
  for (const col of PROFILE_COLUMNS) profile[col] = str(student[col]);
  const name = `${profile.user_first_name} ${profile.user_last_name}`.trim();

  const edit = await loadAlumni(student.student_pk);
  if (edit) {
    const meta = await loadLatestMeta(userId);
    return {
      kind: "edit",
      ids: { enrollmentUserId: String(student.user_id), studentId: String(student.student_pk), alumniId: edit.alumniId },
      name, afid: student.afid ?? "", ...meta, profile, alumni: edit.alumni, codeNames: edit.codeNames,
    };
  }

  // Not an alumnus yet: only pass-outs of an alumni program can be added.
  const [cohort] = await query<{
    program: string; passout_year: string; school_code: string | null; school_name: string | null; status: string | null;
  }>(
    `WITH ${cohortCte("AND er.user_id = $4")}
     SELECT program, passout_year, school_code, school_name, status FROM cohort_flagged LIMIT 1`,
    [...cohortParams(), userId],
  );
  if (!cohort) return null;
  // Class 12 year: from the record, else the end of the year they passed out (2025-2026 → 2026).
  if (!profile.student_g12_graduating_year) profile.student_g12_graduating_year = academicYearEnd(cohort.passout_year);
  return {
    kind: "new",
    ids: { enrollmentUserId: String(student.user_id), studentId: String(student.student_pk), alumniId: "" },
    name,
    afid: student.afid ?? "",
    program: cohort.program,
    school: str(cohort.school_name),
    schoolCode: cohort.school_code || NO_SCHOOL_CODE,
    cohortYear: cohort.passout_year,
    profile,
    alumni: {},
    codeNames: {},
  };
}

/** The student's alumni row (latest if somehow more than one), with college/branch as codes. */
async function loadAlumni(studentPk: string) {
  const [r] = await query<Record<string, unknown>>(
    `SELECT a.*,
       cu.college_id AS college_code_ug, cu.name AS college_name_ug,
       cp.college_id AS college_code_pg, cp.name AS college_name_pg,
       bu.branch_id AS branch_code_ug, bu.name AS branch_name_ug,
       bp.branch_id AS branch_code_pg, bp.name AS branch_name_pg
     FROM alumni a
     LEFT JOIN college cu ON cu.id = a.college_id_ug
     LEFT JOIN college cp ON cp.id = a.college_id_pg
     LEFT JOIN branch bu ON bu.id = a.branch_id_ug
     LEFT JOIN branch bp ON bp.id = a.branch_id_pg
     WHERE a.student_id = $1
     ORDER BY a.updated_at DESC NULLS LAST, a.id DESC
     LIMIT 1`,
    [studentPk],
  );
  if (!r) return null;

  const alumni: Values = {};
  for (const [formCol, dbCol] of Object.entries(ALUMNI_DB_COLUMN)) alumni[formCol] = str(r[dbCol]);
  for (const level of ["ug", "pg"]) {
    alumni[`college_id_${level}`] = str(r[`college_code_${level}`]);
    alumni[`branch_id_${level}`] = str(r[`branch_code_${level}`]);
  }
  return {
    alumniId: str(r.id),
    alumni,
    codeNames: {
      college_id_ug: str(r.college_name_ug), college_id_pg: str(r.college_name_pg),
      branch_id_ug: str(r.branch_name_ug), branch_id_pg: str(r.branch_name_pg),
    },
  };
}

/** Program, school and cohort year for an existing alumnus: their most recent ones. */
async function loadLatestMeta(userId: string) {
  const [m] = await query<{ program: string | null; school_code: string | null; school_name: string | null; cohort_year: string | null }>(
    `SELECT
       (SELECT p.name FROM enrollment_record er JOIN batch b ON b.id = er.group_id JOIN program p ON p.id = b.program_id
        WHERE er.user_id = $1 AND er.group_type = 'batch'
        ORDER BY er.academic_year DESC NULLS LAST, array_position($2::int[], b.program_id::int) NULLS LAST, er.id DESC
        LIMIT 1) AS program,
       sch.code AS school_code, sch.name AS school_name,
       (SELECT er.academic_year FROM enrollment_record er JOIN grade gr ON gr.id = er.group_id
        WHERE er.user_id = $1 AND er.group_type = 'grade' AND gr.number = 12
        ORDER BY er.academic_year DESC NULLS LAST LIMIT 1) AS cohort_year
     FROM (SELECT 1) one
     LEFT JOIN LATERAL (
       SELECT sc.code, sc.name FROM enrollment_record er JOIN school sc ON sc.id = er.group_id
       WHERE er.user_id = $1 AND er.group_type = 'school'
       ORDER BY er.academic_year DESC NULLS LAST, er.is_current DESC, er.id DESC LIMIT 1
     ) sch ON true`,
    [userId, ALUMNI_PROGRAM_ORDER],
  );
  return {
    program: str(m?.program),
    school: str(m?.school_name),
    schoolCode: m?.school_code || NO_SCHOOL_CODE,
    cohortYear: str(m?.cohort_year),
  };
}
