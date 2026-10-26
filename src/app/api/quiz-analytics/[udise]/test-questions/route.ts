import { NextResponse } from "next/server";
import { authorizeSessionRead } from "@/lib/performance-session-request";
import { getTestQuestionLevelData } from "@/lib/bigquery";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ udise: string }> }
) {
  const { udise } = await params;
  const read = await authorizeSessionRead(request, udise);
  if (!read.ok) return read.response;
  const { program, grade, sessionId, stream } = read;

  try {
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
