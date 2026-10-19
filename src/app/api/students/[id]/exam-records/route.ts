import { NextResponse } from "next/server";
import { getServerSession, type Session } from "next-auth";
import { authOptions } from "@/lib/auth";
import { canAccessStudent } from "@/lib/permissions";
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
import { canonicalizeExamRecordsPayload } from "@/lib/exam-records-payload";
import type { StudentExamRecord } from "@/lib/competitive-exams";

// The Exams tab of Edit Student. Both verbs require edit rights on the
// Student, not just view: the response carries exam-portal passwords, which no
// other surface exposes.

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

    // Removals run first: a registration moved from one exam to another keeps
    // its application number, and the DB Service's create upserts on that
    // number, so the old row has to be gone before the new one is written.
    const removedIds = parsed.payload.removed_record_ids.filter((recordId) =>
      existingById.has(recordId),
    );
    const warnings: string[] = [];
    let attempted = 0;
    let failed = 0;

    for (const recordId of removedIds) {
      attempted += 1;
      try {
        await deleteExamRecord(recordId);
        const record = existingById.get(recordId);
        if (record) existingByExam.delete(record.exam_id);
      } catch (error) {
        failed += 1;
        const name = existingById.get(recordId)?.exam_name ?? `record ${recordId}`;
        warnings.push(`Could not remove ${name}: ${errorText(error)}`);
      }
    }

    // An application number the Student already carries on an exam that is
    // staying put would be hijacked by the DB Service's upsert, so refuse the
    // whole save rather than silently moving the other registration.
    const keptNumbers = new Map<string, string>();
    for (const record of existingByExam.values()) {
      if (!record.application_number) continue;
      keptNumbers.set(record.application_number.toLowerCase(), record.exam_name);
    }
    for (const exam of parsed.payload.exams) {
      const clash = keptNumbers.get(exam.application_number.toLowerCase());
      if (clash && clash !== exam.exam_name) {
        return NextResponse.json(
          {
            error: `Application number ${exam.application_number} is already recorded for ${clash}`,
          },
          { status: 400 },
        );
      }
    }

    for (const exam of parsed.payload.exams) {
      const write: ExamRecordWrite = {
        student_id: studentId,
        exam_id: exam.exam_id,
        application_number: exam.application_number,
        application_password: exam.application_password,
        sessions_applied: exam.sessions_applied,
      };
      const current = existingByExam.get(exam.exam_id);
      if (current && unchanged(current, write)) continue;
      attempted += 1;
      try {
        if (current) await updateExamRecord(current.id, write);
        else await createExamRecord(write);
      } catch (error) {
        failed += 1;
        warnings.push(`Could not save ${exam.exam_name}: ${errorText(error)}`);
      }
    }

    // Every call failing is a failed save, not a partial one.
    if (attempted > 0 && failed === attempted) {
      return NextResponse.json({ error: warnings.join("; ") }, { status: 502 });
    }

    const records = await listStudentExamRecords(studentId);
    return NextResponse.json(warnings.length ? { records, warnings } : { records });
  } catch (error) {
    console.error("Error saving student exam records:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
