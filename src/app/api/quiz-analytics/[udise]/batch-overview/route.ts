import { NextResponse } from "next/server";
import { authorizeSchoolAccess } from "@/lib/api-auth";
import { resolvePerformanceProgram } from "@/lib/performance-program";
import { getBatchOverviewData } from "@/lib/bigquery";
import { getCmsTestChapters, priorityForStream } from "@/lib/question-analytics";
import { isNvsProgram } from "@/lib/constants";
import type { BatchSummary, BatchOverviewData, TestTrendPoint } from "@/types/quiz";

const CHAPTER_FORMATS = ["chapter_test", "combined_chapter_test", "homework"];

// Physical centres' chapter-test cards show the CMS chapter (code, name, subject,
// priority). A failed lookup leaves the cards on the test name rather than
// failing the overview.
async function withChapters(tests: TestTrendPoint[]): Promise<TestTrendPoint[]> {
  const ids = tests
    .filter((t) => t.cms_test_id && CHAPTER_FORMATS.includes((t.test_format ?? "").toLowerCase()))
    .map((t) => t.cms_test_id!);
  if (ids.length === 0) return tests;
  try {
    const chapters = await getCmsTestChapters(ids);
    return tests.map((t) => {
      const c = t.cms_test_id ? chapters.get(t.cms_test_id) : undefined;
      if (!c) return t;
      return {
        ...t,
        chapter: {
          code: c.chapter_code,
          name: c.chapter_name,
          subject: c.subject,
          priority: priorityForStream(c, t.test_stream),
        },
      };
    });
  } catch (error) {
    console.error(
      "Chapter lookup failed:",
      error instanceof Error ? error.message : "unknown error"
    );
    return tests;
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ udise: string }> }
) {
  const { udise } = await params;
  const auth = await authorizeSchoolAccess(udise, { feature: "performance" });
  if (!auth.authorized) return auth.response;

  const url = new URL(request.url);
  const pinned = resolvePerformanceProgram(
    auth.permission,
    url.searchParams.get("program") || undefined
  );
  if (!pinned.ok) return pinned.response;
  const program = pinned.program;
  const gradeParam = url.searchParams.get("grade");
  if (!gradeParam) {
    return NextResponse.json({ error: "grade is required" }, { status: 400 });
  }
  const grade = Number(gradeParam);
  if (!Number.isInteger(grade)) {
    return NextResponse.json({ error: "grade must be an integer" }, { status: 400 });
  }

  try {
    const stream = url.searchParams.get("stream")?.toLowerCase() || undefined;
    const raw = await getBatchOverviewData(udise, grade, program, stream);

    const tests = isNvsProgram(program) ? raw.tests : await withChapters(raw.tests);
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
      tests,
      totalEnrolled: raw.totalEnrolled,
      enrolledByStream: raw.enrolledByStream,
      streams: raw.streams,
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
