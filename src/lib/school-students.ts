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
 *   sp       → a source exposing student_program_ids (current batch programs)
 *   dp       → a source exposing dropout_program_ids (dropout audits not undone)
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
      s.pen_number,
      s.apaar_id,
      s.category,
      s.physically_handicapped,
      s.g10_board,
      s.g10_roll_no,
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
      sp.student_program_ids,
      dp.dropout_program_ids,
      EXISTS (
        SELECT 1
        FROM lms_student_write_audits dropout
        WHERE dropout.action = 'student_program_dropout'
          AND dropout.program_id = 64
          AND (dropout.affected_identifiers ->> 'student_pk_id')::bigint = s.id
          AND dropout.changed_values ? 'batch_enrollment_id'
          AND NOT EXISTS (
            SELECT 1
            FROM lms_student_write_audits undo
            WHERE undo.action = 'student_program_dropout_undo'
              AND (undo.affected_identifiers ->> 'dropout_audit_id')::bigint = dropout.id
          )
      ) AS can_undo_nvs_dropout,
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
    -- Restrict the roster to the current academic year. Keep every current
    -- grade row so duplicate-grade data issues still surface, but collapse
    -- dropout history to the latest same-year grade after DB Service ends
    -- current grade enrollment.
    JOIN enrollment_record er_grade ON er_grade.user_id = u.id
      AND er_grade.group_type = 'grade'
      AND er_grade.academic_year = $2
      AND (
        er_grade.is_current = true
        OR (
          s.status = 'dropout'
          AND er_grade.id = (
            SELECT er_latest.id
            FROM enrollment_record er_latest
            WHERE er_latest.user_id = u.id
              AND er_latest.group_type = 'grade'
              AND er_latest.academic_year = $2
            ORDER BY er_latest.end_date DESC NULLS LAST, er_latest.updated_at DESC, er_latest.id DESC
            LIMIT 1
          )
        )
      )
    LEFT JOIN grade gr ON er_grade.group_id = gr.id
    LEFT JOIN LATERAL (
      SELECT p.name as program_name, p.id as program_id
      FROM enrollment_record er_batch
      JOIN batch b ON b.id = er_batch.group_id
      JOIN program p ON b.program_id = p.id
      WHERE er_batch.user_id = u.id
        AND er_batch.group_type = 'batch'
      -- Deterministic tiebreaker for students in multiple program batches:
      -- prefer CoE → Nodal → NVS (PROGRAM_ATTRIBUTION_ORDER). Interim until
      -- a primary_batch field lands; see PR #58 discussion.
      -- Dropout ends the current batch membership, so fall back to the latest
      -- historical batch when no current batch remains.
      ORDER BY
        er_batch.is_current DESC,
        CASE WHEN er_batch.is_current THEN array_position(ARRAY[${PROGRAM_ATTRIBUTION_ORDER.join(", ")}]::int[], b.program_id) END,
        (er_batch.academic_year = $2) DESC,
        er_batch.end_date DESC NULLS LAST,
        er_batch.updated_at DESC,
        er_batch.id DESC
      LIMIT 1
    ) p ON true
    LEFT JOIN LATERAL (
      SELECT COALESCE(
        ARRAY_AGG(DISTINCT b.program_id) FILTER (WHERE b.program_id IS NOT NULL),
        ARRAY[]::int[]
      ) AS student_program_ids
      FROM enrollment_record er_batch
      JOIN batch b ON b.id = er_batch.group_id
      WHERE er_batch.user_id = u.id
        AND er_batch.group_type = 'batch'
        AND er_batch.is_current = true
    ) sp ON true
    LEFT JOIN LATERAL (
      SELECT COALESCE(
        ARRAY_AGG(DISTINCT audit.program_id) FILTER (WHERE audit.program_id IS NOT NULL),
        ARRAY[]::int[]
      ) AS dropout_program_ids
      FROM lms_student_write_audits audit
      WHERE audit.action = 'student_program_dropout'
        AND (audit.affected_identifiers ->> 'student_pk_id')::bigint = s.id
        AND NOT (audit.program_id = ANY(sp.student_program_ids))
    ) dp ON true
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
    LEFT JOIN LATERAL (
      SELECT COALESCE(
        ARRAY_AGG(DISTINCT b.program_id) FILTER (WHERE b.program_id IS NOT NULL),
        ARRAY[]::int[]
      ) AS student_program_ids
      FROM enrollment_record er_batch
      JOIN batch b ON b.id = er_batch.group_id
      WHERE er_batch.user_id = u.id
        AND er_batch.group_type = 'batch'
        AND er_batch.is_current = true
    ) sp ON true
    LEFT JOIN LATERAL (
      SELECT COALESCE(
        ARRAY_AGG(DISTINCT audit.program_id) FILTER (WHERE audit.program_id IS NOT NULL),
        ARRAY[]::int[]
      ) AS dropout_program_ids
      FROM lms_student_write_audits audit
      WHERE audit.action = 'student_program_dropout'
        AND (audit.affected_identifiers ->> 'student_pk_id')::bigint = s.id
        AND NOT (audit.program_id = ANY(sp.student_program_ids))
    ) dp ON true
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
