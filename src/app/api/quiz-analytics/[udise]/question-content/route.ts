import { NextResponse } from "next/server";
import { authorizeSessionRead } from "@/lib/performance-session-request";
import { getCmsServiceConfig } from "@/lib/cms-service";
import { getSessionCmsTest } from "@/lib/question-analytics";
import { isNvsProgram } from "@/lib/constants";
import type { QuestionContent } from "@/types/question-analytics";

// One question's content (text, options, answer, solutions) from the CMS, for the
// chapter-test report. Gated like the report (Performance access to the School,
// the PMU pin; JNV NVS refused), not on quiz session access: teachers who read
// reports may not create sessions. The CMS test is looked up from the School's
// own session, and the question must have been in it, so a caller can only read
// questions their School has already sat. The CMS returns the whole assembled
// test; only the asked-for question is passed on, so the response stays small
// even when questions carry inline images.

interface CmsProblem {
  id: number;
  subtype?: string;
  paragraph?: { body?: string } | null;
  meta_data?: {
    text?: string;
    options?: string[] | null;
    answer?: string[] | null;
    solutions?: { type?: string; value?: string }[] | null;
  };
}

function isPositiveInt(value: string | null): value is string {
  return value != null && /^\d+$/.test(value) && Number(value) > 0;
}

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

  const questionId = new URL(request.url).searchParams.get("questionId");
  if (!isPositiveInt(questionId)) {
    return NextResponse.json({ error: "questionId must be a positive integer" }, { status: 400 });
  }

  let testId: string | null;
  try {
    testId = await getSessionCmsTest({ udise, grade, sessionId, program, stream }, Number(questionId));
  } catch (error) {
    console.error(
      "Session test lookup failed:",
      error instanceof Error ? error.message : "unknown error"
    );
    return NextResponse.json({ error: "Failed to look up the test" }, { status: 500 });
  }
  if (!testId) {
    return NextResponse.json({ error: "Question not found in this test" }, { status: 404 });
  }

  const cms = getCmsServiceConfig();
  if (!cms) {
    return NextResponse.json({ error: "CMS service is not configured" }, { status: 500 });
  }

  let response: Response;
  try {
    response = await fetch(`${cms.url}/api/service/test?id=${testId}`, {
      headers: { Authorization: `Bearer ${cms.token}` },
      cache: "no-store",
    });
  } catch (error) {
    console.error(
      "Failed to reach CMS:",
      error instanceof Error ? error.message : "unknown error"
    );
    return NextResponse.json({ error: "Failed to reach CMS" }, { status: 502 });
  }
  if (!response.ok) {
    console.error("CMS test fetch failed:", response.status);
    return NextResponse.json({ error: "Failed to fetch question" }, { status: 502 });
  }

  let body: { problems?: CmsProblem[] };
  try {
    body = (await response.json()) as { problems?: CmsProblem[] };
  } catch {
    console.error("CMS test response was not JSON");
    return NextResponse.json({ error: "Failed to fetch question" }, { status: 502 });
  }
  const problem = body.problems?.find((p) => p.id === Number(questionId));
  if (!problem) {
    return NextResponse.json({ error: "Question not found in this test" }, { status: 404 });
  }

  const meta = problem.meta_data ?? {};
  const paragraph = problem.paragraph?.body;
  const content: QuestionContent = {
    id: problem.id,
    type: problem.subtype ?? "",
    // A comprehension question's passage comes first, as on the paper.
    text: paragraph ? `${paragraph}${meta.text ?? ""}` : (meta.text ?? ""),
    options: meta.options ?? [],
    answer: meta.answer ?? [],
    solutions: (meta.solutions ?? [])
      .map((s) => s?.value ?? "")
      .filter((v) => v !== ""),
  };
  return NextResponse.json(content);
}
