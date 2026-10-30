import { NextResponse } from "next/server";
import { withStudentSupportRead } from "@/lib/student-support-request";
import { getScoreJourney } from "@/lib/student-support";

/** Score journey: every enrolled student of the grade, Predicted vs Mode AL. */
export const GET = withStudentSupportRead(async (req, udise) => {
  try {
    const stream = req.searchParams.get("stream")?.toLowerCase() || undefined;
    const testGradeParam = Number(req.searchParams.get("testGrade"));
    const testGrade = req.searchParams.get("testGrade") && Number.isInteger(testGradeParam) ? testGradeParam : undefined;
    return NextResponse.json(await getScoreJourney(udise, req.grade, req.program, stream, testGrade));
  } catch (error) {
    console.error("Score journey error:", error);
    return NextResponse.json({ error: "Failed to fetch the score journey" }, { status: 500 });
  }
});
