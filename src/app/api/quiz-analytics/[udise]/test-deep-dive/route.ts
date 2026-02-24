import { NextResponse } from "next/server";
import { authorizeSchoolAccess } from "@/lib/api-auth";
import { getTestDeepDiveData, mergeStudentDeepDiveRows } from "@/lib/bigquery";
import type { TestDeepDiveSummary, TestDeepDiveData } from "@/types/quiz";

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
  const grade = parseInt(gradeParam, 10);
  if (isNaN(grade)) {
    return NextResponse.json({ error: "grade must be a number" }, { status: 400 });
  }

  try {
    const raw = await getTestDeepDiveData(udise, grade, sessionId);

    if (raw.overallResults.length === 0) {
      return NextResponse.json(
        { error: "No results found for this test" },
        { status: 404 }
      );
    }

    const results = raw.overallResults;
    const percentages = results.map((r) => r.percentage);
    const accuracies = results.map((r) => r.accuracy);
    const attemptRates = results.map((r) => r.attempt_rate);

    const avg = (arr: number[]) =>
      arr.length > 0
        ? Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 10) / 10
        : 0;

    const summary: TestDeepDiveSummary = {
      test_name: results[0].test_name,
      start_date: results[0].start_date,
      students_appeared: results.length,
      avg_score: avg(percentages),
      min_score: Math.round(Math.min(...percentages) * 10) / 10,
      max_score: Math.round(Math.max(...percentages) * 10) / 10,
      avg_accuracy: avg(accuracies),
      avg_attempt_rate: avg(attemptRates),
    };

    const students = mergeStudentDeepDiveRows(raw);

    const response: TestDeepDiveData = {
      summary,
      subjects: raw.subjectAggregates,
      chapters: raw.chapters,
      students: students.sort((a, b) => b.percentage - a.percentage),
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("Test deep dive error:", error);
    return NextResponse.json(
      { error: "Failed to fetch test deep dive data" },
      { status: 500 }
    );
  }
}
