import { NextResponse, type NextRequest } from "next/server";

import { resolveAiTestInsightsStudentAccess } from "@/lib/ai-test-insights-access";
import { errorName } from "@/lib/ai-test-insights-env";
import type { AiTestInsightsTestsResponse } from "@/lib/ai-test-insights-shared";
import { readAiTestInsightsTests } from "@/lib/ai-test-insights-tests";

// The AI Summary card's test picker (#550, physical centres only): the
// Student's submitted Major, Full Syllabus and Mock tests of this year, newest
// first. Student access gates before the warehouse is read: 401 no session,
// 422 bad id, 403 no `ai_test_insights` view, 404 Student missing, not listed
// or out of scope. Viewers may read it too. A failed warehouse read is 502.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ studentId: string }> },
) {
  const { studentId } = await params;
  const access = await resolveAiTestInsightsStudentAccess(studentId);
  if (!access.authorized) return access.response;

  try {
    const body: AiTestInsightsTestsResponse = { tests: await readAiTestInsightsTests(access.student.userId) };
    return NextResponse.json(body);
  } catch (error) {
    // Error name only: a warehouse message can quote ids or row values.
    console.error("AI Test Insights test picker read failed:", errorName(error, "unknown error"));
    return NextResponse.json({ error: "Tests could not be loaded" }, { status: 502 });
  }
}
