import { NextResponse } from "next/server";
import { authorizeSchoolAccess } from "@/lib/api-auth";
import { getBatchOverviewData } from "@/lib/bigquery";
import type { BatchSummary, BatchOverviewData } from "@/types/quiz";

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
    const raw = await getBatchOverviewData(udise, grade, program);

    const tests = raw.tests;
    const testsCount = tests.length;
    const avgParticipation =
      testsCount > 0
        ? Math.round(tests.reduce((s, t) => s + t.student_count, 0) / testsCount)
        : 0;

    const summary: BatchSummary = {
      tests_conducted: testsCount,
      avg_participation: avgParticipation,
    };

    const response: BatchOverviewData = {
      summary,
      tests: raw.tests,
      totalEnrolled: raw.totalEnrolled,
      enrolledByStream: raw.enrolledByStream,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("Batch overview error:", error);
    return NextResponse.json(
      { error: "Failed to fetch batch overview" },
      { status: 500 }
    );
  }
}
