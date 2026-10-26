import { query } from "@/lib/db";
import {
  COMPETITIVE_EXAM_NAMES,
  compareExamNames,
  type ExamOption,
  type StudentExamRecord,
  type StudentExamSummary,
} from "@/lib/competitive-exams";

// Reads for the Exams tab and the roster card. Writes never happen here: the
// `student_exam_record` rows belong to the DB Service, so they are created,
// updated and deleted through `@/lib/db-service-exam-records`.

interface ExamOptionRow {
  id: string | number;
  name: string;
}

interface StudentExamRecordRow {
  id: string | number;
  student_id: string | number;
  exam_id: string | number;
  exam_name: string;
  application_number: string | null;
  application_password: string | null;
  sessions_applied: number[] | null;
}

/** The roster projection: whether a password is stored, never the password. */
type StudentExamSummaryRow = Omit<StudentExamRecordRow, "application_password"> & {
  has_password: boolean;
};

function toNumber(value: string | number): number {
  return typeof value === "number" ? value : Number(value);
}

/**
 * The exams the picker offers — the `exam` rows whose name is on the
 * competitive list, in the order {@link COMPETITIVE_EXAM_NAMES} gives.
 */
export async function listExamOptions(): Promise<ExamOption[]> {
  const rows = await query<ExamOptionRow>(
    `SELECT id, name FROM exam WHERE name = ANY($1::text[])`,
    [[...COMPETITIVE_EXAM_NAMES]],
  );
  return rows
    .map((row) => ({ id: toNumber(row.id), name: row.name }))
    .sort((a, b) => compareExamNames(a.name, b.name));
}

function toRecord(row: StudentExamRecordRow): StudentExamRecord {
  return {
    id: toNumber(row.id),
    exam_id: toNumber(row.exam_id),
    exam_name: row.exam_name,
    application_number: row.application_number,
    application_password: row.application_password,
    sessions_applied: row.sessions_applied,
  };
}

/**
 * Every exam registration stored for one Student, password included. Only the
 * gated Exams tab route may call this — the password reaches a browser nowhere
 * else.
 */
export async function listStudentExamRecords(
  studentId: number,
): Promise<StudentExamRecord[]> {
  const rows = await query<StudentExamRecordRow>(
    `SELECT ser.id,
            ser.student_id,
            ser.exam_id,
            e.name AS exam_name,
            ser.application_number,
            ser.application_password,
            ser.sessions_applied
     FROM student_exam_record ser
     JOIN exam e ON e.id = ser.exam_id
     WHERE ser.student_id = $1
     ORDER BY ser.id`,
    [studentId],
  );
  return rows.map(toRecord);
}

/**
 * Exam registrations for a whole roster, keyed by student id and stripped of
 * passwords. One query for the page rather than one per card.
 *
 * The exam tables are the DB Service's, and this is a display extra on a page
 * whose point is the roster: if the read fails (most likely a database that
 * has not run the DB Service migration yet), the roster still renders, just
 * without the exam tags.
 */
export async function listExamSummariesForStudents(
  studentIds: number[],
): Promise<Map<number, StudentExamSummary[]>> {
  const byStudent = new Map<number, StudentExamSummary[]>();
  if (studentIds.length === 0) return byStudent;

  let rows: StudentExamSummaryRow[];
  try {
    rows = await query<StudentExamSummaryRow>(
      `SELECT ser.id,
              ser.student_id,
              ser.exam_id,
              e.name AS exam_name,
              ser.application_number,
              ser.application_password IS NOT NULL
                AND ser.application_password <> '' AS has_password,
              ser.sessions_applied
       FROM student_exam_record ser
       JOIN exam e ON e.id = ser.exam_id
       WHERE ser.student_id = ANY($1::bigint[])
       ORDER BY ser.id`,
      [studentIds],
    );
  } catch (error) {
    console.error(
      "Failed to load student exam records for the roster:",
      error instanceof Error ? error.message : error,
    );
    return byStudent;
  }

  for (const row of rows) {
    const studentId = toNumber(row.student_id);
    const summary: StudentExamSummary = {
      id: toNumber(row.id),
      exam_id: toNumber(row.exam_id),
      exam_name: row.exam_name,
      application_number: row.application_number,
      has_password: Boolean(row.has_password),
      sessions_applied: row.sessions_applied,
    };
    const existing = byStudent.get(studentId);
    if (existing) existing.push(summary);
    else byStudent.set(studentId, [summary]);
  }
  return byStudent;
}
