import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { canAccessSchool } from "@/lib/permissions";
import { query } from "@/lib/db";
import { getQuizResults, getQuizSubjectResults } from "@/lib/bigquery";
import type { QuizSummary, ScoreDistribution, SubjectScore, QuizResult } from "@/types/quiz";

interface School {
  id: string;
  code: string;
  region: string | null;
}

async function getSchoolByUdise(udise: string): Promise<School | null> {
  const schools = await query<School>(
    `SELECT id, code, region FROM school WHERE udise_code = $1 OR code = $1`,
    [udise]
  );
  return schools[0] || null;
}

function calculateScoreDistribution(scores: number[]): ScoreDistribution[] {
  const ranges = [
    { range: "0-20%", min: 0, max: 20 },
    { range: "20-40%", min: 20, max: 40 },
    { range: "40-60%", min: 40, max: 60 },
    { range: "60-80%", min: 60, max: 80 },
    { range: "80-100%", min: 80, max: 101 },
  ];

  return ranges.map(({ range, min, max }) => ({
    range,
    count: scores.filter((s) => s >= min && s < max).length,
  }));
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ udise: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { udise } = await params;
  const { quizId } = await request.json();

  if (!quizId) {
    return NextResponse.json({ error: "Quiz ID is required" }, { status: 400 });
  }

  // Validate access
  const school = await getSchoolByUdise(udise);
  if (!school) {
    return NextResponse.json({ error: "School not found" }, { status: 404 });
  }

  const isPasscodeUser = session.isPasscodeUser;
  if (isPasscodeUser) {
    if (session.schoolCode !== school.code) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }
  } else {
    const hasAccess = await canAccessSchool(
      session.user?.email || null,
      school.code,
      school.region || undefined
    );
    if (!hasAccess) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }
  }

  try {
    // Fetch data from BigQuery
    const [overallResults, subjectResults] = await Promise.all([
      getQuizResults(quizId, udise),
      getQuizSubjectResults(quizId, udise),
    ]);

    if (overallResults.length === 0) {
      return NextResponse.json({
        summary: null,
        message: "No results found for this quiz",
      });
    }

    // Calculate summary statistics (attendance_status is "Present" in BigQuery)
    const presentStudents = overallResults.filter(
      (r) => r.attendance_status?.toLowerCase() === "present"
    );
    const absentStudents = overallResults.filter(
      (r) => r.attendance_status?.toLowerCase() !== "present"
    );

    const scores = presentStudents
      .map((r) => r.percentage_score)
      .filter((s): s is number => s !== null);

    const avgScore = scores.length > 0
      ? scores.reduce((a, b) => a + b, 0) / scores.length
      : 0;
    const minScore = scores.length > 0 ? Math.min(...scores) : 0;
    const maxScore = scores.length > 0 ? Math.max(...scores) : 0;

    // Calculate subject-wise scores
    const subjectMap = new Map<string, { total: number; count: number }>();
    for (const row of subjectResults) {
      if (row.subject_name && row.subject_marks_obtained !== null && row.subject_total_marks) {
        const pct = (row.subject_marks_obtained / row.subject_total_marks) * 100;
        const existing = subjectMap.get(row.subject_name) || { total: 0, count: 0 };
        subjectMap.set(row.subject_name, {
          total: existing.total + pct,
          count: existing.count + 1,
        });
      }
    }

    const subjectScores: SubjectScore[] = Array.from(subjectMap.entries()).map(
      ([subject_name, { total, count }]) => ({
        subject_name,
        avg_percentage: Math.round((total / count) * 10) / 10,
        student_count: count,
      })
    );

    // Build student results
    const studentResults: QuizResult[] = overallResults.map((r) => ({
      student_name: r.student_full_name,
      attendance_status: r.attendance_status,
      marks_obtained: r.total_marks_obtained,
      total_marks: r.total_marks,
      percentage: r.percentage_score,
    }));

    const summary: QuizSummary = {
      total_students: overallResults.length,
      present_count: presentStudents.length,
      absent_count: absentStudents.length,
      avg_score: Math.round(avgScore * 10) / 10,
      min_score: Math.round(minScore * 10) / 10,
      max_score: Math.round(maxScore * 10) / 10,
      score_distribution: calculateScoreDistribution(scores),
      subject_scores: subjectScores,
      student_results: studentResults.sort((a, b) =>
        (b.percentage || 0) - (a.percentage || 0)
      ),
    };

    return NextResponse.json({ summary });
  } catch (error) {
    console.error("Quiz analytics error:", error);
    return NextResponse.json(
      { error: "Failed to fetch quiz analytics" },
      { status: 500 }
    );
  }
}
