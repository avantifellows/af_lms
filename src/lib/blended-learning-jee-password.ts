import { query } from "./db";
import { canAccessBlendedStudent, type BlendedLearningAccess } from "./blended-learning-access";
import { JEE_FORM_EXAM } from "./blended-learning-jee-form-input";
import { jeeExamId } from "./blended-learning-jee-form";
import { decryptExamPassword } from "./exam-password-crypto";
import { isPmuOnlyStudent } from "./permissions";
import { recordExamPasswordReveal } from "./student-exam-records";

// The JEE form's "Show password" (server-only): the one place the Blended
// Learning side decrypts a Mentee's exam-portal password, and every reveal is
// logged to `lms_exam_password_reveals` (viewer email and role) before the
// password is returned. A reveal that can't be logged isn't made.
//
// Who: anyone the Student is in Blended Learning scope for —
// canAccessBlendedStudent, i.e. a Mentor (team leads included) only for their
// own Mentees with an active current-year Mapping, a Blended Learning Admin or
// LMS admin for any Student with one. Read-only accounts may reveal (it's a
// view). The Exams tab's gate (`exam-records-gate`) can't be reused: it is
// school-scoped and gives Blended Learning roles no access.
//
// Only the ciphertext of the Student's JEE Mains 2027 record is read. The
// legacy plaintext `application_password` column is never read here: a record
// holding only a legacy password counts as having none, and the form asks for
// the password again.

export type RevealJeePasswordResult =
  | { ok: true; password: string }
  | { ok: false; status: 403 | 404; error: string };

const FORBIDDEN: RevealJeePasswordResult = { ok: false, status: 403, error: "Forbidden" };
const NONE_SAVED: RevealJeePasswordResult = { ok: false, status: 404, error: "No password saved" };

type CiphertextRow = { id: number | string; exam_id: number | string; application_password_ciphertext: string };

async function jeeCiphertext(studentId: number, examId: number): Promise<CiphertextRow | undefined> {
  const rows = await query<CiphertextRow>(
    `SELECT ser.id, ser.exam_id, ser.application_password_ciphertext
     FROM student_exam_record ser
     WHERE ser.student_id = $1 AND ser.exam_id = $2 AND ser.exam_year = $3
       AND ser.application_password_ciphertext IS NOT NULL
     ORDER BY ser.id DESC
     LIMIT 1`,
    [studentId, examId, JEE_FORM_EXAM.examYear]
  );
  return rows[0];
}

// 403 out of scope (or a JNV NVS-only Student), 404 with no password saved.
// Throws when KMS or the reveal log fails; the caller logs only the error's
// name, never the ciphertext or the password.
export async function revealJeeFormPassword(
  access: BlendedLearningAccess,
  studentId: number
): Promise<RevealJeePasswordResult> {
  if (!(await canAccessBlendedStudent(access, studentId))) return FORBIDDEN;
  // A safety net, as on the Exams tab: exam registrations aren't collected
  // for a JNV NVS-only Student.
  if (await isPmuOnlyStudent(studentId)) return FORBIDDEN;

  const examId = await jeeExamId();
  if (examId === null) return NONE_SAVED;
  const row = await jeeCiphertext(studentId, examId);
  if (!row) return NONE_SAVED;

  const password = await decryptExamPassword(row.application_password_ciphertext, studentId);
  await recordExamPasswordReveal({
    studentId,
    recordId: Number(row.id),
    examId: Number(row.exam_id),
    viewerEmail: access.actorEmail,
    viewerRole: access.role,
  });
  return { ok: true, password };
}
