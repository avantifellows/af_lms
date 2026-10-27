import { NextResponse } from "next/server";
import { authorizeChapterReportRead, lookUpSessionTest } from "@/lib/chapter-report-request";
import { getCmsServiceConfig } from "@/lib/cms-service";
import { serveCmsTestPdf } from "@/lib/cms-test-pdf";

// The question paper / answer key for a School's chapter-test session, from the
// chapter-test report. Same generator as /api/cms/test-pdf, but gated like the
// report (Performance access, the PMU pin; JNV NVS refused) rather than on quiz
// session access: teachers who read reports may not create sessions. The CMS test
// is looked up from the School's own session, never taken from the browser, so
// only papers the School has already sat can be fetched.
// The Next.js handler shape every quiz-analytics route shares.
// fallow-ignore-next-line code-duplication
export async function GET(
  request: Request,
  { params }: { params: Promise<{ udise: string }> }
) {
  const { udise } = await params;
  const read = await authorizeChapterReportRead(request, udise);
  if (!read.ok) return read.response;

  const cms = getCmsServiceConfig();
  if (!cms) {
    return NextResponse.json({ error: "CMS service is not configured" }, { status: 500 });
  }

  const test = await lookUpSessionTest(read.scope, "No CMS paper for this test");
  if (!test.ok) return test.response;

  const url = new URL(request.url);
  const pdfUrl = new URL(url.origin + url.pathname);
  pdfUrl.searchParams.set("testId", test.testId);
  for (const key of ["type", "download", "lang"]) {
    const value = url.searchParams.get(key);
    if (value) pdfUrl.searchParams.set(key, value);
  }
  return serveCmsTestPdf(new Request(pdfUrl), cms);
}
