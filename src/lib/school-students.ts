import { query } from "@/lib/db";
import { CURRENT_ACADEMIC_YEAR, PROGRAM_ATTRIBUTION_ORDER } from "@/lib/constants";
import {
  processStudents,
  type DataIssue,
} from "@/lib/school-student-list-data-issues";
import type { Student } from "@/components/StudentTable";

export interface SchoolRoster {
  students: Student[];
  issues: DataIssue[];
}

/**
 * The fat `Student` projection, shared verbatim by every canonical roster query
 * (school + centre) so their row shapes can never drift. It reads from a fixed
 * set of table aliases that each query must provide:
 *   gu       → group_user (membership row → group_user_id)
 *   u        → "user"
 *   s        → student (LEFT-joined; may be null)
 *   er_grade → the current-year grade enrollment_record (→ grade_id)
 *   gr       → grade (LEFT-joined via er_grade → grade number)
 *   p        → a source exposing program_name + program_id
 */
const STUDENT_COLUMNS = `
      gu.id as group_user_id,
      u.id as user_id,
      s.id as student_pk_id,
      u.first_name,
      u.last_name,
      u.phone,
      u.whatsapp_phone,
      u.email,
      u.date_of_birth,
      u.gender,
      u.address,
      u.city,
      u.district,
      u.state,
      u.pincode,
      s.student_id,
      s.apaar_id,
      s.category,
      s.stream,
      s.board_stream,
      s.school_medium,
      s.father_name,
      s.father_phone,
      s.father_profession,
      s.father_education_level,
      s.mother_name,
      s.mother_phone,
      s.mother_profession,
      s.mother_education_level,
      s.guardian_name,
      s.guardian_relation,
      s.guardian_phone,
      s.guardian_education_level,
      s.guardian_profession,
      s.annual_family_income,
      s.monthly_family_income,
      s.status,
      er_grade.group_id as grade_id,
      gr.number as grade,
      p.program_name,
      p.program_id,
      GREATEST(s.updated_at, u.updated_at) as updated_at`;

/**
 * Canonical school roster — the single source of truth for "who are this
 * school's students". The Enrollment tab renders exactly this list, and any
 * other Postgres-built student list (e.g. the Performance test deep-dive)
 * must consume this function instead of writing its own query, so the lists
 * can never drift apart.
 */
export async function getSchoolRoster(
  schoolId: string | number,
): Promise<SchoolRoster> {
  const rows = await query<Student>(
    `SELECT ${STUDENT_COLUMNS}
    FROM group_user gu
    JOIN "group" g ON gu.group_id = g.id
    JOIN "user" u ON gu.user_id = u.id
    LEFT JOIN student s ON s.user_id = u.id
    -- Restrict the roster to students enrolled for the current academic year.
    -- Inner join (not LEFT) so students whose only grade enrollment is from a
    -- prior year (e.g. graduated cohorts still attached to old batches) are
    -- excluded rather than shown with a blank grade.
    JOIN enrollment_record er_grade ON er_grade.user_id = u.id
      AND er_grade.group_type = 'grade'
      AND er_grade.is_current = true
      AND er_grade.academic_year = $2
    LEFT JOIN grade gr ON er_grade.group_id = gr.id
    LEFT JOIN LATERAL (
      SELECT p.name as program_name, p.id as program_id
      FROM group_user gu_batch
      JOIN "group" g_batch ON gu_batch.group_id = g_batch.id AND g_batch.type = 'batch'
      JOIN batch b ON g_batch.child_id = b.id
      JOIN program p ON b.program_id = p.id
      WHERE gu_batch.user_id = u.id
      -- Deterministic tiebreaker for students in multiple program batches:
      -- prefer CoE → Nodal → NVS (PROGRAM_ATTRIBUTION_ORDER). Interim until
      -- a primary_batch field lands; see PR #58 discussion.
      ORDER BY array_position(ARRAY[${PROGRAM_ATTRIBUTION_ORDER.join(", ")}]::int[], b.program_id)
      LIMIT 1
    ) p ON true
    WHERE g.type = 'school' AND g.child_id = $1
    ORDER BY gr.number, u.first_name, u.last_name`,
    [schoolId, CURRENT_ACADEMIC_YEAR],
  );
  return processStudents(rows);
}

/**
 * Canonical centre roster — the counterpart to {@link getSchoolRoster} for a
 * centre. Membership is authoritative from the `centre_students` view (school
 * roster ∩ the student's single attributed program = the centre's program, on
 * an active centre); this function only *hydrates* those members into the full
 * `Student` shape via the shared column list, so a centre roster and a school
 * roster are structurally identical and interchangeable in the UI.
 *
 * The view is lean (centre_id, user_id, academic_year, grade, program_id), so
 * group_user_id / grade_id / the demographic columns are recovered by joining
 * back through the centre's school group, the grade enrollment, and program.
 *
 * NOTE: this joins membership through the centre's *school* group, so it covers
 * only school-linked centres. City/urban centres (school_id NULL) return empty
 * until the batch-tag leg lands (task: centre-students-batch-leg), which must
 * also extend this hydration to recover group_user_id from the batch group.
 */
export async function getCentreStudents(
  centreId: string | number,
): Promise<SchoolRoster> {
  const rows = await query<Student>(
    `SELECT ${STUDENT_COLUMNS}
    FROM centre_students cs
    JOIN centres c ON c.id = cs.centre_id
    JOIN "group" g ON g.type = 'school' AND g.child_id = c.school_id
    JOIN group_user gu ON gu.group_id = g.id AND gu.user_id = cs.user_id
    JOIN "user" u ON u.id = cs.user_id
    LEFT JOIN student s ON s.user_id = u.id
    -- Re-derive the current-year grade enrollment (for grade_id + a stable grade
    -- number). The view already guarantees it exists for this academic year, so
    -- this inner join never drops a member; a student with two current grade
    -- rows yields duplicate rows that processStudents dedupes, exactly as in
    -- getSchoolRoster.
    JOIN enrollment_record er_grade ON er_grade.user_id = cs.user_id
      AND er_grade.group_type = 'grade'
      AND er_grade.is_current = true
      AND er_grade.academic_year = cs.academic_year
    LEFT JOIN grade gr ON er_grade.group_id = gr.id
    LEFT JOIN LATERAL (
      SELECT pr.name as program_name, pr.id as program_id
      FROM program pr WHERE pr.id = cs.program_id
    ) p ON true
    WHERE cs.centre_id = $1 AND cs.academic_year = $2
    ORDER BY gr.number, u.first_name, u.last_name`,
    [centreId, CURRENT_ACADEMIC_YEAR],
  );
  return processStudents(rows);
}

export interface RosterFilters {
  grade?: number;
  /** Program name, matched against the roster's single attributed program. */
  program?: string;
  /** Stream, compared case-insensitively after trimming. */
  stream?: string;
}

function normalizeStream(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim().toLowerCase();
  return trimmed || null;
}

/**
 * Active (non-dropout) roster students, narrowed with the same semantics the
 * Enrollment tab UI applies: grade equality and program by the roster's
 * attributed program. Stream is compared case-insensitively.
 */
export function filterActiveRosterStudents(
  students: Student[],
  filters: RosterFilters = {},
): Student[] {
  const stream = normalizeStream(filters.stream);
  return students.filter((s) => {
    if (s.status === "dropout") return false;
    if (filters.grade != null && s.grade !== filters.grade) return false;
    if (filters.program && s.program_name !== filters.program) return false;
    if (stream && normalizeStream(s.stream) !== stream) return false;
    return true;
  });
}
