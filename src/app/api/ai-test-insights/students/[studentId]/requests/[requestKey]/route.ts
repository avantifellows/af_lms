import { NextResponse } from "next/server";

import { errorName } from "@/lib/ai-test-insights-env";
import { withInsightRequest } from "@/lib/ai-test-insights-request-routes";
import { redeliver, requestByKey } from "@/lib/ai-test-insights-requests";
import type { AiTestInsightsRequestStatusResponse } from "@/lib/ai-test-insights-shared";

// The status of one Insight Request (#563, physical centres only), which the
// AI Summary card polls every 10 seconds while the request is `queued` or
// `running`. Student access gates first, as a read: 401 no session, 422 bad
// id, 403 no `ai_test_insights` view, 404 Student missing, not listed or out
// of scope. A request key that does not belong to that Student answers 404.
//
// The one read with a side effect: for a caller with edit access, a poll of a
// `queued` request runs the re-delivery claim (`redeliver`), at most once
// every 30 seconds per request, so a request whose first enqueue call was
// missed while the generator booted is not lost. A viewer's poll never
// re-delivers. The answer is `{ request }` either way, as the request reads
// after any re-delivery; a failed re-delivery is logged and never changes it.
// A request made 20 minutes ago or more reads `failed` with `timed_out` (the
// stall rule) and is never delivered again; the poll leaves its row as it is.
export const GET = withInsightRequest("Request not found", async (requested, student) => {
  let found = requested;
  if (student.canEdit && found.state === "queued") {
    try {
      if (await redeliver(found.requestKey)) found = (await requestByKey(student.studentId, found.requestKey)) ?? found;
    } catch (error) {
      // Only the request key, the Student's id and the error name.
      console.error(
        `AI Test Insights re-delivery failed: request=${found.requestKey} student=${student.studentId} error=${
          errorName(error)
        }`,
      );
    }
  }

  const response: AiTestInsightsRequestStatusResponse = { request: found };
  return NextResponse.json(response);
});
