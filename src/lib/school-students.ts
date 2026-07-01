import { query } from "@/lib/db";
import { CURRENT_ACADEMIC_YEAR } from "@/lib/constants";
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
    `SELECT
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
      GREATEST(s.updated_at, u.updated_at) as updated_at
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
      -- prefer CoE → Nodal → NVS (matches PROGRAM_IDS_ORDERED). Interim until
      -- a primary_batch field lands; see PR #58 discussion.
      -- Dropout ends the current batch membership, so fall back to the latest
      -- historical batch when no current batch remains.
      ORDER BY
        er_batch.is_current DESC,
        CASE WHEN er_batch.is_current THEN array_position(ARRAY[1, 2, 64]::int[], b.program_id) END,
        (er_batch.academic_year = $2) DESC,
        er_batch.end_date DESC NULLS LAST,
        er_batch.updated_at DESC,
        er_batch.id DESC
      LIMIT 1
    ) p ON true
    WHERE g.type = 'school' AND g.child_id = $1
    ORDER BY gr.number, u.first_name, u.last_name`,
    [schoolId, CURRENT_ACADEMIC_YEAR],
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
