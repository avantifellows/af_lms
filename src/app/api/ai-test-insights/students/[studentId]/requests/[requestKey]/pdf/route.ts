import { NextResponse } from "next/server";

import { presignTestInsightPdf } from "@/lib/ai-test-insights-artifacts";
import {
  NO_STORE,
  readingNotConfigured,
  withCompletedInsightRequest,
} from "@/lib/ai-test-insights-request-routes";
import { aiTestInsightPdfFileName } from "@/lib/ai-test-insights-shared";

// The AI Summary PDF of one completed Insight Request (#565, physical centres
// only): the file AI Mentorship Guide made, which the card's "Download PDF"
// link fetches. Student access gates first, as a read, so viewers download it
// too: 401 no session, 422 bad id, 403 no `ai_test_insights` view, 404
// Student missing, not listed or out of scope. Then: 404 for a request key
// that is not that Student's, a request that is not `completed`, or one whose
// Item has no `report_pdf` file; 503 when reading is not configured; 502 when
// the key fails the environment folder check or signing fails. Otherwise a
// 302 to a presigned URL that lasts 60 seconds, as the document downloads do.
//
// The file name is built from the Student's `student.id` and the request's
// date in India, never the Student's name. It travels in the presigned URL,
// where S3 answers it as the download's `Content-Disposition` (a browser
// ignores that header on a redirect), and on the 302 itself.
//
// It only reads: no wake or enqueue call, no write. Logs carry the request
// key, the Student's id, a reason and an error name, never a key or the URL.
export const GET = withCompletedInsightRequest("AI Summary PDF not found", async (found, student) => {
  const fileName = aiTestInsightPdfFileName(student.studentId, found.requestedAt);
  const signed = await presignTestInsightPdf(student.studentId, found.requestKey, fileName);
  switch (signed.status) {
    case "signed":
      return NextResponse.redirect(signed.url, {
        status: 302,
        headers: { ...NO_STORE, "Content-Disposition": `attachment; filename="${fileName}"` },
      });
    case "no_file":
      return NextResponse.json({ error: "AI Summary PDF not found" }, { status: 404, headers: NO_STORE });
    case "not_configured":
      return readingNotConfigured();
    case "unreadable":
      console.error(
        `AI Test Insights PDF unreadable: request=${found.requestKey} student=${student.studentId} reason=${
          signed.reason
        }${signed.errorName ? ` error=${signed.errorName}` : ""}`,
      );
      return NextResponse.json({ error: "AI Summary PDF could not be read" }, { status: 502, headers: NO_STORE });
  }
});
