import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";

import { query, withTransaction } from "./db";
import { CURRENT_ACADEMIC_YEAR } from "./constants";
import {
  activeBlendedMappingSql,
  blendedStudentScope,
  canAccessBlendedStudent,
  canBlendedLearning,
  lockMappingInScope,
  mentorNameSql,
  viewableMentorUserIds,
  type BlendedLearningAccess,
  type MappingSnapshot,
} from "./blended-learning-access";
import {
  JEE_FORM_EXAM,
  JEE_FORM_REMINDER_TEXT,
  JEE_PASSWORD_REQUIRED,
  confirmationError,
  jeeFormFlagComment,
  validateJeeForm,
  type JeeFormFieldErrors,
  type JeeFormInput,
  type JeeFormReason,
  type JeeFormLineView,
  type JeeFormRow,
  type JeeFormStatus,
  type JeeFormStatusSummary,
  type JeeFormUpdate,
  type JeeFormView,
  type JeeReminderItem,
  type JeeStatusOnlyView,
  type RawJeeForm,
} from "./blended-learning-jee-form-input";
import { jeeReminderMatchSql } from "./blended-learning-jee-reminder";
import { createDocument, softDeleteDocument } from "./db-service-documents";
import {
  createExamRecordWithoutPlaintext,
  patchExamRecordWithoutPlaintext,
} from "./db-service-exam-records";
import { encryptExamPassword } from "./exam-password-crypto";
import { isPmuOnlyStudent } from "./permissions";
import { deleteDocumentObjects, presignDocumentPage, uploadDocumentPages, type UploadedPage } from "./s3";

// The JEE form (server-only): whether a Mentee has filled the JEE Main 2027
// form, recorded in the JEE Form tab. Each save appends a row to
// blended_learning_jee_form_updates (the latest is the status, the rest its
// history).
//
// - Filled: the application number is upserted into `student_exam_record`
//   through the DB Service (one record per Student + "JEE Mains" + 2027; an
//   existing row is updated, never duplicated) with the exam-portal password
//   as KMS ciphertext (required while the record has none; optional to
//   replace after), the optional confirmation PDF
//   goes to S3 and `lms_student_documents` through the existing document
//   upload, and the Student's open "JEE Form Filling (Reminder)" Common
//   Action Item is ticked done. Saving the same Filled form again adds no
//   update but still ticks an open reminder (by the latest update); a typed
//   password always counts as a change.
// - Not filled: the reasons and details are stored and a Mentor Flag with
//   recipient `jee_form` is raised for the program team's Flags feed.
//
// The legacy plaintext `student_exam_record.application_password` is never
// selected, read or returned here: every read names its columns, and page
// data carries only `passwordSaved`. It is only ever cleared: a write that
// sets a new ciphertext also sends `application_password: null` (as the Exams
// tab does), and the read-back confirms it is null with an IS NULL test that
// never selects the value. The DB Service writes never read the response
// body. The password is decrypted only by the logged reveal
// (blended-learning-jee-password).

const JEE_CONFIRMATION_DOCUMENT_TYPE = "jee_main_confirmation";
const CONFIRMATION_URL_TTL_SECONDS = 300; // 5 minutes
const HISTORY_LIMIT = 20;

type UpdateRow = {
  student_id: number | string;
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
export async function jeeExamId(): Promise<number | null> {
  const rows = await query<{ id: number | string }>(`SELECT id FROM exam WHERE name = $1 ORDER BY id LIMIT 1`, [
    JEE_FORM_EXAM.examName,
  ]);
  return rows[0] ? Number(rows[0].id) : null;
}

// Each Student's latest updates, newest first: the current one and up to
// HISTORY_LIMIT - 1 earlier ones.
async function listUpdates(studentIds: number[], examId: number): Promise<UpdateRow[]> {
  return query<UpdateRow>(
    `SELECT ranked.student_id, ranked.id, ranked.status, ranked.application_number,
            ranked.confirmation_document_id, ranked.has_confirmation, ranked.reasons, ranked.details,
            ranked.recorded_on, ranked.flag_raised
     FROM (
       SELECT u.student_id, u.id, u.status, u.application_number, u.confirmation_document_id,
              (doc.id IS NOT NULL) AS has_confirmation, u.reasons, u.details,
              ((u.inserted_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata')::date::text AS recorded_on,
              EXISTS (SELECT 1 FROM blended_learning_mentor_flags flag WHERE flag.jee_form_update_id = u.id)
                AS flag_raised,
              row_number() OVER (PARTITION BY u.student_id ORDER BY u.id DESC) AS newest
       FROM blended_learning_jee_form_updates u
       LEFT JOIN lms_student_documents doc
         ON doc.id = u.confirmation_document_id AND doc.deleted_at IS NULL
       WHERE u.student_id = ANY($1::bigint[]) AND u.exam_id = $2 AND u.exam_year = $3
     ) ranked
     WHERE ranked.newest <= ${HISTORY_LIMIT}
     ORDER BY ranked.student_id, ranked.id DESC`,
    [studentIds, examId, JEE_FORM_EXAM.examYear]
  );
}

type ReminderRow = { student_id: number | string; id: number | string; text: string; status: "open" | "done" };

async function listReminderItems(studentIds: number[]): Promise<ReminderRow[]> {
  return query<ReminderRow>(
    `SELECT item.student_id, item.id, item.text, item.status
     FROM blended_learning_action_items item
     JOIN blended_learning_common_action_items common ON common.id = item.common_action_item_id
     WHERE item.student_id = ANY($1::bigint[]) AND ${jeeReminderMatchSql("common", "$2")}
     ORDER BY item.student_id, item.id`,
    [studentIds, JEE_FORM_REMINDER_TEXT]
  );
}

function byStudent<T extends { student_id: number | string }>(rows: T[]): Map<number, T[]> {
  const groups = new Map<number, T[]>();
  for (const row of rows) {
    const key = Number(row.student_id);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return groups;
}

// The Students whose JEE Mains 2027 record holds a password ciphertext. Only
// the flag is selected, never the ciphertext (and never the legacy column).
async function listPasswordSaved(studentIds: number[], examId: number): Promise<Set<number>> {
  const rows = await query<{ student_id: number | string }>(
    `SELECT DISTINCT ser.student_id
     FROM student_exam_record ser
     WHERE ser.student_id = ANY($1::bigint[]) AND ser.exam_id = $2 AND ser.exam_year = $3
       AND ser.application_password_ciphertext IS NOT NULL`,
    [studentIds, examId, JEE_FORM_EXAM.examYear]
  );
  return new Set(rows.map((row) => Number(row.student_id)));
}

// Each Student's form: the current update, the earlier ones and the reminder.
async function jeeFormViews(studentIds: number[], examId: number): Promise<Map<number, JeeFormView>> {
  if (studentIds.length === 0) return new Map();
  const [updates, reminders, passwordSaved] = await Promise.all([
    listUpdates(studentIds, examId),
    listReminderItems(studentIds),
    listPasswordSaved(studentIds, examId),
  ]);
  const updatesByStudent = byStudent(updates);
  const remindersByStudent = byStudent(reminders);
  return new Map(
    studentIds.map((studentId) => {
      const [current, ...earlier] = (updatesByStudent.get(studentId) ?? []).map(toUpdate);
      const reminderItems: JeeReminderItem[] = (remindersByStudent.get(studentId) ?? []).map((row) => ({
        id: Number(row.id),
        text: row.text,
        status: row.status,
      }));
      return [
        studentId,
        { current: current ?? null, earlier, reminderItems, passwordSaved: passwordSaved.has(studentId) },
      ];
    })
  );
}

type StatusRow = {
  student_id: number | string;
  status: JeeFormStatus;
  reasons: JeeFormReason[] | null;
  recorded_on: string;
};

// Each Student's current status for a view-only viewer: the latest update's
// status, reasons and date, and nothing else. This read never selects the
// application number, the details, the confirmation or the exam record.
async function jeeStatusOnlyViews(studentIds: number[], examId: number): Promise<Map<number, JeeStatusOnlyView>> {
  if (studentIds.length === 0) return new Map();
  const rows = await query<StatusRow>(
    `SELECT DISTINCT ON (u.student_id) u.student_id, u.status, u.reasons,
            ((u.inserted_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata')::date::text AS recorded_on
     FROM blended_learning_jee_form_updates u
     WHERE u.student_id = ANY($1::bigint[]) AND u.exam_id = $2 AND u.exam_year = $3
     ORDER BY u.student_id, u.id DESC`,
    [studentIds, examId, JEE_FORM_EXAM.examYear]
  );
  const current = new Map<number, JeeFormStatusSummary>(
    rows.map((row) => [
      Number(row.student_id),
      { status: row.status, reasons: row.reasons ?? [], recordedOn: row.recorded_on },
    ])
  );
  return new Map(
    studentIds.map((studentId) => [studentId, { statusOnly: true, current: current.get(studentId) ?? null }])
  );
}

// The Mentee page's JEE line, by the viewer's scope on the Student
// (blendedStudentScope): the whole form in full scope, the status only for a
// team lead on a supervised Mentor's Mentee (view only). Null out of scope or
// without a "JEE Mains" exam row.
export async function getJeeFormLine(access: BlendedLearningAccess, studentId: number): Promise<JeeFormLineView | null> {
  const scope = await blendedStudentScope(access, studentId);
  if (scope === null) return null;
  const examId = await jeeExamId();
  if (examId === null) return null;
  if (scope === "view_only") return (await jeeStatusOnlyViews([studentId], examId)).get(studentId) ?? null;
  return (await jeeFormViews([studentId], examId)).get(studentId) ?? null;
}

// One Mentee's form; null when out of the actor's full scope or when there is
// no "JEE Mains" exam row to record against.
async function getJeeForm(access: BlendedLearningAccess, studentId: number): Promise<JeeFormView | null> {
  if (!(await canAccessBlendedStudent(access, studentId))) return null;
  const examId = await jeeExamId();
  if (examId === null) return null;
  return (await jeeFormViews([studentId], examId)).get(studentId) ?? null;
}

type StudentRow = {
  student_id: number | string;
  program_student_id: string | null;
  first_name: string | null;
  last_name: string | null;
  mentor_user_id: number | string;
  mentor_name: string;
};

// The JEE Form tab: one row per Student with an active current-year Mapping
// the viewer sees (viewableMentorUserIds: a Mentor's own, a team lead's
// supervised Mentors' too; every Mentor's for an admin), A–Z by name. A row
// in full scope carries its form; a supervised Mentor's Mentee (view only,
// as blendedStudentScope has it) carries the status only. Null when there is
// no "JEE Mains" exam row.
export async function listJeeFormRows(access: BlendedLearningAccess): Promise<JeeFormRow[] | null> {
  const mentorUserIds = viewableMentorUserIds(access);
  if (mentorUserIds !== null && mentorUserIds.length === 0) return [];
  const examId = await jeeExamId();
  if (examId === null) return null;
  const students = await query<StudentRow>(
    `SELECT st.id AS student_id, st.student_id AS program_student_id, account.first_name, account.last_name,
            mapping.mentor_user_id, ${mentorNameSql("mentor", "mapping.mentor_user_id")} AS mentor_name
     FROM blended_learning_mentor_mentee_mappings mapping
     JOIN student st ON st.id = mapping.student_id
     JOIN "user" account ON account.id = st.user_id
     LEFT JOIN "user" mentor ON mentor.id = mapping.mentor_user_id
     WHERE ${activeBlendedMappingSql("mapping", "$1")}
       AND ($2::bigint[] IS NULL OR mapping.mentor_user_id = ANY($2::bigint[]))
     ORDER BY lower(CONCAT_WS(' ', account.first_name, account.last_name)), st.id`,
    [CURRENT_ACADEMIC_YEAR, mentorUserIds]
  );
  // View only: a Mentor's row whose Mapping is to a Mentor they supervise.
  const viewOnly = (row: StudentRow) => access.kind === "mentor" && Number(row.mentor_user_id) !== access.mentorUserId;
  const ids = (rows: StudentRow[]) => rows.map((row) => Number(row.student_id));
  const [views, statuses] = await Promise.all([
    jeeFormViews(ids(students.filter((row) => !viewOnly(row))), examId),
    jeeStatusOnlyViews(ids(students.filter(viewOnly)), examId),
  ]);
  return students.map((row): JeeFormRow => {
    const studentId = Number(row.student_id);
    const base = {
      studentId,
      programStudentId: row.program_student_id,
      name: [row.first_name, row.last_name].filter(Boolean).join(" "),
      mentorUserId: Number(row.mentor_user_id),
      mentorName: row.mentor_name,
    };
    if (viewOnly(row)) {
      return { ...base, viewOnly: true, form: statuses.get(studentId) ?? { statusOnly: true, current: null } };
    }
    const form = views.get(studentId) ?? { current: null, earlier: [], reminderItems: [], passwordSaved: false };
    return { ...base, viewOnly: false, form };
  });
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
  // The record holds a password ciphertext (the ciphertext isn't selected).
  has_password?: boolean;
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

// The plan, the record it writes (null for a create) and whether that record
// already holds a password ciphertext.
type ExamRecordTarget = { plan: ExamRecordPlan; recordId: number | null; passwordSaved: boolean };

function planTarget(rows: ExamRecordRow[], examId: number, plan: ExamRecordPlan): ExamRecordTarget {
  let row: ExamRecordRow | undefined;
  if (plan.kind === "patch") row = rows.find((candidate) => Number(candidate.id) === plan.id);
  else if (plan.kind === "none") {
    row = rows.find((candidate) => Number(candidate.exam_id) === examId && Number(candidate.exam_year) === JEE_FORM_EXAM.examYear);
  }
  return { plan, recordId: row ? Number(row.id) : null, passwordSaved: Boolean(row?.has_password) };
}

async function examRecordPlan(
  client: PoolClient,
  studentId: number,
  examId: number,
  applicationNumber: string
): Promise<ExamRecordTarget> {
  // Named columns only: never the legacy password, and only whether a
  // ciphertext is there, not the ciphertext.
  const { rows } = await client.query<ExamRecordRow>(
    `SELECT ser.id, ser.exam_id, e.name AS exam_name, ser.exam_year, ser.application_number,
            (ser.application_password_ciphertext IS NOT NULL) AS has_password
     FROM student_exam_record ser
     LEFT JOIN exam e ON e.id = ser.exam_id
     WHERE ser.student_id = $1
       AND (ser.exam_id = $2 OR lower(btrim(ser.application_number)) = lower($3))
     ORDER BY ser.id`,
    [studentId, examId, applicationNumber]
  );
  return planTarget(rows, examId, planExamRecordWrite(rows, examId, applicationNumber));
}

// `ciphertext` (a new password) rides along with the plan's write; with
// nothing else to change, it is patched onto the record on its own. It always
// goes with `application_password: null`, clearing any legacy plaintext as
// the Exams tab does; a write without a new password (a number change alone)
// leaves both password columns as they are, as the Exams tab's "keep" does.
async function applyExamRecordPlan(
  client: PoolClient,
  target: ExamRecordTarget,
  studentId: number,
  examId: number,
  applicationNumber: string,
  ciphertext: string | null
): Promise<void> {
  const { plan } = target;
  const password =
    ciphertext === null ? {} : { application_password: null, application_password_ciphertext: ciphertext };
  if (plan.kind === "create") {
    await createExamRecordWithoutPlaintext({
      student_id: studentId,
      exam_id: examId,
      exam_year: JEE_FORM_EXAM.examYear,
      application_number: applicationNumber,
      ...password,
    });
  } else if (plan.kind === "patch") {
    await patchExamRecordWithoutPlaintext(plan.id, {
      application_number: applicationNumber,
      ...(plan.examYear === undefined ? {} : { exam_year: plan.examYear }),
      ...password,
    });
  } else if (plan.kind === "none" && ciphertext !== null && target.recordId !== null) {
    await patchExamRecordWithoutPlaintext(target.recordId, password);
  }
  if (ciphertext !== null) await confirmCiphertextStored(client, studentId, examId, ciphertext);
}

class CiphertextNotStored extends Error {
  name = "CiphertextNotStored";
}

// A DB Service that predates `application_password_ciphertext` answers 2xx
// and drops the key, so the write is read back from Postgres instead of
// being taken on trust (the response body, which holds the legacy password,
// is never read). As the Exams tab checks its response, the record must hold
// this ciphertext and no legacy plaintext: the legacy column is only tested
// IS NULL, never selected. Read on the save's transaction client: each
// statement sees what the DB Service has committed.
async function confirmCiphertextStored(
  client: PoolClient,
  studentId: number,
  examId: number,
  ciphertext: string
): Promise<void> {
  const { rows } = await client.query<{ id: number | string }>(
    `SELECT ser.id
     FROM student_exam_record ser
     WHERE ser.student_id = $1 AND ser.exam_id = $2 AND ser.exam_year = $3
       AND ser.application_password_ciphertext = $4
       AND ser.application_password IS NULL
     LIMIT 1`,
    [studentId, examId, JEE_FORM_EXAM.examYear, ciphertext]
  );
  if (rows.length === 0) throw new CiphertextNotStored();
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

class OutOfScope extends Error {
  name = "OutOfScope";
}

// A refusal decided inside the save's transaction (409, 403, 422 or 502):
// thrown so the transaction rolls back, then answered with its result.
class SaveRefused extends Error {
  name = "SaveRefused";
  constructor(readonly result: RecordJeeFormResult) {
    super("JEE form save refused");
  }
}

// Serializes saves for one Student (two tabs, two devices), held to commit,
// so the exam record and the latest update can't end up holding different
// numbers and the same Not filled form can't raise two flags. Taken before
// the Mapping lock; keyed by a namespaced string as the Holistic locks are.
async function lockStudentJeeForm(client: PoolClient, studentId: number): Promise<void> {
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`blended_learning_jee_form:${studentId}`]);
}

type LatestRow = {
  id: number | string;
  status: JeeFormStatus;
  application_number: string | null;
  confirmation_document_id: number | string | null;
  reasons: JeeFormReason[] | null;
  details: string | null;
};

// The same status and values as the latest update, with no new PDF and, for
// Filled, no password typed: a typed password can't be compared with the
// saved ciphertext (and is written to the exam record before the update is
// appended), so it always counts as a change and records a new update.
function unchanged(latest: LatestRow | undefined, input: JeeFormInput, newDocument: boolean): boolean {
  if (!latest || latest.status !== input.status || newDocument) return false;
  if (input.status === "filled") {
    return input.password === null && latest.application_number === input.applicationNumber;
  }
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
    mapping: MappingSnapshot;
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
       AND item.student_id = $1 AND item.status = 'open' AND ${jeeReminderMatchSql("common", "$2")}`,
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

// The update and its flag or tick. False when nothing changed (the same
// status and values were saved again): no update is added then, but saving
// Filled again still ticks an open reminder, done by the latest (Filled)
// update. That closes a reminder left open while the Student was already
// Filled (a push that ran alongside the save, or one made before pushes
// added it done), which nothing else can tick.
async function appendUpdate(
  client: PoolClient,
  access: BlendedLearningAccess,
  values: {
    studentId: number;
    examId: number;
    input: JeeFormInput;
    latest: LatestRow | undefined;
    stored: StoredConfirmation | null;
    mapping: MappingSnapshot;
  }
): Promise<boolean> {
  const { studentId, examId, input, latest, stored, mapping } = values;
  if (unchanged(latest, input, stored !== null)) {
    if (latest?.status === "filled") await tickReminder(client, access, studentId, Number(latest.id));
    return false;
  }

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
}

function failedSave(error: unknown): RecordJeeFormResult {
  if (error instanceof SaveRefused) return error.result;
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

type ExternalWrite = { ok: true; stored: StoredConfirmation | null } | { ok: false; result: RecordJeeFormResult };

const NVS_REFUSED: RecordJeeFormResult = {
  ok: false,
  status: 403,
  error: "Exam registrations are not collected for JNV NVS Students",
};

// The new password as KMS ciphertext, or null to keep the saved one. A form
// without a password is refused while the record has none. KMS errors name
// the key and the IAM user, so only the error's name is logged.
async function passwordCiphertext(
  studentId: number,
  password: string | null,
  passwordSaved: boolean
): Promise<{ ok: true; ciphertext: string | null } | { ok: false; result: RecordJeeFormResult }> {
  if (password === null) {
    return passwordSaved ? { ok: true, ciphertext: null } : { ok: false, result: invalid({ password: JEE_PASSWORD_REQUIRED }) };
  }
  // A safety net: exam registrations are a physical-centre feature, never
  // collected for a JNV NVS-only Student (as on the Exams tab).
  // So such a Student can't be recorded as Filled (Not filled still works).
  // Accepted on review of #507: Blended Learning has no NVS Students. If NVS
  // Students are ever mapped, don't offer Filled for them or drop the password
  // requirement.
  if (await isPmuOnlyStudent(studentId)) return { ok: false, result: NVS_REFUSED };
  try {
    return { ok: true, ciphertext: await encryptExamPassword(password, studentId) };
  } catch (error) {
    console.error("JEE form password encryption failed:", error instanceof Error ? error.name : "unknown");
    return { ok: false, result: { ok: false, status: 502, error: "Couldn't save the password. Try again." } };
  }
}

// A filled form's writes outside the database: the confirmation PDF (S3 +
// lms_student_documents) and the student_exam_record upsert with any new
// password ciphertext, both through the DB Service. They run inside the
// save's open transaction (its reads use the transaction client), after the
// locks and before the update is appended. The password is encrypted before
// anything is written; on failure the stored PDF is withdrawn. A same-form
// re-save runs this too: with no password or PDF it sends nothing unless the
// record no longer holds the number (edited elsewhere), and it still answers
// 409 / 422 when the number now clashes or the record lost its password.
async function writeApplication(
  client: PoolClient,
  access: BlendedLearningAccess,
  studentId: number,
  examId: number,
  input: Extract<JeeFormInput, { status: "filled" }>,
  file: ConfirmationFile | null
): Promise<ExternalWrite> {
  const target = await examRecordPlan(client, studentId, examId, input.applicationNumber);
  if (target.plan.kind === "conflict") return { ok: false, result: conflict({ applicationNumber: target.plan.message }) };
  const secret = await passwordCiphertext(studentId, input.password, target.passwordSaved);
  if (!secret.ok) return secret;
  let stored: StoredConfirmation | null = null;
  try {
    if (file) stored = await storeConfirmation(studentId, file, access.actorEmail);
    await applyExamRecordPlan(client, target, studentId, examId, input.applicationNumber, secret.ciphertext);
    return { ok: true, stored };
  } catch (error) {
    // Never log keys, bodies or the number: the error's name is enough.
    console.error("JEE form external write failed:", error instanceof Error ? error.name : "unknown");
    await discardConfirmation(stored);
    return { ok: false, result: { ok: false, status: 502, error: "Couldn't save the application. Try again." } };
  }
}

// Record the Mentee's JEE form status. 403 for read-only and other roles (and
// for a JNV NVS-only Student's password), 404 out of scope, 422 invalid
// (including a Filled form without a password while none is saved), 409 an
// application number held by another record, 502 when KMS, S3 or the DB
// Service fails (nothing is recorded then), 503 without a "JEE Mains" exam
// row. On success `created` is false when the same form was saved again
// (nothing new recorded, though an open reminder is still ticked); `form` is
// read after the save, so it shows the reminder as it now is.
//
// One save is one transaction, in this order: the per-Student lock, the
// Mapping re-checked in scope (404 before any KMS, S3 or DB Service write),
// the latest update, then for Filled the external writes (writeApplication),
// then the update and its flag or tick, then commit. Any refusal or failure
// rolls the transaction back and withdraws a stored PDF. What can't be undone
// is the exam record write: if the insert or commit fails after it (a
// constraint, a lost connection, or the pool's 15 s idle-in-transaction
// timeout ending the session while the HTTP calls run), the record holds the
// new number or password while the latest update still shows the old status.
// That gap is left as is, not compensated; saving again repairs it.
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

  // Set once the PDF is stored, so a failure after that withdraws it.
  const written: { stored: StoredConfirmation | null } = { stored: null };
  let created: boolean;
  try {
    created = await withTransaction(async (client) => {
      await lockStudentJeeForm(client, studentId);
      const mapping = await lockMappingInScope(client, access, studentId);
      if (!mapping) throw new OutOfScope();
      const latest = await latestUpdate(client, studentId, examId);
      if (input.status === "filled") {
        const external = await writeApplication(client, access, studentId, examId, input, file);
        if (!external.ok) throw new SaveRefused(external.result);
        written.stored = external.stored;
      }
      return appendUpdate(client, access, { studentId, examId, input, latest, stored: written.stored, mapping });
    });
  } catch (error) {
    await discardConfirmation(written.stored);
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
