import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  examPasswordViewer,
  gateExamRecords,
  parsePositiveId,
} from "@/lib/exam-records-gate";
import {
  getExamPasswordSource,
  recordExamPasswordReveal,
} from "@/lib/student-exam-records";
import { decryptExamPassword } from "@/lib/exam-password-crypto";

// Reveal one stored exam-portal password. The only place a password is
// decrypted, and every reveal is logged to `lms_exam_password_reveals`.
//
// POST, not GET: it writes the log, and it must never be cached or prefetched.
// Gate order: the Exams tab gate (edit rights on the Student, not JNV NVS) →
// `exam_passwords` view → the record belongs to this Student. A record that is
// missing, another Student's, or has no password is a 404 alike.

const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string; recordId: string }> },
) {
  const { id, recordId: rawRecordId } = await params;
  const session = await getServerSession(authOptions);
  const gated = await gateExamRecords(session, id);
  if (!gated.ok) return gated.response;

  const viewer = session ? await examPasswordViewer(session) : null;
  if (!viewer?.canReveal) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const recordId = parsePositiveId(rawRecordId);
  if (recordId === null) {
    return NextResponse.json({ error: "Invalid record id" }, { status: 400 });
  }

  try {
    const source = await getExamPasswordSource(gated.studentId, recordId);
    if (!source || (!source.ciphertext && !source.legacyPlaintext)) {
      return NextResponse.json({ error: "No password stored" }, { status: 404 });
    }

    const password = source.ciphertext
      ? await decryptExamPassword(source.ciphertext, gated.studentId)
      : (source.legacyPlaintext as string);

    // Logged before the password is returned: a reveal that can't be logged
    // isn't made.
    await recordExamPasswordReveal({
      studentId: gated.studentId,
      recordId: source.recordId,
      examId: source.examId,
      viewerEmail: viewer.email,
      viewerRole: viewer.role,
    });

    return NextResponse.json({ password }, { headers: NO_STORE });
  } catch (error) {
    // Never log the password or the ciphertext — only that the reveal failed.
    console.error(
      "Error revealing exam password:",
      error instanceof Error ? error.name : "unknown error",
    );
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
