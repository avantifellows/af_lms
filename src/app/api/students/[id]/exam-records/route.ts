import { NextResponse } from "next/server";
import { getServerSession, type Session } from "next-auth";
import { authOptions } from "@/lib/auth";
import { examPasswordViewer, gateExamRecords } from "@/lib/exam-records-gate";
import {
  listExamOptions,
  listStudentExamRecords,
} from "@/lib/student-exam-records";
import {
  createExamRecord,
  deleteExamRecord,
  updateExamRecord,
  type ExamRecordWrite,
} from "@/lib/db-service-exam-records";
import {
  canonicalizeExamRecordsPayload,
  type CanonicalExamRecordInput,
} from "@/lib/exam-records-payload";
import { encryptExamPassword } from "@/lib/exam-password-crypto";
import type { StudentExamRecord } from "@/lib/competitive-exams";

// The Exams tab of Edit Student. Both verbs are gated by `gateExamRecords`
// (edit rights on the Student, not a JNV NVS Student).
//
// Neither verb returns a password, only whether one is stored. A password the
// tab sends is encrypted with KMS here, before it leaves for the DB Service;
// reading one back is a separate, logged reveal
// (`[recordId]/password/route.ts`).

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await getServerSession(authOptions);
  const gated = await gateExamRecords(session, id);
  if (!gated.ok) return gated.response;

  try {
    const [exams, records, viewer] = await Promise.all([
      listExamOptions(),
      listStudentExamRecords(gated.studentId),
      examPasswordViewer(session as Session),
    ]);
    return NextResponse.json({
      exams,
      records,
      can_reveal_password: viewer?.canReveal ?? false,
    });
  } catch (error) {
    console.error("Error loading student exam records:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

function unchanged(existing: StudentExamRecord, exam: CanonicalExamRecordInput): boolean {
  const sameSessions =
    (existing.sessions_applied ?? []).join(",") ===
    (exam.sessions_applied ?? []).join(",");
  // A new password is always written: KMS ciphertext differs every time, and
  // the stored one is not decrypted just to compare.
  const samePassword =
    exam.password.action === "keep" ||
    (exam.password.action === "clear" && !existing.has_password);
  return (
    (existing.application_number ?? "") === exam.application_number &&
    samePassword &&
    sameSessions
  );
}

/** The DB Service write for one registration, its password encrypted on the way. */
async function toWrite(
  studentId: number,
  exam: CanonicalExamRecordInput,
): Promise<ExamRecordWrite> {
  const write: ExamRecordWrite = {
    student_id: studentId,
    exam_id: exam.exam_id,
    application_number: exam.application_number,
    sessions_applied: exam.sessions_applied,
  };
  if (exam.password.action === "set") {
    write.application_password = null;
    write.application_password_ciphertext = await encryptOrFail(exam.password.value, studentId);
  } else if (exam.password.action === "clear") {
    write.application_password = null;
    write.application_password_ciphertext = null;
  }
  return write;
}

/**
 * KMS errors name the key ARN and the IAM user, which belong in the server log
 * and not in a warning shown to whoever is editing the Student, so they are
 * replaced with a plain message here.
 */
async function encryptOrFail(plaintext: string, studentId: number): Promise<string> {
  try {
    return await encryptExamPassword(plaintext, studentId);
  } catch (error) {
    console.error(
      "Exam password encryption failed:",
      error instanceof Error ? error.name : typeof error,
    );
    throw new Error("the password could not be encrypted; try again later");
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface WriteOutcome {
  attempted: number;
  failed: number;
  warnings: string[];
}

/**
 * Delete the removals first: a registration moved from one exam to another
 * keeps its application number, and the DB Service's create upserts on that
 * number, so the old row has to be gone before the new one is written.
 */
async function applyRemovals(
  recordIds: number[],
  existingById: Map<number, StudentExamRecord>,
  existingByExam: Map<number, StudentExamRecord>,
  outcome: WriteOutcome,
): Promise<void> {
  for (const recordId of recordIds) {
    outcome.attempted += 1;
    try {
      await deleteExamRecord(recordId);
      const record = existingById.get(recordId);
      if (record) existingByExam.delete(record.exam_id);
    } catch (error) {
      outcome.failed += 1;
      const name = existingById.get(recordId)?.exam_name ?? `record ${recordId}`;
      outcome.warnings.push(`Could not remove ${name}: ${errorText(error)}`);
    }
  }
}

/**
 * An application number the Student already carries on an exam that is staying
 * put would be hijacked by the DB Service's upsert, so the whole save is
 * refused rather than another registration silently moving.
 *
 * The Blended Learning JEE form has its own copy of this check
 * (`planExamRecordWrite` in lib/blended-learning-jee-form.ts); af_lms#544
 * tracks sharing one.
 */
function clashingApplicationNumber(
  exams: CanonicalExamRecordInput[],
  kept: Iterable<StudentExamRecord>,
): string | null {
  const keptNumbers = new Map<string, string>();
  for (const record of kept) {
    if (!record.application_number) continue;
    keptNumbers.set(record.application_number.toLowerCase(), record.exam_name);
  }
  for (const exam of exams) {
    const clash = keptNumbers.get(exam.application_number.toLowerCase());
    if (clash && clash !== exam.exam_name) {
      return `Application number ${exam.application_number} is already recorded for ${clash}`;
    }
  }
  return null;
}

async function applyUpserts(
  studentId: number,
  exams: CanonicalExamRecordInput[],
  existingByExam: Map<number, StudentExamRecord>,
  outcome: WriteOutcome,
): Promise<void> {
  for (const exam of exams) {
    const current = existingByExam.get(exam.exam_id);
    if (current && unchanged(current, exam)) continue;
    outcome.attempted += 1;
    try {
      // Inside the try: a KMS failure fails this registration, as a DB Service
      // failure does, and never sends the password unencrypted.
      const write = await toWrite(studentId, exam);
      if (current) await updateExamRecord(current.id, write);
      else await createExamRecord(write);
    } catch (error) {
      outcome.failed += 1;
      outcome.warnings.push(`Could not save ${exam.exam_name}: ${errorText(error)}`);
    }
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const gated = await gateExamRecords(await getServerSession(authOptions), id);
  if (!gated.ok) return gated.response;
  const studentId = gated.studentId;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be an object" }, { status: 400 });
  }

  try {
    const examOptions = await listExamOptions();
    const parsed = canonicalizeExamRecordsPayload(body, examOptions);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const existing = await listStudentExamRecords(studentId);
    const existingById = new Map(existing.map((record) => [record.id, record]));
    const existingByExam = new Map(existing.map((record) => [record.exam_id, record]));
    const outcome: WriteOutcome = { attempted: 0, failed: 0, warnings: [] };

    await applyRemovals(
      parsed.payload.removed_record_ids.filter((recordId) => existingById.has(recordId)),
      existingById,
      existingByExam,
      outcome,
    );

    const clash = clashingApplicationNumber(parsed.payload.exams, existingByExam.values());
    if (clash) return NextResponse.json({ error: clash }, { status: 400 });

    await applyUpserts(studentId, parsed.payload.exams, existingByExam, outcome);

    // Every call failing is a failed save, not a partial one.
    if (outcome.attempted > 0 && outcome.failed === outcome.attempted) {
      return NextResponse.json({ error: outcome.warnings.join("; ") }, { status: 502 });
    }

    const records = await listStudentExamRecords(studentId);
    return NextResponse.json(
      outcome.warnings.length ? { records, warnings: outcome.warnings } : { records },
    );
  } catch (error) {
    console.error("Error saving student exam records:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
