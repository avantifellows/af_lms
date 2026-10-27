import { NextResponse } from "next/server";
import { authorizeStudentSupportRead } from "@/lib/student-support-request";
import { getStudentReport } from "@/lib/student-support";

/** One student's report: chapter competency and full-test history. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ udise: string }> }
) {
  const { udise } = await params;
  const req = await authorizeStudentSupportRead(request, udise);
  if (!req.ok) return req.response;

  const student = req.searchParams.get("student");
  if (!student || !/^\d+$/.test(student)) {
    return NextResponse.json({ error: "student must be a numeric id" }, { status: 400 });
  }

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
}
