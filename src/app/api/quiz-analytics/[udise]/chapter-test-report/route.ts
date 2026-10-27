import { NextResponse } from "next/server";
import { authorizeChapterReportRead } from "@/lib/chapter-report-request";
import { getChapterTestReport } from "@/lib/question-analytics";

// The chapter-test report: overview, topic and difficulty insights, per-question
// results, gender split and the comparison with other physical centres on the
// same CMS test. Physical centres only, so JNV NVS is refused.
// The Next.js handler shape every quiz-analytics route shares.
// fallow-ignore-next-line code-duplication
export async function GET(
  request: Request,
  { params }: { params: Promise<{ udise: string }> }
) {
  const { udise } = await params;
  const read = await authorizeChapterReportRead(request, udise);
  if (!read.ok) return read.response;

  try {
    const report = await getChapterTestReport(read.scope);
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
