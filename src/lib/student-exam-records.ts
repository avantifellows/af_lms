import { query } from "@/lib/db";
import {
  COMPETITIVE_EXAM_NAMES,
  compareExamNames,
  type ExamOption,
  type StudentExamRecord,
  type StudentExamSummary,
} from "@/lib/competitive-exams";
import {
  EXAM_ACK_DOCUMENT_TYPE,
  type ExamAcknowledgement,
  type ExamAcknowledgementPage,
} from "@/lib/exam-acknowledgements";

// Reads for the Exams tab and the roster card, plus the reveal log. Writes to
// `student_exam_record` never happen here: those rows belong to the DB Service,
// so they are created, updated and deleted through `@/lib/db-service-exam-records`.
// `lms_exam_password_reveals` is LMS-owned and written directly.
//
// No list read selects a password. A stored password is a KMS ciphertext in
// `application_password_ciphertext`; rows not yet re-encrypted by the backfill
// still hold a legacy plaintext in `application_password`. Either counts as a
// stored password, and only {@link getExamPasswordSource} reads them.

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
  has_password: boolean;
  sessions_applied: number[] | null;
}

// Shared by both list reads so the card and the tab agree on "stored".
const HAS_PASSWORD_SQL = `(ser.application_password_ciphertext IS NOT NULL
                OR (ser.application_password IS NOT NULL AND ser.application_password <> ''))
              AS has_password`;

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

function toRecord(row: StudentExamRecordRow): StudentExamSummary {
  return {
    id: toNumber(row.id),
    exam_id: toNumber(row.exam_id),
    exam_name: row.exam_name,
    application_number: row.application_number,
    has_password: Boolean(row.has_password),
    sessions_applied: row.sessions_applied,
  };
}

/** Every exam registration stored for one Student, for the gated Exams tab. */
export async function listStudentExamRecords(
  studentId: number,
): Promise<StudentExamSummary[]> {
  const rows = await query<StudentExamRecordRow>(
    `SELECT ser.id,
            ser.student_id,
            ser.exam_id,
            e.name AS exam_name,
            ser.application_number,
            ${HAS_PASSWORD_SQL},
            ser.sessions_applied
     FROM student_exam_record ser
     JOIN exam e ON e.id = ser.exam_id
     WHERE ser.student_id = $1
     ORDER BY ser.id`,
    [studentId],
  );
  return rows.map(toRecord);
}

/** A Student's registrations with their acknowledgements, for the Exams tab. */
export interface StudentExamRecordsWithAcknowledgements {
  records: StudentExamRecord[];
  /**
   * False when the acknowledgements could not be read — most likely a
   * database that has not run the DB Service migration adding
   * `lms_student_documents.student_exam_record_id` yet. The registrations
   * still load; the tab just offers no uploads.
   */
  acknowledgementsAvailable: boolean;
}

/** Attach each registration's current exam acknowledgements. */
export async function attachAcknowledgements(
  studentId: number,
  records: StudentExamSummary[],
): Promise<StudentExamRecordsWithAcknowledgements> {
  let byRecord = new Map<number, ExamAcknowledgement[]>();
  let acknowledgementsAvailable = true;
  try {
    byRecord = await listExamAcknowledgements(studentId);
  } catch (error) {
    console.error(
      "Failed to load exam acknowledgements:",
      error instanceof Error ? error.message : error,
    );
    acknowledgementsAvailable = false;
  }
  return {
    records: records.map((record) => ({
      ...record,
      acknowledgements: byRecord.get(record.id) ?? [],
    })),
    acknowledgementsAvailable,
  };
}

interface ExamAcknowledgementRow {
  id: string | number;
  student_exam_record_id: string | number;
  exam_session: number | null;
  pages: unknown;
  uploaded_by: string;
  inserted_at: Date | string;
}

function toPages(raw: unknown): ExamAcknowledgementPage[] {
  const list = typeof raw === "string" ? (JSON.parse(raw) as unknown) : raw;
  if (!Array.isArray(list)) return [];
  return list
    .map((page) => ({
      page_number: Number((page as Record<string, unknown>)?.page_number),
      mime_type: String((page as Record<string, unknown>)?.mime_type ?? ""),
    }))
    .filter((page) => Number.isInteger(page.page_number) && page.page_number > 0)
    .sort((a, b) => a.page_number - b.page_number);
}

function toAcknowledgement(row: ExamAcknowledgementRow): ExamAcknowledgement {
  return {
    id: toNumber(row.id),
    exam_session: row.exam_session,
    pages: toPages(row.pages),
    uploaded_by: row.uploaded_by,
    uploaded_at:
      row.inserted_at instanceof Date ? row.inserted_at.toISOString() : String(row.inserted_at),
  };
}

/**
 * A Student's current exam acknowledgements, by registration.
 * Soft-deleted rows are left out; the S3 keys are not selected — a page is
 * fetched through the documents page route, which presigns it.
 */
export async function listExamAcknowledgements(
  studentId: number,
): Promise<Map<number, ExamAcknowledgement[]>> {
  const rows = await query<ExamAcknowledgementRow>(
    `SELECT id, student_exam_record_id, exam_session, pages, uploaded_by, inserted_at
     FROM lms_student_documents
     WHERE student_id = $1
       AND document_type = $2
       AND student_exam_record_id IS NOT NULL
       AND deleted_at IS NULL
     ORDER BY exam_session NULLS FIRST, id`,
    [studentId, EXAM_ACK_DOCUMENT_TYPE],
  );
  const byRecord = new Map<number, ExamAcknowledgement[]>();
  for (const row of rows) {
    const recordId = toNumber(row.student_exam_record_id);
    const list = byRecord.get(recordId) ?? [];
    list.push(toAcknowledgement(row));
    byRecord.set(recordId, list);
  }
  return byRecord;
}

/**
 * One current acknowledgement, only if it belongs to this Student's
 * registration — both ids come from the URL, so neither is trusted alone.
 */
export async function getExamAcknowledgement(
  studentId: number,
  recordId: number,
  documentId: number,
): Promise<ExamAcknowledgement | null> {
  const rows = await query<ExamAcknowledgementRow>(
    `SELECT id, student_exam_record_id, exam_session, pages, uploaded_by, inserted_at
     FROM lms_student_documents
     WHERE id = $1
       AND student_id = $2
       AND student_exam_record_id = $3
       AND document_type = $4
       AND deleted_at IS NULL`,
    [documentId, studentId, recordId, EXAM_ACK_DOCUMENT_TYPE],
  );
  return rows[0] ? toAcknowledgement(rows[0]) : null;
}

/** What one roster-wide read of the exam registrations came back with. */
export interface RosterExamSummaries {
  /** Registrations by student id; a Student with none is simply absent. */
  byStudent: Map<number, StudentExamSummary[]>;
  /**
   * The read itself failed. The roster still renders, but a Student with no
   * registrations now means "not read", not "not registered" — the Data
   * completeness table (#468) says so instead of counting every expected
   * Student as a gap.
   */
  failed: boolean;
}

/**
 * Exam registrations for a whole roster, keyed by student id. One query for
 * the page rather than one per card.
 *
 * The exam tables are the DB Service's, and this is a display extra on a page
 * whose point is the roster: if the read fails (most likely a database that
 * has not run the DB Service migration yet), the roster still renders, just
 * without the exam tags — and says so, via `failed`.
 */
export async function listExamSummariesForStudents(
  studentIds: number[],
): Promise<RosterExamSummaries> {
  const byStudent = new Map<number, StudentExamSummary[]>();
  if (studentIds.length === 0) return { byStudent, failed: false };

  let rows: StudentExamRecordRow[];
  try {
    rows = await query<StudentExamRecordRow>(
      `SELECT ser.id,
              ser.student_id,
              ser.exam_id,
              e.name AS exam_name,
              ser.application_number,
              ${HAS_PASSWORD_SQL},
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
    return { byStudent, failed: true };
  }

  for (const row of rows) {
    const studentId = toNumber(row.student_id);
    const summary = toRecord(row);
    const existing = byStudent.get(studentId);
    if (existing) existing.push(summary);
    else byStudent.set(studentId, [summary]);
  }
  return { byStudent, failed: false };
}

/** What one registration's stored password is held as. */
export interface ExamPasswordSource {
  recordId: number;
  examId: number;
  /** Base64 KMS ciphertext, or null. */
  ciphertext: string | null;
  /** Plaintext the backfill has not re-encrypted yet, or null. */
  legacyPlaintext: string | null;
}

interface ExamPasswordSourceRow {
  id: string | number;
  exam_id: string | number;
  application_password_ciphertext: string | null;
  application_password: string | null;
}

/**
 * The stored password of one registration, only if it belongs to `studentId`
 * — the record id comes from the URL, so it is never trusted on its own.
 * Callers must have gated on the Student and on `exam_passwords` view first.
 */
export async function getExamPasswordSource(
  studentId: number,
  recordId: number,
): Promise<ExamPasswordSource | null> {
  const rows = await query<ExamPasswordSourceRow>(
    `SELECT id, exam_id, application_password_ciphertext, application_password
     FROM student_exam_record
     WHERE id = $1 AND student_id = $2`,
    [recordId, studentId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    recordId: toNumber(row.id),
    examId: toNumber(row.exam_id),
    ciphertext: row.application_password_ciphertext,
    legacyPlaintext: row.application_password ? row.application_password : null,
  };
}

/** One row in the append-only reveal log. */
export async function recordExamPasswordReveal(reveal: {
  studentId: number;
  recordId: number;
  examId: number;
  viewerEmail: string;
  viewerRole: string;
}): Promise<void> {
  await query(
    `INSERT INTO lms_exam_password_reveals
       (student_id, student_exam_record_id, exam_id, viewer_email, viewer_role)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      reveal.studentId,
      reveal.recordId,
      reveal.examId,
      reveal.viewerEmail.trim().toLowerCase(),
      reveal.viewerRole,
    ],
  );
}
