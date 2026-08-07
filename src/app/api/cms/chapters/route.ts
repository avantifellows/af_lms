import { NextRequest, NextResponse } from "next/server";
import { requireQuizSessionRequestAccess } from "@/lib/quiz-session-access";
import { parseCmsCurriculumScope } from "@/lib/cms-tests";
import { query } from "@/lib/db";
import { SUBJECT_IDS, type SubjectName } from "@/types/curriculum";

// Chapters for the new-CMS chapter-test picker: in-syllabus chapters for an
// exam-track/grade/subject, so the session creator can drill Subject -> Chapter -> Test.
// Global content (keyed by exam_track), not school-scoped like /api/curriculum/chapters.

interface ChapterNameRow {
  id: number;
  code: string;
  name: { lang_code: string; chapter?: string }[] | null;
}

export interface CmsChapterOption {
  id: number;
  code: string;
  name: string;
}

function chapterName(row: ChapterNameRow): string {
  const names = row.name ?? [];
  return (
    names.find((n) => n.lang_code === "en")?.chapter ?? names[0]?.chapter ?? row.code
  );
}

export async function GET(request: NextRequest) {
  const access = await requireQuizSessionRequestAccess("view");
  if (!access.ok) {
    return access.response;
  }

  const { searchParams } = new URL(request.url);
  const subject = (searchParams.get("subject") || "").trim();
  const scope = parseCmsCurriculumScope(searchParams);
  if (!scope.ok) {
    return NextResponse.json({ error: scope.error }, { status: 400 });
  }
  const { examTrack, grade } = scope;
  const subjectId = SUBJECT_IDS[subject as SubjectName];
  if (!subjectId) {
    return NextResponse.json({ error: "Invalid or missing subject" }, { status: 400 });
  }

  // Duplicate chapter rows share a code (e.g. 12P17 = ids 22 AND 27), and the syllabus
  // config can expose more than one, which would surface two identical options. Collapse to
  // one row per code (DISTINCT ON), keeping the lowest coverage_sequence. Test matching in
  // /api/cms/tests is code-based, so whichever id survives still resolves to the right test.
  const rows = await query<ChapterNameRow>(
    `SELECT id, code, name
     FROM (
       SELECT DISTINCT ON (ch.code)
              ch.id, ch.code, ch.name, cfg.coverage_sequence
       FROM lms_chapter_exam_configs cfg
       JOIN chapter ch ON ch.id = cfg.chapter_id
       JOIN grade g ON g.id = ch.grade_id
       WHERE cfg.exam_track = $1
         AND cfg.is_in_syllabus = true
         AND g.number = $2
         AND ch.subject_id = $3
       ORDER BY ch.code ASC, cfg.coverage_sequence ASC, ch.id ASC
     ) deduped
     ORDER BY coverage_sequence ASC, code ASC`,
    [examTrack, grade, subjectId]
  );

  const chapters: CmsChapterOption[] = rows.map((row) => ({
    id: Number(row.id),
    code: row.code,
    name: chapterName(row),
  }));

  return NextResponse.json({ chapters });
}
