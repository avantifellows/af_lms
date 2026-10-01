import { NextRequest, NextResponse } from "next/server";
import { requireQuizSessionRequestAccess } from "@/lib/quiz-session-access";
import { getCmsTestLanguages } from "@/lib/cms-test-languages";

// Regional languages a CMS test's PDFs can be printed in (session details uses this).
export async function GET(request: NextRequest) {
  const access = await requireQuizSessionRequestAccess("view");
  if (!access.ok) return access.response;

  const testId = Number(new URL(request.url).searchParams.get("testId"));
  if (!Number.isInteger(testId) || testId <= 0) {
    return NextResponse.json({ error: "testId is required" }, { status: 400 });
  }

  const languages = await getCmsTestLanguages([testId]);
  return NextResponse.json({ languages: languages.get(testId) ?? [] });
}
