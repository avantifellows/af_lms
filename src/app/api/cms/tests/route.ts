import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { requireQuizSessionAccess } from "@/lib/quiz-session-access";
import {
  EXAM_TRACKS,
  curriculumIdForExamTrack,
  resolveGradeId,
} from "@/lib/curriculum-options";
import { CMS_TEST_TYPES, type CmsTestType } from "@/lib/cms-tests";
import { query } from "@/lib/db";
import type { ExamTrack } from "@/types/curriculum";

// New CMS (nex-gen-cms) service API. af_lms consumes the list route to let the session
// creator pick tests authored in the new CMS. The CMS list route is subtype-agnostic
// (testtype-dropdown), so this route takes a test_type and forwards it as-is — widening the
// set of supported test types is a picker/scope change with no backend work. For chapter
// tests the CMS returns chapter_id per test (in type_params) so we can offer "tests for a
// chapter". Bearer-authed, mirrors the DB_SERVICE_URL/TOKEN pattern.
const CMS_SERVICE_URL = process.env.CMS_SERVICE_URL;
const CMS_SERVICE_TOKEN = process.env.CMS_SERVICE_TOKEN;

interface RawCmsTest {
  id: number;
  code: string;
  name?: { lang_code: string; resource: string }[];
  subtype?: string;
  type_params?: { chapter_id?: number; marks?: number; duration?: string };
}

export interface CmsTestOption {
  id: number;
  code: string;
  name: string;
  chapterId: number | null;
  marks: number | null;
  duration: string | null;
}

function resourceName(test: RawCmsTest): string {
  const names = test.name ?? [];
  return (
    names.find((n) => n.lang_code === "en")?.resource ?? names[0]?.resource ?? ""
  );
}

// Staging + prod have duplicate chapter rows for the same chapter code (e.g. 12P17
// "Electric Charges and Fields" = ids 22 AND 27), and a test's type_params.chapter_id
// points at just one of them while the picker may hand us either. Resolve the selected
// chapter to every sibling id sharing its (code, subject, grade) so the match is robust to
// which duplicate was picked. See task lms-cms-tests.
async function chapterIdsSharingCode(chapterId: number): Promise<number[]> {
  const rows = await query<{ id: number }>(
    `SELECT sib.id
       FROM chapter sel
       JOIN chapter sib
         ON sib.code = sel.code
        AND sib.subject_id IS NOT DISTINCT FROM sel.subject_id
        AND sib.grade_id IS NOT DISTINCT FROM sel.grade_id
      WHERE sel.id = $1`,
    [chapterId]
  );
  return rows.map((r) => Number(r.id));
}

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const access = await requireQuizSessionAccess(session.user.email, "view");
  if (!access.ok) {
    return access.response;
  }

  if (!CMS_SERVICE_URL || !CMS_SERVICE_TOKEN) {
    return NextResponse.json(
      { error: "CMS service is not configured" },
      { status: 500 }
    );
  }

  const { searchParams } = new URL(request.url);
  const examTrack = (searchParams.get("exam_track") || "").trim() as ExamTrack;
  const grade = Number((searchParams.get("grade") || "").trim());
  const testType = (searchParams.get("test_type") || "chapter_test").trim() as CmsTestType;
  const chapterIdParam = (searchParams.get("chapter_id") || "").trim();

  if (!EXAM_TRACKS.includes(examTrack)) {
    return NextResponse.json(
      { error: "Invalid or missing exam_track" },
      { status: 400 }
    );
  }
  if (grade !== 11 && grade !== 12) {
    return NextResponse.json({ error: "grade must be 11 or 12" }, { status: 400 });
  }
  if (!CMS_TEST_TYPES.includes(testType)) {
    return NextResponse.json(
      { error: "Invalid or missing test_type" },
      { status: 400 }
    );
  }

  // Resolve the CMS grade id from the grade table (shared with the from-cms session route),
  // rather than trusting a client-side grade->id mapping that could drift.
  const gradeId = await resolveGradeId(grade);
  if (!gradeId) {
    return NextResponse.json(
      { error: `No grade row for grade ${grade}` },
      { status: 400 }
    );
  }

  const curriculumId = curriculumIdForExamTrack(examTrack);
  const cmsUrl =
    `${CMS_SERVICE_URL.replace(/\/$/, "")}/api/service/tests` +
    `?curriculum-dropdown=${curriculumId}` +
    `&grade-dropdown=${encodeURIComponent(String(gradeId))}` +
    `&testtype-dropdown=${encodeURIComponent(testType)}`;

  let response: Response;
  try {
    response = await fetch(cmsUrl, {
      headers: {
        Authorization: `Bearer ${CMS_SERVICE_TOKEN}`,
        accept: "application/json",
      },
      cache: "no-store",
    });
  } catch (err) {
    console.error("Failed to reach CMS service:", err);
    return NextResponse.json({ error: "Failed to reach CMS" }, { status: 502 });
  }

  if (!response.ok) {
    const errorText = await response.text();
    console.error("CMS tests fetch failed:", response.status, errorText);
    return NextResponse.json(
      { error: "Failed to fetch tests" },
      { status: response.status }
    );
  }

  const rawBody = (await response.json()) as unknown;
  // Defend against the CMS answering 200 with a non-array body (error/paginated shape after
  // an upstream change): surface an empty list, not a 500 from calling .filter on a non-array.
  if (!Array.isArray(rawBody)) {
    console.error("CMS tests response was not an array:", rawBody);
    return NextResponse.json({ tests: [] });
  }
  const rawTests = rawBody as RawCmsTest[];
  // chapter_id is only meaningful for chapter tests; other types ignore the filter. Match
  // against every sibling chapter id sharing the selected chapter's code (duplicate rows),
  // so a test linked to any of them shows up regardless of which duplicate was picked.
  const selectedChapterId =
    testType === "chapter_test" && chapterIdParam ? Number(chapterIdParam) : null;
  let chapterIds: Set<number> | null = null;
  if (selectedChapterId !== null) {
    const siblings = await chapterIdsSharingCode(selectedChapterId);
    chapterIds = new Set(siblings.length > 0 ? siblings : [selectedChapterId]);
  }

  const tests: CmsTestOption[] = rawTests
    .filter((test) => (test.subtype ?? testType) === testType)
    .filter(
      (test) =>
        chapterIds === null ||
        (test.type_params?.chapter_id !== undefined &&
          chapterIds.has(test.type_params.chapter_id))
    )
    .map((test) => ({
      id: test.id,
      code: test.code,
      name: resourceName(test),
      chapterId: test.type_params?.chapter_id ?? null,
      marks: test.type_params?.marks ?? null,
      duration: test.type_params?.duration ?? null,
    }));

  return NextResponse.json({ tests });
}
