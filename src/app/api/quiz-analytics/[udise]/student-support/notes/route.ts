import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { authorizeStudentSupportRead } from "@/lib/student-support-request";
import { getMentorNoteCounts, getMentorNotes } from "@/lib/student-support-notes";

/**
 * Mentor notes for the cumulative report: note counts for the grade, or with
 * `student` that student's notes. On top of the Student support gate, the
 * Holistic Mentorship read rules apply (teachers: own mentees only). Not an
 * MCP view: notes are confidential.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ udise: string }> }
) {
  const { udise } = await params;
  const req = await authorizeStudentSupportRead(request, udise);
  if (!req.ok) return req.response;

  const student = req.searchParams.get("student");
  if (student !== null && !/^\d+$/.test(student)) {
    return NextResponse.json({ error: "student must be a numeric id" }, { status: 400 });
  }

  try {
    const session = await getSession();
    if (student === null) {
      return NextResponse.json({ counts: await getMentorNoteCounts(session, req.schoolCode, req.grade) });
    }
    const notes = await getMentorNotes(session, req.schoolCode, student);
    return notes
      ? NextResponse.json({ interactions: notes })
      : NextResponse.json({ error: "Not found" }, { status: 404 });
  } catch (error) {
    console.error("Mentor notes error:", error);
    return NextResponse.json({ error: "Failed to fetch mentor notes" }, { status: 500 });
  }
}
