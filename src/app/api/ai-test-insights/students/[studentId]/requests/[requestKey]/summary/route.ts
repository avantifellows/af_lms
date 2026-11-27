import { NextResponse, type NextRequest } from "next/server";

import { resolveAiTestInsightsStudentAccess } from "@/lib/ai-test-insights-access";
import { readTestInsightText } from "@/lib/ai-test-insights-artifacts";
import { requestByKey } from "@/lib/ai-test-insights-requests";
import { NOT_CONFIGURED_CODE, type AiTestInsightsSummaryResponse } from "@/lib/ai-test-insights-shared";

// The AI Summary text of one completed Insight Request (#564, physical
// centres only), which the AI Summary card shows. Student access gates first,
// as a read, so viewers read it too: 401 no session, 422 bad id, 403 no
// `ai_test_insights` view, 404 Student missing, not listed or out of scope.
// Then: 404 for a request key that is not that Student's, a request that is
// not `completed`, or one whose Item has no report file; 503 when reading is
// not configured; 502 when the key fails the environment folder check, the
// text is larger than 1 MB, or the store read fails.
//
// It only reads: no wake or enqueue call, no write. Logs carry the request
// key, the Student's id, a reason and an error name, never the text or a key.
const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ studentId: string; requestKey: string }> },
) {
  const { studentId, requestKey } = await params;
  const access = await resolveAiTestInsightsStudentAccess(studentId, {
    centre: request.nextUrl.searchParams.get("centre"),
  });
  if (!access.authorized) return access.response;
  const { student } = access;

  const found = await requestByKey(student.studentId, requestKey);
  if (!found || found.state !== "completed") {
    return NextResponse.json({ error: "AI Summary not found" }, { status: 404, headers: NO_STORE });
  }

  const read = await readTestInsightText(student.studentId, found.requestKey);
  switch (read.status) {
    case "read": {
      const body: AiTestInsightsSummaryResponse = { markdown: read.markdown };
      return NextResponse.json(body, { headers: NO_STORE });
    }
    case "no_file":
      return NextResponse.json({ error: "AI Summary not found" }, { status: 404, headers: NO_STORE });
    case "not_configured":
      return NextResponse.json(
        { error: "AI Summary reading is not configured", code: NOT_CONFIGURED_CODE },
        { status: 503, headers: NO_STORE },
      );
    case "unreadable":
      console.error(
        `AI Test Insights summary unreadable: request=${found.requestKey} student=${student.studentId} reason=${
          read.reason
        }${read.errorName ? ` error=${read.errorName}` : ""}`,
      );
      return NextResponse.json({ error: "AI Summary could not be read" }, { status: 502, headers: NO_STORE });
  }
}
