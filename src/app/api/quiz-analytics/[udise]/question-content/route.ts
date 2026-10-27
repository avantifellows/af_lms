import { NextResponse } from "next/server";
import { authorizeChapterReportRead, lookUpSessionTest } from "@/lib/chapter-report-request";
import { getCmsServiceConfig } from "@/lib/cms-service";
import type { QuestionContent } from "@/types/question-analytics";

// One question's content (text, options, answer, solutions) from the CMS, for the
// chapter-test report, gated like the report (chapter-report-request.ts). The CMS
// test is looked up from the School's own session, and the question must have
// been in it, so a caller can only read questions their School has already sat. The CMS returns the whole assembled
// test; only the asked-for question is passed on, so the response stays small
// even when questions carry inline images.

interface CmsMetaData {
  text?: string;
  options?: string[] | null;
  answer?: string[] | null;
  solutions?: { type?: string; value?: string }[] | null;
}

interface CmsProblem {
  id: number;
  subtype?: string;
  paragraph?: { body?: string } | null;
  meta_data?: CmsMetaData;
  lang_versions?: { lang_code?: string; meta_data?: CmsMetaData | null }[] | null;
}

// Since the CMS went multilingual (nex-gen-cms #170) a problem's content lives per
// language in lang_versions; the top-level meta_data is kept but empty. Read the
// English version, as quiz-backend's cms_ingest does, and fall back to the flat copy
// only for older payloads.
function englishMeta(problem: CmsProblem): CmsMetaData {
  const en = problem.lang_versions?.find((v) => v?.lang_code === "en")?.meta_data;
  return en && Object.keys(en).length > 0 ? en : (problem.meta_data ?? {});
}

function isPositiveInt(value: string | null): value is string {
  return value != null && /^\d+$/.test(value) && Number(value) > 0;
}

/** The CMS's assembled test, or the error response to return. */
async function fetchCmsProblems(
  testId: string
): Promise<{ ok: true; problems: CmsProblem[] } | { ok: false; response: NextResponse }> {
  const cms = getCmsServiceConfig();
  if (!cms) {
    return {
      ok: false,
      response: NextResponse.json({ error: "CMS service is not configured" }, { status: 500 }),
    };
  }
  const failed = (log: string, error: string) => {
    console.error(log);
    return { ok: false as const, response: NextResponse.json({ error }, { status: 502 }) };
  };
  let response: Response;
  try {
    response = await fetch(`${cms.url}/api/service/test?id=${testId}`, {
      headers: { Authorization: `Bearer ${cms.token}` },
      cache: "no-store",
    });
  } catch (error) {
    return failed(
      `Failed to reach CMS: ${error instanceof Error ? error.message : "unknown error"}`,
      "Failed to reach CMS"
    );
  }
  if (!response.ok) return failed(`CMS test fetch failed: ${response.status}`, "Failed to fetch question");
  try {
    const body = (await response.json()) as { problems?: CmsProblem[] };
    return { ok: true, problems: body.problems ?? [] };
  } catch {
    return failed("CMS test response was not JSON", "Failed to fetch question");
  }
}

function toQuestionContent(problem: CmsProblem): QuestionContent {
  const meta = englishMeta(problem);
  const paragraph = problem.paragraph?.body;
  return {
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
}

// The Next.js handler shape every quiz-analytics route shares.
// fallow-ignore-next-line code-duplication
export async function GET(
  request: Request,
  { params }: { params: Promise<{ udise: string }> }
) {
  const { udise } = await params;
  const read = await authorizeChapterReportRead(request, udise);
  if (!read.ok) return read.response;

  const questionId = new URL(request.url).searchParams.get("questionId");
  if (!isPositiveInt(questionId)) {
    return NextResponse.json({ error: "questionId must be a positive integer" }, { status: 400 });
  }

  const test = await lookUpSessionTest(read.scope, "Question not found in this test", Number(questionId));
  if (!test.ok) return test.response;

  const cms = await fetchCmsProblems(test.testId);
  if (!cms.ok) return cms.response;
  const problem = cms.problems.find((p) => p.id === Number(questionId));
  if (!problem) {
    return NextResponse.json({ error: "Question not found in this test" }, { status: 404 });
  }
  return NextResponse.json(toQuestionContent(problem));
}
