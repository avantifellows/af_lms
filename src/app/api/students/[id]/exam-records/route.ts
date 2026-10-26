import { NextResponse } from "next/server";
import { getServerSession, type Session } from "next-auth";
import { authOptions } from "@/lib/auth";
import { canAccessStudent, isPmuOnlyStudent } from "@/lib/permissions";
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
import type { StudentExamRecord } from "@/lib/competitive-exams";

// The Exams tab of Edit Student. Both verbs require edit rights on the
// Student, not just view: the response carries exam-portal passwords, which no
// other surface exposes.
//
// Exam registrations are a physical-centre feature (#434, confirmed with the
// Programs team), so both verbs also refuse a PMU (JNV NVS) Student outright
// — the UI hides the tab for them, and the endpoint can't be used to put one
// on an NVS Student behind its back.

function parseStudentId(raw: string): number | null {
  // Exact integer only — `Number.parseInt` would turn "5abc" into another
  // Student's id.
  if (!/^\d+$/.test(raw)) return null;
  const id = Number.parseInt(raw, 10);
  return Number.isFinite(id) && id > 0 ? id : null;
}

async function gate(
  session: Session | null,
  rawStudentId: string,
): Promise<{ ok: true; studentId: number } | { ok: false; response: NextResponse }> {
  if (!session) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  const studentId = parseStudentId(rawStudentId);
  if (studentId === null) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Invalid student id" }, { status: 400 }),
    };
  }
  if (!(await canAccessStudent(session, studentId, { requireEdit: true }))) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }
  if (await isPmuOnlyStudent(studentId)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Exam registrations are not collected for JNV NVS Students" },
        { status: 403 },
      ),
    };
  }
  return { ok: true, studentId };
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const gated = await gate(await getServerSession(authOptions), id);
  if (!gated.ok) return gated.response;

  try {
    const [exams, records] = await Promise.all([
      listExamOptions(),
      listStudentExamRecords(gated.studentId),
    ]);
    return NextResponse.json({ exams, records });
  } catch (error) {
    console.error("Error loading student exam records:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

function unchanged(existing: StudentExamRecord, write: ExamRecordWrite): boolean {
  const sameSessions =
    (existing.sessions_applied ?? []).join(",") ===
    (write.sessions_applied ?? []).join(",");
  return (
    (existing.application_number ?? "") === write.application_number &&
    (existing.application_password ?? null) === write.application_password &&
    sameSessions
  );
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
    const write: ExamRecordWrite = {
      student_id: studentId,
      exam_id: exam.exam_id,
      application_number: exam.application_number,
      application_password: exam.application_password,
      sessions_applied: exam.sessions_applied,
    };
    const current = existingByExam.get(exam.exam_id);
    if (current && unchanged(current, write)) continue;
    outcome.attempted += 1;
    try {
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
  const gated = await gate(await getServerSession(authOptions), id);
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
