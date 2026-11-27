import { NextResponse, type NextRequest } from "next/server";

import { resolveAiTestInsightsListScope } from "@/lib/ai-test-insights-access";
import { listAiTestInsightsStudents } from "@/lib/ai-test-insights-students";
import type { AiTestInsightsListResponse } from "@/lib/ai-test-insights-shared";

// AI Test Insights Tab list (#550). The access module gates before any Student
// read: 401 no session, 404 School not found, 403 no School access, 403 no
// `ai_test_insights` view, 403 no physical-centre scope for this user.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ udise: string }> },
) {
  const { udise } = await params;
  const scope = await resolveAiTestInsightsListScope(udise, request.nextUrl.searchParams.get("centre_id"));
  if (!scope.authorized) return scope.response;

  try {
    const body: AiTestInsightsListResponse = { students: await listAiTestInsightsStudents(scope.centreIds) };
    return NextResponse.json(body);
  } catch (error) {
    // Error name only: a database message can quote row values, and logs never
    // carry a Student name.
    console.error("AI Test Insights list failed:", error instanceof Error ? error.name : "unknown error");
    return NextResponse.json({ error: "Failed to load AI Test Insights" }, { status: 500 });
  }
}
