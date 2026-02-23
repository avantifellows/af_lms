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
  const grade = parseInt(gradeParam, 10);
  if (isNaN(grade)) {
    return NextResponse.json({ error: "grade must be a number" }, { status: 400 });
  }

  try {
    const raw = await getBatchOverviewData(udise, grade);

    // Compute summary
    const tests = raw.tests;
    const testsCount = tests.length;
    const avgParticipation =
      testsCount > 0
        ? Math.round(tests.reduce((s, t) => s + t.student_count, 0) / testsCount)
        : 0;
    const overallAvg =
      testsCount > 0
        ? Math.round(
            (tests.reduce((s, t) => s + t.avg_percentage, 0) / testsCount) * 10
          ) / 10
        : 0;

    // Trend: compare last 2 tests
    let trendDirection: BatchSummary["trend_direction"] = "flat";
    if (testsCount >= 2) {
      const last = tests[testsCount - 1].avg_percentage;
      const prev = tests[testsCount - 2].avg_percentage;
      if (last - prev > 1) trendDirection = "up";
      else if (prev - last > 1) trendDirection = "down";
    }

    // Weakest subject: lowest avg across all subject trend data
    let weakestSubject: string | null = null;
    if (raw.subjectTrend.length > 0) {
      const subjectAvgs = new Map<string, { total: number; count: number }>();
      for (const pt of raw.subjectTrend) {
        const entry = subjectAvgs.get(pt.subject) || { total: 0, count: 0 };
        entry.total += pt.avg_percentage;
        entry.count += 1;
        subjectAvgs.set(pt.subject, entry);
      }
      let minAvg = Infinity;
      for (const [subject, { total, count }] of subjectAvgs) {
        const avg = total / count;
        if (avg < minAvg) {
          minAvg = avg;
          weakestSubject = subject;
        }
      }
    }

    const summary: BatchSummary = {
      tests_conducted: testsCount,
      avg_participation: avgParticipation,
      overall_avg: overallAvg,
      trend_direction: trendDirection,
      weakest_subject: weakestSubject,
    };

    const response: BatchOverviewData = {
      summary,
      tests: raw.tests,
      subjectTrend: raw.subjectTrend,
      totalEnrolled: raw.totalEnrolled,
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
