import { NextResponse } from "next/server";
import { authorizeSessionRead } from "@/lib/performance-session-request";
import { getSessionCmsTest, type SessionScope } from "@/lib/question-analytics";
import { isNvsProgram } from "@/lib/constants";

// The chapter-test report's routes (report, question content, PDFs) share one
// gate: Performance access to the School and the PMU pin, via authorizeSessionRead,
// and JNV NVS refused, since the report is for physical centres only. Not quiz
// session access: teachers who read reports may not create sessions.

type Refused = { ok: false; response: NextResponse };

export async function authorizeChapterReportRead(
  request: Request,
  udise: string
): Promise<{ ok: true; scope: SessionScope } | Refused> {
  const read = await authorizeSessionRead(request, udise);
  if (!read.ok) return read;
  const { program, grade, sessionId, stream } = read;
  if (isNvsProgram(program)) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Not available for JNV NVS" }, { status: 403 }),
    };
  }
  return { ok: true, scope: { udise, grade, sessionId, program, stream } };
}

/**
 * The CMS test the School's session sat, looked up server-side so a caller can
 * only reach tests (and, with `questionId`, questions) the School has sat.
 */
export async function lookUpSessionTest(
  scope: SessionScope,
  notFound: string,
  questionId?: number
): Promise<{ ok: true; testId: string } | Refused> {
  let testId: string | null;
  try {
    testId = questionId == null ? await getSessionCmsTest(scope) : await getSessionCmsTest(scope, questionId);
  } catch (error) {
    console.error(
      "Session test lookup failed:",
      error instanceof Error ? error.message : "unknown error"
    );
    return {
      ok: false,
      response: NextResponse.json({ error: "Failed to look up the test" }, { status: 500 }),
    };
  }
  if (!testId) {
    return { ok: false, response: NextResponse.json({ error: notFound }, { status: 404 }) };
  }
  return { ok: true, testId };
}
