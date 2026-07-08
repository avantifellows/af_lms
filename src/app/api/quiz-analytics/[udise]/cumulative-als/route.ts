import { NextResponse } from "next/server";
import { authorizeSchoolAccess } from "@/lib/api-auth";
import { getCumulativeALData } from "@/lib/bigquery";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ udise: string }> }
) {
  const { udise } = await params;
  const auth = await authorizeSchoolAccess(udise);
  if (!auth.authorized) return auth.response;

  const url = new URL(request.url);
  const gradeParam = url.searchParams.get("grade");
  if (!gradeParam) {
    return NextResponse.json({ error: "grade is required" }, { status: 400 });
  }
  const grade = Number(gradeParam);
  if (!Number.isInteger(grade)) {
    return NextResponse.json({ error: "grade must be an integer" }, { status: 400 });
  }

  try {
    const program = url.searchParams.get("program") || undefined;
    const stream = url.searchParams.get("stream")?.toLowerCase() || undefined;
    const testGradeParam = url.searchParams.get("testGrade");
    const testGrade =
      testGradeParam && Number.isInteger(Number(testGradeParam))
        ? Number(testGradeParam)
        : undefined;
    const data = await getCumulativeALData(udise, grade, program, stream, testGrade);
    return NextResponse.json(data);
  } catch (error) {
    console.error("Cumulative AL error:", error);
    return NextResponse.json(
      { error: "Failed to fetch cumulative AL data" },
      { status: 500 }
    );
  }
}
