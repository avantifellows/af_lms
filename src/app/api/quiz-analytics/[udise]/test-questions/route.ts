import { NextResponse } from "next/server";
import { authorizeSchoolAccess } from "@/lib/api-auth";
import { getTestQuestionLevelData } from "@/lib/bigquery";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ udise: string }> }
) {
  const { udise } = await params;
  const auth = await authorizeSchoolAccess(udise);
  if (!auth.authorized) return auth.response;

  const url = new URL(request.url);
  const gradeParam = url.searchParams.get("grade");
  const sessionId = url.searchParams.get("sessionId");

  if (!gradeParam || !sessionId) {
    return NextResponse.json(
      { error: "grade and sessionId are required" },
      { status: 400 }
    );
  }
  const grade = Number(gradeParam);
  if (!Number.isInteger(grade)) {
    return NextResponse.json({ error: "grade must be an integer" }, { status: 400 });
  }

  try {
    const program = url.searchParams.get("program") || undefined;
    const stream = url.searchParams.get("stream")?.toLowerCase() || undefined;
    const questions = await getTestQuestionLevelData(
      udise,
      grade,
      sessionId,
      program,
      stream
    );
    return NextResponse.json({ questions });
  } catch (error) {
    console.error("Test questions error:", error);
    return NextResponse.json(
      { error: "Failed to fetch question-level data" },
      { status: 500 }
    );
  }
}
