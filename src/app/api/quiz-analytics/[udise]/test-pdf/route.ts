import { NextResponse } from "next/server";
import { authorizeSessionRead } from "@/lib/performance-session-request";
import { getCmsServiceConfig } from "@/lib/cms-service";
import { serveCmsTestPdf } from "@/lib/cms-test-pdf";
import { getSessionCmsTest } from "@/lib/question-analytics";
import { isNvsProgram } from "@/lib/constants";

// The question paper / answer key for a School's chapter-test session, from the
// chapter-test report. Same generator as /api/cms/test-pdf, but gated like the
// report (Performance access, the PMU pin; JNV NVS refused) rather than on quiz
// session access: teachers who read reports may not create sessions. The CMS test
// is looked up from the School's own session, never taken from the browser, so
// only papers the School has already sat can be fetched.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ udise: string }> }
) {
  const { udise } = await params;
  const read = await authorizeSessionRead(request, udise);
  if (!read.ok) return read.response;
  const { program, grade, sessionId, stream } = read;
  if (isNvsProgram(program)) {
    return NextResponse.json({ error: "Not available for JNV NVS" }, { status: 403 });
  }

  const cms = getCmsServiceConfig();
  if (!cms) {
    return NextResponse.json({ error: "CMS service is not configured" }, { status: 500 });
  }

  let testId: string | null;
  try {
    testId = await getSessionCmsTest({ udise, grade, sessionId, program, stream });
  } catch (error) {
    console.error(
      "Session test lookup failed:",
      error instanceof Error ? error.message : "unknown error"
    );
    return NextResponse.json({ error: "Failed to look up the test" }, { status: 500 });
  }
  if (!testId) {
    return NextResponse.json({ error: "No CMS paper for this test" }, { status: 404 });
  }

  const url = new URL(request.url);
  const pdfUrl = new URL(url.origin + url.pathname);
  pdfUrl.searchParams.set("testId", testId);
  for (const key of ["type", "download", "lang"]) {
    const value = url.searchParams.get(key);
    if (value) pdfUrl.searchParams.set(key, value);
  }
  return serveCmsTestPdf(new Request(pdfUrl), cms);
}
