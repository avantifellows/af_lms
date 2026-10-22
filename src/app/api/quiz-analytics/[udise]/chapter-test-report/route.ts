import { NextResponse } from "next/server";
import { authorizeSessionRead } from "@/lib/performance-session-request";
import { getChapterTestReport } from "@/lib/question-analytics";
import { isNvsProgram } from "@/lib/constants";

// The chapter-test report: overview, topic and difficulty insights, per-question
// results, gender split and the comparison with other physical centres on the
// same CMS test. Physical centres only, so JNV NVS is refused.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ udise: string }> }
) {
  const { udise } = await params;
  const read = await authorizeSessionRead(request, udise);
  if (!read.ok) return read.response;
  const { program, grade, sessionId, stream } = read;

  if (isNvsProgram(program)) {
    return NextResponse.json(
      { error: "Chapter test reports are not available for JNV NVS" },
      { status: 403 }
    );
  }

  try {
    const report = await getChapterTestReport({ udise, grade, sessionId, program, stream });
    if (!report) {
      return NextResponse.json(
        { error: "No results available for this test yet. Please check back in a few hours." },
        { status: 404 }
      );
    }
    return NextResponse.json(report);
  } catch (error) {
    console.error(
      "Chapter test report error:",
      error instanceof Error ? error.message : "unknown error"
    );
    return NextResponse.json({ error: "Failed to fetch chapter test report" }, { status: 500 });
  }
}
