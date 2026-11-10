import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";

import { query, withTransaction } from "./db";
import {
  canAccessBlendedStudent,
  canBlendedLearning,
  lockMappingInScope,
  type BlendedLearningAccess,
} from "./blended-learning-access";
import {
  JEE_FORM_EXAM,
  JEE_FORM_REMINDER_TEXT,
  confirmationError,
  jeeFormFlagComment,
  validateJeeForm,
  type JeeFormFieldErrors,
  type JeeFormInput,
  type JeeFormReason,
  type JeeFormStatus,
  type JeeFormUpdate,
  type JeeFormView,
  type JeeReminderItem,
  type RawJeeForm,
} from "./blended-learning-jee-form-input";
import { createDocument, softDeleteDocument } from "./db-service-documents";
import {
  createExamRecordWithoutPassword,
  patchExamRecordWithoutPassword,
} from "./db-service-exam-records";
import { deleteDocumentObjects, presignDocumentPage, uploadDocumentPages, type UploadedPage } from "./s3";

// The JEE form card (server-only): whether a Mentee has filled the JEE Main
// 2027 form. Each save appends a row to blended_learning_jee_form_updates
// (the latest is the status, the rest its history).
//
// - Filled: the application number is upserted into `student_exam_record`
//   through the DB Service (one record per Student + "JEE Mains" + 2027; an
//   existing row is updated, never duplicated), the optional confirmation PDF
//   goes to S3 and `lms_student_documents` through the existing document
//   upload, and the Student's open "JEE Form Filling (Reminder)" Common
//   Action Item is ticked done.
// - Not filled: the reasons and details are stored and a Mentor Flag with
//   recipient `jee_form` is raised for the program team's Flags feed.
//
// `student_exam_record.application_password` is never selected, written or
// returned here: every read names its columns, and the DB Service writes
// send no password and never read the response body.

const JEE_CONFIRMATION_DOCUMENT_TYPE = "jee_main_confirmation";
const CONFIRMATION_URL_TTL_SECONDS = 300; // 5 minutes
const HISTORY_LIMIT = 20;

type UpdateRow = {
  id: number | string;
  status: JeeFormStatus;
  application_number: string | null;
  confirmation_document_id: number | string | null;
  has_confirmation: boolean;
  reasons: JeeFormReason[] | null;
  details: string | null;
  recorded_on: string;
  flag_raised: boolean;
};

// The reminder's text with case and runs of spaces ignored.
const REMINDER_MATCH_SQL = `lower(regexp_replace(btrim(common.text), '\\s+', ' ', 'g')) = lower($2)`;

function toUpdate(row: UpdateRow): JeeFormUpdate {
  return {
    id: Number(row.id),
    status: row.status,
    applicationNumber: row.application_number,
    hasConfirmation: row.has_confirmation,
    reasons: row.reasons ?? [],
    details: row.details,
    recordedOn: row.recorded_on,
    flagRaised: row.flag_raised,
  };
}

// The "JEE Mains" exam row's id, or null when the database has none.
async function jeeExamId(): Promise<number | null> {
  const rows = await query<{ id: number | string }>(`SELECT id FROM exam WHERE name = $1 ORDER BY id LIMIT 1`, [
    JEE_FORM_EXAM.examName,
  ]);
  return rows[0] ? Number(rows[0].id) : null;
}

async function listUpdates(studentId: number, examId: number): Promise<UpdateRow[]> {
  return query<UpdateRow>(
    `SELECT u.id, u.status, u.application_number, u.confirmation_document_id,
            (doc.id IS NOT NULL) AS has_confirmation, u.reasons, u.details,
            ((u.inserted_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata')::date::text AS recorded_on,
            EXISTS (SELECT 1 FROM blended_learning_mentor_flags flag WHERE flag.jee_form_update_id = u.id)
              AS flag_raised
     FROM blended_learning_jee_form_updates u
     LEFT JOIN lms_student_documents doc
       ON doc.id = u.confirmation_document_id AND doc.deleted_at IS NULL
     WHERE u.student_id = $1 AND u.exam_id = $2 AND u.exam_year = $3
     ORDER BY u.id DESC
     LIMIT ${HISTORY_LIMIT}`,
    [studentId, examId, JEE_FORM_EXAM.examYear]
  );
}

async function listReminderItems(studentId: number): Promise<JeeReminderItem[]> {
  const rows = await query<{ id: number | string; text: string; status: "open" | "done" }>(
    `SELECT item.id, item.text, item.status
     FROM blended_learning_action_items item
     JOIN blended_learning_common_action_items common ON common.id = item.common_action_item_id
     WHERE item.student_id = $1 AND ${REMINDER_MATCH_SQL}
     ORDER BY item.id`,
    [studentId, JEE_FORM_REMINDER_TEXT]
  );
  return rows.map((row) => ({ id: Number(row.id), text: row.text, status: row.status }));
}

// The card for one Mentee; null when out of the actor's scope or when there
// is no "JEE Mains" exam row to record against.
export async function getJeeForm(access: BlendedLearningAccess, studentId: number): Promise<JeeFormView | null> {
  if (!(await canAccessBlendedStudent(access, studentId))) return null;
  const examId = await jeeExamId();
  if (examId === null) return null;
  const [updates, reminderItems] = await Promise.all([listUpdates(studentId, examId), listReminderItems(studentId)]);
  const [current, ...earlier] = updates.map(toUpdate);
  return { current: current ?? null, earlier, reminderItems };
}

// --- Recording ---------------------------------------------------------------

export type ConfirmationFile = { name: string; type: string; size: number; arrayBuffer(): Promise<ArrayBuffer> };

export type RecordJeeFormResult =
  | { ok: true; created: boolean; form: JeeFormView }
  | { ok: false; status: 403 | 404 | 409 | 422 | 502 | 503; error: string; fieldErrors?: JeeFormFieldErrors };

const NOT_FOUND: RecordJeeFormResult = { ok: false, status: 404, error: "Not found" };

function invalid(fieldErrors: JeeFormFieldErrors): RecordJeeFormResult {
  const [first] = Object.values(fieldErrors);
  return { ok: false, status: 422, error: first ?? "Check the form.", fieldErrors };
}

function conflict(fieldErrors: JeeFormFieldErrors): RecordJeeFormResult {
  const [first] = Object.values(fieldErrors);
  return { ok: false, status: 409, error: first ?? "This conflicts with what is saved.", fieldErrors };
}

type ExamRecordRow = {
  id: number | string;
  exam_id: number | string;
  exam_name: string | null;
  exam_year: number | null;
  application_number: string | null;
};

// What to send the DB Service so the Student has exactly one "JEE Mains"
// 2027 record holding this application number.
export type ExamRecordPlan =
  | { kind: "none" }
  | { kind: "create" }
  | { kind: "patch"; id: number; examYear?: number }
  | { kind: "conflict"; message: string };

const sameNumber = (a: string | null, b: string) => (a ?? "").trim().toLowerCase() === b.toLowerCase();

// The DB Service's create upserts on (student, application number), not on
// the exam, so a number the Student already holds on another record would
// move that record. Such a number is refused instead, except on the
// Student's yearless "JEE Mains" record (as the Exams tab saves them), which
// is taken to be this registration and given the year.
export function planExamRecordWrite(
  rows: ExamRecordRow[],
  examId: number,
  applicationNumber: string
): ExamRecordPlan {
  const isJee = (row: ExamRecordRow) => Number(row.exam_id) === examId;
  const target = rows.find((row) => isJee(row) && Number(row.exam_year) === JEE_FORM_EXAM.examYear);
  const holders = rows.filter((row) => sameNumber(row.application_number, applicationNumber));
  const clash = holders.find((row) => row.id !== target?.id && !(target === undefined && isJee(row) && row.exam_year === null));
  if (clash) {
    const year = clash.exam_year === null ? "" : ` ${clash.exam_year}`;
    return {
      kind: "conflict",
      message: `This application number is already saved for ${clash.exam_name ?? "another exam"}${year}.`,
    };
  }
  if (target) {
    return target.application_number === applicationNumber ? { kind: "none" } : { kind: "patch", id: Number(target.id) };
  }
  const yearless = holders.find((row) => isJee(row) && row.exam_year === null);
  if (yearless) return { kind: "patch", id: Number(yearless.id), examYear: JEE_FORM_EXAM.examYear };
  return { kind: "create" };
}

async function examRecordPlan(studentId: number, examId: number, applicationNumber: string): Promise<ExamRecordPlan> {
  // Named columns only: never the password.
  const rows = await query<ExamRecordRow>(
    `SELECT ser.id, ser.exam_id, e.name AS exam_name, ser.exam_year, ser.application_number
     FROM student_exam_record ser
     LEFT JOIN exam e ON e.id = ser.exam_id
     WHERE ser.student_id = $1
       AND (ser.exam_id = $2 OR lower(btrim(ser.application_number)) = lower($3))
     ORDER BY ser.id`,
    [studentId, examId, applicationNumber]
  );
  return planExamRecordWrite(rows, examId, applicationNumber);
}

async function applyExamRecordPlan(
  plan: ExamRecordPlan,
  studentId: number,
  examId: number,
  applicationNumber: string
): Promise<void> {
  if (plan.kind === "create") {
    await createExamRecordWithoutPassword({
      student_id: studentId,
      exam_id: examId,
      exam_year: JEE_FORM_EXAM.examYear,
      application_number: applicationNumber,
    });
  } else if (plan.kind === "patch") {
    await patchExamRecordWithoutPassword(plan.id, {
      application_number: applicationNumber,
      ...(plan.examYear === undefined ? {} : { exam_year: plan.examYear }),
    });
  }
}

type StoredConfirmation = { documentId: number; pages: UploadedPage[] };

// The PDF as an `lms_student_documents` row, as the Students page's document
// upload stores one (S3 first, then the DB Service row; S3 is cleaned up if
// the row fails).
async function storeConfirmation(
  studentId: number,
  file: ConfirmationFile,
  uploadedBy: string
): Promise<StoredConfirmation> {
  const pages = await uploadDocumentPages({
    studentId,
    documentType: JEE_CONFIRMATION_DOCUMENT_TYPE,
    documentUuid: randomUUID(),
    pages: [{ buffer: Buffer.from(await file.arrayBuffer()), mimeType: "application/pdf", pageNumber: 1 }],
  });
  try {
    const row = await createDocument({
      student_id: studentId,
      document_type: JEE_CONFIRMATION_DOCUMENT_TYPE,
      pages,
      metadata: { exam: JEE_FORM_EXAM.examName, exam_year: JEE_FORM_EXAM.examYear, source: "blended_learning" },
      uploaded_by: uploadedBy,
    });
    return { documentId: Number(row.id), pages };
  } catch (error) {
    await deleteDocumentObjects(pages.map((page) => page.s3_key));
    throw error;
  }
}

// Best effort: a confirmation stored for a save that then failed.
async function discardConfirmation(stored: StoredConfirmation | null): Promise<void> {
  if (!stored) return;
  try {
    await softDeleteDocument(stored.documentId);
  } catch (error) {
    console.error("JEE form confirmation cleanup failed:", error instanceof Error ? error.name : "unknown");
  }
}

class OutOfScope extends Error {}

type LatestRow = {
  id: number | string;
  status: JeeFormStatus;
  application_number: string | null;
  confirmation_document_id: number | string | null;
  reasons: JeeFormReason[] | null;
  details: string | null;
};

// The same status and values as the latest update, with no new PDF.
function unchanged(latest: LatestRow | undefined, input: JeeFormInput, newDocument: boolean): boolean {
  if (!latest || latest.status !== input.status || newDocument) return false;
  if (input.status === "filled") return latest.application_number === input.applicationNumber;
  return (latest.reasons ?? []).join(",") === input.reasons.join(",") && latest.details === input.details;
}

async function insertUpdate(
  client: PoolClient,
  access: BlendedLearningAccess,
  values: {
    studentId: number;
    examId: number;
    input: JeeFormInput;
    confirmationDocumentId: number | null;
    mapping: { mentor_user_id: number | string; program_id: number | string; academic_year: string };
  }
): Promise<number> {
  const { input, mapping } = values;
  const result = await client.query<{ id: number | string }>(
    `INSERT INTO blended_learning_jee_form_updates
       (student_id, exam_id, exam_year, status, application_number, confirmation_document_id,
        reasons, details, mentor_user_id, program_id, academic_year, recorded_by_email)
     VALUES ($1, $2, $3, $4, $5, $6, $7::varchar[], $8, $9, $10, $11, $12)
     RETURNING id`,
    [
      values.studentId,
      values.examId,
      JEE_FORM_EXAM.examYear,
      input.status,
      input.status === "filled" ? input.applicationNumber : null,
      values.confirmationDocumentId,
      input.status === "not_filled" ? input.reasons : null,
      input.status === "not_filled" ? input.details : null,
      mapping.mentor_user_id,
      mapping.program_id,
      mapping.academic_year,
      access.actorEmail,
    ]
  );
  return Number(result.rows[0].id);
}

// One Mentor Flag for the program team, on the not-filled update.
async function raiseFlag(
  client: PoolClient,
  access: BlendedLearningAccess,
  studentId: number,
  updateId: number,
  input: Extract<JeeFormInput, { status: "not_filled" }>
): Promise<void> {
  await client.query(
    `INSERT INTO blended_learning_mentor_flags (student_id, jee_form_update_id, recipient, comment, raised_by_email)
     VALUES ($1, $2, 'jee_form', $3, $4)`,
    [studentId, updateId, jeeFormFlagComment(input), access.actorEmail]
  );
}

// Tick the Student's open reminder Action Items done, by this update.
async function tickReminder(
  client: PoolClient,
  access: BlendedLearningAccess,
  studentId: number,
  updateId: number
): Promise<void> {
  await client.query(
    `UPDATE blended_learning_action_items item
     SET status = 'done', completed_by_jee_form_update_id = $3, completed_by_email = $4,
         completed_at = now(), updated_at = now()
     FROM blended_learning_common_action_items common
     WHERE common.id = item.common_action_item_id
       AND item.student_id = $1 AND item.status = 'open' AND ${REMINDER_MATCH_SQL}`,
    [studentId, JEE_FORM_REMINDER_TEXT, updateId, access.actorEmail]
  );
}

// A re-save of the same number keeps the confirmation already uploaded.
function keptDocument(latest: LatestRow | undefined, input: JeeFormInput): number | null {
  if (input.status !== "filled" || latest?.status !== "filled") return null;
  if (latest.application_number !== input.applicationNumber || latest.confirmation_document_id === null) return null;
  return Number(latest.confirmation_document_id);
}

async function latestUpdate(client: PoolClient, studentId: number, examId: number): Promise<LatestRow | undefined> {
  const result = await client.query<LatestRow>(
    `SELECT id, status, application_number, confirmation_document_id, reasons, details
     FROM blended_learning_jee_form_updates
     WHERE student_id = $1 AND exam_id = $2 AND exam_year = $3
     ORDER BY id DESC
     LIMIT 1`,
    [studentId, examId, JEE_FORM_EXAM.examYear]
  );
  return result.rows[0];
}

// The update, its flag or tick, in one transaction. False when nothing
// changed (the same status and values were saved again).
function saveUpdate(
  access: BlendedLearningAccess,
  studentId: number,
  examId: number,
  input: JeeFormInput,
  stored: StoredConfirmation | null
): Promise<boolean> {
  return withTransaction(async (client) => {
    const mapping = await lockMappingInScope(client, access, studentId);
    if (!mapping) throw new OutOfScope();
    const latest = await latestUpdate(client, studentId, examId);
    if (unchanged(latest, input, stored !== null)) return false;

    const updateId = await insertUpdate(client, access, {
      studentId,
      examId,
      input,
      confirmationDocumentId: stored?.documentId ?? keptDocument(latest, input),
      mapping,
    });
    if (input.status === "not_filled") await raiseFlag(client, access, studentId, updateId, input);
    else await tickReminder(client, access, studentId, updateId);
    return true;
  });
}

function failedSave(error: unknown): RecordJeeFormResult {
  if (error instanceof OutOfScope) return NOT_FOUND;
  const code = (error as { code?: unknown } | null)?.code;
  if (code === "23514" || code === "23505" || code === "23503") {
    return { ok: false, status: 409, error: "This conflicts with what is saved. Reload and try again." };
  }
  throw error;
}

function validateFile(input: JeeFormInput, file: ConfirmationFile | null): JeeFormFieldErrors | null {
  if (!file) return null;
  if (input.status !== "filled") return { confirmation: "Only a filled form takes a confirmation page." };
  const error = confirmationError(file);
  return error ? { confirmation: error } : null;
}

// A filled form's writes outside the database transaction: the confirmation
// PDF (S3 + lms_student_documents) and the student_exam_record upsert, both
// through the DB Service. On failure the stored PDF is withdrawn.
async function writeApplication(
  access: BlendedLearningAccess,
  studentId: number,
  examId: number,
  input: Extract<JeeFormInput, { status: "filled" }>,
  file: ConfirmationFile | null
): Promise<{ ok: true; stored: StoredConfirmation | null } | { ok: false; result: RecordJeeFormResult }> {
  const plan = await examRecordPlan(studentId, examId, input.applicationNumber);
  if (plan.kind === "conflict") return { ok: false, result: conflict({ applicationNumber: plan.message }) };
  let stored: StoredConfirmation | null = null;
  try {
    if (file) stored = await storeConfirmation(studentId, file, access.actorEmail);
    await applyExamRecordPlan(plan, studentId, examId, input.applicationNumber);
    return { ok: true, stored };
  } catch (error) {
    // Never log keys, bodies or the number: the error's name is enough.
    console.error("JEE form external write failed:", error instanceof Error ? error.name : "unknown");
    await discardConfirmation(stored);
    return { ok: false, result: { ok: false, status: 502, error: "Couldn't save the application. Try again." } };
  }
}

// Record the Mentee's JEE form status. 403 for read-only and other roles,
// 404 out of scope, 422 invalid, 409 an application number held by another
// record, 502 when S3 or the DB Service fails (nothing is recorded then),
// 503 without a "JEE Mains" exam row.
export async function recordJeeForm(
  access: BlendedLearningAccess,
  studentId: number,
  raw: RawJeeForm,
  file: ConfirmationFile | null
): Promise<RecordJeeFormResult> {
  if (!canBlendedLearning(access, "record_jee_form")) return { ok: false, status: 403, error: "Forbidden" };
  if (!Number.isSafeInteger(studentId) || studentId <= 0) return NOT_FOUND;

  const validated = validateJeeForm(raw);
  if (!validated.ok) return invalid(validated.fieldErrors);
  const { input } = validated;
  const fileErrors = validateFile(input, file);
  if (fileErrors) return invalid(fileErrors);

  if (!(await canAccessBlendedStudent(access, studentId))) return NOT_FOUND;
  const examId = await jeeExamId();
  if (examId === null) return { ok: false, status: 503, error: "The JEE Mains exam isn't set up yet." };

  const external = input.status === "filled" ? await writeApplication(access, studentId, examId, input, file) : null;
  if (external && !external.ok) return external.result;
  const stored = external?.stored ?? null;

  let created: boolean;
  try {
    created = await saveUpdate(access, studentId, examId, input, stored);
  } catch (error) {
    await discardConfirmation(stored);
    return failedSave(error);
  }

  const form = await getJeeForm(access, studentId);
  return form ? { ok: true, created, form } : NOT_FOUND;
}

// A short-lived link to the current confirmation page; null when out of
// scope or the latest update has none.
export async function getJeeConfirmationUrl(access: BlendedLearningAccess, studentId: number): Promise<string | null> {
  if (!(await canAccessBlendedStudent(access, studentId))) return null;
  const examId = await jeeExamId();
  if (examId === null) return null;
  const rows = await query<{ pages: UploadedPage[] | null }>(
    `SELECT doc.pages
     FROM (
       SELECT confirmation_document_id
       FROM blended_learning_jee_form_updates
       WHERE student_id = $1 AND exam_id = $2 AND exam_year = $3
       ORDER BY id DESC
       LIMIT 1
     ) latest
     JOIN lms_student_documents doc
       ON doc.id = latest.confirmation_document_id AND doc.student_id = $1 AND doc.deleted_at IS NULL`,
    [studentId, examId, JEE_FORM_EXAM.examYear]
  );
  const s3Key = rows[0]?.pages?.[0]?.s3_key;
  if (!s3Key) return null;
  return presignDocumentPage({
    s3Key,
    ttlSeconds: CONFIRMATION_URL_TTL_SECONDS,
    responseContentType: "application/pdf",
  });
}
