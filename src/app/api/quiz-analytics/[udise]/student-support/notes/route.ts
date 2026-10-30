import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { badStudentParam, withStudentSupportRead } from "@/lib/student-support-request";
import { getMentorNoteCounts, getMentorNotes } from "@/lib/student-support-notes";

/**
 * Mentor notes for the cumulative report: note counts for the grade, or with
 * `student` that student's notes. On top of the Student support gate, the
 * Holistic Mentorship read rules apply (teachers: own mentees only). Not an
 * MCP view: notes are confidential.
 */
export const GET = withStudentSupportRead(async (req) => {
  const student = req.searchParams.get("student");
  const invalid = student === null ? null : badStudentParam(student);
  if (invalid) return invalid;

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
});
