import { NextResponse } from "next/server";
import { badStudentParam, withStudentSupportRead } from "@/lib/student-support-request";
import { getStudentReport } from "@/lib/student-support";

/** One student's report: chapter competency and full-test history. */
export const GET = withStudentSupportRead(async (req, udise) => {
  const student = req.searchParams.get("student") ?? "";
  const invalid = badStudentParam(student);
  if (invalid) return invalid;

  try {
    const report = await getStudentReport(udise, req.grade, req.program, student);
    if (!report) {
      return NextResponse.json({ error: "Student not found in this grade" }, { status: 404 });
    }
    return NextResponse.json(report);
  } catch (error) {
    console.error("Student report error:", error);
    return NextResponse.json({ error: "Failed to fetch the student report" }, { status: 500 });
  }
});
